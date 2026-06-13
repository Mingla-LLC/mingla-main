/**
 * Trip payment screen. ORCH-0876 [Trip CRUD + Purchase Flow Completion] —
 * mirror of `app/checkout/[eventId]/payment.tsx` for trips.
 *
 * Route: /checkout-trip/{tripEventId}/payment
 *
 * Inherits ORCH-0839-B (web hosted Stripe Checkout via window.location.assign)
 * + ORCH-0849 (native iOS/Android PaymentSheet via useNativeCheckoutFlow) +
 * ORCH-0852 (fire-and-forget confirm with 3s client-side timeout + webhook
 * backup) from event-side payment.tsx, verbatim. NO native Stripe SDK import
 * here — CI gate at
 * .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs
 * forbids re-introduction.
 *
 * Trip-specific swaps from event-side: `usePublicEventById → usePublicTripById`;
 * route literals to `/checkout-trip/`; `eventPublicPath → tripPublicPath`;
 * `event → trip` variable name. The Stripe RPC chain
 * (`biz_ticket_checkout_create_session` + `biz_ticket_checkout_finalize`) is
 * event_type-agnostic — Tr3 [ORCH-0869] branches on `v_event.event_type='trip'`
 * server-side for installment-aware behaviour.
 *
 * Per SPEC_ORCH-0876_V2_FULL_PARITY §8.4 + SC-3.6.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header mirror of /checkout/[eventId]/payment.tsx; insets.bottom IS applied (bottom dock) for home-indicator clearance; the top status-bar overlap with back arrow / payment-step header / "3 OF 3" pill is the intended banner-style buyer aesthetic.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { KeyboardEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  accent,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { usePublicTripById } from "../../../src/hooks/usePublicTripById";
import { formatCurrency } from "../../../src/utils/currency";
import { isRequiredPhoneValid } from "../../../src/utils/phone";
import { tripPublicPath } from "../../../src/constants/publicUrls";
import {
  confirmTicketCheckout,
  createTicketCheckout,
} from "../../../src/services/ticketCheckoutService";
import { mixpanelService } from "../../../src/services/mixpanelService";
import type { NativeCheckoutExecutor } from "../../../src/payments/NativeCheckoutPaymentBoundary";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Toast } from "../../../src/components/ui/Toast";
import { TripPaymentChoice } from "../../../src/components/trip/TripPaymentChoice";
import { projectInstallmentSchedule } from "../../../src/utils/installmentScheduleProjection";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import {
  readCheckoutResumePayload,
  writeCheckoutResumePayload,
} from "../../../src/components/checkout/checkoutPersistence";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import { supabase } from "../../../src/services/supabase";

const NativeCheckoutPaymentBoundary = React.lazy(
  () => import("../../../src/payments/NativeCheckoutPaymentBoundary"),
);

export default function CheckoutTripPaymentScreen(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <NativeCheckoutPaymentBoundary>
        {(nativeCheckout) => (
          <CheckoutTripPaymentScreenContent nativeCheckout={nativeCheckout} />
        )}
      </NativeCheckoutPaymentBoundary>
    </Suspense>
  );
}

interface CheckoutTripPaymentScreenContentProps {
  nativeCheckout: NativeCheckoutExecutor;
}

function CheckoutTripPaymentScreenContent({
  nativeCheckout,
}: CheckoutTripPaymentScreenContentProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tripEventId: string }>();
  const tripEventId = typeof params.tripEventId === "string"
    ? params.tripEventId
    : null;

  const publicTripQuery = usePublicTripById(tripEventId);
  const trip = publicTripQuery.data?.trip ?? null;
  const {
    lines,
    buyer,
    intakeFormData,
    setLineQuantity,
    setBuyer,
    // ORCH-1130 — the pay-full vs pay-over-time choice, pre-filled from the
    // public-page selection (seeded by the checkout index route param). The
    // Review & pay step is the last-chance editor.
    paymentPlanChoice,
    setPaymentPlanChoice,
  } = useCart();
  const totals = useCartTotals();

  // ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer + Planner
  // Surfaces] — FIRST plan-active tier aggregate per SPEC Q3. Renders
  // null when no cart line has a plan. Drives both the in-scroll
  // schedule card AND the pre-Stripe banner + Pay-button copy change.
  const projectedSchedule = React.useMemo(() => {
    if (trip === null) return null;
    for (const line of lines) {
      const sourceTier = trip.pricingTiers.find(
        (t) => t.ticketTypeId === line.ticketTypeId,
      );
      if (
        sourceTier !== undefined &&
        sourceTier.installmentSchedule !== null &&
        line.quantity >= 1
      ) {
        // ORCH-0882 hotfix-2 — pass line.quantity so disclosure +
        // banner + Pay-button all scale with cart (€500/tier × qty=2
        // → €250 deposit, not €125).
        return projectInstallmentSchedule(
          sourceTier,
          new Date(),
          line.quantity,
        );
      }
    }
    return null;
  }, [trip, lines]);
  const isPlanActive = projectedSchedule !== null;
  const isUsingInstallments = isPlanActive && paymentPlanChoice === "installments";

  // ORCH-1130 — the source tier behind the plan-active cart line (for the
  // selector module's depositPct). Single-tier (prod-universal); first
  // plan-active line wins, mirroring the projectedSchedule selection above.
  const planTier = React.useMemo(() => {
    if (trip === null) return undefined;
    for (const line of lines) {
      const sourceTier = trip.pricingTiers.find(
        (t) => t.ticketTypeId === line.ticketTypeId,
      );
      if (
        sourceTier !== undefined &&
        sourceTier.installmentSchedule !== null &&
        line.quantity >= 1
      ) {
        return sourceTier;
      }
    }
    return undefined;
  }, [trip, lines]);

  // ORCH-0880 [Tr5 Traveler Intake Forms] — flatten per-tier intake answers
  // (keyed by ticket_type_id in CartContext) into the array shape expected
  // by ticket-checkout-create. Empty when buyer is purchasing tiers without
  // schemas OR when the intake step hasn't run yet.
  const intakeFormDataArray: unknown[] = React.useMemo(() => {
    const out: unknown[] = [];
    for (const ticketTypeId of Object.keys(intakeFormData)) {
      const entry = intakeFormData[ticketTypeId];
      if (entry !== undefined && entry !== null) out.push(entry);
    }
    return out;
  }, [intakeFormData]);

  // Web Stripe-cancel-return sessionStorage restore (mirror ORCH-0789/0790).
  const [restoreChecked, setRestoreChecked] = useState<boolean>(
    Platform.OS !== "web",
  );

  const [processing, setProcessing] = useState<boolean>(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(
    null,
  );
  const [declineToast, setDeclineToast] = useState<boolean>(false);
  const [successToast, setSuccessToast] = useState<boolean>(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // ORCH-1130 Fix #2 — the vestigial CartTaxPreview billing-address form +
  // "Calculate tax" Pay-gate are REMOVED (MINGLA-WIDE all-in / WYSIWYP: the
  // buyer never types an address; tax is venue-sourced server-side). Instead
  // we silently fetch the server-computed all-in total (incl. tax) via a
  // NO-ADDRESS mode:"preview" create on mount, purely to DISPLAY the all-in
  // upfront and to forward the tax calculationId into the charge. Pay is
  // NEVER blocked on this — if the preview hasn't resolved, the base Total
  // shows and the no-address create still charges the server-computed all-in.
  const [allInPreviewCents, setAllInPreviewCents] = useState<number | null>(
    null,
  );
  const [previewCalculationId, setPreviewCalculationId] = useState<
    string | null
  >(null);

  // ----- Web sessionStorage restore -----
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (tripEventId === null) return;
    if (restoreChecked) return;
    const storage = (globalThis as unknown as { sessionStorage?: Storage })
      .sessionStorage;
    const payload = readCheckoutResumePayload(storage, tripEventId);
    if (payload !== null && lines.length === 0) {
      for (const l of payload.lines) {
        setLineQuantity({
          ticketTypeId: l.ticketTypeId,
          ticketName: l.ticketName,
          unitPrice: l.unitPrice,
          unitPriceGbp: l.unitPriceGbp,
          currency: l.currency,
          isFree: l.isFree,
          quantity: l.quantity,
        });
      }
      setBuyer(payload.buyer);
    }
    setRestoreChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripEventId]);

  // ----- Defensive guards -----
  useEffect(() => {
    if (tripEventId === null) return;
    if (!restoreChecked) return;
    if (lines.length === 0) {
      router.replace(`/checkout-trip/${tripEventId}` as never);
      return;
    }
    if (totals.isFree) {
      router.replace(`/checkout-trip/${tripEventId}/buyer` as never);
      return;
    }
    if (
      buyer.name.trim().length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email.trim()) ||
      !isRequiredPhoneValid(buyer.phone)
    ) {
      router.replace(`/checkout-trip/${tripEventId}/buyer` as never);
      return;
    }
  }, [
    tripEventId,
    lines.length,
    totals.isFree,
    buyer.name,
    buyer.email,
    buyer.phone,
    restoreChecked,
    router,
  ]);

  // ----- Keyboard pattern -----
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const scrollViewRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    const showEvent = Platform.OS === "ios"
      ? "keyboardWillShow"
      : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios"
      ? "keyboardWillHide"
      : "keyboardDidHide";
    const showSub = Keyboard.addListener(
      showEvent,
      (e: KeyboardEvent): void => {
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(hideEvent, (): void => {
      setKeyboardHeight(0);
    });
    return (): void => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ----- ORCH-1130 Fix #2: silent no-address all-in preview (native) -----
  // Fetches the server-computed venue-sourced all-in (incl. tax) so the
  // order-summary box shows the all-in upfront (WYSIWYP) without a buyer
  // address form. Web shows the all-in on Stripe's hosted page, so it skips
  // this. Non-blocking: any failure leaves the base Total + a no-address
  // create (which still charges the all-in). Re-runs when the cart changes.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (tripEventId === null) return;
    if (lines.length === 0) return;
    if (buyer.name.trim().length < 2 || buyer.email.trim().length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.functions.invoke<{
        calculationId: string | null;
        totalCents: number;
      }>("ticket-checkout-create", {
        body: {
          eventId: tripEventId,
          surface: "native",
          mode: "preview",
          buyer: {
            name: buyer.name,
            email: buyer.email,
            phone: buyer.phone,
            marketingOptIn: buyer.marketingOptIn === true,
          },
          lines: lines.map((l) => ({
            ticketTypeId: l.ticketTypeId,
            quantity: l.quantity,
          })),
        },
      });
      if (cancelled) return;
      if (error || !data) {
        // Non-fatal — Pay is not gated on the preview; the base Total shows
        // and the no-address create still charges the server-computed all-in.
        setAllInPreviewCents(null);
        setPreviewCalculationId(null);
        return;
      }
      setAllInPreviewCents(data.totalCents);
      setPreviewCalculationId(data.calculationId);
    })();
    return () => {
      cancelled = true;
    };
  }, [tripEventId, lines, buyer.name, buyer.email, buyer.phone, buyer.marketingOptIn]);

  // ----- Handlers -----
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (tripEventId !== null) {
      router.replace(`/checkout-trip/${tripEventId}/buyer` as never);
    }
  }, [router, tripEventId]);

  const handlePay = useCallback(async (): Promise<void> => {
    if (processing) return;
    if (tripEventId === null) return;
    // ORCH-1130 Fix #2 — no "Calculate tax" gate. Pay is available immediately
    // with the server-computed all-in (incl. tax, venue-sourced). The buyer
    // never types an address.

    if (Platform.OS === "web") {
      // ---------- WEB PATH ----------
      const surface: "web" = "web";
      try {
        setProcessing(true);
        setPaymentError(null);
        mixpanelService.track("ticket_checkout_pay_started", {
          surface,
          eventId: tripEventId,
          eventType: "trip",
        });
        // createTicketCheckout is event_type-agnostic — the RPC
        // biz_ticket_checkout_create_session branches on v_event.event_type='trip'.
        const checkout = await createTicketCheckout({
          eventId: tripEventId,
          buyer,
          lines,
          surface,
          // ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake answers
          // gathered by /checkout-trip/[tripEventId]/intake.tsx and stored
          // in CartContext. Edge fn gates HTTP 400 intake_form_required +
          // 409 intake_schema_stale; on stale, payment.tsx surfaces a Toast
          // + routes back to /intake (rare — schema rarely changes mid-pay).
          ...(intakeFormDataArray.length > 0
            ? { intakeFormData: intakeFormDataArray }
            : {}),
          ...(isPlanActive ? { paymentPlanChoice: paymentPlanChoice } : {}),
        });
        if (checkout.kind !== "requires_web_redirect") {
          throw new Error("Hosted checkout did not return a redirect URL.");
        }
        setCheckoutSessionId(checkout.checkoutSessionId);

        const storage = (globalThis as unknown as { sessionStorage?: Storage })
          .sessionStorage;
        writeCheckoutResumePayload(storage, tripEventId, {
          checkoutSessionId: checkout.checkoutSessionId,
          buyerStatusToken: checkout.buyerStatusToken,
          lines,
          buyer,
        });
        const w = globalThis as unknown as {
          location?: { assign?: (u: string) => void };
        };
        if (w.location?.assign) {
          w.location.assign(checkout.hostedCheckoutUrl);
          return;
        }
        setProcessing(false);
        setPaymentError(
          "Couldn't redirect to Stripe. Please try again from a standard browser.",
        );
      } catch (error) {
        setProcessing(false);
        const message = error instanceof Error
          ? error.message
          : "Payment could not be completed. Please try again.";
        setPaymentError(message);
        mixpanelService.track("ticket_checkout_failed", {
          surface,
          eventId: tripEventId,
          eventType: "trip",
          reason: "thrown_error",
          message,
        });
      }
      return;
    }

    // ---------- NATIVE PATH ----------
    // ORCH-1130 Fix #2 — no buyer address; tax is venue-sourced server-side.
    // Forward the silently-fetched no-address preview calculationId when
    // available (lets the charge reuse the previewed Stripe Tax calculation);
    // otherwise the no-address create recomputes the same venue-sourced all-in.
    const surface: "native" = "native";

    try {
      setProcessing(true);
      setPaymentError(null);
      mixpanelService.track("ticket_checkout_pay_started", {
        surface,
        eventId: tripEventId,
        eventType: "trip",
      });

      const outcome = await nativeCheckout({
        eventId: tripEventId,
        lines,
        buyer: {
          name: buyer.name,
          email: buyer.email,
          phone: buyer.phone,
          marketingOptIn: buyer.marketingOptIn === true,
        },
        ...(previewCalculationId
          ? { taxCalculationId: previewCalculationId }
          : {}),
        ...(isPlanActive ? { paymentPlanChoice: paymentPlanChoice } : {}),
      });

      mixpanelService.track("ticket_checkout_sheet_opened", {
        surface,
        eventId: tripEventId,
        eventType: "trip",
        outcome: outcome.outcome,
      });

      if (outcome.outcome === "canceled") {
        mixpanelService.track("ticket_checkout_cancelled", {
          surface,
          eventId: tripEventId,
          eventType: "trip",
        });
        setProcessing(false);
        return;
      }

      if (outcome.outcome === "failed") {
        mixpanelService.track("ticket_checkout_failed", {
          surface,
          eventId: tripEventId,
          eventType: "trip",
          reason: "native_checkout_failed",
          message: outcome.message,
        });
        setProcessing(false);
        setPaymentError(outcome.message);
        return;
      }

      // ORCH-0852 fire-and-forget pattern (mirror).
      const sessionId = outcome.orderId;
      setCheckoutSessionId(sessionId);
      try {
        await Promise.race([
          confirmTicketCheckout(sessionId, ""),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("client_confirm_timeout")), 3000)
          ),
        ]);
      } catch (confirmErr) {
        console.warn(
          "[checkout-trip-payment] synchronous confirm failed or timed out; relying on webhook backup",
          confirmErr,
        );
        mixpanelService.track("ticket_checkout_sync_confirm_failed", {
          surface,
          eventId: tripEventId,
          eventType: "trip",
          checkoutSessionId: sessionId,
          reason: confirmErr instanceof Error ? confirmErr.message : "unknown",
        });
      }

      mixpanelService.track("ticket_checkout_succeeded", {
        surface,
        eventId: tripEventId,
        eventType: "trip",
        checkoutSessionId: sessionId,
      });

      setSuccessToast(true);

      // Brief delay so the buyer sees the toast before unmount.
      setTimeout(() => {
        if (trip !== null && trip.brandSlug !== null) {
          router.replace(
            tripPublicPath({
              brandSlug: trip.brandSlug,
              tripSlug: trip.slug,
            }) as never,
          );
        } else {
          router.replace("/(tabs)/home" as never);
        }
      }, 1200);
    } catch (error) {
      setProcessing(false);
      const message = error instanceof Error
        ? error.message
        : "Payment could not be completed. Please try again.";
      setPaymentError(message);
      mixpanelService.track("ticket_checkout_failed", {
        surface,
        eventId: tripEventId,
        eventType: "trip",
        reason: "thrown_error",
        message,
      });
    } finally {
      setProcessing(false);
    }
  }, [
    buyer,
    trip,
    tripEventId,
    lines,
    intakeFormDataArray,
    isPlanActive,
    nativeCheckout,
    paymentPlanChoice,
    previewCalculationId,
    processing,
    router,
  ]);

  // ORCH-1130 Fix #2 — display the server-computed all-in (incl. tax) when the
  // silent no-address preview has resolved (native); otherwise the base Total.
  // Web shows the all-in on Stripe's hosted page. The all-in is shown in MINOR
  // units (cents) when sourced from the preview, MAJOR units from totals.total.
  const displayTotalCents = totals.total;
  const displayAllIn = Platform.OS !== "web" && allInPreviewCents !== null
    ? formatCurrency(allInPreviewCents, totals.currency, true)
    : formatCurrency(displayTotalCents, totals.currency);

  // Defensive shell while guards redirect.
  if (
    tripEventId === null ||
    trip === null ||
    lines.length === 0 ||
    totals.isFree ||
    buyer.name.trim().length < 2
  ) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={1}
          totalSteps={2}
          title="Review & pay"
          onBack={handleBack}
        />
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={1}
        totalSteps={2}
        title="Review & pay"
        onBack={handleBack}
      />
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          // ORCH-0882 hotfix-2 — when the pre-Stripe plan banner is
          // active inside the sticky bottom bar, it adds ~120pt of
          // height (banner title + body + margin). Bumping the
          // ScrollView's bottom padding so the PAYMENT redirect card
          // at the bottom of scroll content isn't occluded behind the
          // taller bottom bar.
          { paddingBottom: insets.bottom + (isPlanActive ? 260 : 140) },
          keyboardHeight > 0
            ? { paddingBottom: keyboardHeight + (isPlanActive ? 260 : 140) }
            : null,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Order summary recap */}
        <GlassCard
          variant="base"
          radius="lg"
          padding={spacing.md}
          style={styles.summary}
        >
          <Text style={styles.summaryLabel}>ORDER SUMMARY</Text>
          {lines.map((l) => (
            <View key={l.ticketTypeId} style={styles.summaryLine}>
              {/* ORCH-1130 — compact qty stepper (replaces the removed tier
                  step's qty control). Schedule + totals recompute live (the
                  projection util takes quantity). 44×44 hit areas, no double-tap
                  past min 1 / disabled while processing. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Decrease ${l.ticketName} quantity`}
                accessibilityState={{ disabled: l.quantity <= 1 || processing }}
                disabled={l.quantity <= 1 || processing}
                onPress={() =>
                  setLineQuantity({
                    ticketTypeId: l.ticketTypeId,
                    ticketName: l.ticketName,
                    unitPrice: l.unitPrice,
                    unitPriceGbp: l.unitPriceGbp,
                    currency: l.currency,
                    isFree: l.isFree,
                    quantity: l.quantity - 1,
                  })
                }
                style={[
                  styles.qtyBtn,
                  (l.quantity <= 1 || processing) ? styles.qtyBtnDisabled : null,
                ]}
              >
                <Text style={styles.qtyBtnGlyph}>−</Text>
              </Pressable>
              <Text style={styles.summaryQty}>{l.quantity}×</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Increase ${l.ticketName} quantity`}
                accessibilityState={{ disabled: processing }}
                disabled={processing}
                onPress={() =>
                  setLineQuantity({
                    ticketTypeId: l.ticketTypeId,
                    ticketName: l.ticketName,
                    unitPrice: l.unitPrice,
                    unitPriceGbp: l.unitPriceGbp,
                    currency: l.currency,
                    isFree: l.isFree,
                    quantity: l.quantity + 1,
                  })
                }
                style={[
                  styles.qtyBtn,
                  processing ? styles.qtyBtnDisabled : null,
                ]}
              >
                <Text style={styles.qtyBtnGlyph}>+</Text>
              </Pressable>
              <Text style={styles.summaryName} numberOfLines={1}>
                {l.ticketName}
              </Text>
              <Text style={styles.summaryTotal}>
                {l.isFree
                  ? "Free"
                  : formatCurrency(l.unitPrice * l.quantity, l.currency)}
              </Text>
            </View>
          ))}
          <View style={styles.summaryDivider} />
          <View style={styles.summaryTotalRow}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotalValue}>
              {displayAllIn}
            </Text>
          </View>
          {/* ORCH-1130 Fix #1 — pay-over-time only: the full Total stays the
              headline; the amount charged TODAY (deposit) shows on its own
              labeled line. Read from projectedSchedule.depositCents (already
              in scope, never recomputed). Hidden for pay-in-full / no-plan. */}
          {isUsingInstallments && projectedSchedule !== null ? (
            <View style={styles.summaryDueTodayRow}>
              <Text style={styles.summaryDueTodayLabel}>Total due today</Text>
              <Text style={styles.summaryDueTodayValue}>
                {formatCurrency(
                  projectedSchedule.depositCents,
                  projectedSchedule.currency,
                  true,
                )}
              </Text>
            </View>
          ) : null}
        </GlassCard>

        {/* ORCH-1130 — the single shared selector module (segmented toggle +
            full-width supporting block). Pre-filled from the public-page choice
            (CartContext.paymentPlanChoice), editable here as the last-chance
            editor. Renders the schedule ladder under the over-time option, so
            the standalone passive projection card below is removed. Null-on-null
            for no-plan trips. */}
        {isPlanActive && projectedSchedule !== null && planTier !== undefined ? (
          <TripPaymentChoice
            schedule={projectedSchedule}
            fullPriceCents={projectedSchedule.fullPriceCents}
            currency={projectedSchedule.currency}
            depositPct={planTier.installmentSchedule?.deposit_pct ?? 0}
            value={paymentPlanChoice}
            onChange={setPaymentPlanChoice}
          />
        ) : null}

        {/* ORCH-1130 Fix #2 — the CartTaxPreview billing-address + "Calculate
            tax" form was REMOVED. Tax is venue-sourced server-side and the
            all-in (incl. tax) is shown above (WYSIWYP); the buyer types no
            address. */}

        <GlassCard variant="base" radius="lg" padding={spacing.md}>
          <Text style={styles.summaryLabel}>PAYMENT</Text>
          <Text style={styles.paymentCopy}>
            You'll be redirected to Stripe to complete your purchase securely.
            Apple Pay and Google Pay are supported.
          </Text>
          {checkoutSessionId !== null
            ? (
              <Text style={styles.paymentMeta}>
                Session {checkoutSessionId.slice(0, 8)}
              </Text>
            )
            : null}
        </GlassCard>

        {paymentError !== null
          ? <Text style={styles.errorText}>{paymentError}</Text>
          : null}
      </ScrollView>

      {/* Sticky bottom bar */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
          keyboardHeight > 0 ? styles.bottomBarHidden : null,
        ]}
      >
        {
          /* ORCH-0882 — pre-Stripe disclosure banner. Renders directly
            above the Pay button when cart has plan-active lines. Stripe's
            hosted checkout only displays the deposit amount, so this is
            the last in-product surface to set buyer expectations about
            the deposit + future-installment auto-charge schedule.
            Constitution #3 — no silent failures. */}
        {isPlanActive && projectedSchedule !== null && isUsingInstallments ? (
          <View
            style={styles.planBanner}
            accessibilityRole="alert"
            accessibilityLabel={`Payment plan active. You will be charged ${formatCurrency(projectedSchedule.depositCents, projectedSchedule.currency, true)} today. The remaining ${formatCurrency(projectedSchedule.fullPriceCents - projectedSchedule.depositCents, projectedSchedule.currency, true)} will auto-charge in ${projectedSchedule.installments.length} payments from the same card.`}
          >
            <Text style={styles.planBannerTitle}>Payment plan active</Text>
            <Text style={styles.planBannerBody}>
              You&rsquo;ll be charged{" "}
              <Text style={styles.planBannerStrong}>
                {formatCurrency(
                  projectedSchedule.depositCents,
                  projectedSchedule.currency,
                  true,
                )}
              </Text>{" "}
              today. The remaining{" "}
              <Text style={styles.planBannerStrong}>
                {formatCurrency(
                  projectedSchedule.fullPriceCents -
                    projectedSchedule.depositCents,
                  projectedSchedule.currency,
                  true,
                )}
              </Text>{" "}
              will auto-charge in {projectedSchedule.installments.length}{" "}
              payment
              {projectedSchedule.installments.length === 1 ? "" : "s"} on the
              dates above, from the card you enter next.
            </Text>
          </View>
        ) : null}
        {isPlanActive && projectedSchedule !== null && !isUsingInstallments ? (
          <View
            style={[styles.planBanner, styles.fullPayBanner]}
            accessibilityRole="alert"
            accessibilityLabel={`Paid in full today. You will be charged ${formatCurrency(totals.total, totals.currency)} today and no future installment bills will be scheduled.`}
          >
            <Text style={styles.planBannerTitle}>Paid in full today</Text>
            <Text style={styles.planBannerBody}>
              You&rsquo;ll be charged{" "}
              <Text style={styles.planBannerStrong}>
                {formatCurrency(totals.total, totals.currency)}
              </Text>{" "}
              today. No future installment bills will be scheduled for this
              booking.
            </Text>
          </View>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {displayAllIn}
          </Text>
        </View>
        {/* ORCH-1130 Fix #1 — due-today (deposit) line in the sticky bar under
            pay-over-time; mirrors the order-summary box + buyer step. */}
        {isUsingInstallments && projectedSchedule !== null ? (
          <View style={styles.dueTodayRow}>
            <Text style={styles.dueTodayLabel}>Total due today</Text>
            <Text style={styles.dueTodayValue}>
              {formatCurrency(
                projectedSchedule.depositCents,
                projectedSchedule.currency,
                true,
              )}
            </Text>
          </View>
        ) : null}
        <Button
          // ORCH-1130 ADDENDUM (Seth-BINDING) — the Pay CTA amount follows the
          // current pay-full vs pay-over-time selection on BOTH paths. When
          // pay-over-time is selected the button reads "Pay {deposit} deposit"
          // (the amount due today, read from the projected schedule, never
          // recomputed). When pay-in-full is selected it reads "Pay {full}".
          // Native previously hardcoded the tax-inclusive full total even under
          // the over-time selection, contradicting its own "charged {deposit}
          // today" banner — fixed here. (Stripe still charges only the deposit
          // first; the deposit is tax-exclusive at this preview stage, matching
          // the web path's deposit copy.)
          label={isUsingInstallments && projectedSchedule !== null
            ? `Pay ${
              formatCurrency(
                projectedSchedule.depositCents,
                projectedSchedule.currency,
                true,
              )
            } deposit`
            : Platform.OS !== "web"
            ? `Pay ${displayAllIn}`
            : `Pay ${formatCurrency(totals.total, totals.currency)}`}
          onPress={handlePay}
          variant="primary"
          size="lg"
          fullWidth
          loading={processing}
          // ORCH-1130 Fix #2 — no "Calculate tax" gate; Pay is enabled
          // immediately (only blocked while a charge is in flight).
          disabled={processing}
          accessibilityLabel={isUsingInstallments && projectedSchedule !== null
            ? `Pay ${
              formatCurrency(
                projectedSchedule.depositCents,
                projectedSchedule.currency,
                true,
              )
            } deposit with card`
            : Platform.OS !== "web"
            ? `Pay ${displayAllIn} with card`
            : `Pay ${formatCurrency(totals.total, totals.currency)} with card`}
        />
      </View>

      {/* Toast — absolute-positioned wrap per feedback_toast_needs_absolute_wrap.md */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={declineToast}
          kind="error"
          message="Card declined — try another payment method."
          onDismiss={() => setDeclineToast(false)}
        />
        <Toast
          visible={successToast}
          kind="success"
          message="Spot reserved! Check your tickets list."
          onDismiss={() => setSuccessToast(false)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0c0e12" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  summary: { marginBottom: spacing.lg },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    gap: spacing.sm,
  },
  summaryQty: {
    fontSize: 14,
    color: textTokens.tertiary,
    fontWeight: "500",
    minWidth: 28,
  },
  summaryName: {
    flex: 1,
    fontSize: 14,
    color: textTokens.primary,
    fontWeight: "500",
  },
  summaryTotal: {
    fontSize: 14,
    color: textTokens.primary,
    fontWeight: "600",
  },
  summaryDivider: {
    marginVertical: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  summaryTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  summaryTotalLabel: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  summaryTotalValue: {
    fontSize: 17,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  // ORCH-1130 Fix #1 — due-today (deposit) rows on the order-summary box +
  // sticky bar; accent.warm to read as the actionable "charged now" amount
  // while the full Total above stays the dominant headline.
  summaryDueTodayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 6,
  },
  summaryDueTodayLabel: {
    fontSize: 13,
    color: accent.warm,
    fontWeight: "600",
  },
  summaryDueTodayValue: {
    fontSize: 15,
    color: accent.warm,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  dueTodayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.sm,
  },
  dueTodayLabel: { fontSize: 13, color: accent.warm, fontWeight: "600" },
  dueTodayValue: {
    fontSize: 16,
    color: accent.warm,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  paymentCopy: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
  },
  paymentMeta: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: textTokens.quaternary,
  },
  // ORCH-1130 — compact qty stepper on the order-summary line. 44×44 hit areas.
  qtyBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  qtyBtnDisabled: {
    opacity: 0.4,
  },
  qtyBtnGlyph: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "700",
    color: textTokens.primary,
  },
  errorText: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: "#ef4444",
    fontWeight: "500",
  },
  // ORCH-0882 — pre-Stripe banner. Subtle accent.warm tint matching the
  // existing trip-buyer accent system. flexGrow:0 + flexShrink:0 to
  // honor `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`
  // since it sits inside the sticky bottom bar (a flex parent).
  planBanner: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: 12,
    backgroundColor: "rgba(235, 120, 37, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.45)",
  },
  fullPayBanner: {
    backgroundColor: "rgba(34, 197, 94, 0.08)",
    borderColor: "rgba(34, 197, 94, 0.45)",
  },
  planBannerTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#eb7825",
    letterSpacing: 0.6,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  planBannerBody: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.secondary,
    fontWeight: "400",
  },
  planBannerStrong: {
    color: textTokens.primary,
    fontWeight: "700",
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(12, 14, 18, 0.94)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  bottomBarHidden: { transform: [{ translateY: 200 }] },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.sm,
  },
  totalLabel: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  totalValue: {
    fontSize: 20,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
  },
});
