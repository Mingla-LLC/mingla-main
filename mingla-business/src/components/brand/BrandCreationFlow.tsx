/**
 * #4389 — brand setup with the minimum information: 4 steps, full screen.
 *
 *   F1 Name your brand → F2 Where will you collect funds? → F3 Get paid → F4 You're all set
 *
 * MINGLA-INVARIANT: I-4389-NO-MODAL-ON-OVERLAY | issue #4389 | BrandCreationFlow mounts only on the full-screen routes app/brand/new.tsx and app/brand/[id]/setup.tsx; its bank-country step renders PayoutCountryList inline (no Sheet, no RN Modal). The K1 confirmation is the flow's only sheet and opens over this route, never over another sheet.
 *
 * - The step is DERIVED from `brand_readiness(brand_setup)` on mount and on
 *   focus, never stored (R-9, R-13). Every Continue writes to the server
 *   before it advances. "You're all set" is unreachable while an item is open.
 * - F1 creates with a client id generated when F1 mounts (R-1): a double tap,
 *   a retry or a retry after a lost response is one brand.
 * - Partner client mode keeps its own flow (PartnerClientBrandCreationFlow).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

// Keyboard-aware on native (the CTA and focused field stay clear of the keyboard, U-2).
import { ScrollView } from "../../wrappers/SmartScrollView";

import { useAuth } from "../../context/AuthContext";
import { accent, canvas, radius, semantic, spacing, text as textTokens, typography } from "../../constants/designSystem";
import {
  BrandSetupError,
  deriveSetupStep,
  discardDraftBrand,
  newBrandId,
  refreshStripeSetupStatus,
  type BrandSetupStep,
  type StripeSetupStatus,
} from "../../services/brandSetupService";
import {
  useBrandSetupChecklist,
  useCreateSetupBrand,
  useMarkBrandSetupFreeOnly,
  useSetBrandPayoutCountry,
} from "../../hooks/useBrandSetupChecklist";
import {
  CURRENT_MINGLA_TOS_VERSION,
  ORGANISER_TERMS_URL,
  useAcceptMinglaToS,
} from "../../hooks/useMinglaToSAcceptance";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import { tapToPayBrandEligible } from "../../utils/tapToPayBrandEligible";
import { useTapToPaySettingsEntry } from "../../hooks/useTapToPaySettingsEntry";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { Toast } from "../ui/Toast";
import { OfferingChooser, routeForOffering } from "./OfferingChooser";
import { BrandPaystackOnboardView } from "./BrandPaystackOnboardView";
import { BRAND_SETUP_COPY as C } from "./brandSetupCopy";
import { PayoutCountryList, payoutCountryOption } from "./PayoutCountryList";
import { trackBrandSetup } from "./brandSetupAnalytics";
import { useCurrentBrandStore, type Brand } from "../../store/currentBrandStore";
import { useUpdateCreatorAccount } from "../../hooks/useCreatorAccount";
import { getBrand } from "../../services/brandsService";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TTP_VISUAL: number | null = (() => {
  try {
    return require("../../../assets/tap-to-pay/ttp-visual.png") as number;
  } catch {
    // A plain node test run has no asset transform; the card draws without art.
    return null;
  }
})();

export interface BrandCreationFlowProps {
  /** null = a new brand (/brand/new). */
  brandId: string | null;
  /** `?step=` from the route; clamped to the first open step. */
  requestedStep?: BrandSetupStep | null;
  /** The route came from a resume (Home card, Ari card, relaunch). */
  resumed?: boolean;
  onExit: () => void;
}

const STEP_INDEX: Record<BrandSetupStep, number> = { name: 1, country: 2, pay: 3, done: 4 };
/** F4 polls the live account read at mount, 3 s, 8 s and 20 s (R-5). */
export const F4_POLL_DELAYS_MS = [0, 3000, 8000, 20000] as const;

export const BrandCreationFlow: React.FC<BrandCreationFlowProps> = ({
  brandId,
  requestedStep = null,
  resumed = false,
  onExit,
}) => {
  const router = useRouter();
  const { user, isAuthReady } = useAuth();
  const network = useNetInfoSafe();
  const offline = network?.isConnected === false;

  const checklistQuery = useBrandSetupChecklist(brandId);
  const checklist = checklistQuery.data ?? null;

  // A new brand becomes the current brand and the saved default (I-0756A),
  // so Home, Ari and the switcher open on it.
  const setCurrentBrand = useCurrentBrandStore((st) => st.setCurrentBrand);
  const updateCreatorAccountMutation = useUpdateCreatorAccount();
  const commitDefaultBrand = useCallback(
    (newBrand: Brand): void => {
      setCurrentBrand(newBrand);
      void updateCreatorAccountMutation
        .mutateAsync({ default_brand_id: newBrand.id })
        .catch((error: unknown) => {
          console.warn("[brand-setup] could not save the default brand", error);
        });
    },
    [setCurrentBrand, updateCreatorAccountMutation],
  );
  const adoptCreatedBrand = useCallback(
    (id: string): void => {
      void getBrand(id)
        .then((newBrand) => {
          if (newBrand !== null) commitDefaultBrand(newBrand);
        })
        .catch((error: unknown) => {
          console.warn("[brand-setup] could not read the new brand", error);
        });
    },
    [commitDefaultBrand],
  );
  const facts = checklist?.facts ?? null;
  const brandName = checklist?.readiness.items.find((i) => i.key === "brand.name")?.valuePreview ?? "";

  // ── which step ─────────────────────────────────────────────────────────
  const derived = brandId === null ? "name" : deriveSetupStep(checklist, requestedStep);
  const [backTo, setBackTo] = useState<BrandSetupStep | null>(null);
  const step: BrandSetupStep = brandId === null
    ? "name"
    : backTo !== null && STEP_INDEX[backTo] <= STEP_INDEX[derived]
    ? backTo
    : derived === "name" ? "country" : derived;

  useFocusEffect(
    useCallback(() => {
      // R-14: returning from the secure screen or the app foregrounding.
      if (brandId !== null) void checklistQuery.refetch();
    }, [brandId, checklistQuery.refetch]),
  );

  const [resumeBanner, setResumeBanner] = useState<boolean>(resumed);
  // K1 "Only free events for now?" — opened from F2/F3 "Save and finish later".
  const [k1, setK1] = useState<"country" | "pay" | null>(null);
  const viewedRef = useRef<BrandSetupStep | null>(null);
  useEffect(() => {
    if (viewedRef.current === step) return;
    viewedRef.current = step;
    trackBrandSetup("brand_setup_step_viewed", { step, brand_id: brandId, resumed });
  }, [step, brandId, resumed]);

  // ── X1 / X2 ────────────────────────────────────────────────────────────
  const fatal = checklistQuery.error instanceof BrandSetupError
    ? checklistQuery.error.code
    : checklistQuery.error && /forbidden/.test(checklistQuery.error.message)
    ? "forbidden"
    : checklistQuery.error && /brand_not_found/.test(checklistQuery.error.message)
    ? "brand_not_found"
    : null;
  if (brandId !== null && (fatal === "brand_not_found" || fatal === "forbidden")) {
    return (
      <View style={styles.root} testID="brand-setup-fatal">
        <View style={styles.center}>
          <Text style={styles.h3} accessibilityRole="alert">
            {fatal === "brand_not_found" ? C.common.deleted(brandName || "This brand") : C.common.noAccess(brandName || "this brand")}
          </Text>
        </View>
        <View style={styles.footer}>
          <Button label={C.common.goHome} onPress={() => router.replace("/(tabs)/home" as never)} variant="primary" size="lg" fullWidth />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="brand-setup-flow">
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={C.common.back}
          hitSlop={12}
          onPress={() => {
            if (step === "country" || step === "name") onExit();
            else if (step === "pay") setBackTo("country");
            else onExit();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <View
          style={styles.progress}
          accessibilityRole="progressbar"
          accessibilityLabel={C.common.progress(STEP_INDEX[step])}
          accessibilityValue={{ min: 1, max: 4, now: STEP_INDEX[step] }}
        >
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.segment, i <= STEP_INDEX[step] && styles.segmentOn]} />
          ))}
        </View>
      </View>
      {offline ? (
        <View style={styles.banner} accessibilityRole="alert">
          <Text style={styles.bannerText}>{C.common.offline}</Text>
        </View>
      ) : null}
      {resumeBanner && brandId !== null && step !== "name" ? (
        <Pressable style={[styles.banner, styles.bannerAccent]} onPress={() => setResumeBanner(false)} accessibilityRole="button">
          <Text style={styles.bannerText}>{C.common.resume(C.stepNames[step])}</Text>
        </Pressable>
      ) : null}
      {brandId !== null && checklistQuery.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={accent.warm} /></View>
      ) : step === "name" ? (
        <NameStep
          offline={offline}
          authReady={isAuthReady && user !== null}
          onExit={onExit}
          onCreated={(id) => {
            trackBrandSetup("brand_setup_step_completed", { step: "name", brand_id: id, resumed });
            adoptCreatedBrand(id);
            router.replace(`/brand/${id}/setup?step=country` as never);
          }}
          onDraft={(draftId, draftName) =>
            router.replace(`/brand/new?draft=${encodeURIComponent(draftId)}&draft_name=${encodeURIComponent(draftName)}` as never)}
        />
      ) : step === "country" && brandId !== null ? (
        <CountryStep
          brandId={brandId}
          current={facts?.payoutCountry ?? null}
          locked={facts !== null && (facts.stripeState !== "none" || (facts.provider === "paystack" && facts.details))}
          offline={offline}
          onSaved={() => {
            trackBrandSetup("brand_setup_step_completed", { step: "country", brand_id: brandId, resumed });
            setBackTo(null);
            void checklistQuery.refetch();
          }}
          onLater={() => setK1("country")}
        />
      ) : step === "pay" && brandId !== null && facts !== null ? (
        <PayStep
          brandId={brandId}
          brandName={brandName}
          provider={facts.provider}
          country={facts.payoutCountry}
          currency={facts.currency}
          termsDone={facts.terms}
          stripeState={facts.stripeState}
          waitingFor={facts.waitingFor}
          offline={offline}
          onChangeCountry={() => setBackTo("country")}
          onLater={() => setK1("pay")}
          onConnected={() => void checklistQuery.refetch()}
        />
      ) : step === "done" && brandId !== null && facts !== null ? (
        <DoneStep brandId={brandId} provider={facts.provider} country={facts.payoutCountry} />
      ) : null}
      <K1Sheet
        visible={k1 !== null}
        brandId={brandId}
        onBankNow={() => {
          trackBrandSetup("brand_setup_bank_now_chosen", { from_step: k1 });
          setK1(null);
        }}
        onFreeOnly={() => {
          trackBrandSetup("brand_setup_free_only_chosen", { from_step: k1 });
          setK1(null);
          router.replace("/(tabs)/home?toast=free_only" as never);
        }}
      />
    </View>
  );

};

// ── F1 ───────────────────────────────────────────────────────────────────
const NameStep: React.FC<{
  offline: boolean;
  authReady: boolean;
  onExit: () => void;
  onCreated: (brandId: string) => void;
  onDraft: (brandId: string, name: string) => void;
}> = ({ offline, authReady, onCreated, onDraft }) => {
  const idRef = useRef<string>(newBrandId());
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateSetupBrand();
  const trimmed = name.trim();
  const tooLong = trimmed.length > 60;
  const disabled = trimmed.length === 0 || tooLong || offline || !authReady || create.isPending;

  const submit = (): void => {
    if (disabled) return;
    setError(null);
    create.mutate(
      { brandId: idRef.current, name: trimmed },
      {
        onSuccess: (r) => onCreated(r.brandId),
        onError: (e) => {
          if (e instanceof BrandSetupError && e.code === "draft_exists") {
            onDraft(String(e.detail.brandId ?? ""), String(e.detail.brandName ?? ""));
            return;
          }
          setError(C.common.serverError);
        },
      },
    );
  };

  return (
    <>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1} accessibilityRole="header">{C.f1.title}</Text>
        <Text style={styles.label}>{C.f1.label}</Text>
        <TextInput
          testID="brand-setup-name"
          value={name}
          onChangeText={setName}
          editable={!create.isPending}
          accessibilityLabel={C.f1.label}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
          style={[styles.input, tooLong && styles.inputError]}
          placeholderTextColor={textTokens.quaternary}
        />
        <View style={styles.helperRow}>
          <Text style={[styles.helper, tooLong && styles.errorText]}>{tooLong ? C.f1.tooLong : C.f1.helper}</Text>
          <Text style={[styles.counter, trimmed.length >= 60 && styles.errorText]} accessibilityLabel={`${trimmed.length} of 60 characters`}>
            {trimmed.length}/60
          </Text>
        </View>
        {!authReady ? <Text style={styles.helper}>{C.f1.authWarming}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button testID="brand-setup-name-continue" label={C.f1.cta} onPress={submit} variant="primary" size="lg" fullWidth disabled={disabled} loading={create.isPending} />
        {error !== null ? <Text style={[styles.helper, styles.errorText]} accessibilityRole="alert">{error}</Text> : null}
      </View>
    </>
  );
};

// ── F2 ───────────────────────────────────────────────────────────────────
const CountryStep: React.FC<{
  brandId: string;
  current: string | null;
  locked: boolean;
  offline: boolean;
  onSaved: () => void;
  onLater: () => void;
}> = ({ brandId, current, locked, offline, onSaved, onLater }) => {
  const [selected, setSelected] = useState<string | null>(current);
  const [error, setError] = useState<string | null>(null);
  const save = useSetBrandPayoutCountry(brandId);
  useEffect(() => {
    if (selected === null && current !== null) setSelected(current);
  }, [current, selected]);
  const option = payoutCountryOption(selected);
  const locale = useMemo(() => Intl.DateTimeFormat().resolvedOptions().locale, []);

  const submit = (): void => {
    if (selected === null || save.isPending || offline) return;
    if (selected === current) {
      onSaved();
      return;
    }
    setError(null);
    save.mutate(selected, {
      onSuccess: () => onSaved(),
      onError: (e) => {
        const code = e instanceof BrandSetupError ? e.code : "unknown";
        setError(
          code === "payout_country_locked"
            ? C.f2.locked(payoutCountryOption(current)?.name ?? "")
            : code === "forbidden"
            ? C.f2.forbidden
            : C.common.serverError,
        );
      },
    });
  };

  return (
    <>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1} accessibilityRole="header">{C.f2.title}</Text>
        <Text style={styles.sub}>{C.f2.body}</Text>
        {locked && current !== null ? (
          <View style={styles.banner}><Text style={styles.bannerText}>{C.f2.locked(payoutCountryOption(current)?.name ?? current)}</Text></View>
        ) : null}
        <PayoutCountryList selected={selected} onSelect={setSelected} disabled={locked || save.isPending} deviceLocale={locale} />
      </ScrollView>
      <View style={styles.footer}>
        {option !== null ? (
          <Text style={styles.footnote}>{C.f2.footnote(option.name, option.currency)}</Text>
        ) : null}
        <Button testID="brand-setup-country-continue" label={C.f2.cta} onPress={submit} variant="primary" size="lg" fullWidth disabled={selected === null || offline || (locked && selected !== current)} loading={save.isPending} />
        {error !== null ? <Text style={[styles.helper, styles.errorText]} accessibilityRole="alert">{error}</Text> : null}
        <View style={styles.gap8} />
        <Button label={C.common.later} onPress={onLater} variant="secondary" size="md" fullWidth />
      </View>
    </>
  );
};

// ── F3 ───────────────────────────────────────────────────────────────────
const PayStep: React.FC<{
  brandId: string;
  brandName: string;
  provider: "stripe" | "paystack";
  country: string | null;
  currency: string | null;
  termsDone: boolean;
  stripeState: string;
  waitingFor: string | null;
  offline: boolean;
  onChangeCountry: () => void;
  onLater: () => void;
  onConnected: () => void;
}> = ({ brandId, brandName, provider, country, currency, termsDone, stripeState, waitingFor, offline, onChangeCountry, onLater, onConnected }) => {
  const router = useRouter();
  const { user } = useAuth();
  const [ticked, setTicked] = useState<boolean>(termsDone);
  const [error, setError] = useState<string | null>(null);
  const [ngReady, setNgReady] = useState(false);
  const accept = useAcceptMinglaToS();
  const option = payoutCountryOption(country);
  const locked = stripeState !== "none";

  const acceptTerms = async (): Promise<boolean> => {
    if (termsDone) return true;
    if (user === null) return false;
    try {
      await accept.mutateAsync({ brandId, userId: user.id, version: CURRENT_MINGLA_TOS_VERSION });
      return true;
    } catch {
      setError(C.common.serverError);
      return false;
    }
  };

  const continueStripe = async (): Promise<void> => {
    if (!ticked || offline) return;
    setError(null);
    if (!(await acceptTerms())) return;
    // The server reads the bank country from the brand (never this screen).
    router.push(`/brand/${brandId}/connect?from=brand-create` as never);
  };

  const continueNigeria = async (): Promise<void> => {
    if (!ticked || offline) return;
    setError(null);
    if (!(await acceptTerms())) return;
    try {
      const { beginPaymentsSetup } = await import("../../services/brandSetupService");
      await beginPaymentsSetup(brandId);
      setNgReady(true);
    } catch (e) {
      setError(e instanceof BrandSetupError && e.code === "requires_owner" ? C.f3.notOwner("the owner") : C.common.serverError);
    }
  };

  return (
    <>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1} accessibilityRole="header">{C.f3.title}</Text>
        {option !== null ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>{`${option.name} · ${currency ?? option.currency}`}</Text>
            {!locked ? <Button label={C.f3.change} onPress={onChangeCountry} variant="ghost" size="sm" /> : null}
          </View>
        ) : null}
        {waitingFor !== null ? (
          <View style={styles.banner}><Text style={styles.bannerText}>{C.f3.waitingClient(waitingFor)}</Text></View>
        ) : null}
        {stripeState === "started" || stripeState === "action_needed" ? (
          <View style={styles.banner}><Text style={styles.bannerText}>{C.f3.returnedIncomplete}</Text></View>
        ) : null}
        <Pressable
          testID="brand-setup-terms"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ticked }}
          onPress={() => setTicked((v) => !v)}
          style={styles.card}
          disabled={termsDone}
        >
          <View style={[styles.box, ticked && styles.boxOn]} />
          <Text style={[styles.cardText, { flex: 1 }]}>{C.f3.terms}</Text>
          <Button label={C.f3.readTerms} onPress={() => void Linking.openURL(ORGANISER_TERMS_URL)} variant="ghost" size="sm" />
        </Pressable>
        {provider === "stripe" ? (
          <View style={styles.banner}><Text style={styles.bannerText}>{C.f3.stripeBody}</Text></View>
        ) : ngReady ? (
          <View>
            <Text style={styles.label}>{C.f3.ngHeading}</Text>
            <BrandPaystackOnboardView brandId={brandId} brandName={brandName} onConnected={onConnected} />
          </View>
        ) : null}
        <Text style={styles.helper}>{C.f3.trust}</Text>
      </ScrollView>
      <View style={styles.footer}>
        {!ticked ? <Text style={styles.helper}>{C.f3.termsHint}</Text> : null}
        {provider === "stripe" ? (
          <Button
            testID="brand-setup-pay-continue"
            label={stripeState === "none" ? C.f3.stripeCta : C.f3.continueSetup}
            onPress={() => void continueStripe()}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!ticked || offline || accept.isPending}
            loading={accept.isPending}
          />
        ) : !ngReady ? (
          <Button testID="brand-setup-pay-continue" label={C.f2.cta} onPress={() => void continueNigeria()} variant="primary" size="lg" fullWidth disabled={!ticked || offline} loading={accept.isPending} />
        ) : null}
        {error !== null ? <Text style={[styles.helper, styles.errorText]} accessibilityRole="alert">{error}</Text> : null}
        <View style={styles.gap8} />
        <Button label={C.common.later} onPress={onLater} variant="secondary" size="md" fullWidth />
      </View>
    </>
  );
};

// ── F4 ───────────────────────────────────────────────────────────────────
const DoneStep: React.FC<{ brandId: string; provider: "stripe" | "paystack"; country: string | null }> = ({ brandId, provider, country }) => {
  const router = useRouter();
  const [status, setStatus] = useState<StripeSetupStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const ttpEntry = useTapToPaySettingsEntry(brandId);
  const showTtp = Platform.OS === "ios" && ttpEntry !== null &&
    tapToPayBrandEligible({ paymentProvider: provider, payoutCountry: country });

  useEffect(() => {
    if (provider !== "stripe") return;
    let cancelled = false;
    const timers = F4_POLL_DELAYS_MS.map((delay) =>
      setTimeout(async () => {
        if (cancelled) return;
        try {
          const s = await refreshStripeSetupStatus(brandId);
          if (cancelled) return;
          setFailed(false);
          setStatus(s);
        } catch {
          if (!cancelled) setFailed(true);
        }
      }, delay)
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [brandId, provider]);

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      {provider === "paystack" ? (
        <>
          <Text style={styles.h1}>{C.f4.done}</Text>
          <Text style={styles.sub}>{C.f4.ngDone}</Text>
        </>
      ) : status?.state === "action_needed" ? (
        <>
          <Text style={styles.sub}>{C.f4.actionNeeded}</Text>
          {status.due.map((d) => <Text key={d} style={styles.cardText}>{`• ${d}`}</Text>)}
          <Button label={C.f3.continueSetup} onPress={() => router.push(`/brand/${brandId}/connect?from=brand-create` as never)} variant="primary" size="md" />
        </>
      ) : failed ? (
        <>
          <Text style={styles.h1}>{C.f4.refreshErrorTitle}</Text>
          <Text style={styles.sub}>{C.f4.refreshErrorBody}</Text>
        </>
      ) : status?.state === "submitted" ? (
        <Text style={styles.h1}>{C.f4.done}</Text>
      ) : (
        <>
          <Text style={styles.h1}>{C.f4.checkingTitle}</Text>
          <Text style={styles.sub}>{C.f4.checkingBody}</Text>
        </>
      )}
      {showTtp ? (
        <View style={styles.ttpCard} testID="brand-setup-ttp-card">
          {/* Apple's in-app tile visual (Tap to Pay on iPhone marketing art). */}
          {TTP_VISUAL !== null ? (
            <Image source={TTP_VISUAL} style={styles.ttpVisual} resizeMode="cover" accessible={false} />
          ) : null}
          <Text style={styles.cardTitle} numberOfLines={1}>{C.f4.ttpTitle}</Text>
          <Text style={styles.cardText}>{C.f4.ttpBody}</Text>
          <Text style={styles.helper}>{C.f4.ttpTerms}</Text>
          <Button label={C.f4.ttpCta} onPress={() => router.push(`/account/tap-to-pay?brandId=${encodeURIComponent(brandId)}` as never)} variant="primary" size="md" fullWidth />
        </View>
      ) : null}
      {/* The list of 5 carries its own "What do you want to make first?" heading. */}
      <View style={styles.gap8} />
      <OfferingChooser
        variant="brand-create-welcome"
        headline={C.f4.makeFirst}
        subhead=""
        onSelect={(o) => router.replace(routeForOffering(o) as never)}
      />
    </ScrollView>
  );
};

// ── K1 ───────────────────────────────────────────────────────────────────
const K1Sheet: React.FC<{
  visible: boolean;
  brandId: string | null;
  onBankNow: () => void;
  onFreeOnly: () => void;
}> = ({ visible, brandId, onBankNow, onFreeOnly }) => {
  const mark = useMarkBrandSetupFreeOnly(brandId);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet visible={visible} onClose={onBankNow} snapPoint="half">
      <View style={styles.sheetBody} testID="brand-setup-k1">
        <Text style={styles.h3}>{C.k1.title}</Text>
        <Text style={styles.sub}>{Platform.OS === "ios" ? C.k1.body : C.k1.bodyAndroid}</Text>
        <Text style={styles.sub}>{C.k1.later}</Text>
        <Button label={C.k1.bankNow} onPress={onBankNow} variant="primary" size="lg" fullWidth />
        <View style={styles.gap8} />
        <Button
          label={C.k1.freeOnly}
          onPress={() =>
            mark.mutate(undefined, {
              onSuccess: onFreeOnly,
              onError: () => setError(C.common.serverError),
            })}
          variant="secondary"
          size="lg"
          fullWidth
          loading={mark.isPending}
        />
        {error !== null ? <Text style={[styles.helper, styles.errorText]}>{error}</Text> : null}
      </View>
    </Sheet>
  );
};

// ── N1 (one brand in progress at a time) ─────────────────────────────────
export const DraftInProgress: React.FC<{
  draftId: string;
  draftName: string;
  onContinue: () => void;
  onDiscarded: () => void;
  /** #4389 N3 — "Discard draft" from the switcher opens straight on the confirm. */
  startConfirming?: boolean;
}> = ({ draftId, draftName, onContinue, onDiscarded, startConfirming = false }) => {
  const [confirming, setConfirming] = useState(startConfirming);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discard = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await discardDraftBrand(draftId);
      if (!r.ok) throw new Error(r.error);
      trackBrandSetup("brand_draft_discarded", { had_payment_setup: r.stripe === "closed" || r.paystack === "switched_off" });
      setConfirming(false);
      onDiscarded();
    } catch {
      setError(C.n1.discardError(draftName));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.root} testID="brand-setup-n1">
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Text style={styles.h1}>{C.n1.title}</Text>
        <Text style={styles.sub}>{C.n1.body(draftName)}</Text>
        <Text style={styles.helper}>{C.n1.oneAtATime}</Text>
      </ScrollView>
      <View style={styles.footer}>
        <Button label={C.n1.continue(draftName)} onPress={() => { trackBrandSetup("brand_draft_continued", {}); onContinue(); }} variant="primary" size="lg" fullWidth />
        <View style={styles.gap8} />
        <Button label={C.n1.discardNew} onPress={() => setConfirming(true)} variant="secondary" size="lg" fullWidth />
      </View>
      <Sheet visible={confirming} onClose={() => setConfirming(false)} snapPoint="half">
        <View style={styles.sheetBody}>
          <Text style={styles.h3}>{C.n1.confirmTitle(draftName)}</Text>
          <Text style={styles.sub}>{C.n1.confirmBody}</Text>
          {error !== null ? <Text style={[styles.helper, styles.errorText]}>{error}</Text> : null}
          <Button label={C.n1.discard} onPress={() => void discard()} variant="destructive" size="lg" fullWidth loading={busy} />
          <View style={styles.gap8} />
          <Button label={C.n1.keep} onPress={() => setConfirming(false)} variant="secondary" size="lg" fullWidth disabled={busy} />
        </View>
      </Sheet>
    </View>
  );
};

export { Toast };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: canvas.discover },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backGlyph: { fontSize: 30, color: textTokens.primary },
  progress: { flex: 1, flexDirection: "row", gap: spacing.xs },
  segment: { flex: 1, height: 4, borderRadius: radius.full, backgroundColor: "rgba(255,255,255,0.12)" },
  segmentOn: { backgroundColor: accent.warm },
  body: { flex: 1 },
  bodyContent: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm, maxWidth: 560, width: "100%", alignSelf: "center" },
  footer: { padding: spacing.md, gap: spacing.xs, maxWidth: 560, width: "100%", alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  h1: { ...typography.h1, color: textTokens.primary },
  h3: { ...typography.h3, color: textTokens.primary },
  sub: { ...typography.body, color: textTokens.secondary },
  label: { ...typography.bodySm, color: textTokens.secondary, marginTop: spacing.md },
  input: { minHeight: 52, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: "rgba(255,255,255,0.06)", color: textTokens.primary, fontSize: typography.body.fontSize },
  inputError: { borderWidth: 1, borderColor: semantic.error },
  helperRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  helper: { ...typography.bodySm, color: textTokens.tertiary },
  counter: { ...typography.caption, color: textTokens.tertiary },
  errorText: { color: semantic.errorText },
  footnote: { ...typography.bodySm, color: textTokens.secondary, marginBottom: spacing.xs },
  banner: { marginHorizontal: spacing.md, marginVertical: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.06)" },
  bannerAccent: { backgroundColor: accent.faint },
  bannerText: { ...typography.bodySm, color: textTokens.primary },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.05)", minHeight: 52 },
  cardTitle: { ...typography.h3, color: textTokens.primary },
  cardText: { ...typography.body, color: textTokens.primary },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "rgba(255,255,255,0.4)" },
  boxOn: { backgroundColor: accent.warm, borderColor: accent.warm },
  ttpCard: { marginTop: spacing.md, padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" },
  ttpVisual: { width: "100%", aspectRatio: 720 / 559, borderRadius: radius.md },
  sheetBody: { padding: spacing.lg, gap: spacing.sm },
  gap8: { height: spacing.sm },
});

export default BrandCreationFlow;
