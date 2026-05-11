/**
 * J-C3 — Payment screen.
 *
 * Route: /checkout/{eventId}/payment
 *
 * Production Stripe PaymentSheet. Free orders never reach this screen.
 *
 * On payment success: wait for the server-backed checkout status, record the
 * issued tickets into cart Context, then router.replace to /confirm.
 *
 * Per Cycle 8 spec §4.6.
 */

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
import { usePublicEventById } from "../../../src/hooks/usePublicEvents";
import { formatCurrency } from "../../../src/utils/currency";
import { isRequiredPhoneValid } from "../../../src/utils/phone";
import {
  createTicketCheckout,
  pollTicketCheckoutStatus,
} from "../../../src/services/ticketCheckoutService";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Toast } from "../../../src/components/ui/Toast";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import {
  clearCheckoutResumePayload,
  readCheckoutResumePayload,
  writeCheckoutResumePayload,
} from "../../../src/components/checkout/checkoutPersistence";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import { useStripePaymentSheet } from "../../../src/payments/stripePaymentSheet";

export default function CheckoutPaymentScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;

  const publicEventQuery = usePublicEventById(eventId);
  const event = publicEventQuery.data?.event ?? null;
  const { lines, buyer, recordResult, setLineQuantity, setBuyer } = useCart();
  const totals = useCartTotals();

  // ORCH-0789/0790 REWORK: on web, the buyer may be returning from a
  // Stripe Checkout cancel. Cart context is in-memory and was wiped by
  // the full-page reload. Restore lines + buyer from sessionStorage
  // BEFORE the defensive bounce evaluates, so the buyer doesn't lose
  // their selections after a Stripe-side cancel.
  const [restoreChecked, setRestoreChecked] = useState<boolean>(
    Platform.OS !== "web",
  );
  const {
    initPaymentSheet,
    isPaymentSheetSupported,
    presentPaymentSheet,
  } = useStripePaymentSheet();

  const [processing, setProcessing] = useState<boolean>(false);
  const [finalizing, setFinalizing] = useState<boolean>(false);
  const [finalizingTimedOut, setFinalizingTimedOut] = useState<boolean>(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [declineToast, setDeclineToast] = useState<boolean>(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const finalizingRef = useRef<boolean>(false);

  // ----- ORCH-0789/0790 REWORK: web sessionStorage restore -----
  // Runs once on mount (web only). If cart context is empty but we have
  // a resume payload in sessionStorage for this eventId, restore lines
  // + buyer so the defensive bounce below sees the populated cart on
  // its next evaluation. Storage entry is NOT cleared here — only the
  // confirm screen clears on confirmed success (so a buyer who cancels
  // on Stripe can retry without rebuilding the cart).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (eventId === null) return;
    if (restoreChecked) return;
    const storage = (globalThis as unknown as { sessionStorage?: Storage })
      .sessionStorage;
    const payload = readCheckoutResumePayload(storage, eventId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount;
    // intentional that we don't re-restore if cart changes after.
  }, [eventId]);

  // ----- Defensive guards ------------------------------------------
  // Free orders never reach this screen (J-C2 skips to /confirm).
  // Cart empty → bounce to J-C1. Buyer details invalid → bounce to /buyer.
  // Gated on restoreChecked so the web Stripe-cancel-return path has a
  // chance to restore cart context before this bounces.
  useEffect(() => {
    if (eventId === null) return;
    if (!restoreChecked) return;
    if (lines.length === 0) {
      router.replace(`/checkout/${eventId}` as never);
      return;
    }
    if (totals.isFree) {
      router.replace(`/checkout/${eventId}/buyer` as never);
      return;
    }
    if (
      buyer.name.trim().length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email.trim()) ||
      !isRequiredPhoneValid(buyer.phone)
    ) {
      router.replace(`/checkout/${eventId}/buyer` as never);
      return;
    }
  }, [
    eventId,
    lines.length,
    totals.isFree,
    buyer.name,
    buyer.email,
    buyer.phone,
    restoreChecked,
    router,
  ]);

  // ----- Keyboard pattern (lifted from buyer.tsx / EventCreatorWizard) -----
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

  // ----- Handlers -------------------------------------------------
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (eventId !== null) {
      router.replace(`/checkout/${eventId}/buyer` as never);
    }
  }, [router, eventId]);

  const handlePay = useCallback(async (): Promise<void> => {
    if (processing) return;
    if (eventId === null) return;

    // ORCH-0790: web buyers go through Stripe Checkout Sessions (hosted page +
    // redirect). Native buyers use the existing Stripe RN PaymentSheet flow.
    if (Platform.OS === "web") {
      try {
        setProcessing(true);
        setPaymentError(null);
        const checkout = await createTicketCheckout({
          eventId,
          buyer,
          lines,
          surface: "web",
        });
        if (checkout.kind !== "requires_web_redirect") {
          throw new Error("Web checkout did not return a redirect URL.");
        }
        setCheckoutSessionId(checkout.checkoutSessionId);
        // Persist resume payload BEFORE the redirect — sessionStorage is
        // scoped to the tab and survives Stripe's success_url full-page
        // return. We persist lines + buyer too so a Stripe-side cancel
        // returns the buyer to a populated /payment screen (instead of
        // bouncing to /checkout/{eventId} with an empty cart) and a
        // Stripe-side success returns to /confirm with a complete
        // summary card and "Sent to {email}" line. Putting
        // buyerStatusToken in the URL would leak it to history /
        // referrers / analytics, so storage-only.
        const storage = (globalThis as unknown as { sessionStorage?: Storage })
          .sessionStorage;
        writeCheckoutResumePayload(storage, eventId, {
          checkoutSessionId: checkout.checkoutSessionId,
          buyerStatusToken: checkout.buyerStatusToken,
          lines,
          buyer,
        });
        const w = (globalThis as unknown as { location?: { assign?: (u: string) => void } });
        if (w.location?.assign) {
          w.location.assign(checkout.hostedCheckoutUrl);
        } else {
          // Sandbox / test environments where location.assign is unavailable.
          // Reset processing and surface an error so the buyer isn't stuck.
          setProcessing(false);
          setPaymentError(
            "Couldn't redirect to Stripe. Please try again from a standard browser.",
          );
        }
        return;
      } catch (error) {
        setProcessing(false);
        setPaymentError(
          error instanceof Error
            ? error.message
            : "We couldn't start checkout. Please try again.",
        );
        return;
      }
    }

    if (!isPaymentSheetSupported) {
      // Native build that somehow resolved the web stub — defensive only.
      setPaymentError(
        "Payment isn't available right now. Please try again from the latest app version.",
      );
      return;
    }

    try {
      setProcessing(true);
      setPaymentError(null);
      const checkout = await createTicketCheckout({ eventId, buyer, lines });
      if (checkout.kind !== "requires_payment") {
        throw new Error("Checkout did not return a payment session.");
      }
      setCheckoutSessionId(checkout.checkoutSessionId);
      const initResult = await initPaymentSheet({
        merchantDisplayName: "Mingla",
        paymentIntentClientSecret: checkout.clientSecret,
        allowsDelayedPaymentMethods: false,
      });
      if (initResult.error) {
        // initPaymentSheet failures are config / network issues, not user
        // intent. Surface as inline error (no decline toast).
        setProcessing(false);
        setPaymentError(initResult.error.message);
        return;
      }
      const payResult = await presentPaymentSheet();
      if (payResult.error) {
        // ORCH-0789: Stripe's PaymentSheet error.code distinguishes user-cancel
        // ("Canceled") from real failures ("Failed") from "Timeout". Treating
        // every error as a decline strands buyers who simply closed the sheet.
        switch (payResult.error.code) {
          case "Canceled":
            // Buyer closed the sheet — Stripe already gave visual feedback.
            // Silent return to the payment summary; no toast, no error text.
            setProcessing(false);
            return;
          case "Timeout":
            setProcessing(false);
            setPaymentError("Stripe took too long — please try again.");
            return;
          case "Failed":
          default:
            setDeclineToast(true);
            setProcessing(false);
            return;
        }
      }

      setFinalizing(true);
      finalizingRef.current = true;
      const status = await pollTicketCheckoutStatus(
        checkout.checkoutSessionId,
        checkout.buyerStatusToken,
      );
      if (!finalizingRef.current) return;
      if (status === null || status.order === null) {
        finalizingRef.current = false;
        setFinalizingTimedOut(true);
        setFinalizing(false);
        setProcessing(false);
        console.warn("[ticket-checkout] paid checkout finalization timed out", {
          checkoutSessionId: checkout.checkoutSessionId,
        });
        return;
      }
      recordResult({
        orderId: status.order.orderId,
        ticketIds: status.order.tickets.map((ticket) => ticket.ticketId),
        checkoutSessionId: status.checkoutSessionId,
        paidAt: new Date().toISOString(),
        paymentMethod: "card",
        total: status.order.totalCents / 100,
        totalCents: status.order.totalCents,
        currency: status.order.currency,
        paymentStatus: status.order.paymentStatus,
        notificationStatus: status.order.notificationStatus,
        tickets: status.order.tickets,
      });
      router.replace(`/checkout/${eventId}/confirm` as never);
    } catch (error) {
      if (finalizingRef.current) {
        finalizingRef.current = false;
        setFinalizingTimedOut(true);
        setFinalizing(false);
        setProcessing(false);
        return;
      }
      setPaymentError(
        error instanceof Error
          ? error.message
          : "Payment could not be completed. Please try again.",
      );
    } finally {
      if (!finalizingRef.current) {
        setProcessing(false);
      }
    }
  }, [
    buyer,
    eventId,
    initPaymentSheet,
    isPaymentSheetSupported,
    lines,
    presentPaymentSheet,
    processing,
    recordResult,
    router,
  ]);

  useEffect(
    () => () => {
      finalizingRef.current = false;
    },
    [],
  );

  // Render an empty shell while defensive guards redirect.
  if (
    event === null ||
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
            {Platform.OS === "web"
              ? "You'll be redirected to Stripe to complete your purchase securely. Apple Pay and Google Pay are supported."
              : "Card, Apple Pay, and Google Pay are handled by Stripe."}
          </Text>
          {checkoutSessionId !== null ? (
            <Text style={styles.paymentMeta}>Session {checkoutSessionId.slice(0, 8)}</Text>
          ) : null}
        </GlassCard>

        {finalizing || finalizingTimedOut ? (
          <GlassCard variant="base" radius="lg" padding={spacing.md}>
            <Text style={styles.finalizingTitle}>
              {finalizingTimedOut ? "Payment received" : "Finalizing your tickets..."}
            </Text>
            <Text style={styles.finalizingCopy}>
              {finalizingTimedOut
                ? "Your ticket will arrive by email and message shortly."
                : "Stripe has accepted the payment. We are waiting for the server to issue your tickets."}
            </Text>
          </GlassCard>
        ) : null}

        {paymentError !== null && !finalizing && !finalizingTimedOut ? (
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
          disabled={processing || finalizingTimedOut}
          accessibilityLabel={`Pay ${formatCurrency(totals.total, totals.currency)} with card`}
        />
      </View>

      {/* Decline toast — top-anchored absolute wrapper (Cycle 8a lesson) */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={declineToast}
          kind="error"
          message="Card declined — try another payment method."
          onDismiss={() => setDeclineToast(false)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  summary: {
    marginBottom: spacing.lg,
  },
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
  finalizingTitle: {
    fontSize: 16,
    color: textTokens.primary,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  finalizingCopy: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
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
  bottomBarHidden: {
    transform: [{ translateY: 200 }],
  },
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
  // Top-anchored toast wrap — Toast slides down 40px from above this
  // wrap into its natural position.
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
  },
});
