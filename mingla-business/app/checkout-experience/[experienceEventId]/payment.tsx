/**
 * Experience payment screen. META-ORCH-1059 Sub-D — mirror of
 * `app/checkout-trip/[tripEventId]/payment.tsx`, with the trip-only installment
 * plan steps removed (experiences are single-charge).
 *
 * Route: /checkout-experience/{experienceEventId}/payment
 *
 * Inherits the SHARED money path verbatim: web hosted Stripe Checkout
 * (window.location.assign) + native iOS/Android PaymentSheet via
 * NativeCheckoutPaymentBoundary + the ORCH-0852 fire-and-forget confirm with
 * a 3s client timeout + webhook backup. NO native Stripe SDK import here — the
 * CI gate forbids re-introduction. The all-in WYSIWYP cart (ORCH-1025) +
 * combined "Fees & tax" line come from the shared CartTaxPreview component.
 *
 * COMMS-0014/0016: `createTicketCheckout` is event_type-agnostic; the
 * experience's events-row id is the eventId. No parallel money fn, no new
 * payment UI.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header mirror of /checkout-trip/[tripEventId]/payment.tsx; insets.bottom IS applied (bottom dock); the top status-bar overlap with the payment-step banner header is the intended buyer aesthetic.

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
import { usePublicExperienceById } from "../../../src/hooks/usePublicExperience";
import { formatCurrency } from "../../../src/utils/currency";
import { isRequiredPhoneValid } from "../../../src/utils/phone";
import {
  confirmTicketCheckout,
  createTicketCheckout,
} from "../../../src/services/ticketCheckoutService";
import { mixpanelService } from "../../../src/services/mixpanelService";
import type { NativeCheckoutExecutor } from "../../../src/payments/NativeCheckoutPaymentBoundary";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Toast } from "../../../src/components/ui/Toast";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import {
  CartTaxPreview,
  type CartTaxPreviewResult,
} from "../../../src/components/checkout/CartTaxPreview";
import {
  readCheckoutResumePayload,
  writeCheckoutResumePayload,
} from "../../../src/components/checkout/checkoutPersistence";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";

const NativeCheckoutPaymentBoundary = React.lazy(
  () => import("../../../src/payments/NativeCheckoutPaymentBoundary"),
);

export default function CheckoutExperiencePaymentScreen(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <NativeCheckoutPaymentBoundary>
        {(nativeCheckout) => (
          <CheckoutExperiencePaymentScreenContent
            nativeCheckout={nativeCheckout}
          />
        )}
      </NativeCheckoutPaymentBoundary>
    </Suspense>
  );
}

interface ContentProps {
  nativeCheckout: NativeCheckoutExecutor;
}

function CheckoutExperiencePaymentScreenContent({
  nativeCheckout,
}: ContentProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ experienceEventId: string }>();
  const experienceEventId =
    typeof params.experienceEventId === "string"
      ? params.experienceEventId
      : null;

  const query = usePublicExperienceById(experienceEventId);
  const experience = query.data?.experience ?? null;
  const { lines, buyer, setLineQuantity, setBuyer } = useCart();
  const totals = useCartTotals();

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
  const [taxPreview, setTaxPreview] = useState<CartTaxPreviewResult | null>(
    null,
  );

  // ----- Web sessionStorage restore (mirror ORCH-0789/0790) -----
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (experienceEventId === null) return;
    if (restoreChecked) return;
    const storage = (globalThis as unknown as { sessionStorage?: Storage })
      .sessionStorage;
    const payload = readCheckoutResumePayload(storage, experienceEventId);
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
  }, [experienceEventId]);

  // ----- Defensive guards -----
  useEffect(() => {
    if (experienceEventId === null) return;
    if (!restoreChecked) return;
    if (lines.length === 0) {
      router.replace(`/checkout-experience/${experienceEventId}` as never);
      return;
    }
    if (totals.isFree) {
      router.replace(
        `/checkout-experience/${experienceEventId}/buyer` as never,
      );
      return;
    }
    if (
      buyer.name.trim().length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email.trim()) ||
      !isRequiredPhoneValid(buyer.phone)
    ) {
      router.replace(
        `/checkout-experience/${experienceEventId}/buyer` as never,
      );
      return;
    }
  }, [
    experienceEventId,
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

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (experienceEventId !== null) {
      router.replace(
        `/checkout-experience/${experienceEventId}/buyer` as never,
      );
    }
  }, [router, experienceEventId]);

  const handlePay = useCallback(async (): Promise<void> => {
    if (processing) return;
    if (experienceEventId === null) return;
    if (Platform.OS !== "web" && taxPreview === null) {
      setPaymentError("Calculate tax before paying.");
      return;
    }

    if (Platform.OS === "web") {
      // ---------- WEB PATH ----------
      const surface: "web" = "web";
      try {
        setProcessing(true);
        setPaymentError(null);
        mixpanelService.track("ticket_checkout_pay_started", {
          surface,
          eventId: experienceEventId,
          eventType: "experience",
        });
        const checkout = await createTicketCheckout({
          eventId: experienceEventId,
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
        writeCheckoutResumePayload(storage, experienceEventId, {
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
          eventId: experienceEventId,
          eventType: "experience",
          reason: "thrown_error",
          message,
        });
      }
      return;
    }

    // ---------- NATIVE PATH ----------
    if (taxPreview === null) {
      setPaymentError("Calculate tax before paying.");
      return;
    }
    const readyTaxPreview = taxPreview;
    const surface: "native" = "native";

    try {
      setProcessing(true);
      setPaymentError(null);
      mixpanelService.track("ticket_checkout_pay_started", {
        surface,
        eventId: experienceEventId,
        eventType: "experience",
      });

      const outcome = await nativeCheckout({
        eventId: experienceEventId,
        lines,
        buyer: {
          name: buyer.name,
          email: buyer.email,
          phone: buyer.phone,
          marketingOptIn: buyer.marketingOptIn === true,
          address: readyTaxPreview.address,
        },
        taxCalculationId: readyTaxPreview.calculationId,
      });

      mixpanelService.track("ticket_checkout_sheet_opened", {
        surface,
        eventId: experienceEventId,
        eventType: "experience",
        outcome: outcome.outcome,
      });

      if (outcome.outcome === "canceled") {
        mixpanelService.track("ticket_checkout_cancelled", {
          surface,
          eventId: experienceEventId,
          eventType: "experience",
        });
        setProcessing(false);
        return;
      }

      if (outcome.outcome === "failed") {
        mixpanelService.track("ticket_checkout_failed", {
          surface,
          eventId: experienceEventId,
          eventType: "experience",
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
            setTimeout(
              () => reject(new Error("client_confirm_timeout")),
              3000,
            ),
          ),
        ]);
      } catch (confirmErr) {
        console.warn(
          "[checkout-experience-payment] synchronous confirm failed or timed out; relying on webhook backup",
          confirmErr,
        );
        mixpanelService.track("ticket_checkout_sync_confirm_failed", {
          surface,
          eventId: experienceEventId,
          eventType: "experience",
          checkoutSessionId: sessionId,
          reason:
            confirmErr instanceof Error ? confirmErr.message : "unknown",
        });
      }

      mixpanelService.track("ticket_checkout_succeeded", {
        surface,
        eventId: experienceEventId,
        eventType: "experience",
        checkoutSessionId: sessionId,
      });

      setSuccessToast(true);

      setTimeout(() => {
        router.replace(
          `/checkout-experience/${experienceEventId}/confirm` as never,
        );
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
        eventId: experienceEventId,
        eventType: "experience",
        reason: "thrown_error",
        message,
      });
    } finally {
      setProcessing(false);
    }
  }, [
    buyer,
    experienceEventId,
    lines,
    nativeCheckout,
    processing,
    router,
    taxPreview,
  ]);

  const handleTaxPreviewChange = useCallback(
    (result: CartTaxPreviewResult | null): void => {
      setTaxPreview(result);
      if (result !== null) setBuyer({ address: result.address });
    },
    [setBuyer],
  );

  const displayTotalCents =
    Platform.OS === "web" || taxPreview === null
      ? totals.total
      : taxPreview.totalCents;

  // Defensive shell while guards redirect.
  if (
    experienceEventId === null ||
    experience === null ||
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
          keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 140 } : null,
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
              {formatCurrency(displayTotalCents, totals.currency)}
            </Text>
          </View>
        </GlassCard>

        {/* All-in tax/fee preview (native) — combined "Fees & tax" line. */}
        {Platform.OS !== "web" ? (
          <GlassCard variant="base" radius="lg" padding={spacing.md}>
            <CartTaxPreview
              eventId={experienceEventId}
              lines={lines}
              buyer={buyer}
              currency={totals.currency}
              disabled={processing}
              onPreviewChange={handleTaxPreviewChange}
            />
          </GlassCard>
        ) : null}

        <GlassCard variant="base" radius="lg" padding={spacing.md}>
          <Text style={styles.summaryLabel}>PAYMENT</Text>
          <Text style={styles.paymentCopy}>
            You&apos;ll be redirected to Stripe to complete your purchase
            securely. Apple Pay and Google Pay are supported.
          </Text>
          {checkoutSessionId !== null ? (
            <Text style={styles.paymentMeta}>
              Session {checkoutSessionId.slice(0, 8)}
            </Text>
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
            {formatCurrency(displayTotalCents, totals.currency)}
          </Text>
        </View>
        <Button
          label={`Pay ${formatCurrency(displayTotalCents, totals.currency)}`}
          onPress={handlePay}
          variant="primary"
          size="lg"
          fullWidth
          loading={processing}
          disabled={
            processing || (Platform.OS !== "web" && taxPreview === null)
          }
          accessibilityLabel={`Pay ${formatCurrency(displayTotalCents, totals.currency)} with card`}
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
  summaryTotal: { fontSize: 14, color: textTokens.primary, fontWeight: "600" },
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
  paymentCopy: { fontSize: 14, color: textTokens.secondary, lineHeight: 20 },
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
  totalLabel: { fontSize: 13, color: textTokens.tertiary, fontWeight: "500" },
  totalValue: {
    fontSize: 20,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  toastWrap: { position: "absolute", top: 80, left: 0, right: 0 },
});
