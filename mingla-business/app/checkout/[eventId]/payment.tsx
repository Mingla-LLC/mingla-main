/**
 * J-C3 — Payment screen.
 *
 * Route: /checkout/{eventId}/payment
 *
 * ORCH-0839-B (2026-05-14): mingla-business pivoted from native Stripe
 * PaymentSheet to hosted Stripe Checkout via expo-web-browser. Do NOT
 * re-add @stripe/stripe-react-native imports here — the iOS 26 + newArch
 * bridgeless TurboModule hang documented in
 * Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md
 * §D-1 still exists in the SDK. CI gate
 * .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs
 * forbids re-introduction.
 *
 * Both web and mobile (iOS + Android) buyers now redirect to the Stripe-
 * hosted Checkout page. Web uses window.location.assign; mobile uses
 * expo-web-browser.openAuthSessionAsync, intercepting the
 * mingla-business://checkout/return custom-scheme redirect.
 *
 * Free orders never reach this screen.
 *
 * On payment success: wait for the server-backed checkout status, record the
 * issued tickets into cart Context, then router.replace to /confirm.
 *
 * Per Cycle 8 spec §4.6 + ORCH-0839-B SPEC §2.6.
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
import * as WebBrowser from "expo-web-browser";

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
import { mixpanelService } from "../../../src/services/mixpanelService";

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

// ORCH-0839-B: return-URL scheme that the in-app browser session intercepts.
// Stripe redirects success_url + cancel_url to a mingla-business:// URL;
// openAuthSessionAsync resolves once the redirect happens. The scheme is
// registered in mingla-business/app.config.ts.
const CHECKOUT_RETURN_URL_SCHEME = "mingla-business://checkout/return";

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

  const [processing, setProcessing] = useState<boolean>(false);
  const [finalizing, setFinalizing] = useState<boolean>(false);
  const [finalizingTimedOut, setFinalizingTimedOut] = useState<boolean>(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  // ORCH-0839-B: declineToast state is retained but dormant. Stripe's hosted
  // page handles all card-decline UX inside its own surface. The Toast wrap
  // below preserves the absolute-positioning lesson per
  // feedback_toast_needs_absolute_wrap.md even though it has no caller in
  // the new code path.
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

    // ORCH-0839-B: single code path for web and mobile — both surfaces now use
    // hosted Stripe Checkout. The only platform fork is HOW the URL is opened:
    //   - web: window.location.assign (full-page redirect; same as ORCH-0790)
    //   - native (iOS + Android): expo-web-browser.openAuthSessionAsync with a
    //     custom-scheme returnUrl. The edge function emits
    //     mingla-business://checkout/return?... for the "mobile-web" surface;
    //     openAuthSessionAsync intercepts that redirect and resolves with
    //     type:"success" | "cancel" | "dismiss", before the OS Linking
    //     handler ever sees the URL (which is why there's no Linking
    //     listener in app/_layout.tsx).
    const surface: "web" | "mobile-web" =
      Platform.OS === "web" ? "web" : "mobile-web";

    try {
      setProcessing(true);
      setPaymentError(null);
      mixpanelService.track("ticket_checkout_pay_started", {
        surface,
        eventId,
      });
      const checkout = await createTicketCheckout({
        eventId,
        buyer,
        lines,
        surface,
      });
      if (checkout.kind !== "requires_web_redirect") {
        throw new Error("Hosted checkout did not return a redirect URL.");
      }
      setCheckoutSessionId(checkout.checkoutSessionId);

      if (Platform.OS === "web") {
        // Web path — full-page redirect via window.location.assign.
        // sessionStorage persist BEFORE redirect so a Stripe-side cancel
        // returns the buyer to a populated /payment screen and a success
        // returns to /confirm with the order summary intact.
        const storage = (globalThis as unknown as { sessionStorage?: Storage })
          .sessionStorage;
        writeCheckoutResumePayload(storage, eventId, {
          checkoutSessionId: checkout.checkoutSessionId,
          buyerStatusToken: checkout.buyerStatusToken,
          lines,
          buyer,
        });
        const w =
          globalThis as unknown as {
            location?: { assign?: (u: string) => void };
          };
        if (w.location?.assign) {
          w.location.assign(checkout.hostedCheckoutUrl);
        } else {
          // Sandbox / test environments where location.assign is unavailable.
          setProcessing(false);
          setPaymentError(
            "Couldn't redirect to Stripe. Please try again from a standard browser.",
          );
        }
        return;
      }

      // Native path (iOS + Android) — open the Stripe-hosted Checkout URL in
      // an in-app browser session. openAuthSessionAsync resolves when Stripe
      // redirects to mingla-business://checkout/return... or when the buyer
      // dismisses the sheet.
      const browserResult = await WebBrowser.openAuthSessionAsync(
        checkout.hostedCheckoutUrl,
        CHECKOUT_RETURN_URL_SCHEME,
      );

      mixpanelService.track("ticket_checkout_sheet_opened", {
        surface,
        eventId,
        checkoutSessionId: checkout.checkoutSessionId,
        browserResultType: browserResult.type,
      });

      if (
        browserResult.type === "cancel" ||
        browserResult.type === "dismiss"
      ) {
        // Buyer closed the in-app browser. Stripe sometimes completes
        // payment AFTER dismiss — same defensive race as
        // BrandOnboardView.tsx. Poll once with the full backoff; if the
        // order is still pending, surface as silent cancel.
        const status = await pollTicketCheckoutStatus(
          checkout.checkoutSessionId,
          checkout.buyerStatusToken,
        );
        if (status !== null && status.order !== null) {
          recordResult({
            orderId: status.order.orderId,
            ticketIds: status.order.tickets.map((t) => t.ticketId),
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
          mixpanelService.track("ticket_checkout_succeeded", {
            surface,
            eventId,
            checkoutSessionId: checkout.checkoutSessionId,
          });
          router.replace(`/checkout/${eventId}/confirm` as never);
          return;
        }
        // Real cancel — silent return (mirrors web cancel UX).
        mixpanelService.track("ticket_checkout_cancelled", {
          surface,
          eventId,
          checkoutSessionId: checkout.checkoutSessionId,
        });
        setProcessing(false);
        return;
      }

      if (browserResult.type !== "success") {
        // "locked" or "opened" — unusual states. Log + surface as error.
        console.warn(
          "[checkout-payment] openAuthSessionAsync unexpected type",
          browserResult.type,
        );
        mixpanelService.track("ticket_checkout_failed", {
          surface,
          eventId,
          checkoutSessionId: checkout.checkoutSessionId,
          reason: `browser_result_${browserResult.type}`,
        });
        setProcessing(false);
        setPaymentError("Checkout couldn't complete. Please try again.");
        return;
      }

      // browserResult.type === "success" — Stripe redirected back to
      // mingla-business://checkout/return?cs=... . Poll for the paid order.
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
        console.warn(
          "[checkout-payment] hosted checkout finalization timed out",
          { checkoutSessionId: checkout.checkoutSessionId },
        );
        mixpanelService.track("ticket_checkout_failed", {
          surface,
          eventId,
          checkoutSessionId: checkout.checkoutSessionId,
          reason: "finalize_timeout",
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
      mixpanelService.track("ticket_checkout_succeeded", {
        surface,
        eventId,
        checkoutSessionId: checkout.checkoutSessionId,
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
      setProcessing(false);
      const message =
        error instanceof Error
          ? error.message
          : "Payment could not be completed. Please try again.";
      setPaymentError(message);
      mixpanelService.track("ticket_checkout_failed", {
        surface,
        eventId,
        reason: "thrown_error",
        message,
      });
    } finally {
      if (!finalizingRef.current) {
        setProcessing(false);
      }
    }
  }, [
    buyer,
    eventId,
    lines,
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
            You'll be redirected to Stripe to complete your purchase securely. Apple Pay and Google Pay are supported.
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
