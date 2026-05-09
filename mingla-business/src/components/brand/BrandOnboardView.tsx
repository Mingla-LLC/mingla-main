/**
 * BrandOnboardView — Stripe Connect Express onboarding entry point.
 *
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.5.1.
 *
 * Replaces the Cycle 2 simulated state machine with the real flow:
 *  - Calls brand-stripe-onboard edge fn → Mingla-hosted onboarding URL
 *  - Opens URL via expo-web-browser.openAuthSessionAsync (system browser modal)
 *  - On dismiss: refreshes status from server; transitions state machine
 *  - DELETED: long-press dev gesture (R-NEW-6 production back-door mitigation)
 *  - DELETED: 1.5s simulated delay (was fake)
 *
 * State machine (9 states + 2 mount bypasses) — expanded from SPEC §4.5.1
 * 6-state proposal per /ui-ux-pro-max design review (IMPL Phase 8 pre-flight):
 *
 *  Mount bypasses:
 *    - checking-status: cached active brand waits for live Stripe confirmation
 *    - already-active: live Stripe status is active; render success + redirect
 *    - permission-denied: caller lacks finance_manager rank
 *
 *  Active states:
 *    idle → starting → in-flight → {
 *      complete-active   (status=active; verified; immediate)
 *      complete-verifying (status=onboarding; awaiting Stripe verification)
 *      needs-information (status=restricted; actionable Stripe requirements)
 *      cancelled         (browser dismissed without completing)
 *      session-expired   (Stripe AccountSession TTL exceeded)
 *      failed-network    (mutation failed before browser opened)
 *      failed-stripe     (terminal Stripe rejection)
 *    }
 *
 * Trust signals (per design review):
 *  - "Powered by Stripe" footer in idle state
 *  - "Your bank details go directly to Stripe — Mingla never sees them" reassurance
 *  - Time estimate "Takes about 5 minutes"
 *  - Prerequisites list (tax ID, bank, ID)
 *  - Support email link in in-flight + failed states
 *
 * Accessibility (I-38 + I-39 + I-40 motion):
 *  - accessibilityLabel on every Pressable
 *  - AccessibilityInfo.announceForAccessibility on state changes
 *  - Spinner respects iOS Reduce Motion via existing kit Spinner primitive
 *  - Haptics on state transitions (success/warning/error)
 *
 * Per J-A10 spec §3.6 + B2a SPEC §4.5.1.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";

import {
  accent,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";
import { useStartBrandStripeOnboarding } from "../../hooks/useStartBrandStripeOnboarding";
import {
  useBrandStripeStatus,
  brandStripeStatusKeys,
} from "../../hooks/useBrandStripeStatus";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/Spinner";
import { BrandStripeCountryPicker } from "./BrandStripeCountryPicker";
import { MinglaToSAcceptanceGate } from "../onboarding/MinglaToSAcceptanceGate";
import { useAuth } from "../../context/AuthContext";
import {
  classifyStripeOnboardingOutcome,
  deriveStripeOnboardingEntryState,
  type StripeOnboardingOutcome,
  type StripeRequirementsShape,
} from "../../utils/stripeOnboardingOutcome";
import { settleStripeStatus } from "../../utils/stripeStatusSettlement";
import {
  getStripeCountryLockedCopy,
  getStripeCountryReplaceableCopy,
  isStripeCountryPickerLocked,
} from "../../utils/brandStripeUiState";
import { BrandStripeCountryLockedError } from "../../services/brandStripeService";

const RETURN_DEEP_LINK = "mingla-business://onboarding-complete" as const;
const DEFAULT_COUNTRY = "GB" as const;
// B2a Path C V3 forensics C-3: was support@mingla.com — domain not Mingla-owned.
const SUPPORT_EMAIL = "support@usemingla.com" as const;
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}` as const;

type ViewState =
  | "permission-denied"
  | "checking-status"
  | "settling-status"
  | "already-active"
  | "idle"
  | "starting"
  | "in-flight"
  | "complete-active"
  | "complete-verifying"
  | "needs-information"
  | "cancelled"
  | "session-expired"
  | "failed-network"
  | "failed-stripe";

export interface BrandOnboardViewProps {
  brand: Brand | null;
  onCancel: () => void;
  onAfterDone: () => void;
}

/** Best-effort haptic — silently swallowed if unavailable. */
function fireHaptic(
  kind: "success" | "warning" | "error",
): void {
  try {
    const map = {
      success: Haptics.NotificationFeedbackType.Success,
      warning: Haptics.NotificationFeedbackType.Warning,
      error: Haptics.NotificationFeedbackType.Error,
    } as const;
    void Haptics.notificationAsync(map[kind]);
  } catch {
    // Haptics unavailable on web or simulator — silent skip
  }
}

/** Best-effort screen reader announcement. */
function announceForAccessibility(message: string): void {
  try {
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // Skip on platforms without support
  }
}

function coerceRequirements(
  requirements: unknown,
): StripeRequirementsShape | null {
  if (requirements == null || typeof requirements !== "object") return null;
  return requirements as StripeRequirementsShape;
}

export const BrandOnboardView: React.FC<BrandOnboardViewProps> = ({
  brand,
  onCancel,
  onAfterDone,
}) => {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const onboardMutation = useStartBrandStripeOnboarding();
  const statusQuery = useBrandStripeStatus(brand?.id ?? null);
  const startInProgressRef = useRef(false);

  // Mount-time bypass derivation
  const initialState: ViewState = (() => {
    if (brand === null) return "idle"; // not-found rendered separately below
    // Cached active is not enough to show terminal success: brand.stripeStatus
    // lacks live requirements JSONB and detached_at. Confirm through
    // useBrandStripeStatus before rendering "You're all set".
    if (brand.stripeStatus === "active") return "checking-status";
    return "idle";
  })();

  const [viewState, setViewState] = useState<ViewState>(initialState);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // V3 multi-country: brand admin picks country before onboarding starts.
  // Defaults to GB to preserve Phase 0 behaviour for unmodified callers.
  // Per SPEC §13 amendment A4 + I-PROPOSED-T (canonical 34-country allowlist).
  const [selectedCountry, setSelectedCountry] = useState<string>(DEFAULT_COUNTRY);
  const [countryTouched, setCountryTouched] = useState(false);
  // V3 ToS gate: must pass before Stripe onboarding can start (per I-PROPOSED-U).
  // Gate component checks brand_team_members.mingla_tos_accepted_at and either
  // (a) auto-fires onPassed if already accepted, or (b) renders a sheet that
  // forces the user to accept before any other interaction is possible.
  const { user } = useAuth();
  const [tosPassed, setTosPassed] = useState(false);
  const handleTosPassed = useCallback((): void => setTosPassed(true), []);
  const handleCountryChange = useCallback((countryCode: string): void => {
    setCountryTouched(true);
    setSelectedCountry(countryCode);
  }, []);

  const savedStripeCountry = statusQuery.data?.country ?? null;
  const countryPickerLocked = isStripeCountryPickerLocked({
    stripeAccountId: statusQuery.data?.stripe_account_id ?? null,
    status: statusQuery.data?.status ?? brand?.stripeStatus ?? null,
    detailsSubmitted: statusQuery.data?.details_submitted ?? null,
    chargesEnabled: statusQuery.data?.charges_enabled ?? null,
    payoutsEnabled: statusQuery.data?.payouts_enabled ?? null,
  });
  const countryPickerHelper =
    savedStripeCountry !== null &&
      savedStripeCountry !== selectedCountry &&
      !countryPickerLocked
      ? getStripeCountryReplaceableCopy(selectedCountry)
      : null;
  const countryPickerWarning = countryPickerLocked
    ? getStripeCountryLockedCopy(savedStripeCountry ?? selectedCountry)
    : null;
  const isCountryLockedError =
    errorMessage?.includes("create a new brand") === true;

  useEffect(() => {
    if (countryTouched || savedStripeCountry === null) return;
    setSelectedCountry(savedStripeCountry);
  }, [countryTouched, savedStripeCountry]);

  const applyOnboardingOutcome = useCallback(
    (outcome: StripeOnboardingOutcome): void => {
      switch (outcome) {
        case "complete-active":
          setViewState("complete-active");
          setErrorMessage(null);
          fireHaptic("success");
          announceForAccessibility(
            "Onboarding complete. You can publish events and accept payments now.",
          );
          break;
        case "complete-verifying":
          setViewState("complete-verifying");
          setErrorMessage(null);
          fireHaptic("success");
          announceForAccessibility(
            "Submitted to Stripe. Stripe is verifying your details.",
          );
          break;
        case "needs-information":
          setViewState("needs-information");
          setErrorMessage(
            "Stripe needs a few more details before payments can be enabled. Continue verification to finish the missing steps.",
          );
          fireHaptic("warning");
          announceForAccessibility(
            "Stripe needs more information. Continue verification to finish setup.",
          );
          break;
        case "failed-stripe":
          setViewState("failed-stripe");
          setErrorMessage(
            "Stripe could not verify this account. Contact support if this looks wrong.",
          );
          fireHaptic("error");
          announceForAccessibility("Stripe could not verify this account.");
          break;
        case "session-expired":
          setViewState("session-expired");
          setErrorMessage(null);
          fireHaptic("warning");
          announceForAccessibility(
            "Onboarding session ended. Tap continue setup to retry.",
          );
          break;
      }
    },
    [],
  );

  // Watch status query for in-flight → completion transitions while in browser
  useEffect(() => {
    if (viewState !== "in-flight") return;
    const status = statusQuery.data?.status;
    if (status === "active") {
      applyOnboardingOutcome("complete-active");
    } else if (status === "onboarding") {
      // Brand submitted; Stripe verifying. Don't auto-transition unless browser dismissed.
    } else if (status === "restricted") {
      applyOnboardingOutcome(
        classifyStripeOnboardingOutcome({
          status,
          requirements: coerceRequirements(statusQuery.data?.requirements),
        }),
      );
    }
  }, [
    applyOnboardingOutcome,
    statusQuery.data?.requirements,
    statusQuery.data?.status,
    viewState,
  ]);

  // Cached active must settle through the canonical live status query before
  // terminal success. This keeps live restricted requirements from being hidden
  // behind stale denormalized brand cache.
  useEffect(() => {
    if (viewState !== "checking-status" || brand === null) return;

    if (statusQuery.isError) {
      setViewState("failed-network");
      setErrorMessage(
        "We couldn't confirm your Stripe status. Check your connection and try again.",
      );
      fireHaptic("error");
      announceForAccessibility("Could not confirm your Stripe status.");
      return;
    }

    const entryState = deriveStripeOnboardingEntryState({
      cachedStatus: brand.stripeStatus ?? null,
      liveStatus: statusQuery.data?.status ?? null,
      liveStatusLoaded: statusQuery.data != null,
      requirements: coerceRequirements(statusQuery.data?.requirements),
    });

    if (entryState === "checking-status") return;

    if (entryState === "already-active") {
      setViewState("already-active");
      setErrorMessage(null);
      return;
    }

    if (entryState === "idle") {
      setViewState("idle");
      setErrorMessage(null);
      return;
    }

    applyOnboardingOutcome(entryState);
  }, [
    applyOnboardingOutcome,
    brand,
    statusQuery.data,
    statusQuery.isError,
    viewState,
  ]);

  // ----- Action handlers ------------------------------------------------

  const handleStart = useCallback(async (): Promise<void> => {
    if (brand === null || startInProgressRef.current) return;
    startInProgressRef.current = true;
    setViewState("starting");
    setErrorMessage(null);
    announceForAccessibility("Creating your Stripe account.");

    try {
      const result = await onboardMutation.mutateAsync({
        brandId: brand.id,
        returnUrl: RETURN_DEEP_LINK,
        country: selectedCountry,
      });

      setViewState("in-flight");
      announceForAccessibility(
        "Complete the form that opened. We will know when you are done.",
      );

      const browserResult = await WebBrowser.openAuthSessionAsync(
        result.onboarding_url,
        RETURN_DEEP_LINK,
      );

      setViewState("settling-status");
      announceForAccessibility("Confirming your Stripe status.");

      // Refresh status to determine outcome. Stripe can lag the browser
      // return, so settle briefly before deciding what the user sees.
      await queryClient.invalidateQueries({
        queryKey: brandStripeStatusKeys.detail(brand.id),
      });
      const refreshed = await settleStripeStatus(() => statusQuery.refetch());
      const outcome = classifyStripeOnboardingOutcome({
        status: refreshed?.status,
        requirements: coerceRequirements(refreshed?.requirements),
      });

      if (browserResult.type === "success") {
        applyOnboardingOutcome(outcome);
      } else if (
        browserResult.type === "cancel" ||
        browserResult.type === "dismiss"
      ) {
        // Dismissed browser windows can still complete Stripe steps. Trust the
        // bounded settlement if Stripe now reports a real account state.
        if (outcome !== "session-expired") {
          applyOnboardingOutcome(outcome);
        } else {
          setViewState("cancelled");
          fireHaptic("warning");
          announceForAccessibility(
            "Onboarding cancelled. Your progress is saved.",
          );
        }
      } else {
        applyOnboardingOutcome("session-expired");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof BrandStripeCountryLockedError) {
        setViewState("failed-stripe");
        setErrorMessage(err.message);
        fireHaptic("warning");
        announceForAccessibility(err.message);
        return;
      }
      // Discriminate network vs Stripe errors
      if (
        message.toLowerCase().includes("stripe_api_error") ||
        message.toLowerCase().includes("stripe")
      ) {
        setViewState("failed-stripe");
        setErrorMessage(message);
      } else {
        setViewState("failed-network");
        setErrorMessage(message);
      }
      fireHaptic("error");
      announceForAccessibility("Onboarding failed. Tap try again.");
    } finally {
      startInProgressRef.current = false;
    }
  }, [
    applyOnboardingOutcome,
    brand,
    onboardMutation,
    queryClient,
    selectedCountry,
    statusQuery,
  ]);

  const handleTryAgain = useCallback((): void => {
    setViewState("idle");
    setErrorMessage(null);
    announceForAccessibility("Ready to retry onboarding.");
  }, []);

  useEffect(() => {
    if (viewState !== "complete-verifying") return;
    if (statusQuery.data?.status !== "active") return;
    applyOnboardingOutcome("complete-active");
  }, [applyOnboardingOutcome, statusQuery.data?.status, viewState]);

  const handleDone = useCallback((): void => {
    onAfterDone();
  }, [onAfterDone]);

  const handleSupport = useCallback((): void => {
    void Linking.openURL(SUPPORT_MAILTO);
  }, []);

  // ----- Not-found state (brand=null) -----------------------------------

  if (brand === null) {
    return (
      <View style={styles.host}>
        <View style={[styles.topBarRow, { paddingTop: spacing.sm }]}>
          <View style={styles.topBarSlot}>
            <Button
              label="Cancel"
              onPress={onCancel}
              variant="ghost"
              size="sm"
              accessibilityLabel="Cancel onboarding"
            />
          </View>
          <Text style={styles.topBarTitle}>Set up payments</Text>
          <View style={styles.topBarSlot} />
        </View>
        <View style={styles.notFoundWrap}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle}>Brand not found</Text>
            <Text style={styles.notFoundBody}>
              The brand you tried to onboard doesn{"’"}t exist or has been
              removed.
            </Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label="Back"
                onPress={onCancel}
                variant="secondary"
                size="md"
                leadingIcon="arrowL"
                accessibilityLabel="Back to account"
              />
            </View>
          </GlassCard>
        </View>
      </View>
    );
  }

  // ----- Render helpers -------------------------------------------------

  const renderTopBar = (): React.ReactElement => (
    <View style={[styles.topBarRow, { paddingTop: spacing.sm }]}>
      <View style={styles.topBarSlot}>
        <Button
          label="Cancel"
          onPress={onCancel}
          variant="ghost"
          size="sm"
          accessibilityLabel="Cancel onboarding"
        />
      </View>
      <Text style={styles.topBarTitle}>Set up payments</Text>
      <View style={styles.topBarSlot} />
    </View>
  );

  // ----- Populated states -----------------------------------------------

  return (
    <View style={styles.host}>
      {renderTopBar()}

      <View
        style={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.lg) },
        ]}
      >
        {viewState === "permission-denied" ? (
          <View style={styles.stateBlock}>
            <View style={[styles.stateIconCircle, styles.stateIconCircleFailed]}>
              <Icon name="flag" size={32} color={semantic.error} />
            </View>
            <Text style={styles.stateTitle}>You don{"’"}t have permission</Text>
            <Text style={styles.stateSub}>
              Only Brand Admin or Finance Manager rank can set up payments. Ask
              your account owner to invite you with a higher role.
            </Text>
          </View>
        ) : null}

        {viewState === "already-active" ? (
          <>
            <View style={styles.stateBlock}>
              <View
                style={[styles.stateIconCircle, styles.stateIconCircleSuccess]}
              >
                <Icon name="check" size={32} color={accent.warm} />
              </View>
              <Text style={styles.stateTitle}>You{"’"}re all set</Text>
              <Text style={styles.stateSub}>
                Your Stripe account is active. You can publish events and
                accept payments.
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Done"
                onPress={handleDone}
                variant="primary"
                size="lg"
                fullWidth
                accessibilityLabel="Done"
              />
            </View>
          </>
        ) : null}

        {viewState === "checking-status" || viewState === "settling-status" ? (
          <View style={styles.stateBlock}>
            <Spinner size={48} color={accent.warm} />
            <Text style={styles.stateTitle}>Checking Stripe status...</Text>
            <Text style={styles.stateSub}>
              We{"’"}re confirming your account with Stripe before marking
              payments ready.
            </Text>
          </View>
        ) : null}

        {/* V3 ToS gate — renders an over-everything sheet when not accepted.
            When accepted (or on mount if previously accepted), fires
            handleTosPassed and the sheet stays hidden. The "Set up payments"
            CTA below is gated on `tosPassed`. */}
        {viewState === "idle" && brand !== null && user !== null ? (
          <MinglaToSAcceptanceGate
            brandId={brand.id}
            userId={user.id}
            onPassed={handleTosPassed}
          />
        ) : null}

        {viewState === "idle" ? (
          <>
            <View style={styles.stateBlock}>
              <Text style={styles.stateTitle}>
                Connect Stripe to start selling tickets
              </Text>
              <Text style={styles.stateSub}>
                Set up payments to publish events and receive money from ticket
                sales.{"\n\n"}
                <Text style={styles.bold}>
                  Your bank details go directly to Stripe — Mingla never sees
                  them.
                </Text>
                {"\n\n"}Takes about 5 minutes.
              </Text>

              <View style={styles.prereqCard}>
                <BrandStripeCountryPicker
                  value={selectedCountry}
                  onChange={handleCountryChange}
                  disabled={countryPickerLocked}
                  helperText={countryPickerHelper}
                  warningText={countryPickerWarning}
                />
              </View>

              <GlassCard variant="base" padding={spacing.md} style={styles.prereqCard}>
                <Text style={styles.prereqHeader}>BEFORE YOU START, HAVE READY</Text>
                <Text style={styles.prereqItem}>{"•"} Business name and tax ID</Text>
                <Text style={styles.prereqItem}>
                  {"•"} Bank account for your country
                </Text>
                <Text style={styles.prereqItem}>
                  {"•"} Photo of government ID
                </Text>
              </GlassCard>
            </View>

            <View style={styles.actionsCol}>
              <Button
                label="Set up payments"
                onPress={handleStart}
                variant="primary"
                size="lg"
                fullWidth
                disabled={!tosPassed}
                accessibilityLabel={
                  tosPassed
                    ? "Start Stripe Connect onboarding"
                    : "Accept Mingla terms first to start Stripe onboarding"
                }
              />
            </View>

            <View style={styles.poweredByRow}>
              <Text style={styles.poweredByText}>
                Powered by Stripe. Your data is encrypted.
              </Text>
            </View>
          </>
        ) : null}

        {viewState === "starting" ? (
          <View style={styles.stateBlock}>
            <Spinner size={48} color={accent.warm} />
            <Text style={styles.stateTitle}>Creating your Stripe account…</Text>
          </View>
        ) : null}

        {viewState === "in-flight" ? (
          <>
            <View style={styles.stateBlock}>
              <Spinner size={48} color={accent.warm} />
              <Text style={styles.stateTitle}>
                Complete onboarding in the browser
              </Text>
              <Text style={styles.stateSub}>
                We{"’"}ll know automatically when you{"’"}re done. If the
                browser closed by accident, tap{" "}
                <Text style={styles.bold}>Continue setup</Text>.
              </Text>
            </View>

            <View style={styles.actionsCol}>
              <Button
                label="Continue setup"
                onPress={handleStart}
                variant="primary"
                size="lg"
                fullWidth
                accessibilityLabel="Continue Stripe onboarding"
              />
              <Pressable
                onPress={handleSupport}
                accessibilityLabel="Email Mingla support"
                accessibilityRole="link"
              >
                <Text style={styles.supportLink}>
                  Need help? Email {SUPPORT_EMAIL}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {viewState === "complete-active" ? (
          <>
            <View style={styles.stateBlock}>
              <View
                style={[styles.stateIconCircle, styles.stateIconCircleSuccess]}
              >
                <Icon name="check" size={32} color={accent.warm} />
              </View>
              <Text style={styles.stateTitle}>{"✓"} Set up complete</Text>
              <Text style={styles.stateSub}>
                You can publish events and accept payments now.
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Done"
                onPress={handleDone}
                variant="primary"
                size="lg"
                fullWidth
                accessibilityLabel="Done"
              />
            </View>
          </>
        ) : null}

        {viewState === "complete-verifying" ? (
          <>
            <View style={styles.stateBlock}>
              <View
                style={[styles.stateIconCircle, styles.stateIconCircleSuccess]}
              >
                <Icon name="check" size={32} color={accent.warm} />
              </View>
              <Text style={styles.stateTitle}>{"✓"} Submitted to Stripe</Text>
              <Text style={styles.stateSub}>
                Stripe is verifying your details. We{"’"}ll email you the
                moment it{"’"}s done — usually within minutes.
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Done"
                onPress={handleDone}
                variant="primary"
                size="lg"
                fullWidth
                accessibilityLabel="Done"
              />
            </View>
          </>
        ) : null}

        {viewState === "needs-information" ? (
          <>
            <View style={styles.stateBlock}>
              <View style={[styles.stateIconCircle, styles.stateIconCircleNeedsInfo]}>
                <Icon name="flag" size={32} color={semantic.error} />
              </View>
              <Text style={styles.stateTitle}>More information needed</Text>
              <Text style={styles.stateSub}>
                {errorMessage ??
                  "Stripe needs a few more details before payments can be enabled."}
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Continue verification"
                onPress={handleStart}
                variant="primary"
                size="lg"
                fullWidth
                disabled={onboardMutation.isPending}
                accessibilityLabel="Continue Stripe verification"
              />
              <Button
                label="Back to payments"
                onPress={handleDone}
                variant="secondary"
                size="md"
                fullWidth
                accessibilityLabel="Back to payments"
              />
            </View>
          </>
        ) : null}

        {viewState === "cancelled" ? (
          <>
            <View style={styles.stateBlock}>
              <View style={[styles.stateIconCircle, styles.stateIconCircleFailed]}>
                <Icon name="flag" size={32} color={semantic.error} />
              </View>
              <Text style={styles.stateTitle}>Onboarding cancelled</Text>
              <Text style={styles.stateSub}>
                You can try again any time. Your account is saved — we{"’"}ll
                pick up where you left off.
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Continue setup"
                onPress={handleTryAgain}
                variant="primary"
                size="lg"
                fullWidth
                accessibilityLabel="Continue setup"
              />
              <Button
                label="Cancel"
                onPress={onCancel}
                variant="secondary"
                size="md"
                fullWidth
                accessibilityLabel="Cancel onboarding"
              />
            </View>
          </>
        ) : null}

        {viewState === "session-expired" ? (
          <>
            <View style={styles.stateBlock}>
              <View style={[styles.stateIconCircle, styles.stateIconCircleFailed]}>
                <Icon name="flag" size={32} color={semantic.error} />
              </View>
              <Text style={styles.stateTitle}>Onboarding link expired</Text>
              <Text style={styles.stateSub}>
                The Stripe onboarding link expired. Tap try again — your
                progress is saved.
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Try again"
                onPress={handleTryAgain}
                variant="primary"
                size="lg"
                fullWidth
                accessibilityLabel="Retry onboarding"
              />
              <Button
                label="Cancel"
                onPress={onCancel}
                variant="secondary"
                size="md"
                fullWidth
                accessibilityLabel="Cancel onboarding"
              />
            </View>
          </>
        ) : null}

        {viewState === "failed-network" ? (
          <>
            <View style={styles.stateBlock}>
              <View style={[styles.stateIconCircle, styles.stateIconCircleFailed]}>
                <Icon name="flag" size={32} color={semantic.error} />
              </View>
              <Text style={styles.stateTitle}>Couldn{"’"}t reach Stripe</Text>
              <Text style={styles.stateSub}>
                Check your connection and try again. If the problem continues,
                contact support.
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Try again"
                onPress={handleTryAgain}
                variant="primary"
                size="lg"
                fullWidth
                accessibilityLabel="Retry onboarding"
              />
              <Pressable
                onPress={handleSupport}
                accessibilityLabel="Email Mingla support"
                accessibilityRole="link"
              >
                <Text style={styles.supportLink}>
                  Email {SUPPORT_EMAIL}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {viewState === "failed-stripe" ? (
          <>
            <View style={styles.stateBlock}>
              <View style={[styles.stateIconCircle, styles.stateIconCircleFailed]}>
                <Icon name="flag" size={32} color={semantic.error} />
              </View>
              <Text style={styles.stateTitle}>
                {isCountryLockedError
                  ? "Stripe is already connected"
                  : "Stripe couldn't verify"}
              </Text>
              <Text style={styles.stateSub}>
                {isCountryLockedError
                  ? errorMessage
                  : `${errorMessage ?? "Stripe needs additional information."} Try again or contact support.`}
              </Text>
            </View>
            <View style={styles.actionsCol}>
              {isCountryLockedError ? null : (
                <Button
                  label="Try again"
                  onPress={handleTryAgain}
                  variant="primary"
                  size="lg"
                  fullWidth
                  accessibilityLabel="Retry onboarding"
                />
              )}
              {isCountryLockedError ? (
                <Button
                  label="Back to payments"
                  onPress={handleDone}
                  variant="primary"
                  size="lg"
                  fullWidth
                  accessibilityLabel="Back to payments"
                />
              ) : null}
              <Pressable
                onPress={handleSupport}
                accessibilityLabel="Email Mingla support"
                accessibilityRole="link"
              >
                <Text style={styles.supportLink}>
                  Email {SUPPORT_EMAIL}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },

  // Custom TopBar --------------------------------------------------------
  topBarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    minHeight: 56,
  },
  topBarSlot: {
    flexShrink: 0,
    minWidth: 80,
  },
  topBarTitle: {
    flex: 1,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },

  // Body -----------------------------------------------------------------
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    gap: spacing.xl,
  },
  stateBlock: {
    alignItems: "center",
    gap: spacing.md,
  },
  stateIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  stateIconCircleSuccess: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  stateIconCircleNeedsInfo: {
    backgroundColor: semantic.errorTint,
    borderColor: "rgba(239, 68, 68, 0.45)",
  },
  stateIconCircleFailed: {
    backgroundColor: semantic.errorTint,
    borderColor: "rgba(239, 68, 68, 0.45)",
  },
  stateTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    textAlign: "center",
  },
  stateSub: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  bold: {
    fontWeight: "600",
    color: textTokens.primary,
  },
  actionsCol: {
    gap: spacing.sm,
  },
  supportLink: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
    paddingTop: spacing.sm,
    textDecorationLine: "underline",
  },
  prereqCard: {
    marginTop: spacing.md,
    width: "100%",
  },
  prereqHeader: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  prereqItem: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    paddingVertical: 2,
  },
  poweredByRow: {
    alignItems: "center",
    paddingTop: spacing.lg,
  },
  poweredByText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
  },

  // Not-found ------------------------------------------------------------
  notFoundWrap: {
    flex: 1,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
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
});

export default BrandOnboardView;
