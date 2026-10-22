/**
 * BrandPaymentsView — payments dashboard (J-A11 §5.3.7).
 *
 * Renders four states based on `brand.stripeStatus`:
 *   - not_connected → orange Connect banner + £0 KPIs + empty payouts + Export
 *   - onboarding → orange Verifying banner + £0 KPIs + empty + Export
 *   - active → green connected banner + populated KPIs + payouts + refunds + Export
 *   - restricted → red Action Required banner + £0/historical KPIs + payouts + Export
 *
 * Status-driven banner via `resolveBrandStripeBannerConfig` (#3258; the
 * `Record<BrandStripePresentation, …>` table lives in
 * `src/utils/brandStripeUiState.ts`). ORCH-0764C changed active from
 * suppressed to explicit success banner.
 *
 * Inline composition (DEC-079 closure):
 *   - formatGbp (D-INV-A10-2 watch-point — THRESHOLD HIT, defer lift to J-A12)
 *   - formatRelativeTime (D-INV-A10-3 — THRESHOLD HIT, defer lift to J-A12)
 *   - StatusBanner (D-INV-A10-1 — first use; promote on 3+ uses)
 *
 * Per J-A10 spec §3.5.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
// #1834 [keyboard-blocks-bank-field] — the body ScrollViews route through the
// canonical SmartScrollView wrapper (ORCH-0892-B: native = the keyboard
// library's KeyboardAwareScrollView with the inherited DEFAULT_BOTTOM_OFFSET —
// Done bar + Input chrome + 12 visible clearance, derived per platform in the
// wrapper; web = plain RN ScrollView, a no-op).
// Plain react-native ScrollView subscribes to nothing, so the Nigerian bank
// form's account-number Input sat under the keyboard + Done bar with zero
// scroll on focus. Focused-field avoidance is owned by the wrapper — no
// bespoke KAV plumbing here, and no explicit bottomOffset (forking the
// constant is what breaks the ORCH-1165 clearance invariant).
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";

import {
  accent,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";

import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { TopBar } from "../ui/TopBar";
import { BrandStripeOrphanedRefundsSection } from "./BrandStripeOrphanedRefundsSection";
// ORCH-0802 — Danger zone: Disconnect Stripe sheet (was HIDDEN-FLAW-2 in
// investigation — detach hook+service shipped in B2a Path C V3 without a
// UI surface).
import { BrandStripeDetachConfirmSheet } from "./BrandStripeDetachConfirmSheet";
// META-ORCH-1076 Phase 2 — Paystack (NG) payout onboarding surface.
import { BrandPaystackOnboardView } from "./BrandPaystackOnboardView";
import {
  healRememberedPayoutCountry,
  rememberBrandPayoutCountry,
} from "../../services/brandPayoutCountryService";
// #1180 — held-payout receipt + release history (both rails) + explainer sheet.
import { BrandPayoutOverview } from "./BrandPayoutOverview";
import { BrandPayoutTimelineExplainer } from "./BrandPayoutTimelineExplainer";
import {
  useBrandPaystackStatus,
  useClearPaystackProvider,
  useDisconnectPaystack,
} from "../../hooks/useBrandPaystack";
import { useBrandStripeStatus } from "../../hooks/useBrandStripeStatus";
import { useBrandPayoutVisibility } from "../../hooks/useBrandPayoutVisibility";
import { useBrandStripeTaxAccountSession } from "../../hooks/useBrandStripeTaxAccountSession";
import { useBrandStripeAccountSession } from "../../hooks/useBrandStripeAccountSession";
import { useCanManageBrandPayments } from "../../hooks/useCanManageBrandPayments";
import { getEffectiveBrandStripeStatus } from "../../utils/stripeOnboardingOutcome";
// #3645 PR10 — organiser payout states ("Selling, add a bank", "Next payout on
// <date>", "Payouts paused") land on the SAME status card, on both rails.
import { isBrandChargeReady, isBrandPayoutReady } from "../../utils/brandPayout";
import {
  overlayPayoutStatusOnStripeBanner,
  resolveBrandPayoutStatus,
} from "../../utils/brandPayoutVisibility";
// #3258 — the status banner is resolved from status + requirements, not from a
// bare enum lookup. Table + selector live in the pure util so they are
// executable in a plain jest test (this file is not: expo-web-browser,
// reanimated and expo-haptics all land here at module scope).
import {
  resolveBrandStripeBannerConfig,
  type BrandStripeBannerConfig,
  type BrandStripeRequirementsShape,
} from "../../utils/brandStripeUiState";
// #3258 — NO import of `constants/publicUrls` here, deliberately. It reaches
// `constants/platformUrl`, which calls `expo-constants` at module scope; this
// file is mounted for real by `__tests__/issue_1863_payments_permission_gate.
// render.test.tsx`, whose runner has no expo-constants, so the import alone
// killed that whole suite at require time. There is also nothing to import:
// the pending-verification sentence names the URL the ACCOUNT reports, which
// the server hands us on `business_profile_url`.
// #1863 §4.10 — defence in depth for the 30s stale-role window. The primary
// gate is the route wrapper (BrandPaymentsPermissionGate); this catches the
// case where the client gate said ALLOW and the server said 403.
import { isPermissionDeniedError } from "../../utils/edgeFunctionErrors";
import {
  BRAND_PAYMENTS_DENIED_BODY,
  BRAND_PAYMENTS_DENIED_TITLE,
} from "../../utils/brandPaymentsPermission";
import {
  buildAccountManagementWebReturnUrl,
  isSafeAccountManagementTargetUrl,
} from "../../utils/accountManagementOpen";

// #2227 — literal custom scheme in this file so the AuthSession redirect
// registry can prove it is not https (re-export aliases are deny-by-default).
const RETURN_DEEP_LINK = "mingla-business://onboarding-complete" as const;

// Status-banner config table. ORCH-0764C requires active to render a visible
// success confirmation; only truly unsupported statuses would be suppressed.
// W-1 watch-point: kit lacks `alert`/`info` icons; restricted state uses
// `flag` (action-needed connotation) + semantic.error coloring.
//
// #3258 — the table and the presentation selector MOVED to
// `src/utils/brandStripeUiState.ts` (`BRAND_STRIPE_BANNER_CONFIG` +
// `resolveBrandStripeBannerConfig`) and gained a `pending_verification` entry.
// It sat here as `BANNER_CONFIG[stripeStatus]`, a bare enum lookup that never
// consulted `requirements` even though they were already in scope one screen
// down — which is how a seller with `disabled_reason =
// requirements.pending_verification` and EMPTY currently_due/past_due was shown
// "Action required — your account is limited" plus a destructive "Continue
// verification" button that returned them to a form they had already finished.
// Moving it also makes it testable: nothing in this file can be imported by the
// default node/ts-jest runner.

export interface BrandPaymentsViewProps {
  brand: Brand | null;
  onBack: () => void;
  /**
   * Called when user taps Connect/Finish banner CTA — routes to onboarding
   * shell. Restricted remediation uses the same route so the app creates a
   * fresh Stripe Account Link.
   */
  onOpenOnboard: () => void;
  /**
   * Called when user taps the "Export finance report" Button — routes to
   * the finance reports surface. NEW in J-A12.
   */
  onOpenReports: () => void;
  /** Opens the host-facing support hub for a payout that cannot be sent. */
  onContactSupport?: () => void;
  /** Opens the canonical payout detail route for one ledger release. */
  onOpenPayout?: (releaseId: string) => void;
  /**
   * #3645 — opens bank setup for a host who asked for a DIFFERENT country
   * (the Nigerian form's "Choose a different country"). Bank setup then opens
   * its country list with nothing chosen instead of sending a brand with a
   * Nigerian address straight back to Nigeria. Falls back to `onOpenOnboard`.
   */
  onChooseDifferentCountry?: () => void;
}

/**
 * The ONE Payments status card. Stripe's connected/not-connected banner and the
 * #3645 payout states (selling-add-bank / next payout / paused) both render
 * through this component, on both rails — there is no second card.
 */
const PaymentsStatusCard: React.FC<{
  config: BrandStripeBannerConfig;
  onCta: () => void;
}> = ({ config, onCta }) => (
  <GlassCard
    variant="base"
    padding={spacing.md}
    style={[
      config.destructive ? styles.bannerDestructive : null,
      config.success ? styles.bannerSuccess : null,
    ]}
  >
    <View style={styles.bannerRow}>
      <View
        style={[
          styles.bannerIconWrap,
          config.destructive && styles.bannerIconWrapDestructive,
          config.success && styles.bannerIconWrapSuccess,
        ]}
      >
        <Icon name={config.icon} size={20} color={config.iconColor} />
      </View>
      <View style={styles.bannerTextCol}>
        <Text style={styles.bannerTitle}>{config.title}</Text>
        <Text style={styles.bannerSub}>{config.sub}</Text>
      </View>
    </View>
    {config.ctaLabel !== null && config.ctaVariant !== null
      ? (
        <View style={styles.bannerCtaRow}>
          <Button
            label={config.ctaLabel}
            onPress={onCta}
            variant={config.ctaVariant}
            size="md"
            fullWidth
            accessibilityLabel={config.ctaLabel}
          />
        </View>
      )
      : null}
  </GlassCard>
);

export const BrandPaymentsView: React.FC<BrandPaymentsViewProps> = ({
  brand,
  onBack,
  onOpenPayout = () => {},
  onOpenOnboard,
  onOpenReports,
  onContactSupport = onOpenOnboard,
  onChooseDifferentCountry,
}) => {
  const insets = useSafeAreaInsets();
  // #3645 — the Nigerian status card's "Add bank" scrolls to the bank form
  // below it and focuses its first field.
  const paystackScrollRef = useRef<ScrollView | null>(null);
  const paystackFormYRef = useRef(0);
  const [paystackFormFocusSignal, setPaystackFormFocusSignal] = useState(0);
  const handlePaystackFormLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      paystackFormYRef.current = event.nativeEvent.layout.y;
    },
    [],
  );
  // #3660 — index is view-gated; bank mutate CTAs stay owner-only.
  const { allowed: canMutatePayouts } = useCanManageBrandPayments(
    brand?.id ?? null,
  );
  const handleMutatePayouts = useCallback((): void => {
    if (!canMutatePayouts) {
      Alert.alert(BRAND_PAYMENTS_DENIED_TITLE, BRAND_PAYMENTS_DENIED_BODY);
      return;
    }
    onOpenOnboard();
  }, [canMutatePayouts, onOpenOnboard]);

  // V3 (Sub-C Session A): live status query gives access to requirements
  // shape for the KycRemediationCard. Sibling-pattern: cached + Realtime-fed.
  const stripeStatusQuery = useBrandStripeStatus(brand?.id ?? null);
  const stripeStatus = getEffectiveBrandStripeStatus({
    liveStatus: stripeStatusQuery.data?.status,
    cachedStatus: brand?.stripeStatus,
  });
  // META-ORCH-1076 — Paystack rail. Enabled only for paystack brands; harmless
  // (disabled) for every Stripe brand. Hook runs unconditionally per React rules.
  const isPaystackBrand = brand?.paymentProvider === "paystack";
  const paystackStatusQuery = useBrandPaystackStatus(
    isPaystackBrand ? (brand?.id ?? null) : null,
  );
  const disconnectPaystackMutation = useDisconnectPaystack();
  const clearPaystackMutation = useClearPaystackProvider();
  const [paystackEditing, setPaystackEditing] = useState<boolean>(false);
  // ORCH-0955 — Tax CTA opens new brand-stripe-tax-account-session that mints
  // an AccountSession with tax_registrations + tax_settings GA components,
  // rendered in the Mingla-hosted /connect-tax-registrations page via
  // expo-web-browser. Replaces the legacy ORCH-0804 dashboard-link redirect
  // (deleted; would have broken under ORCH-0954 dashboard:'none' cutover).
  // ORCH-0955: brand is merchant of record; Stripe Tax for Platforms direct-
  // charge handles the calc/commit/reverse 3-step inline on every native PI.
  const taxAccountSession = useBrandStripeTaxAccountSession();
  // ORCH-0954 — Account management embedded-onboarding session for
  // dashboard:'none' Stripe-managed-risk Connect controllers.
  const accountSession = useBrandStripeAccountSession();
  const handleOpenAccountManagement = useCallback(async (): Promise<void> => {
    if (!canMutatePayouts) {
      Alert.alert(BRAND_PAYMENTS_DENIED_TITLE, BRAND_PAYMENTS_DENIED_BODY);
      return;
    }
    if (brand?.id === undefined || accountSession.isPending) return;
    // #3645 — Real Host web is HTTPS: same-tab assign with HTTPS return_to
    // (openAuthSession after an await is popup-blocked). Native and non-HTTPS
    // environments keep the deep-link auth session.
    const webReturnUrl =
      typeof window !== "undefined"
        ? buildAccountManagementWebReturnUrl(window.location.origin, brand.id)
        : null;
    if (webReturnUrl !== null) {
      const result = await accountSession.mutateAsync({
        brandId: brand.id,
        surface: "account_management",
        returnUrl: webReturnUrl,
      });
      if (
        !isSafeAccountManagementTargetUrl(
          result.targetUrl,
          window.location.origin,
        )
      ) {
        throw new Error(
          "We got an unexpected bank setup link. Please try again.",
        );
      }
      window.location.assign(result.targetUrl);
      return;
    }
    const result = await accountSession.mutateAsync({
      brandId: brand.id,
      surface: "account_management",
    });
    await WebBrowser.openAuthSessionAsync(result.targetUrl, RETURN_DEEP_LINK);
  }, [accountSession, brand?.id, canMutatePayouts]);
  const handleOpenTaxDashboard = useCallback((): void => {
    if (!canMutatePayouts) {
      Alert.alert(BRAND_PAYMENTS_DENIED_TITLE, BRAND_PAYMENTS_DENIED_BODY);
      return;
    }
    if (brand?.id === undefined || taxAccountSession.isPending) return;
    taxAccountSession.mutate(brand.id);
  }, [brand?.id, canMutatePayouts, taxAccountSession]);

  // ORCH-0802 — Disconnect Stripe sheet visibility. Sheet is only ever
  // reachable from the Danger zone CTA below, which itself only renders
  // when stripeStatus is active OR restricted (SPEC §6.3 visibility gate).
  const [detachSheetVisible, setDetachSheetVisible] = useState<boolean>(false);
  const handleOpenDetach = useCallback((): void => {
    if (!canMutatePayouts) {
      Alert.alert(BRAND_PAYMENTS_DENIED_TITLE, BRAND_PAYMENTS_DENIED_BODY);
      return;
    }
    setDetachSheetVisible(true);
  }, [canMutatePayouts]);
  const handleCloseDetach = useCallback((): void => {
    setDetachSheetVisible(false);
  }, []);

  // #1180 — "How payouts work" explainer sheet (shared by both rails).
  const [explainerVisible, setExplainerVisible] = useState<boolean>(false);
  const handleOpenExplainer = useCallback((): void => {
    setExplainerVisible(true);
  }, []);
  const handleCloseExplainer = useCallback((): void => {
    setExplainerVisible(false);
  }, []);

  // #3258 — status + requirements, not status alone. `stripeStatus` stays the
  // server-derived enum for every OTHER consumer on this screen (bank section,
  // danger zone, balances, KPI gating); only the banner splits the
  // "Stripe is still checking" case out of `restricted`.
  const stripeRequirements =
    (stripeStatusQuery.data?.requirements as
      | BrandStripeRequirementsShape
      | undefined) ?? null;
  // #3258 — the URL Stripe actually holds for this account, straight off
  // `brand-stripe-refresh-status`. This is the ONLY URL the sentence names.
  //
  // An earlier cut of this change also guessed the brand's own Mingla page
  // (`brandPublicUrl(brand.slug)`) whenever the account reported none. That
  // guess is gone, and its removal is a subtraction, not a loss:
  //   - it could only ever be a guess. Stripe pends `business_profile.url`
  //     against the URL it HOLDS; for every account onboarded before the
  //     platform began prefilling one, that is whatever website the seller
  //     typed inside Connect onboarding — for the brand this issue was filed
  //     over, a dead domain. Naming the Mingla page there states something
  //     false with total confidence (Constitution rule 9).
  //   - it is redundant. Since `brand-stripe-onboard` prefills
  //     `defaults.profile.business_url` with `/b/{slug}`, any account Stripe
  //     is checking a URL on reports that URL back here.
  // With no URL to name, the sentence reads "Stripe is checking your website.
  // Nothing to do — we'll email you when it's verified." — still true, still
  // names the field, just without a URL we invented.
  //
  // `?? null` covers both an absent field (edge fn not yet redeployed) and an
  // explicit null.
  const accountBusinessUrl = stripeStatusQuery.data?.business_profile_url ??
    null;
  // #3258 (review follow-up) — `stripeStatus` can come from the CACHED
  // `brand.stripeStatus` while `stripeRequirements` can only come from the
  // live query, so on every cold mount there is a window where the pair reads
  // `{ restricted, null }`. Without this flag that window rendered the red
  // "Action required" card plus a tappable "Continue verification", then
  // flipped to the warm verifying card once the edge function (which itself
  // round-trips to Stripe) answered. `isSuccess` is the only honest signal
  // that `stripeRequirements` means anything yet.
  const stripeBannerBase = resolveBrandStripeBannerConfig({
    status: stripeStatus,
    requirements: stripeRequirements,
    statusQuerySucceeded: stripeStatusQuery.isSuccess,
    accountBusinessUrl,
  });

  // #3645 PR10 — payout visibility (finance_manager+ RPC; the route gate already
  // keeps lower roles off this screen). A failed read degrades to "no extra
  // state" — the card falls back to its existing copy, never to a guess.
  const payoutVisibilityQuery = useBrandPayoutVisibility(brand?.id ?? null);
  const payoutVisibility = payoutVisibilityQuery.data ?? null;
  // Fresh provider flags beat the cached brand row when the live queries answered.
  const payoutReadinessBrand = brand === null ? null : {
    ...brand,
    chargesEnabled: stripeStatusQuery.data?.charges_enabled ??
      brand.chargesEnabled,
    payoutsEnabled: stripeStatusQuery.data?.payouts_enabled ??
      brand.payoutsEnabled,
    hasPaystackRecipient: paystackStatusQuery.data?.recipient_connected ??
      brand.hasPaystackRecipient,
  };
  const payoutStatus = resolveBrandPayoutStatus({
    chargeReady: isBrandChargeReady(payoutReadinessBrand),
    payoutReady: isBrandPayoutReady(payoutReadinessBrand),
    visibility: payoutVisibility,
  });
  // Stripe: overlay on the existing banner (only when it is the "connected"
  // card — an action-required card is never papered over).
  const bannerConfig = overlayPayoutStatusOnStripeBanner(
    stripeBannerBase,
    payoutStatus,
  );
  // Paystack: there is no Stripe banner; the same card carries the payout state
  // with no CTA (the bank form is already on screen below it).
  // #3645 — "Selling, add a bank to get paid" keeps its "Add bank" button
  // while the form is on screen: the button takes the host to the form. The
  // other states (next payout, paused) offer no action.
  // #3645 — card rail. A brand that can sell but whose payouts are not enabled
  // gets "Add bank" on the status card. Bank setup has nothing left to ask
  // such a brand (it answers "You're all set"), so the button opens payout
  // account management, which is where a bank account is entered.
  const cardRailAddBank = payoutStatus !== null &&
    payoutStatus.kind === "selling_add_bank" &&
    bannerConfig !== stripeBannerBase;
  const refetchStripeStatus = stripeStatusQuery.refetch;
  const refetchPayoutVisibility = payoutVisibilityQuery.refetch;
  // True when the last "Add bank" could not open payout account management,
  // for ANY reason: the request, or the browser refusing to open the window
  // (a popup blocker refuses a window opened after a request). Never silent.
  const [addBankFailed, setAddBankFailed] = useState(false);
  const handleCardRailAddBank = useCallback(async (): Promise<void> => {
    setAddBankFailed(false);
    try {
      await handleOpenAccountManagement();
    } catch {
      setAddBankFailed(true);
      return;
    }
    void refetchStripeStatus();
    void refetchPayoutVisibility();
  }, [
    handleOpenAccountManagement,
    refetchPayoutVisibility,
    refetchStripeStatus,
  ]);
  // #3645 — the remembered payout country is never authoritative over a real
  // account: this screen knows the account's country, so a different
  // remembered one is corrected (fire-and-forget).
  const brandIdForHeal = brand?.id ?? null;
  const rememberedPayoutCountry = brand?.payoutCountry ?? null;
  const liveAccountCountry = stripeStatusQuery.data?.country ?? null;
  useEffect(() => {
    healRememberedPayoutCountry({
      brandId: brandIdForHeal,
      rememberedCountry: rememberedPayoutCountry,
      accountCountry: liveAccountCountry,
    });
  }, [brandIdForHeal, liveAccountCountry, rememberedPayoutCountry]);

  // #1863 §4.10 — the server has refused this caller. Derived once, from the
  // real classified errors, for BOTH twins. When true the whole body is
  // replaced by the same explanation card the route gate renders — and
  // specifically NOT by the two "Couldn’t refresh…" warning cards plus a live
  // Danger Zone, which is what a demoted user saw for the length of the 30s
  // role-cache window.
  const deniedByServer = isPermissionDeniedError(stripeStatusQuery.error);

  // ----- Not-found state -----
  if (brand === null) {
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Payments"
            onBack={onBack}
            rightSlot={<View />}
          />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle}>Brand not found</Text>
            <Text style={styles.notFoundBody}>
              The brand you tried to open doesn{"’"}t exist or has been removed.
              Go back to your account to pick another.
            </Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label="Back to Account"
                onPress={onBack}
                variant="secondary"
                size="md"
                leadingIcon="arrowL"
              />
            </View>
          </GlassCard>
        </ScrollView>
      </View>
    );
  }

  // ----- Server-refused state (#1863 §4.10) -----
  // Placed ABOVE the Paystack fork on purpose: a gate that sat below it would
  // leave the entire Nigerian bank-connect journey unprotected. One decision,
  // both rails — the same reason the route wrapper sits above this component.
  if (deniedByServer) {
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Payments"
            onBack={onBack}
            rightSlot={<View />}
          />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle} accessibilityRole="header">
              {BRAND_PAYMENTS_DENIED_TITLE}
            </Text>
            <Text style={styles.notFoundBody}>{BRAND_PAYMENTS_DENIED_BODY}</Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label="Back"
                onPress={onBack}
                variant="secondary"
                size="md"
                leadingIcon="arrowL"
                accessibilityLabel="Back"
              />
            </View>
          </GlassCard>
        </ScrollView>
      </View>
    );
  }

  // ----- Paystack rail (META-ORCH-1076 Phase 2) -----
  // Nigerian brands settle through Paystack, not Stripe Connect. Render the
  // bank-details onboarding form until a subaccount exists, then a readiness
  // card. Entirely separate from the Stripe surface below.
  if (isPaystackBrand) {
    const connected = brand.paystackSubaccountCode != null ||
      paystackStatusQuery.data?.connected === true;
    const handleDisconnect = (): void => {
      if (!canMutatePayouts) {
        Alert.alert(BRAND_PAYMENTS_DENIED_TITLE, BRAND_PAYMENTS_DENIED_BODY);
        return;
      }
      Alert.alert(
        "Disconnect payout bank?",
        "This brand will stop receiving payouts until you connect a bank again.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: () => {
              disconnectPaystackMutation.mutate(brand.id, {
                onSuccess: () => {
                  setPaystackEditing(false);
                  paystackStatusQuery.refetch();
                },
                onError: () =>
                  Alert.alert(
                    "Couldn't disconnect",
                    "Please try again in a moment.",
                  ),
              });
            },
          },
        ],
      );
    };
    const handleClearProvider = (): void => {
      if (!canMutatePayouts) {
        Alert.alert(BRAND_PAYMENTS_DENIED_TITLE, BRAND_PAYMENTS_DENIED_BODY);
        return;
      }
      clearPaystackMutation.mutate(brand.id, {
        // Leave the Nigerian rail, then open the country list to re-pick.
        // #3645 — the choice is cleared, so the remembered country is too, and
        // bank setup is told the host came to choose (nothing preselected, no
        // automatic move back to Nigeria).
        onSuccess: () => {
          void rememberBrandPayoutCountry(brand.id, null);
          (onChooseDifferentCountry ?? onOpenOnboard)();
        },
      });
    };
    // #3645 — "Add bank" on the status card: the bank form is further down
    // this same screen. Scroll to it and focus its first field.
    const handleGoToBankForm = (): void => {
      if (!canMutatePayouts) {
        Alert.alert(BRAND_PAYMENTS_DENIED_TITLE, BRAND_PAYMENTS_DENIED_BODY);
        return;
      }
      if (connected) setPaystackEditing(true);
      paystackScrollRef.current?.scrollTo({
        y: Math.max(0, paystackFormYRef.current - spacing.md),
        animated: true,
      });
      setPaystackFormFocusSignal((signal) => signal + 1);
    };
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Payments"
            onBack={onBack}
            rightSlot={<View />}
          />
        </View>
        <ScrollView
          ref={paystackScrollRef}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: spacing.xl + Math.max(insets.bottom, spacing.md) },
          ]}
          // #1834 — the Verify/Connect CTAs must fire on the FIRST tap with the
          // keyboard up; without this the tap is consumed dismissing it (a dead
          // tap, Constitution rule 1). Same reason as app/partner/earnings.tsx.
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <BrandPayoutOverview
            brandId={brand.id}
            onOpenPayout={onOpenPayout}
            onOpenExplainer={handleOpenExplainer}
            onOpenBank={handleGoToBankForm}
            onOpenVerification={onOpenOnboard}
            onContactSupport={onContactSupport}
            onDisconnectBank={connected ? handleDisconnect : undefined}
            onDownloadPayouts={onOpenReports}
          />
          {connected && !paystackEditing
            ? (
              null
            )
            : (
              <View
                onLayout={handlePaystackFormLayout}
                testID="payments-nigeria-bank-form"
              >
                <BrandPaystackOnboardView
                  brandId={brand.id}
                  brandName={brand.displayName}
                  mode={connected ? "update" : "create"}
                  onConnected={() => {
                    setPaystackEditing(false);
                    paystackStatusQuery.refetch();
                  }}
                  onCancel={connected
                    ? () => setPaystackEditing(false)
                    : handleClearProvider}
                  focusFirstFieldSignal={paystackFormFocusSignal}
                />
              </View>
            )}
        </ScrollView>
        {/* #1180 — explainer sheet mounted outside the ScrollView so the modal
            overlay isn't clipped by the scroll frame. */}
        <BrandPayoutTimelineExplainer
          visible={explainerVisible}
          onClose={handleCloseExplainer}
          isNgBrand
        />
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          title="Payments"
          onBack={onBack}
          rightSlot={<View />}
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: spacing.xl + Math.max(insets.bottom, spacing.md) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {(stripeStatus !== "active" || cardRailAddBank) && bannerConfig !== null ? (
          <PaymentsStatusCard
            config={bannerConfig}
            onCta={cardRailAddBank ? () => void handleCardRailAddBank() : handleMutatePayouts}
          />
        ) : null}
        {addBankFailed ? (
          <Text style={styles.statusRefreshTitle} accessibilityRole="alert">
            Couldn{"’"}t open bank setup. Try again.
          </Text>
        ) : null}
        <BrandPayoutOverview
          brandId={brand.id}
          onOpenPayout={onOpenPayout}
          onOpenExplainer={handleOpenExplainer}
          onOpenBank={() => void handleCardRailAddBank()}
          onOpenVerification={onOpenOnboard}
          onContactSupport={onContactSupport}
          onDisconnectBank={handleOpenDetach}
          onDownloadPayouts={onOpenReports}
          suppressAttention={stripeStatus !== "active" || cardRailAddBank}
        />

        {brand && stripeStatusQuery.data?.detached_at != null
          ? <BrandStripeOrphanedRefundsSection brandId={brand.id} />
          : null}

        {/* SECTION B.5 — ORCH-0955 embedded Tax tools.
            Mints an AccountSession with tax_registrations + tax_settings
            GA components, then opens the Mingla-hosted
            /connect-tax-registrations page (via expo-web-browser) which
            mounts both components inline. Replaces the legacy ORCH-0804
            Stripe Express Dashboard login-link redirect (deleted; broke
            under ORCH-0954 dashboard:'none' cutover). Brand is merchant
            of record. Stripe Tax for Platforms direct-charge handles
            calc/commit/reverse on every native PI. */}
        {stripeStatus === "active" && brand !== null
          ? (
            <GlassCard
              variant="base"
              padding={spacing.md}
              style={styles.taxCtaCard}
            >
              <View style={styles.taxCtaRow}>
                <View style={styles.taxCtaIconCol}>
                  <Icon name="bank" size={20} color={accent.warm} />
                </View>
                <View style={styles.taxCtaTextCol}>
                  <Text style={styles.taxCtaTitle}>Tax & registrations</Text>
                  <Text style={styles.taxCtaBody}>
                    Manage your tax registrations and settings here. Stripe’s
                    automatic-tax fee (about 0.5%) is paid by you and shown
                    separately from Mingla’s 4.5% fee.
                  </Text>
                  {taxAccountSession.isError
                    ? (
                      <Text style={styles.taxCtaError}>
                        Couldn’t open tax settings. Try again.
                      </Text>
                    )
                    : null}
                </View>
              </View>
              <View style={styles.taxCtaBtnRow}>
                <Button
                  label={taxAccountSession.isPending
                    ? "Opening..."
                    : "Manage tax registrations"}
                  onPress={handleOpenTaxDashboard}
                  variant="secondary"
                  size="md"
                  disabled={taxAccountSession.isPending}
                  leadingIcon="link"
                />
              </View>
            </GlassCard>
          )
          : null}

      </ScrollView>

      {
        /* ORCH-0802 — Detach confirmation sheet. Mounted outside the
          ScrollView so the modal overlay isn't clipped by the scroll
          frame. brandId/brandName are null-guarded — the sheet renders
          null when either is missing. */
      }
      <BrandStripeDetachConfirmSheet
        visible={detachSheetVisible}
        brandId={brand?.id ?? null}
        brandName={brand?.displayName ?? null}
        onClose={handleCloseDetach}
      />

      {/* #1180 — "How payouts work" explainer sheet (Stripe rail). */}
      <BrandPayoutTimelineExplainer
        visible={explainerVisible}
        onClose={handleCloseExplainer}
        isNgBrand={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },

  // Not-found state ------------------------------------------------------
  notFoundTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  notFoundBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  notFoundBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },

  // Banner ---------------------------------------------------------------
  bannerDestructive: {
    borderColor: "rgba(239, 68, 68, 0.45)", // Pill error border style
    borderWidth: 1,
  },
  bannerSuccess: {
    borderColor: "rgba(34, 197, 94, 0.45)",
    borderWidth: 1,
  },
  bannerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  bannerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerIconWrapDestructive: {
    backgroundColor: semantic.errorTint,
    borderColor: "rgba(239, 68, 68, 0.45)",
  },
  bannerIconWrapSuccess: {
    backgroundColor: semantic.successTint,
    borderColor: "rgba(34, 197, 94, 0.45)",
  },
  bannerTextCol: {
    flex: 1,
    minWidth: 0,
  },
  bannerTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  bannerSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: 2,
  },
  bannerCtaRow: {
    marginTop: spacing.md,
  },
  statusRefreshWarning: {
    borderColor: "rgba(251, 191, 36, 0.35)",
    borderWidth: 1,
  },
  statusRefreshTitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  statusRefreshBody: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: 4,
  },

  // ORCH-0954 — Embedded Stripe account-management entry ----------------
  manageStripeCard: {
    borderColor: accent.border,
    borderWidth: 1,
  },
  manageStripeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  manageStripeIconCol: {
    width: 26,
    paddingTop: 2,
  },
  manageStripeTextCol: {
    flex: 1,
    minWidth: 0,
  },
  manageStripeTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: 2,
  },
  manageStripeBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  manageStripeError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: 4,
  },
  manageStripeBtnRow: {
    marginTop: spacing.md,
    flexDirection: "row",
  },

  // KPI tiles ------------------------------------------------------------
  kpisRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kpiCell: {
    flex: 1,
  },

  // ORCH-0804 — Tax & registrations CTA card -----------------------------
  taxCtaCard: {
    marginTop: spacing.md,
  },
  taxCtaRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  taxCtaIconCol: {
    width: 26,
    paddingTop: 2,
  },
  taxCtaTextCol: {
    flex: 1,
    minWidth: 0,
  },
  taxCtaTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  taxCtaBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  taxCtaError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: 4,
  },
  taxCtaBtnRow: {
    marginTop: spacing.sm,
    alignItems: "flex-start",
  },

  // Section labels -------------------------------------------------------
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionLabelGap: {
    paddingTop: spacing.md,
  },

  // Empty state ----------------------------------------------------------
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: 4,
  },

  // Transaction rows (payouts + refunds) ---------------------------------
  txnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  txnRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  txnLeftCol: {
    flex: 1,
    minWidth: 0,
  },
  txnAmount: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  txnAmountRefund: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: semantic.error,
  },
  txnSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  refundDate: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },

  // Export CTA -----------------------------------------------------------
  exportRow: {
    marginTop: spacing.sm,
  },

  // ORCH-0802 — Danger zone (Disconnect Stripe) --------------------------
  dangerZone: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  dangerZoneTitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: semantic.error,
  },
  dangerZoneBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  dangerZoneBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },
});

export default BrandPaymentsView;
