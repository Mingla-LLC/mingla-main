/**
 * BrandBankConnectBody — bank-first partner setup body (web).
 *
 * Loads the canonical brand row, pre-resolves Stripe vs Paystack, records the
 * approved Mingla Host clickwrap before minting a Stripe AccountSession,
 * then performs a same-tab navigation to the existing embedded Connect form.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

// #1841 [keyboard-guard-blind-spots] — this scroll wraps
// BrandPaystackOnboardView, whose account-number / bank fields are real
// TextInputs behind the `Input` primitive. On WEB this import is a behavioural
// no-op — src/wrappers/SmartScrollView.tsx is `export { ScrollView } from
// "react-native"` — but it satisfies I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY
// without an allowlist and future-proofs a money surface: the day a `.native`
// sibling appears it inherits the derived Done-bar clearance for free rather
// than repeating #1834's bug. #1834 §2 named this file and deferred it here.
import { ScrollView } from "../../wrappers/SmartScrollView";

import { BrandPaystackOnboardView } from "./BrandPaystackOnboardView";
import { BrandStripeCountryPicker } from "./BrandStripeCountryPicker";
import { BusinessAppDownloadCta } from "../invite/BusinessAppDownloadCta";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/Spinner";
import {
  accent,
  canvas,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import {
  CURRENT_MINGLA_TOS_VERSION,
  ORGANISER_TERMS_URL,
  useAcceptMinglaToS,
} from "../../hooks/useMinglaToSAcceptance";
import { brandStripeStatusKeys } from "../../hooks/useBrandStripeStatus";
import { useBrand } from "../../hooks/useBrands";
import {
  useClearPaystackProvider,
  useSelectPaystackProvider,
} from "../../hooks/useBrandPaystack";
import { brandKeys } from "../../hooks/brandKeys";
import {
  startBrandStripeOnboarding,
  type StartOnboardingResult,
} from "../../services/brandStripeService";
import {
  startStripeWebBankConnect,
} from "../../utils/bankConnectFunnel";
import {
  resolveBankConnectRail,
  type BankConnectProvider,
} from "../../utils/bankConnectRail";
import { isInviteFunnelValue } from "../../utils/inviteFunnelSignal";
import { describePayoutCountrySwitchFailure } from "../../utils/payoutCountrySwitchCopy";

const TERMS_URL = ORGANISER_TERMS_URL;
const PAYSTACK_PICKER_OPTIONS = [
  {
    code: "NG",
    name: "Nigeria",
    currency: "NGN",
    sublabel: "Bank transfer via Paystack",
  },
] as const;

function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim().length > 0 ? first : null;
}

interface BankConnectOnboardingInput {
  brandId: string;
  returnUrl: string;
  country?: string;
}

/**
 * Route-local parity wrapper for useStartBrandStripeOnboarding.
 *
 * Keeping this tiny wrapper behind the lazy route boundary prevents Metro from
 * hoisting the legacy onboarding hook into the eager common chunk. The
 * canonical service, payload, invalidation keys, and error semantics remain
 * identical to src/hooks/useStartBrandStripeOnboarding.ts.
 */
function useStartBankConnectOnboarding(): UseMutationResult<
  StartOnboardingResult,
  Error,
  BankConnectOnboardingInput
> {
  const queryClient = useQueryClient();
  return useMutation<
    StartOnboardingResult,
    Error,
    BankConnectOnboardingInput
  >({
    mutationFn: async ({ brandId, returnUrl, country }) =>
      startBrandStripeOnboarding(brandId, returnUrl, country),
    onSuccess: (_data, { brandId }) => {
      queryClient.invalidateQueries({
        queryKey: brandStripeStatusKeys.detail(brandId),
      });
      queryClient.invalidateQueries({
        queryKey: brandKeys.detail(brandId),
      });
      queryClient.invalidateQueries({
        queryKey: brandKeys.lists(),
      });
    },
    onError: (error, { brandId }) => {
      console.error("[useStartBrandStripeOnboarding] failed", {
        message: error.message,
        brandId,
      });
    },
  });
}

export default function BrandBankConnectBody(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string | string[];
    provider?: string | string[];
    from?: string | string[];
  }>();
  const brandId = firstParam(params.id);
  const providerHint = firstParam(params.provider);
  // #948 W4 [web-skip-download] — invite-funnel phase gates the Back-hide + Skip
  // reveal. Exact-match on `?from=invite`; absent/other values keep Back + no Skip.
  const isInviteFunnel = isInviteFunnelValue(params.from);
  const isBrandCreateFunnel = params.from === "brand-create";
  const brandQuery = useBrand(brandId);
  const brand = brandQuery.data ?? null;
  const { user } = useAuth();
  const acceptTermsMutation = useAcceptMinglaToS();
  const onboardMutation = useStartBankConnectOnboarding();
  const submitInProgressRef = useRef(false);
  const [selectedCountry, setSelectedCountry] = useState("GB");
  const [selectedProvider, setSelectedProvider] =
    useState<BankConnectProvider>("stripe");
  const [submitError, setSubmitError] = useState<string | null>(null);
  // #3645 — picking Nigeria must put the brand on the Nigerian payout rail
  // straight away (edge `select_provider`), exactly as the native screen does,
  // so it can sell before a bank exists. Leaving Nigeria reverses it
  // (`clear_provider`) so a brand is never left on that rail by accident.
  const selectNigeriaRail = useSelectPaystackProvider();
  const clearNigeriaRail = useClearPaystackProvider();
  // Pending is owned HERE, not read off the mutation observers: under
  // StrictMode's effect replay an observer detaches from a mutation fired in
  // an effect, so its `isPending` and per-call callbacks never settle.
  const [railMutationPending, setRailMutationPending] = useState(false);
  const [railSwitchError, setRailSwitchError] = useState<{
    message: string;
    countryCode: string;
    retryable: boolean;
  } | null>(null);
  // `isPending` is one render behind: two picks in the same tick both saw it
  // false and both fired. This ref is set the moment a switch is sent.
  const railSwitchInFlightRef = useRef(false);
  // The automatic switch for a brand whose address already says Nigeria runs
  // at most once per mount (StrictMode, re-renders and the brand refetch after
  // success must not repeat it).
  const autoSwitchFiredRef = useRef(false);
  // Once the organiser picks a country the brand row stops re-seeding the
  // picker: the switch itself refetches the brand, and that refetch must not
  // overwrite the country they just chose.
  const countryTouchedRef = useRef(false);
  // What this screen last asked the server for. null = nothing asked yet, so
  // the brand row is the truth. A FAILED switch to Nigeria still counts as
  // "ng": the server may have moved the brand before failing.
  const requestedRailRef = useRef<"ng" | "not-ng" | null>(null);
  // #948 W4 — the two Skip choices stay hidden until "Skip for now" is pressed,
  // so the primary "Add bank details" CTA keeps bank-first emphasis.
  const [skipChoicesOpen, setSkipChoicesOpen] = useState(false);

  const canonicalRail = useMemo(
    () =>
      resolveBankConnectRail({
        countryCode: brand?.countryCode,
        paymentProvider: brand?.paymentProvider ?? providerHint,
      }),
    [brand?.countryCode, brand?.paymentProvider, providerHint],
  );

  const brandOnNigeriaRail =
    brand?.paymentProvider?.trim().toLowerCase() === "paystack";
  // #3645 — the screen resolves to Nigeria (from the brand's address) but the
  // saved brand is not on the Nigerian rail yet. Showing the bank form here
  // sent no switch at all, so the brand could not sell before adding a bank.
  // Only the brand's account owner may change payouts, so only they trigger
  // the automatic switch; anyone else keeps the screen as it was.
  const needsAutoSwitch =
    brand !== null &&
    user !== null &&
    canonicalRail.provider === "paystack" &&
    !brandOnNigeriaRail &&
    typeof brand.accountId === "string" &&
    brand.accountId === user.id;

  useEffect(() => {
    if (brand === null || countryTouchedRef.current) return;
    setSelectedCountry(canonicalRail.countryCode);
    // The bank form waits for the automatic switch to succeed.
    setSelectedProvider(needsAutoSwitch ? "stripe" : canonicalRail.provider);
  }, [
    brand,
    canonicalRail.countryCode,
    canonicalRail.provider,
    needsAutoSwitch,
  ]);

  const handleBack = useCallback((): void => {
    if (isBrandCreateFunnel && brandId !== null) {
      router.replace(
        `/brand/new?resume_brand=${encodeURIComponent(brandId)}` as never,
      );
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (brandId !== null) {
      router.replace(`/brand/${brandId}/payments` as never);
      return;
    }
    router.replace("/(tabs)/account" as never);
  }, [brandId, isBrandCreateFunnel, router]);

  // #948 W4 [web-skip-download] — ORCH-1401 [continue-web-home]: "Continue on
  // web" lands on the top-level web-app home (`/(tabs)/home`) rather than the
  // brand's own dashboard, so skipping the bank step drops the partner at the
  // app's front door. `replace` (not `push`) keeps the skipped bank screen off
  // the back stack.
  const handleContinueOnWeb = useCallback((): void => {
    if (brandId === null) return;
    router.replace("/(tabs)/home" as never);
  }, [brandId, router]);

  const handleOpenSkipChoices = useCallback((): void => {
    setSkipChoicesOpen(true);
  }, []);

  const handleCountryChange = useCallback((countryCode: string): void => {
    if (brand === null || railMutationPending || railSwitchInFlightRef.current) {
      return;
    }
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria uses Paystack and is deliberately outside the Stripe allowlist.
    const wantsNigeria = countryCode.trim().toUpperCase() === "NG";
    const next = resolveBankConnectRail({
      countryCode,
      paymentProvider: wantsNigeria ? "paystack" : "stripe",
    });
    countryTouchedRef.current = true;
    setSelectedCountry(next.countryCode);
    setSubmitError(null);
    setRailSwitchError(null);

    if (wantsNigeria) {
      requestedRailRef.current = "ng";
      railSwitchInFlightRef.current = true;
      setRailMutationPending(true);
      selectNigeriaRail
        .mutateAsync(brand.id)
        // The bank form only appears once the brand really is on the rail.
        .then(() => setSelectedProvider("paystack"))
        .catch((error: unknown) => {
          setSelectedProvider("stripe");
          setRailSwitchError({
            ...describePayoutCountrySwitchFailure(error),
            countryCode: next.countryCode,
          });
        })
        .finally(() => {
          railSwitchInFlightRef.current = false;
          setRailMutationPending(false);
        });
      return;
    }

    const onNigeriaRail =
      requestedRailRef.current === null
        ? brand.paymentProvider === "paystack" || selectedProvider === "paystack"
        : requestedRailRef.current === "ng";
    if (!onNigeriaRail) {
      setSelectedProvider(next.provider);
      return;
    }
    railSwitchInFlightRef.current = true;
    setRailMutationPending(true);
    clearNigeriaRail
      .mutateAsync(brand.id)
      .then(() => {
        requestedRailRef.current = "not-ng";
        setSelectedProvider("stripe");
      })
      .catch((error: unknown) => {
        setRailSwitchError({
          ...describePayoutCountrySwitchFailure(error),
          countryCode: next.countryCode,
        });
      })
      .finally(() => {
        railSwitchInFlightRef.current = false;
        setRailMutationPending(false);
      });
  }, [
    brand,
    clearNigeriaRail,
    railMutationPending,
    selectNigeriaRail,
    selectedProvider,
  ]);

  // Same code path as a manual Nigeria pick, fired once.
  const handleCountryChangeRef = useRef(handleCountryChange);
  handleCountryChangeRef.current = handleCountryChange;
  useEffect(() => {
    if (
      !needsAutoSwitch ||
      autoSwitchFiredRef.current ||
      countryTouchedRef.current
    ) {
      return;
    }
    autoSwitchFiredRef.current = true;
    handleCountryChangeRef.current("NG");
  }, [needsAutoSwitch]);
  // Pending from first paint: the effect above has not run yet on the very
  // first render, and neither rail's form may show before the switch settles.
  const awaitingAutoSwitch = needsAutoSwitch && !autoSwitchFiredRef.current;
  const railSwitchPending = railMutationPending || awaitingAutoSwitch;

  const handlePaystackConnected = useCallback((): void => {
    if (brandId === null) return;
    if (isBrandCreateFunnel) {
      router.replace(
        `/brand/new?resume_brand=${encodeURIComponent(brandId)}` as never,
      );
      return;
    }
    router.replace(`/brand/${brandId}/payments` as never);
  }, [brandId, isBrandCreateFunnel, router]);

  const handleStartStripe = useCallback(async (): Promise<void> => {
    if (
      brand === null ||
      user === null ||
      submitInProgressRef.current
    ) {
      return;
    }

    submitInProgressRef.current = true;
    setSubmitError(null);
    try {
      await startStripeWebBankConnect({
        brandId: brand.id,
        userId: user.id,
        country: selectedCountry,
        origin: window.location.origin,
        tosVersion: CURRENT_MINGLA_TOS_VERSION,
        acceptTerms: (input) => acceptTermsMutation.mutateAsync(input),
        mintOnboarding: (input) => onboardMutation.mutateAsync(input),
        assign: (url) => window.location.assign(url),
        destination: isBrandCreateFunnel ? "brand-create" : "payments",
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "We couldn't start bank setup. Check your connection and try again.";
      setSubmitError(message);
    } finally {
      submitInProgressRef.current = false;
    }
  }, [
    acceptTermsMutation,
    brand,
    isBrandCreateFunnel,
    onboardMutation,
    selectedCountry,
    user,
  ]);

  const handleOpenTerms = useCallback((): void => {
    Linking.openURL(TERMS_URL).catch(() => {
      setSubmitError(
        "We couldn't open the Organiser Terms. Please try again in a moment.",
      );
    });
  }, []);

  const loading =
    brandId !== null &&
    !brandQuery.isError &&
    (brandQuery.isLoading || !brandQuery.isFetched);

  if (loading) {
    return (
      <View style={styles.host}>
        <View style={styles.centeredState}>
          <Spinner size={48} color={accent.warm} />
          <Text style={styles.stateTitle}>Loading bank setup…</Text>
          <Text style={styles.stateBody}>
            We{"’"}re getting the payout details for this brand.
          </Text>
        </View>
      </View>
    );
  }

  if (brandQuery.isError) {
    return (
      <View style={styles.host}>
        <View style={styles.centeredState}>
          <Text style={styles.stateTitle}>Couldn{"’"}t load this brand</Text>
          <Text style={styles.stateBody}>
            Check your connection, then retry. Your bank setup has not started.
          </Text>
          <View style={styles.stateActions}>
            <Button
              label="Retry"
              onPress={(): void => {
                void brandQuery.refetch();
              }}
              variant="primary"
              size="lg"
              accessibilityLabel="Retry loading bank setup"
            />
            <Button
              label="Back"
              onPress={handleBack}
              variant="ghost"
              size="md"
              accessibilityLabel="Back from bank setup"
            />
          </View>
        </View>
      </View>
    );
  }

  if (brandId === null || brand === null) {
    return (
      <View style={styles.host}>
        <View style={styles.centeredState}>
          <Text style={styles.stateTitle}>Brand not found</Text>
          <Text style={styles.stateBody}>
            This brand may have been removed, or the bank setup link is invalid.
          </Text>
          <Button
            label="Back to account"
            onPress={handleBack}
            variant="secondary"
            size="lg"
            accessibilityLabel="Back to account"
          />
        </View>
      </View>
    );
  }

  if (user === null) {
    return (
      <View style={styles.host}>
        <View style={styles.centeredState}>
          <Text style={styles.stateTitle}>Sign in to add your bank</Text>
          <Text style={styles.stateBody}>
            Bank setup is private to this brand{"’"}s team. Sign in, then reopen
            this link.
          </Text>
          <Button
            label="Back"
            onPress={handleBack}
            variant="secondary"
            size="lg"
            accessibilityLabel="Back from bank setup"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <View style={styles.topBar}>
        {/*
          #948 W4 [web-skip-download] — the top Back is hidden ONLY in the
          invite funnel (a fresh partner arrived from email with nowhere to go
          back to). Absent/other `from` values keep Back exactly as before —
          the make-or-break no-regression for dashboard/direct/bookmark entry.
        */}
        {isInviteFunnel ? (
          <View style={styles.topBarSpacer} />
        ) : (
          <Button
            label="Back"
            onPress={handleBack}
            variant="ghost"
            size="sm"
            accessibilityLabel="Back from bank setup"
            testID="bank-connect-back"
          />
        )}
        <Text style={styles.topBarTitle}>Add your bank</Text>
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.heroIcon}>
            <Icon name="bank" size={28} color={accent.warm} />
          </View>
          <Text style={styles.title}>Add your bank</Text>
          <Text style={styles.body}>
            This is how you get paid. Add it once and every sale settles to
            this account — tables, tickets or trips.
          </Text>

          <BrandStripeCountryPicker
            value={selectedCountry}
            onChange={handleCountryChange}
            extraOptions={PAYSTACK_PICKER_OPTIONS}
            presentation="payout-confirm"
            disabled={railSwitchPending}
          />

          {railSwitchPending ? (
            <View
              style={styles.railSwitching}
              accessibilityRole="progressbar"
              accessibilityLabel="Updating your payout country"
              testID="bank-connect-rail-switching"
            >
              <Spinner size={36} color={accent.warm} />
              <Text style={styles.stateBody}>
                Updating your payout country…
              </Text>
            </View>
          ) : railSwitchError !== null ? (
            <>
              <View
                style={styles.errorCard}
                accessibilityRole="alert"
                testID="bank-connect-rail-error"
              >
                <Text style={styles.errorText}>{railSwitchError.message}</Text>
              </View>
              {railSwitchError.retryable ? (
                <Button
                  label="Try again"
                  onPress={(): void =>
                    handleCountryChange(railSwitchError.countryCode)
                  }
                  variant="secondary"
                  size="lg"
                  fullWidth
                  accessibilityLabel="Try updating your payout country again"
                  testID="bank-connect-rail-retry"
                />
              ) : null}
            </>
          ) : selectedProvider === "paystack" ? (
            <BrandPaystackOnboardView
              brandId={brand.id}
              brandName={brand.displayName}
              mode="create"
              onConnected={handlePaystackConnected}
              onCancel={(): void => handleCountryChange("GB")}
            />
          ) : (
            <>
              <GlassCard
                variant="base"
                padding={spacing.md}
                style={styles.prerequisites}
              >
                <Text style={styles.prereqLabel}>BEFORE YOU START, HAVE READY</Text>
                <Text style={styles.prereqItem}>
                  {"•"} Business name and tax ID
                </Text>
                <Text style={styles.prereqItem}>
                  {"•"} A bank account in your country
                </Text>
                <Text style={styles.prereqItem}>
                  {"•"} Photo of government ID
                </Text>
              </GlassCard>

              {submitError !== null ? (
                <View
                  style={styles.errorCard}
                  accessibilityRole="alert"
                  testID="bank-connect-error"
                >
                  <Text style={styles.errorText}>{submitError}</Text>
                </View>
              ) : null}

              <Button
                label={
                  acceptTermsMutation.isPending || onboardMutation.isPending
                    ? "Opening secure bank setup…"
                    : "Add bank details"
                }
                onPress={handleStartStripe}
                variant="primary"
                size="lg"
                fullWidth
                loading={
                  acceptTermsMutation.isPending || onboardMutation.isPending
                }
                disabled={
                  acceptTermsMutation.isPending || onboardMutation.isPending
                }
                accessibilityLabel="Add bank details and continue to secure Stripe setup"
                testID="bank-connect-primary"
              />

              <Pressable
                onPress={handleOpenTerms}
                accessibilityRole="link"
                accessibilityLabel="Open Mingla Organiser Terms"
                style={styles.legalPressable}
              >
                <Text style={styles.legal}>
                  By connecting your bank you agree to Mingla{"’"}s{" "}
                  <Text style={styles.legalLink}>Organiser Terms</Text>. Powered
                  by Stripe — your data is encrypted.
                </Text>
              </Pressable>
            </>
          )}

          {/*
            #948 W4 [web-skip-download] — invite-phase-only Skip affordance,
            below the primary "Add bank details" so bank-first emphasis is
            preserved. Renders for BOTH provider paths (placed after the branch).
            Collapsed: a quiet ghost link. Expanded: the two secondary choices —
            reuse the attribution-safe BusinessAppDownloadCta (one OneLink, no
            store branching) + "Continue on web" → the top-level web-app home
            (`/(tabs)/home`).
          */}
          {isInviteFunnel ? (
            skipChoicesOpen ? (
              <GlassCard
                variant="base"
                padding={spacing.md}
                style={styles.skipChoices}
                testID="bank-connect-skip-choices"
              >
                <Text style={styles.skipHeading}>Add your bank later</Text>
                <Text style={styles.skipSubtext}>
                  No rush — you can add it anytime from your dashboard.
                </Text>
                <BusinessAppDownloadCta testID="bank-connect-skip-download" />
                <Button
                  label="Continue on web"
                  onPress={handleContinueOnWeb}
                  variant="ghost"
                  size="lg"
                  fullWidth
                  accessibilityLabel="Continue to your dashboard on the web"
                  testID="bank-connect-skip-continue-web"
                />
              </GlassCard>
            ) : (
              <Pressable
                onPress={handleOpenSkipChoices}
                accessibilityRole="button"
                accessibilityLabel="Skip bank setup for now"
                style={styles.skipLinkPressable}
                testID="bank-connect-skip-link"
              >
                <Text style={styles.skipLink}>Skip for now</Text>
              </Pressable>
            )
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  topBar: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBarTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  topBarSpacer: {
    width: 64,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    alignItems: "center",
  },
  content: {
    width: "100%",
    maxWidth: 640,
    gap: spacing.md,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  prerequisites: {
    width: "100%",
  },
  prereqLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  prereqItem: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    paddingVertical: spacing.xxs,
  },
  errorCard: {
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: semantic.errorTint,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  railSwitching: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  legalPressable: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  legal: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  legalLink: {
    color: textTokens.secondary,
    textDecorationLine: "underline",
  },
  // #948 W4 [web-skip-download] — the Skip affordance. Kept deliberately quiet
  // (secondary/ghost) so it never competes with the primary "Add bank details".
  skipLinkPressable: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  skipLink: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
    textDecorationLine: "underline",
  },
  skipChoices: {
    width: "100%",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  skipHeading: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  skipSubtext: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  centeredState: {
    flex: 1,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  stateTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  stateBody: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  stateActions: {
    gap: spacing.sm,
    alignItems: "center",
  },
});
