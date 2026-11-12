/**
 * #4389 — brand setup with the minimum information: 4 steps, full screen.
 *
 *   F1 Name your brand → F2 Where will you collect funds? → F3 Get paid → F4 You're all set
 *
 * Invariant I-4389-NO-MODAL-ON-OVERLAY | issue #4389 | BrandCreationFlow mounts only on the full-screen routes app/brand/new.tsx and app/brand/[id]/setup.tsx; its bank-country step renders PayoutCountryList inline (no Sheet, no RN Modal). The K1 confirmation is the flow's only sheet and opens over this route, never over another sheet.
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
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";

// Keyboard-aware on native (the CTA and focused field stay clear of the keyboard, U-2).
// ORCH-0892: the avoiding view is the library's (web: a plain View). It lifts
// the step footer (Continue) above the keyboard and its Done bar, as the
// design's SE frame shows (#4389 P1: Continue sat under the keyboard).
import { DONE_BAR_OCCUPIED, ScrollView } from "../../wrappers/SmartScrollView";
import { KeyboardAvoidingView } from "../../wrappers/SmartKeyboardAvoidingView";
import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * #4389 (iPhone 15 recording: the Done bar sat on Continue) — the library
 * KeyboardAvoidingView measures its frame from onLayout, relative to its
 * parent, and treats it as a screen position. Both setup routes pad the
 * screen by the top safe area above this column, so that much of the lift was
 * missing (59pt on a notched iPhone, the Done bar's height). The offset adds
 * it back on top of the Done bar's own budget.
 */
export function setupKeyboardOffset(topInset: number): number {
  return DONE_BAR_OCCUPIED + topInset;
}

import { useAuth } from "../../context/AuthContext";
import { accent, canvas, radius, semantic, spacing, text as textTokens, typography } from "../../constants/designSystem";
import {
  BRAND_SETUP_STEPS,
  BrandSetupError,
  deriveSetupStep,
  setupFlowHop,
  newBrandId,
  type BrandSetupStep,
} from "../../services/brandSetupCore";
import type { StripeSetupStatus } from "../../services/brandSetupService";
import { useBrandSetupChecklist, useMarkBrandSetupFreeOnly } from "../../hooks/useBrandSetupChecklist";
import {
  adoptBrandIntoCaches,
  useCreateSetupBrand,
  useDiscardDraftBrand,
  useSetBrandPayoutCountry,
} from "../../hooks/useBrandSetupFlowWrites";
import {
  CURRENT_MINGLA_TOS_VERSION,
  ORGANISER_TERMS_URL,
  useAcceptMinglaToS,
} from "../../hooks/useMinglaToSAcceptance";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { Toast } from "../ui/Toast";
import type { OfferingChooserProps } from "./OfferingChooser";
import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import { LazyF4TapToPayCard } from "../door/LazyDoorSaleScreens";
import { BrandPaystackOnboardView } from "./LazyBrandPaystackOnboardView";
import { BRAND_SETUP_COPY as C } from "./brandSetupCopy";
import { PayoutCountryList, payoutCountryOption } from "./PayoutCountryList";
import { trackBrandSetup } from "./brandSetupAnalytics";
import { useCurrentBrandStore, type Brand } from "../../store/currentBrandStore";
import { useUpdateCreatorAccount } from "../../hooks/useCreatorAccount";
import { getBrand } from "../../services/brandsService";
import { useQueryClient } from "@tanstack/react-query";
import { brandKeys } from "../../hooks/brandKeys";
import { brandStripeStatusKeys } from "../../hooks/useBrandStripeStatus";
import type { BrandCreationPayoutState } from "../../utils/brandCreationPayoutState";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useBrandTeamMemberDirectory } from "../../hooks/useBrandTeamMemberDirectory";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import {
  CountryConflictBanner,
  ForbiddenBanner,
  InlineWriteError,
  NameDiscardSheet,
  OtherDeviceBanner,
  SessionExpiredSheet,
  countryConflict,
  finishingOnOtherDevice,
  isSessionExpiredError,
  keepBrandNameForSignIn,
  markPaymentsStartedHere,
  ownerDisplayName,
  paymentsStartedHere,
  shouldConfirmNameDiscard,
  takeKeptBrandName,
  writeErrorMessage,
  type WriteError,
} from "./BrandSetupInterruptions";

// #4389 — F4's "What do you want to make first?" list (and its clips) loads
// with F4, not with the app: one on-intent chunk keeps it out of __common.
const LazyOfferingChooser = createRetryableLazyErrorBoundary<OfferingChooserProps>(
  async () => ({ default: (await import("./OfferingChooser")).OfferingChooser }),
  { loadingLabel: "Loading" },
);

export interface BrandCreationFlowProps {
  /** null = a new brand (/brand/new). */
  brandId: string | null;
  /** `?step=` from the route; clamped to the first open step. */
  requestedStep?: BrandSetupStep | null;
  /** The route came from a resume (Home card, Ari card, relaunch). */
  resumed?: boolean;
  /** #4389 S-11 — open K1 at once (the native secure setup was closed early). */
  openK1?: boolean;
  /** #881 — /brand/new hides partner Step 0 once a name is typed. */
  onTypedNameChange?: (typed: string) => void;
  onExit: () => void;
}

const STEP_INDEX: Record<BrandSetupStep, number> = { name: 1, country: 2, pay: 3, done: 4 };
/** F4 polls the live account read at mount, 3 s, 8 s and 20 s (R-5). */
export const F4_POLL_DELAYS_MS = [0, 3000, 8000, 20000] as const;

export const BrandCreationFlow: React.FC<BrandCreationFlowProps> = ({
  brandId,
  requestedStep = null,
  resumed = false,
  openK1 = false,
  onTypedNameChange,
  onExit,
}) => {
  const router = useRouter();
  const { user, isAuthReady } = useAuth();
  const { isWideDesktop } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const network = useNetInfoSafe();
  const offline = network?.isConnected === false;

  const checklistQuery = useBrandSetupChecklist(brandId);
  const checklist = checklistQuery.data ?? null;

  // A new brand becomes the current brand and the saved default (the ORCH-0756 rule),
  // so Home, Ari and the switcher open on it.
  const setCurrentBrand = useCurrentBrandStore((st) => st.setCurrentBrand);
  const updateCreatorAccountMutation = useUpdateCreatorAccount();
  const queryClient = useQueryClient();
  const accountId = user?.id ?? null;
  const commitDefaultBrand = useCallback(
    (newBrand: Brand): void => {
      // The brand goes into the list / default caches FIRST, so the current-
      // brand recovery never resolves the pointer back to a stale (or just
      // discarded) brand while the list refetch is in flight (#4389 P0).
      if (accountId !== null) adoptBrandIntoCaches(queryClient, newBrand, accountId);
      setCurrentBrand(newBrand);
      void updateCreatorAccountMutation
        .mutateAsync({ default_brand_id: newBrand.id })
        .catch((error: unknown) => {
          console.warn("[brand-setup] could not save the default brand", error);
        });
    },
    [accountId, queryClient, setCurrentBrand, updateCreatorAccountMutation],
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
  // #4389 P2 (retest) — when the checklist turns complete, the brand's payout
  // reads (connect status, brand row) are refreshed so no surface keeps the
  // pre-setup "not connected" answer.
  const setupComplete = facts?.complete === true;
  const wasCompleteRef = useRef<boolean>(setupComplete);
  useEffect(() => {
    if (brandId === null) return;
    if (setupComplete && !wasCompleteRef.current) {
      void queryClient.invalidateQueries({ queryKey: brandStripeStatusKeys.detail(brandId) });
      void queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId), exact: true });
      void queryClient.invalidateQueries({ queryKey: brandKeys.lists() });
    }
    wasCompleteRef.current = setupComplete;
  }, [brandId, queryClient, setupComplete]);
  const brandName = checklist?.readiness.items.find((i) => i.key === "brand.name")?.valuePreview ?? "";

  // ── which step ─────────────────────────────────────────────────────────
  // The URL's `?step=` is a request honoured when the flow opens (a deep link
  // or "Change" back to an earlier step). A successful write CONSUMES it, so
  // the step is then derived from the refreshed checklist alone and the flow
  // advances (#4389 P1: F2 used to stay pinned to `?step=country` forever).
  const [requested, setRequested] = useState<BrandSetupStep | null>(requestedStep);
  const derived = brandId === null ? "name" : deriveSetupStep(checklist, requested);
  const [backTo, setBackTo] = useState<BrandSetupStep | null>(null);
  // The server's first open step moving on (a write here, the secure setup
  // finishing on return, another device) also ends the request.
  const firstOpen = checklist === null ? null : deriveSetupStep(checklist);
  const firstOpenAtRequestRef = useRef<BrandSetupStep | null>(null);
  useEffect(() => {
    if (requested === null || firstOpen === null) return;
    if (firstOpenAtRequestRef.current === null) {
      firstOpenAtRequestRef.current = firstOpen;
    } else if (firstOpenAtRequestRef.current !== firstOpen) {
      setRequested(null);
    }
  }, [firstOpen, requested]);
  const refetchChecklist = checklistQuery.refetch;
  const advanceAfterWrite = useCallback((): void => {
    setRequested(null);
    setBackTo(null);
    void refetchChecklist();
  }, [refetchChecklist]);
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

  // R1 — "Welcome back. You stopped at…" once per resume: on the first step
  // the checklist shows after a resume open, gone once the host moves on.
  const [resumeBanner, setResumeBanner] = useState<boolean>(resumed);
  const resumeStepRef = useRef<BrandSetupStep | null>(null);
  const checklistReady = brandId !== null && checklist !== null;
  useEffect(() => {
    if (!resumeBanner || !checklistReady) return;
    if (resumeStepRef.current === null) resumeStepRef.current = step;
    else if (resumeStepRef.current !== step) setResumeBanner(false);
  }, [checklistReady, resumeBanner, step]);
  // F1 "Discard this brand name?" — Back, iOS swipe-back and Android back
  // with a typed, unsaved name (design F1:discard).
  const navigation = useNavigation();
  const typedNameRef = useRef<string>("");
  const nameSavingRef = useRef<boolean>(false);
  const leaveSanctionedRef = useRef<boolean>(false);
  const pendingLeaveRef = useRef<unknown>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const nameStepShown = brandId === null;
  useEffect(() => {
    if (!nameStepShown || Platform.OS === "web") return;
    const unsubscribe = navigation.addListener("beforeRemove" as never, (raw: unknown) => {
      if (leaveSanctionedRef.current || !shouldConfirmNameDiscard(typedNameRef.current, nameSavingRef.current)) return;
      const event = raw as { preventDefault: () => void; data: { action: unknown } };
      event.preventDefault();
      pendingLeaveRef.current = event.data.action;
      setDiscardOpen(true);
    });
    return unsubscribe;
  }, [navigation, nameStepShown]);
  const discardTypedName = useCallback((): void => {
    setDiscardOpen(false);
    typedNameRef.current = "";
    leaveSanctionedRef.current = true;
    const action = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    if (action !== null) (navigation as unknown as { dispatch: (a: unknown) => void }).dispatch(action);
    else onExit();
  }, [navigation, onExit]);
  // K1 "Only free events for now?" — opened from F2/F3 "Save and finish later".
  const [k1, setK1] = useState<"country" | "pay" | null>(openK1 ? "pay" : null);
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
            {fatal === "brand_not_found" ? C.common.deleted(brandName || null) : C.common.noAccess(brandName || null)}
          </Text>
        </View>
        <View style={styles.footer}>
          <Button label={C.common.goHome} onPress={() => router.replace("/(tabs)/home" as never)} variant="primary" size="lg" fullWidth />
        </View>
      </View>
    );
  }

  // U-6 desktop web: a left step rail beside a 560px pane. 390px web and the
  // phones keep the single column. (No slide transitions exist, so Reduce
  // Motion has nothing to replace.)
  const rail = isWideDesktop ? (
    <View style={styles.rail} testID="brand-setup-rail" accessibilityRole="list">
      {BRAND_SETUP_STEPS.map((s, i) => {
        const on = s === step;
        const done = STEP_INDEX[s] < STEP_INDEX[step];
        return (
          <View key={s} style={styles.railRow} accessibilityState={{ selected: on }}>
            <View style={[styles.railDot, done && styles.railDotDone, on && styles.railDotOn]}>
              <Text style={styles.railDotText}>{done ? "✓" : String(i + 1)}</Text>
            </View>
            <Text style={[styles.railLabel, on && styles.railLabelOn]}>{C.stepNames[s]}</Text>
          </View>
        );
      })}
    </View>
  ) : null;

  return (
    <View style={[styles.root, isWideDesktop && styles.rootDesktop]} testID="brand-setup-flow">
      {rail}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={setupKeyboardOffset(insets.top)}
        style={isWideDesktop ? styles.pane : styles.fill}
      >
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={C.common.back}
          hitSlop={12}
          onPress={() => {
            if (step === "name" && shouldConfirmNameDiscard(typedNameRef.current, nameSavingRef.current)) {
              setDiscardOpen(true);
            } else if (step === "country" || step === "name") onExit();
            // K1 — leaving Get paid before payment details are done asks
            // "Only free events for now?" (addendum). "Change" on the country
            // chip still goes back to Bank country.
            else if (step === "pay") setK1("pay");
            else onExit();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backGlyph} maxFontSizeMultiplier={1.4}>‹</Text>
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
      {/* Never on F4: "You stopped at You're all set" is not a resume (#4389 retest). */}
      {resumeBanner && checklistReady && step !== "name" && step !== "done" ? (
        <Pressable style={[styles.banner, styles.bannerAccent]} onPress={() => setResumeBanner(false)} accessibilityRole="button" accessibilityLabel={C.common.resume(C.stepNames[step])}>
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
          onNameChange={(typed, saving) => {
            typedNameRef.current = typed;
            nameSavingRef.current = saving;
            onTypedNameChange?.(typed);
          }}
          onCreated={(id) => {
            typedNameRef.current = "";
            trackBrandSetup("brand_setup_step_completed", { step: "name", brand_id: id, resumed });
            adoptCreatedBrand(id);
            router.replace(setupFlowHop(`/brand/${id}/setup?step=country`) as never);
          }}
          onDraft={(draftId, draftName) => {
            typedNameRef.current = "";
            router.replace(`/brand/new?draft=${encodeURIComponent(draftId)}&draft_name=${encodeURIComponent(draftName)}` as never);
          }}
        />
      ) : step === "country" && brandId !== null ? (
        <CountryStep
          brandId={brandId}
          authReady={isAuthReady && user !== null}
          current={facts?.payoutCountry ?? null}
          locked={facts !== null && (facts.stripeState !== "none" || (facts.provider === "paystack" && facts.details))}
          offline={offline}
          onSaved={() => {
            trackBrandSetup("brand_setup_step_completed", { step: "country", brand_id: brandId, resumed });
            advanceAfterWrite();
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
          startedAt={facts.paymentsSetupStartedAt}
          refreshing={checklistQuery.isFetching}
          onRefresh={() => void checklistQuery.refetch()}
          waitingFor={facts.waitingFor}
          offline={offline}
          onChangeCountry={() => setBackTo("country")}
          onLater={() => setK1("pay")}
          onConnected={advanceAfterWrite}
        />
      ) : step === "done" && brandId !== null && facts !== null ? (
        <DoneStep brandId={brandId} provider={facts.provider} country={facts.payoutCountry} />
      ) : null}
      <NameDiscardSheet
        visible={discardOpen}
        onKeepEditing={() => {
          pendingLeaveRef.current = null;
          setDiscardOpen(false);
        }}
        onDiscard={discardTypedName}
      />
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
      </KeyboardAvoidingView>
    </View>
  );

};

// ── F1 ───────────────────────────────────────────────────────────────────
const NameStep: React.FC<{
  offline: boolean;
  authReady: boolean;
  onExit: () => void;
  onNameChange: (typed: string, saving: boolean) => void;
  onCreated: (brandId: string) => void;
  onDraft: (brandId: string, name: string) => void;
}> = ({ offline, authReady, onNameChange, onCreated, onDraft }) => {
  const idRef = useRef<string>(newBrandId());
  // R-12 — a name kept across "Sign in again" comes back here.
  const [name, setName] = useState<string>(() => takeKeptBrandName());
  const [writeError, setWriteError] = useState<WriteError | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { signOut } = useAuth();
  const create = useCreateSetupBrand();
  // Once "Sign in" keeps the name, leaving is not a discard.
  const keptForSignInRef = useRef(false);
  useEffect(() => {
    onNameChange(keptForSignInRef.current ? "" : name, create.isPending);
  }, [name, create.isPending, onNameChange]);
  const trimmed = name.trim();
  const tooLong = trimmed.length > 60;
  const disabled = trimmed.length === 0 || tooLong || offline || !authReady || create.isPending;

  const submit = (): void => {
    if (disabled) return;
    // A fresh attempt clears the last error; the typed name is never touched.
    setWriteError(null);
    create.mutate(
      { brandId: idRef.current, name: trimmed },
      {
        onSuccess: (r) => onCreated(r.brandId),
        onError: (e) => {
          if (e instanceof BrandSetupError && e.code === "draft_exists") {
            onDraft(String(e.detail.brandId ?? ""), String(e.detail.brandName ?? ""));
            return;
          }
          if (isSessionExpiredError(e)) {
            setSessionExpired(true);
            return;
          }
          setWriteError({ message: writeErrorMessage(e, C.common.serverError), retry: () => submitRef.current() });
        },
      },
    );
  };
  // "Try again" re-runs the LATEST submit (the name as it is now).
  const submitRef = useRef(submit);
  submitRef.current = submit;

  return (
    <>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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
          <Text style={[styles.counter, trimmed.length >= 60 && styles.errorText]} accessibilityLabel={C.f1.counterLabel(trimmed.length)}>
            {trimmed.length}/60
          </Text>
        </View>
        {!authReady ? <Text style={styles.helper}>{C.f1.authWarming}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button testID="brand-setup-name-continue" label={C.f1.cta} onPress={submit} variant="primary" size="lg" fullWidth disabled={disabled} loading={create.isPending} />
        <InlineWriteError writeError={writeError} testID="brand-setup-name-error" />
      </View>
      <SessionExpiredSheet
        visible={sessionExpired}
        busy={signingOut}
        onClose={() => setSessionExpired(false)}
        onSignIn={() => {
          // The typed name is kept for the next F1 (design F1:expired).
          keepBrandNameForSignIn(trimmed);
          keptForSignInRef.current = true;
          onNameChange("", false);
          setSigningOut(true);
          void signOut({ scope: "local" })
            .catch((e: unknown) => {
              console.warn("[brand-setup] sign out for sign-in again failed", e);
              setWriteError({ message: C.common.serverError, retry: () => submitRef.current() });
            })
            .finally(() => setSigningOut(false));
        }}
      />
    </>
  );
};

// ── F2 ───────────────────────────────────────────────────────────────────
const CountryStep: React.FC<{
  brandId: string;
  authReady: boolean;
  current: string | null;
  locked: boolean;
  offline: boolean;
  onSaved: () => void;
  onLater: () => void;
}> = ({ brandId, authReady, current, locked, offline, onSaved, onLater }) => {
  const [selected, setSelected] = useState<string | null>(current);
  const [error, setError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<WriteError | null>(null);
  const save = useSetBrandPayoutCountry(brandId);
  // #4389 P1 (SE, keyboard up): the search results had no room above the
  // footer, so the first result sat behind Continue and a tap hit the disabled
  // button. With the keyboard up the footer gives the list the room: nothing
  // picked yet → no footer at all (Continue would be disabled anyway); a pick
  // made → Continue only ("Save and finish later" hides, as the design does).
  const keyboardUp = useKeyboardIsVisible();
  const footerShown = !(keyboardUp && selected === null);
  // #4389 (retest r3, SE): picking a result with the keyboard up brings the
  // footer back, which left only a sliver of the picked row showing. The
  // picked row is scrolled into view when it is picked and when the footer
  // reappears (after that layout pass).
  const scrollRef = useRef<RevealScroller | null>(null);
  const scrollYRef = useRef(0);
  const selectedRowRef = useRef<View | null>(null);
  useEffect(() => {
    if (selected === null) return;
    const timer = setTimeout(() => {
      revealRow(selectedRowRef.current, scrollRef.current, scrollYRef.current);
    }, REVEAL_AFTER_LAYOUT_MS);
    return () => clearTimeout(timer);
  }, [selected, footerShown]);
  useEffect(() => {
    if (selected === null && current !== null) setSelected(current);
  }, [current, selected]);
  // F2 conflict — another device saved a different bank country while this
  // screen had its own pick. "Keep" keeps what the other device saved;
  // "Change" lets the host pick again here.
  const previousServerRef = useRef<string | null>(current);
  const [conflict, setConflict] = useState<string | null>(null);
  useEffect(() => {
    const changed = countryConflict({ previousServer: previousServerRef.current, server: current, selected });
    previousServerRef.current = current;
    if (changed !== null) setConflict(changed);
    // `selected` is read at the moment the server value moves, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  // Forbidden pre-check: a member below brand admin sees why before tapping.
  // A missing role row is left to the server (it refuses with "forbidden").
  const role = useCurrentBrandRole(brandId);
  const forbidden = !role.isLoading && !role.isError && role.role !== null && role.rank < BRAND_ROLE_RANK.brand_admin;
  const option = payoutCountryOption(selected);
  const locale = useMemo(() => Intl.DateTimeFormat().resolvedOptions().locale, []);

  const submit = (): void => {
    if (selected === null || save.isPending || offline || forbidden || !authReady) return;
    if (selected === current) {
      onSaved();
      return;
    }
    setError(null);
    setWriteError(null);
    save.mutate(selected, {
      onSuccess: () => onSaved(),
      onError: (e) => {
        const code = e instanceof BrandSetupError ? e.code : "unknown";
        // Locked and forbidden are answers, not failures: no Try again.
        if (code === "payout_country_locked") setError(C.f2.locked(payoutCountryOption(current)?.name ?? ""));
        else if (code === "forbidden") setError(C.f2.forbidden);
        else setWriteError({ message: writeErrorMessage(e, C.common.serverError), retry: () => submitRef.current() });
      },
    });
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  return (
    <>
      <ScrollView
        ref={scrollRef as never}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEventThrottle={16}
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        testID="brand-setup-country-scroll"
      >
        <Text style={styles.h1} accessibilityRole="header">{C.f2.title}</Text>
        <Text style={styles.sub}>{C.f2.body}</Text>
        {conflict !== null ? (
          <CountryConflictBanner
            countryName={payoutCountryOption(conflict)?.name ?? conflict}
            onKeep={() => {
              setSelected(conflict);
              setConflict(null);
            }}
            onChange={() => setConflict(null)}
          />
        ) : null}
        {forbidden ? <ForbiddenBanner message={C.f2.forbidden} /> : null}
        {locked && current !== null ? (
          <View style={styles.banner}><Text style={styles.bannerText}>{C.f2.locked(payoutCountryOption(current)?.name ?? current)}</Text></View>
        ) : null}
        <PayoutCountryList selectedRowRef={selectedRowRef} selected={selected} onSelect={setSelected} disabled={locked || forbidden || save.isPending} deviceLocale={locale} />
      </ScrollView>
      {footerShown ? (
      <View style={styles.footer} testID="brand-setup-country-footer">
        {option !== null ? (
          <Text style={styles.footnote}>{C.f2.footnote(option.name, option.currency)}</Text>
        ) : null}
        <Button testID="brand-setup-country-continue" label={C.f2.cta} onPress={submit} variant="primary" size="lg" fullWidth disabled={selected === null || offline || forbidden || !authReady || save.isPending || (locked && selected !== current)} loading={save.isPending} />
        {error !== null ? <Text style={[styles.helper, styles.errorText]} accessibilityRole="alert">{error}</Text> : null}
        <InlineWriteError writeError={writeError} testID="brand-setup-country-error" />
        {keyboardUp ? null : (
          <>
            <View style={styles.gap8} />
            <Button label={C.common.later} onPress={onLater} variant="secondary" size="md" fullWidth />
          </>
        )}
      </View>
      ) : null}
    </>
  );
};

// ── reveal a row (F2) ────────────────────────────────────────────────────
const REVEAL_AFTER_LAYOUT_MS = 60;
const REVEAL_MARGIN = spacing.md;
type WindowBox = { y: number; height: number };
interface Measurable {
  measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
}
interface RevealScroller extends Measurable {
  scrollTo: (o: { y: number; animated?: boolean }) => void;
}

/** The scroll offset that shows `row` fully inside `viewport` (null: already shown). */
export function revealOffset(row: WindowBox, viewport: WindowBox, currentY: number, margin = REVEAL_MARGIN): number | null {
  const below = row.y + row.height + margin - (viewport.y + viewport.height);
  if (below > 0) return currentY + below;
  const above = viewport.y - (row.y - margin);
  if (above > 0) return Math.max(0, currentY - above);
  return null;
}

function revealRow(row: Measurable | null, scroller: RevealScroller | null, currentY: number): void {
  if (row === null || scroller === null) return;
  row.measureInWindow((_rx, ry, _rw, rh) => {
    scroller.measureInWindow((_sx, sy, _sw, sh) => {
      const y = revealOffset({ y: ry, height: rh }, { y: sy, height: sh }, currentY);
      if (y !== null) scroller.scrollTo({ y, animated: true });
    });
  });
}

// ── F3 ───────────────────────────────────────────────────────────────────
const PayStep: React.FC<{
  brandId: string;
  brandName: string;
  provider: "stripe" | "paystack";
  country: string | null;
  currency: string | null;
  termsDone: boolean;
  stripeState: string;
  startedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  waitingFor: string | null;
  offline: boolean;
  onChangeCountry: () => void;
  onLater: () => void;
  onConnected: () => void;
}> = ({ brandId, brandName, provider, country, currency, termsDone, stripeState, startedAt, refreshing, onRefresh, waitingFor, offline, onChangeCountry, onLater, onConnected }) => {
  const router = useRouter();
  const { user } = useAuth();
  const [ticked, setTicked] = useState<boolean>(termsDone);
  const [error, setError] = useState<string | null>(null);
  const [ngReady, setNgReady] = useState(false);
  const accept = useAcceptMinglaToS();
  const option = payoutCountryOption(country);
  const locked = stripeState !== "none";
  // Not owner: payments are owner-only (biz_begin_payments_setup). Shown up
  // front with the owner's real name from the team directory.
  const role = useCurrentBrandRole(brandId);
  const notOwner = !role.isLoading && !role.isError && role.role !== null && role.rank < BRAND_ROLE_RANK.brand_owner;
  const team = useBrandTeamMemberDirectory(notOwner ? brandId : null);
  const ownerName = ownerDisplayName(team.data, C.f3.ownerFallback);
  // R-4 — the secure setup was started on another device in the last 15 min.
  const otherDevice = finishingOnOtherDevice({
    startedAt,
    stripeState,
    startedHere: paymentsStartedHere(brandId),
    now: Date.now(),
  });

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
    if (!ticked || offline || notOwner) return;
    setError(null);
    if (!(await acceptTerms())) return;
    markPaymentsStartedHere(brandId);
    // The server reads the bank country from the brand (never this screen).
    router.push(`/brand/${brandId}/connect?from=brand-create` as never);
  };

  const continueNigeria = async (): Promise<void> => {
    if (!ticked || offline || notOwner) return;
    setError(null);
    if (!(await acceptTerms())) return;
    markPaymentsStartedHere(brandId);
    try {
      const { beginPaymentsSetup } = await import("../../services/brandSetupService");
      await beginPaymentsSetup(brandId);
      setNgReady(true);
    } catch (e) {
      setError(e instanceof BrandSetupError && e.code === "requires_owner" ? C.f3.notOwner(ownerName) : C.common.serverError);
    }
  };

  return (
    <>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.h1} accessibilityRole="header">{C.f3.title}</Text>
        {option !== null ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>{`${option.name} · ${currency ?? option.currency}`}</Text>
            {!locked ? <Button label={C.f3.change} onPress={onChangeCountry} variant="ghost" size="sm" /> : null}
          </View>
        ) : null}
        {otherDevice ? <OtherDeviceBanner refreshing={refreshing} onRefresh={onRefresh} /> : null}
        {notOwner ? <ForbiddenBanner message={C.f3.notOwner(ownerName)} /> : null}
        {waitingFor !== null ? (
          <View style={styles.banner}><Text style={styles.bannerText}>{C.f3.waitingClient(waitingFor)}</Text></View>
        ) : null}
        {stripeState === "started" || stripeState === "action_needed" ? (
          <View style={styles.banner}><Text style={styles.bannerText}>{C.f3.returnedIncomplete}</Text></View>
        ) : null}
        <Pressable
          testID="brand-setup-terms"
          accessibilityRole="checkbox"
          accessibilityLabel={C.f3.terms}
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
          // Seth: no "Your Nigerian bank" heading (the card's own fields say
          // it); the group keeps a label so screen readers keep the context.
          <View accessibilityLabel={C.f3.ngCardLabel} testID="brand-setup-ng-bank-card">
            <BrandPaystackOnboardView brandId={brandId} brandName={brandName} onConnected={onConnected} hideIntro />
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
            disabled={!ticked || offline || notOwner || accept.isPending}
            loading={accept.isPending}
          />
        ) : !ngReady ? (
          <Button testID="brand-setup-pay-continue" label={C.f2.cta} onPress={() => void continueNigeria()} variant="primary" size="lg" fullWidth disabled={!ticked || offline || notOwner} loading={accept.isPending} />
        ) : null}
        {error !== null ? <Text style={[styles.helper, styles.errorText]} accessibilityRole="alert">{error}</Text> : null}
        <View style={styles.gap8} />
        <Button label={C.common.later} onPress={onLater} variant="secondary" size="md" fullWidth />
      </View>
    </>
  );
};

// ── F4 ───────────────────────────────────────────────────────────────────
/**
 * #4389 P2 — F4's payout line, from the same refresh_status read as its
 * heading, so "You're all set." never sits over "Payouts aren't connected".
 */
export function f4PayoutState(
  provider: "stripe" | "paystack",
  status: StripeSetupStatus | null,
  failed: boolean,
): BrandCreationPayoutState {
  if (provider === "paystack") return "ready";
  if (status?.state === "action_needed") return "restricted";
  if (failed) return "unknown-error";
  if (status?.state === "submitted") return "ready";
  return "loading";
}

const DoneStep: React.FC<{ brandId: string; provider: "stripe" | "paystack"; country: string | null }> = ({ brandId, provider, country }) => {
  const router = useRouter();
  const [status, setStatus] = useState<StripeSetupStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (provider !== "stripe") return;
    let cancelled = false;
    const timers = F4_POLL_DELAYS_MS.map((delay) =>
      setTimeout(async () => {
        if (cancelled) return;
        try {
          const s = await (await import("../../services/brandSetupService")).refreshStripeSetupStatus(brandId);
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
      {/* #4389 — Tap to Pay on iPhone (iPhone only; loaded with the door chunk). */}
      {Platform.OS === "ios" ? <LazyF4TapToPayCard brandId={brandId} provider={provider} country={country} /> : null}
      {/* The list of 5 carries its own "What do you want to make first?" heading. */}
      <View style={styles.gap8} />
      <LazyOfferingChooser
        variant="brand-create-welcome"
        headline={C.f4.makeFirst}
        subhead=""
        // #4389 P2 — the payout line comes from the same live read as the
        // heading above (it used to default to "not connected").
        payoutState={f4PayoutState(provider, status, failed)}
        onSelect={(o) => {
          void import("./OfferingChooser")
            .then(({ routeForOffering }) => router.replace(routeForOffering(o) as never))
            .catch((error: unknown) => console.warn("[BrandCreationFlow] could not open the offering", error));
        }}
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
  // #4389 P3b — only the secondary "Free events only for now" records
  // free-only, and only while K1 is open. "Set up bank now" and every dismiss
  // (swipe down, scrim tap, Android back: the Sheet's onClose) mean "Set up
  // bank now" and latch K1 shut, so a tap that lands on the secondary while
  // the sheet is closing (the content stays mounted for the close animation)
  // can never record free-only.
  const dismissedRef = useRef(false);
  useEffect(() => {
    if (visible) dismissedRef.current = false;
  }, [visible]);
  const bankNow = (): void => {
    dismissedRef.current = true;
    onBankNow();
  };
  const freeOnly = (): void => {
    if (!visible || dismissedRef.current || mark.isPending) return;
    mark.mutate(undefined, {
      onSuccess: onFreeOnly,
      onError: () => setError(C.common.serverError),
    });
  };
  return (
    <Sheet visible={visible} onClose={bankNow} snapPoint="half">
      <SheetScrollLayout
        testID="brand-setup-k1"
        footer={
          <>
            {error !== null ? <Text style={[styles.helper, styles.errorText]}>{error}</Text> : null}
            <Button label={C.k1.bankNow} onPress={bankNow} variant="primary" size="lg" fullWidth />
            <Button
              label={C.k1.freeOnly}
              onPress={freeOnly}
              variant="secondary"
              size="lg"
              fullWidth
              loading={mark.isPending}
            />
          </>
        }
      >
        <Text style={styles.h3}>{C.k1.title}</Text>
        <Text style={styles.sub}>{Platform.OS === "ios" ? C.k1.body : C.k1.bodyAndroid}</Text>
        <Text style={styles.sub}>{C.k1.later}</Text>
      </SheetScrollLayout>
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
  const { user } = useAuth();
  // #4389 P0 — evicts the discarded brand from the brand caches (ORCH-1062).
  const discardDraftBrand = useDiscardDraftBrand(user?.id ?? null);
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
        <SheetScrollLayout
          testID="brand-setup-n1-confirm"
          footer={
            <>
              {error !== null ? <Text style={[styles.helper, styles.errorText]}>{error}</Text> : null}
              <Button label={C.n1.discard} onPress={() => void discard()} variant="destructive" size="lg" fullWidth loading={busy} />
              <Button label={C.n1.keep} onPress={() => setConfirming(false)} variant="secondary" size="lg" fullWidth disabled={busy} />
            </>
          }
        >
          <Text style={styles.h3}>{C.n1.confirmTitle(draftName)}</Text>
          <Text style={styles.sub}>{C.n1.confirmBody}</Text>
        </SheetScrollLayout>
      </Sheet>
    </View>
  );
};

export { Toast };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: canvas.discover },
  rootDesktop: { flexDirection: "row", justifyContent: "center", gap: spacing.xl, paddingTop: spacing.lg },
  fill: { flex: 1 },
  pane: { flex: 1, maxWidth: 560 },
  rail: { width: 220, paddingTop: spacing.xl, gap: spacing.md },
  railRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  railDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    alignItems: "center",
    justifyContent: "center",
  },
  railDotOn: { borderColor: accent.warm },
  railDotDone: { backgroundColor: accent.warm, borderColor: accent.warm },
  railDotText: { ...typography.caption, color: textTokens.primary, fontWeight: "700" },
  railLabel: { ...typography.body, color: textTokens.tertiary },
  railLabelOn: { color: textTokens.primary, fontWeight: "600" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backGlyph: { fontSize: 30, color: textTokens.primary },
  progress: { flex: 1, flexDirection: "row", gap: spacing.xs },
  segment: { flex: 1, height: 4, borderRadius: radius.full, backgroundColor: "rgba(255,255,255,0.12)" },
  segmentOn: { backgroundColor: accent.warm },
  body: { flex: 1 },
  // flexGrow lets an empty / no-match state centre in the space left (#4389).
  bodyContent: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm, maxWidth: 560, width: "100%", alignSelf: "center" },
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
  gap8: { height: spacing.sm },
});

export default BrandCreationFlow;
