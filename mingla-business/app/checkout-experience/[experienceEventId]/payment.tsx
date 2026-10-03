/**
 * Experience payment screen. META-ORCH-1059 Sub-D — mirror of
 * `app/checkout-trip/[tripEventId]/payment.tsx`, with the trip-only installment
 * plan steps removed (experiences are single-charge).
 *
 * Route: /checkout-experience/{experienceEventId}/payment
 *
 * Inherits the SHARED money path verbatim: web hosted Checkout
 * (window.location.assign) + native iOS/Android PaymentSheet via
 * NativeCheckoutPaymentBoundary + the ORCH-0852 fire-and-forget confirm with
 * a 3s client timeout + webhook backup. NO native Stripe SDK import here — the
 * CI gate forbids re-introduction. ORCH-1130 Fix #2: the all-in WYSIWYP cart
 * (ORCH-1025) shows the server-computed venue-sourced all-in (incl. tax) via a
 * silent NO-ADDRESS mode:"preview" create; the old CartTaxPreview billing-
 * address / "Calculate tax" form was removed (buyer never types an address).
 *
 * issue #2190 (toward #3645): the web branch is NOT Stripe-only. Mirrors
 * #2188 on the event payment screen — Paystack brands return
 * `requires_paystack_redirect` + `authorizationUrl`; Stripe brands return
 * `requires_web_redirect` + `hostedCheckoutUrl`. This screen asks
 * `ticketCheckoutProviderHandoff` where to send the guest and follows the
 * answer. Do not reintroduce a provider check here.
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
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
  paidCheckoutErrorMessage,
  PAID_CHECKOUT_NO_HANDOFF_MESSAGE,
  ticketCheckoutProviderHandoff,
} from "../../../src/services/ticketCheckoutService";
import type { TicketCheckoutProviderHandoff } from "../../../src/services/ticketCheckoutService";
import { mixpanelService } from "../../../src/services/mixpanelService";
// ORCH-1192 — native `checkout_started` (mirrors web web_checkout_started),
// fired before purchase_completed. No-op on web / when key absent / opted out.
import { postHogService } from "../../../src/services/postHogService";
import type { NativeCheckoutExecutor } from "../../../src/payments/NativeCheckoutPaymentBoundary";

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
import { supabase } from "../../../src/services/supabase";

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
  const { lines, buyer, setLineQuantity, setBuyer, eventDateId } = useCart();
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
  // ORCH-1130 Fix #2 — the vestigial CartTaxPreview billing-address form +
  // "Calculate tax" Pay-gate are REMOVED (MINGLA-WIDE all-in / WYSIWYP: the
  // buyer never types an address; tax is venue-sourced server-side). Instead
  // we silently fetch the server-computed all-in total (incl. tax) via a
  // NO-ADDRESS mode:"preview" create on mount, purely to DISPLAY the all-in
  // upfront and to forward the tax calculationId into the charge. Pay is
  // NEVER blocked on this. (Migrated alongside the trip + event legs so the
  // shared CartTaxPreview can be deleted — same identical vestigial form.)
  const [allInPreviewCents, setAllInPreviewCents] = useState<number | null>(
    null,
  );
  const [previewCalculationId, setPreviewCalculationId] = useState<
    string | null
  >(null);

  // ----- issue #2190 [paid-checkout-redirect]: one create per checkout -----
  // Mirrors #2188 on the event payment screen. Held in a ref (not state)
  // because nothing renders from it and it must be readable synchronously by
  // the very next Pay tap. Keyed by a fingerprint of what is actually being
  // bought, so it can only ever be replayed for the SAME cart.
  const providerHandoffRef = useRef<
    { fingerprint: string; handoff: TicketCheckoutProviderHandoff } | null
  >(null);
  const cartFingerprint = JSON.stringify({
    eventId: experienceEventId,
    eventDateId,
    email: buyer.email.trim().toLowerCase(),
    phone: buyer.phone.trim(),
    lines: lines.map((l) => [l.ticketTypeId, l.quantity]),
  });

  /**
   * Full-page navigation to the provider. Returns false ONLY where
   * `location.assign` genuinely does not exist (sandbox / test), so the caller
   * can tell "the guest is on their way" from "the guest is still here".
   */
  const assignLocation = useCallback((url: string): boolean => {
    const w = globalThis as unknown as {
      location?: { assign?: (u: string) => void };
    };
    if (typeof w.location?.assign !== "function") return false;
    w.location.assign(url);
    return true;
  }, []);

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

  // #1841 [keyboard-guard-blind-spots] — the keyboard listener, the
  // `keyboardHeight` state and the padding/bottom-bar compensation that read it
  // were DELETED, not migrated. No focusable input exists anywhere in this
  // route's module closure (verified by transitive closure over the orch-0892
  // scan domain, re-run after this edit); card entry is the native Stripe
  // PaymentSheet, which is a separate window. The keyboard cannot appear here,
  // so there is nothing to compensate. Do not re-add keyboard plumbing without
  // first adding a field — and if you add a field, migrate the container to
  // src/wrappers/SmartScrollView instead of reinstating a listener.
  const scrollViewRef = useRef<ScrollView | null>(null);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (experienceEventId !== null) {
      router.replace(
        `/checkout-experience/${experienceEventId}/buyer` as never,
      );
    }
  }, [router, experienceEventId]);

  // ----- ORCH-1130 Fix #2: silent no-address all-in preview (native) -----
  // Server-computed venue-sourced all-in (incl. tax) so the order-summary box
  // shows the all-in upfront (WYSIWYP) without a buyer address form. Web shows
  // it on Stripe's hosted page. Non-blocking; re-runs when the cart changes.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (experienceEventId === null) return;
    if (lines.length === 0) return;
    if (buyer.name.trim().length < 2 || buyer.email.trim().length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.functions.invoke<{
        calculationId: string | null;
        totalCents: number;
      }>("ticket-checkout-create", {
        body: {
          eventId: experienceEventId,
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
  }, [
    experienceEventId,
    lines,
    buyer.name,
    buyer.email,
    buyer.phone,
    buyer.marketingOptIn,
  ]);

  const handlePay = useCallback(async (): Promise<void> => {
    if (processing) return;
    if (experienceEventId === null) return;
    // ORCH-1192 — fire `checkout_started` ONCE per attempt at the top of
    // handlePay (the `processing` early-return guards re-render/double-tap
    // double-fire), BEFORE the web hosted-redirect or native PaymentSheet opens
    // and BEFORE the purchase_completed success capture. value reflects the
    // server-computed all-in preview when available. capture() no-ops on web
    // (native postHogService is a web no-op) and when opted out / key absent.
    postHogService.capture("checkout_started", {
      event_id: experienceEventId,
      offering_type: "experience",
      ...(allInPreviewCents !== null ? { value: allInPreviewCents / 100 } : {}),
      currency: totals.currency,
      surface: "business_app",
    });
    // ORCH-1130 Fix #2 — no "Calculate tax" gate. Pay is available immediately
    // with the server-computed all-in (incl. tax, venue-sourced).

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
        // issue #2190 — ONE create per checkout, structurally (mirrors #2188).
        //
        // If this cart has already been handed a provider page, follow THAT
        // instead of asking the server for a second checkout. The server
        // refuses a duplicate create with 409 and it is right to: a second
        // create for a cart with a live provider attempt is never what the
        // guest wants. Re-following the URL we were already given is.
        const held = providerHandoffRef.current;
        if (held !== null && held.fingerprint === cartFingerprint) {
          if (assignLocation(held.handoff.redirectUrl)) return;
          setProcessing(false);
          setPaymentError(PAID_CHECKOUT_NO_HANDOFF_MESSAGE);
          return;
        }
        const checkout = await createTicketCheckout({
          eventId: experienceEventId,
          buyer,
          lines,
          surface,
          // ORCH-1138 Leg 3 — forward the chosen occurrence ONLY when the buyer
          // picked a slot (adaptive Reserve); null → request byte-identical.
          ...(eventDateId !== null ? { eventDateId } : {}),
        });
        // issue #2190 — provider-neutral. Stripe brands answer with
        // `hostedCheckoutUrl`, Paystack (NGN) brands with `authorizationUrl`;
        // the resolver owns that distinction so this screen never re-learns it.
        // A null answer means there is genuinely nowhere to send the guest —
        // surface it, never retry (a retry is the duplicate create that the
        // server correctly 409s).
        const handoff = ticketCheckoutProviderHandoff(checkout);
        if (handoff === null) {
          throw new Error(PAID_CHECKOUT_NO_HANDOFF_MESSAGE);
        }
        setCheckoutSessionId(handoff.checkoutSessionId);
        // Remember it BEFORE navigating: if the redirect cannot run, the next
        // Pay tap re-follows this URL rather than creating a second checkout.
        providerHandoffRef.current = { fingerprint: cartFingerprint, handoff };

        // sessionStorage persist BEFORE redirect so a provider-side cancel
        // returns the buyer to a populated /payment screen and a success
        // returns to /confirm with the order summary intact.
        const storage = (globalThis as unknown as { sessionStorage?: Storage })
          .sessionStorage;
        writeCheckoutResumePayload(storage, experienceEventId, {
          checkoutSessionId: handoff.checkoutSessionId,
          buyerStatusToken: handoff.buyerStatusToken,
          lines,
          buyer,
        });
        if (assignLocation(handoff.redirectUrl)) return;
        // Sandbox / test environments where location.assign is unavailable.
        setProcessing(false);
        setPaymentError(PAID_CHECKOUT_NO_HANDOFF_MESSAGE);
      } catch (error) {
        setProcessing(false);
        // issue #2190 — NEVER render the raw thrown string. supabase-js reports
        // every handled refusal as "Edge Function returned a non-2xx status
        // code"; the mapper is total and turns each bounded case into a
        // sentence that also says whether money moved.
        const message = paidCheckoutErrorMessage(error);
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
    // ORCH-1130 Fix #2 — no buyer address; tax is venue-sourced server-side.
    // Forward the silently-fetched no-address preview calculationId when
    // available; otherwise the no-address create recomputes the same all-in.
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
        },
        // ORCH-1246 (Apple 4.9) — experience title so the Apple Pay sheet line
        // item shows the product, not the company. Fallback "Ticket" if unloaded.
        displayTitle: experience?.title ?? undefined,
        ...(previewCalculationId
          ? { taxCalculationId: previewCalculationId }
          : {}),
        // ORCH-1138 Leg 3 — chosen occurrence ONLY when present; null → identical.
        ...(eventDateId !== null ? { eventDateId } : {}),
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
    allInPreviewCents,
    // issue #2190 — the redirect follower + the cart identity the held
    // provider hand-off is keyed by are both read inside this handler.
    assignLocation,
    cartFingerprint,
    buyer,
    eventDateId,
    experienceEventId,
    lines,
    nativeCheckout,
    previewCalculationId,
    processing,
    router,
    totals.currency,
  ]);

  // ORCH-1147 — the headline Total is the server fee-grossed all-in
  // (totals.allInTotal, from priceAllInGbp/pg_public_event_tier_allin), NOT the
  // bare base subtotal. Web shows it synchronously; native upgrades to the
  // tax-inclusive preview once it resolves (>= floor guard). The client owns
  // ZERO fee/tax math. I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN (DRAFT).
  //
  // OQ-2 exclusive-tax CAVEAT (documented, NOT fixed): priceAllInGbp folds FEES
  // but EXCLUDES tax — in exclusive-tax regions (US pass_tax=true) the floor
  // understates by tax. Today's blast radius is ZERO (all charges-enabled brands
  // are inclusive-tax GB/EU/CH). Larger follow-on (ORCH-1147 OQ-2).
  const baseTotalCents = Math.round(totals.subtotal * 100);
  const allInFloorCents = Math.round(totals.allInTotal * 100);
  const headlineCents =
    Platform.OS !== "web" &&
    allInPreviewCents !== null &&
    allInPreviewCents >= allInFloorCents
      ? allInPreviewCents
      : allInFloorCents;
  // ORCH-1147 — single combined "Fees & tax" line (never split service-fee + VAT).
  const feesTaxLineCents = Math.max(0, headlineCents - baseTotalCents);
  const showFeesTaxLine = feesTaxLineCents > 0;
  const displayAllIn = formatCurrency(headlineCents, totals.currency, true);

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
          {/* ORCH-1147 — single combined "Fees & tax" line (all-in − base);
              rendered only on a real delta (absorb-all brands show nothing). */}
          {showFeesTaxLine ? (
            <View style={styles.summaryFeesTaxRow}>
              <Text style={styles.summaryFeesTaxLabel}>Fees &amp; tax</Text>
              <Text style={styles.summaryFeesTaxValue}>
                {formatCurrency(feesTaxLineCents, totals.currency, true)}
              </Text>
            </View>
          ) : null}
          <View style={styles.summaryTotalRow}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotalValue}>
              {displayAllIn}
            </Text>
          </View>
        </GlassCard>

        {/* ORCH-1130 Fix #2 — the CartTaxPreview billing-address + "Calculate
            tax" form was REMOVED. Tax is venue-sourced server-side and the
            all-in (incl. tax) is shown above (WYSIWYP); the buyer types no
            address. */}

        <GlassCard variant="base" radius="lg" padding={spacing.md}>
          <Text style={styles.summaryLabel}>PAYMENT</Text>
          <Text style={styles.paymentCopy}>
            You&apos;ll be taken to our secure payment page to complete your
            purchase.
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
        ]}
      >
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {displayAllIn}
          </Text>
        </View>
        <Button
          label={`Pay ${displayAllIn}`}
          onPress={handlePay}
          variant="primary"
          size="lg"
          fullWidth
          loading={processing}
          // ORCH-1130 Fix #2 — no "Calculate tax" gate; Pay is enabled
          // immediately (only blocked while a charge is in flight).
          disabled={processing}
          accessibilityLabel={`Pay ${displayAllIn} with card`}
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
  // ORCH-1147 — combined "Fees & tax" line.
  summaryFeesTaxRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.xs,
  },
  summaryFeesTaxLabel: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  summaryFeesTaxValue: {
    fontSize: 14,
    color: textTokens.secondary,
    fontWeight: "600",
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
  // #1841 — `bottomBarHidden` deleted with the keyboard plumbing that was its
  // only consumer. A style whose sole purpose was hiding the bar behind a
  // keyboard that cannot appear on this route is dead code, and leaving it is
  // an invitation to re-wire the listener.
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
