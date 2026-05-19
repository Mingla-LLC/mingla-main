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

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { KeyboardEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
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
import { useNativeCheckoutFlow } from "../../../src/payments/nativeCheckoutFlow";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Toast } from "../../../src/components/ui/Toast";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import {
  readCheckoutResumePayload,
  writeCheckoutResumePayload,
} from "../../../src/components/checkout/checkoutPersistence";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";

export default function CheckoutTripPaymentScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tripEventId: string }>();
  const tripEventId =
    typeof params.tripEventId === "string" ? params.tripEventId : null;

  const publicTripQuery = usePublicTripById(tripEventId);
  const trip = publicTripQuery.data?.trip ?? null;
  const { lines, buyer, setLineQuantity, setBuyer } = useCart();
  const totals = useCartTotals();

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

  const nativeCheckout = useNativeCheckoutFlow();

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
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
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
        const message =
          error instanceof Error
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
            setTimeout(() => reject(new Error("client_confirm_timeout")), 3000),
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
          reason:
            confirmErr instanceof Error ? confirmErr.message : "unknown",
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
      const message =
        error instanceof Error
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
    nativeCheckout,
    processing,
    router,
  ]);

  // Defensive shell while guards redirect.
  if (
    trip === null ||
    lines.length === 0 ||
    totals.isFree ||
    buyer.name.trim().length < 2
  ) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={2}
          totalSteps={3}
          title="Payment"
          onBack={handleBack}
        />
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={2}
        totalSteps={3}
        title="Payment"
        onBack={handleBack}
      />
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 140 },
          keyboardHeight > 0
            ? { paddingBottom: keyboardHeight + 140 }
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
              <Text style={styles.summaryQty}>{l.quantity}×</Text>
              <Text style={styles.summaryName} numberOfLines={1}>
                {l.ticketName}
              </Text>
              <Text style={styles.summaryTotal}>
                {l.isFree ? "Free" : formatCurrency(l.unitPrice * l.quantity, l.currency)}
              </Text>
            </View>
          ))}
          <View style={styles.summaryDivider} />
          <View style={styles.summaryTotalRow}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotalValue}>
              {formatCurrency(totals.total, totals.currency)}
            </Text>
          </View>
        </GlassCard>

        <GlassCard variant="base" radius="lg" padding={spacing.md}>
          <Text style={styles.summaryLabel}>PAYMENT</Text>
          <Text style={styles.paymentCopy}>
            You'll be redirected to Stripe to complete your purchase securely. Apple Pay and Google Pay are supported.
          </Text>
          {checkoutSessionId !== null ? (
            <Text style={styles.paymentMeta}>Session {checkoutSessionId.slice(0, 8)}</Text>
          ) : null}
        </GlassCard>

        {paymentError !== null ? (
          <Text style={styles.errorText}>{paymentError}</Text>
        ) : null}
      </ScrollView>

      {/* Sticky bottom bar */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
          keyboardHeight > 0 ? styles.bottomBarHidden : null,
        ]}
      >
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {formatCurrency(totals.total, totals.currency)}
          </Text>
        </View>
        <Button
          label={`Pay ${formatCurrency(totals.total, totals.currency)}`}
          onPress={handlePay}
          variant="primary"
          size="lg"
          fullWidth
          loading={processing}
          disabled={processing}
          accessibilityLabel={`Pay ${formatCurrency(totals.total, totals.currency)} with card`}
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
  errorText: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: "#ef4444",
    fontWeight: "500",
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
