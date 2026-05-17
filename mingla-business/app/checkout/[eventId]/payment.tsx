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
 * ORCH-0852 (2026-05-17): native PaymentSheet success path is now FIRE-AND-
 * FORGET. Mirrors consumer's pattern at app-mobile/src/components/expanded
 * Card/ExpandedBusinessEventSheet.tsx:264-286. After PaymentSheet returns
 * `succeeded`, the buyer is no longer blocked on synchronous polling for
 * order finalization. Instead we: (a) call `confirmTicketCheckout` with a
 * 3-second client-side timeout — server verifies the Stripe PI directly
 * and idempotently invokes biz_ticket_checkout_finalize so the order is
 * guaranteed to exist; (b) show a success toast; (c) router.replace to
 * the event public page. If the sync confirm errors or times out client-
 * side, the user is STILL navigated — the webhook backup creates the
 * order asynchronously and the buyer's tickets list refetch / Realtime
 * subscription picks it up. There is no stranded post-payment dead-end
 * screen any more. Per SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md §M0.
 *
 * Per Cycle 8 spec §4.6 + ORCH-0839-B SPEC §2.6.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header: insets.bottom IS applied (line 483 + 543) for home-indicator clearance; the top status-bar overlap with back arrow / payment-step header / "3 OF 3" pill is the intended banner-style buyer aesthetic (matches /checkout/{id} + /checkout/{id}/buyer pattern). Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1).

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
import { eventPublicPath } from "../../../src/constants/publicUrls";
import {
  confirmTicketCheckout,
  createTicketCheckout,
} from "../../../src/services/ticketCheckoutService";
import { mixpanelService } from "../../../src/services/mixpanelService";
// ORCH-0849 (2026-05-15): native PaymentSheet flow replaces the
// ORCH-0839-B WebBrowser.openAuthSessionAsync hosted-checkout pivot.
// Parity with consumer (app-mobile/src/payments/nativeCheckoutFlow.ts).
// Per SPEC_ORCH-0849 §3.4.5 + invariant I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY.
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

// ORCH-0849 (2026-05-15): CHECKOUT_RETURN_URL_SCHEME removed — native
// PaymentSheet handles return-URL internally via the StripeNativeProvider's
// urlScheme prop (mounted in mingla-business/app/_layout.tsx). Web path
// retains full-page redirect via window.location.assign; no return-URL
// interception needed on web because Stripe's success_url/cancel_url
// navigate the browser directly.

export default function CheckoutPaymentScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;

  const publicEventQuery = usePublicEventById(eventId);
  const event = publicEventQuery.data?.event ?? null;
  const { lines, buyer, setLineQuantity, setBuyer } = useCart();
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
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  // ORCH-0839-B: declineToast state is retained but dormant. Stripe's hosted
  // page handles all card-decline UX inside its own surface. The Toast wrap
  // below preserves the absolute-positioning lesson per
  // feedback_toast_needs_absolute_wrap.md even though it has no caller in
  // the new code path.
  const [declineToast, setDeclineToast] = useState<boolean>(false);
  // ORCH-0852: shown briefly after PaymentSheet success, before navigation.
  // Mirrors consumer's "Ticket secured!" toast in
  // app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx.
  const [successToast, setSuccessToast] = useState<boolean>(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // ORCH-0849: native PaymentSheet hook. Returns a function that the
  // native branch of handlePay invokes; not used on web (Platform.OS ===
  // "web" path stays on full-page Hosted Checkout via window.location.assign).
  const nativeCheckout = useNativeCheckoutFlow();

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

    // ORCH-0849: two distinct code paths, retained from ORCH-0839-B for web
    // (Platform.OS === "web"; mingla-business has a web build for the
    // public buyer route) but pivoted on native (iOS + Android) from
    // hosted Stripe Checkout to native PaymentSheet, parity with consumer.
    //
    //   - web: createTicketCheckout({surface:"web"}) → requires_web_redirect
    //     → window.location.assign(hostedCheckoutUrl). Full-page redirect.
    //     Web has no native Stripe SDK; PaymentSheet doesn't render in a
    //     browser. Hosted Checkout remains the right surface there.
    //
    //   - native (iOS + Android): useNativeCheckoutFlow() → invokes
    //     ticket-checkout-create with surface:"native" → requires_payment →
    //     initStripe per-PI + initPaymentSheet + presentPaymentSheet. Same
    //     pattern as consumer (app-mobile/src/payments/nativeCheckoutFlow.ts).
    //     ORCH-0844 fixes (initStripe per-PI with stripeAccountId, Customer
    //     + ephemeralKey, withTimeout removal) are inherited verbatim.

    if (Platform.OS === "web") {
      // ---------- WEB PATH (unchanged from ORCH-0839-B) ----------
      const surface: "web" = "web";
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
          return;
        }
        // Sandbox / test environments where location.assign is unavailable.
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
          eventId,
          reason: "thrown_error",
          message,
        });
      }
      return;
    }

    // ---------- NATIVE PATH (ORCH-0849 native PaymentSheet) ----------
    const surface: "native" = "native";

    try {
      setProcessing(true);
      setPaymentError(null);
      mixpanelService.track("ticket_checkout_pay_started", { surface, eventId });

      const outcome = await nativeCheckout({
        eventId,
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
        eventId,
        outcome: outcome.outcome,
      });

      if (outcome.outcome === "canceled") {
        mixpanelService.track("ticket_checkout_cancelled", {
          surface,
          eventId,
        });
        setProcessing(false);
        return;
      }

      if (outcome.outcome === "failed") {
        mixpanelService.track("ticket_checkout_failed", {
          surface,
          eventId,
          reason: "native_checkout_failed",
          message: outcome.message,
        });
        setProcessing(false);
        setPaymentError(outcome.message);
        return;
      }

      // ORCH-0852 — outcome.outcome === "succeeded". Fire-and-forget pattern
      // mirroring consumer at app-mobile/src/components/expandedCard/
      // ExpandedBusinessEventSheet.tsx:264-286. We:
      //   1. Call confirmTicketCheckout SYNCHRONOUSLY (server verifies the
      //      Stripe PI directly + invokes idempotent finalize RPC) with a
      //      3-second CLIENT-SIDE timeout so the UI is never blocked on
      //      a slow server. Order is guaranteed to exist server-side after
      //      this — even if our await times out, the RPC ran.
      //   2. Show a success toast.
      //   3. router.replace to the event public page after a brief delay
      //      so the buyer sees the confirmation copy.
      // The webhook backup remains in flight; if the sync confirm threw or
      // timed out, the webhook will still create/finalize the order and
      // the buyer's tickets list refetch / Realtime subscription resolves it.
      // There is no stranded post-payment dead-end any more.
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
        // Non-fatal — webhook backup will finalize. Log for observability.
        console.warn(
          "[checkout-payment] synchronous confirm failed or timed out; relying on webhook backup",
          confirmErr,
        );
        mixpanelService.track("ticket_checkout_sync_confirm_failed", {
          surface,
          eventId,
          checkoutSessionId: sessionId,
          reason:
            confirmErr instanceof Error ? confirmErr.message : "unknown",
        });
      }

      mixpanelService.track("ticket_checkout_succeeded", {
        surface,
        eventId,
        checkoutSessionId: sessionId,
      });

      setSuccessToast(true);

      // Brief delay so the buyer sees the toast before the screen unmounts
      // via router.replace. 1.2s mirrors the consumer pattern's perceived
      // confirmation window. Event slugs come from the public event query
      // (already fetched above). On the off-chance event is null (race
      // with the publicEventQuery), fall back to /(tabs)/home — same
      // pattern as handleBackToEvent in confirm.tsx.
      setTimeout(() => {
        if (event !== null) {
          router.replace(
            eventPublicPath({
              brandSlug: event.brandSlug,
              eventSlug: event.eventSlug,
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
        eventId,
        reason: "thrown_error",
        message,
      });
    } finally {
      setProcessing(false);
    }
  }, [
    buyer,
    event,
    eventId,
    lines,
    nativeCheckout,
    processing,
    router,
  ]);

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

        {/* ORCH-0852: the prior post-payment blocking GlassCard was removed.
            PaymentSheet success no longer parks the buyer on this screen;
            the success toast + auto-navigate happen inside handlePay so
            this surface stays minimal. */}

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

      {/* Toast — top-anchored absolute wrapper (Cycle 8a lesson per
          feedback_toast_needs_absolute_wrap.md). ORCH-0852: success toast
          fires on PaymentSheet success before navigation; decline toast
          retained from ORCH-0839-B for parity even though dormant. */}
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
          message="Ticket secured! Check your tickets list."
          onDismiss={() => setSuccessToast(false)}
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
