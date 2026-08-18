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
 * Both web and mobile (iOS + Android) buyers now redirect to a PROVIDER-hosted
 * payment page. Web uses window.location.assign; mobile uses
 * expo-web-browser.openAuthSessionAsync, intercepting the
 * mingla-business://checkout/return custom-scheme redirect.
 *
 * issue #2188 (2026-08-17): the web branch is NOT Stripe-only. A Nigerian
 * (Paystack) brand's create returns `requires_paystack_redirect` +
 * `authorizationUrl`; a Stripe brand returns `requires_web_redirect` +
 * `hostedCheckoutUrl`. This screen must NOT branch on which — it asks
 * `ticketCheckoutProviderHandoff` where to send the guest and follows the
 * answer. It previously hard-required Stripe's shape, threw away a live
 * Paystack hand-off, and left the guest re-tapping Pay into the server's
 * (correct) duplicate-checkout 409. Do not reintroduce a provider check here.
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
import { usePublicEventById } from "../../../src/hooks/usePublicEvents";
// ORCH-1162 Bug 3 — brand-accent for the checkout Pay CTA, matching the public page.
import { resolveCheckoutBrandAccent } from "../../../src/utils/checkoutBrandAccent";
import { formatCurrency } from "../../../src/utils/currency";
import { isRequiredPhoneValid } from "../../../src/utils/phone";
import { eventPublicPath } from "../../../src/constants/publicUrls";
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
// ORCH-0849 (2026-05-15): native PaymentSheet flow replaces the
// ORCH-0839-B WebBrowser.openAuthSessionAsync hosted-checkout pivot.
// Parity with consumer (app-mobile/src/payments/nativeCheckoutFlow.ts).
// Per SPEC_ORCH-0849 §3.4.5 + invariant I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY.
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

// ORCH-0849 (2026-05-15): CHECKOUT_RETURN_URL_SCHEME removed — native
// PaymentSheet handles return-URL internally via the StripeNativeProvider's
// urlScheme prop (scoped to this payment route wrapper). Web path
// retains full-page redirect via window.location.assign; no return-URL
// interception needed on web because Stripe's success_url/cancel_url
// navigate the browser directly.

const NativeCheckoutPaymentBoundary = React.lazy(
  () => import("../../../src/payments/NativeCheckoutPaymentBoundary"),
);

export default function CheckoutPaymentScreen(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <NativeCheckoutPaymentBoundary>
        {(nativeCheckout) => (
          <CheckoutPaymentScreenContent nativeCheckout={nativeCheckout} />
        )}
      </NativeCheckoutPaymentBoundary>
    </Suspense>
  );
}

interface CheckoutPaymentScreenContentProps {
  nativeCheckout: NativeCheckoutExecutor;
}

function CheckoutPaymentScreenContent({
  nativeCheckout,
}: CheckoutPaymentScreenContentProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;

  const publicEventQuery = usePublicEventById(eventId);
  const event = publicEventQuery.data?.event ?? null;
  const brand = publicEventQuery.data?.brand ?? null;
  // ORCH-1162 Bug 3 — CTA brand accent (matches the public page Pay button).
  const ctaAccent =
    event !== null
      ? (resolveCheckoutBrandAccent({
          brandTheme: brand?.theme ?? null,
          eventThemeOverrides: event.themeOverrides ?? null,
        }) ?? undefined)
      : undefined;
  // issue #2135 [multi-date public day picker] — `eventDateId` is the occurrence
  // the guest chose on the public page, seeded into the cart by the cart step.
  // null on every single-date checkout, which keeps the request byte-identical.
  const { lines, buyer, setLineQuantity, setBuyer, eventDateId } = useCart();
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
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(
    null,
  );
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

  // ----- issue #2188 [paid-checkout-redirect]: one create per checkout -----
  //
  // The provider page this cart was already sent to. Held in a ref (not state)
  // because nothing renders from it and it must be readable synchronously by
  // the very next Pay tap.
  //
  // Keyed by a fingerprint of what is actually being bought, so it can only
  // ever be replayed for the SAME cart. Change the tickets, the buyer or the
  // chosen day and the fingerprint moves, the held URL stops matching, and a
  // fresh create runs — which is correct, because that is a different purchase
  // with a different server-side idempotency key.
  const providerHandoffRef = useRef<
    { fingerprint: string; handoff: TicketCheckoutProviderHandoff } | null
  >(null);
  const cartFingerprint = JSON.stringify({
    eventId,
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

  // ----- ORCH-1130 Fix #2: silent no-address all-in preview (native) -----
  // Fetches the server-computed venue-sourced all-in (incl. tax) so the
  // order-summary box shows the all-in upfront (WYSIWYP) without a buyer
  // address form. Web shows the all-in on Stripe's hosted page, so it skips
  // this. Non-blocking: any failure leaves the base Total + a no-address
  // create (which still charges the all-in). Re-runs when the cart changes.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (eventId === null) return;
    if (lines.length === 0) return;
    if (buyer.name.trim().length < 2 || buyer.email.trim().length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.functions.invoke<{
        calculationId: string | null;
        totalCents: number;
      }>("ticket-checkout-create", {
        body: {
          eventId,
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
  }, [eventId, lines, buyer.name, buyer.email, buyer.phone, buyer.marketingOptIn]);

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
    // ORCH-1192 — fire `checkout_started` ONCE per attempt, at the top of
    // handlePay (the `processing` early-return above guards re-render/double-tap
    // double-fire), BEFORE either the web hosted-redirect or the native
    // PaymentSheet opens and BEFORE the purchase_completed success capture on
    // /confirm. Free orders never reach this screen (J-C2 → /confirm), so this
    // is paid-only; value reflects the server-computed all-in preview when
    // available. capture() no-ops on web (native postHogService is a web no-op)
    // and when opted out / key absent.
    postHogService.capture("checkout_started", {
      event_id: eventId,
      offering_type: "event",
      ...(allInPreviewCents !== null ? { value: allInPreviewCents / 100 } : {}),
      currency: totals.currency,
      surface: "business_app",
    });
    // ORCH-1130 Fix #2 — no "Calculate tax" gate. Pay is available immediately
    // with the server-computed all-in (incl. tax, venue-sourced). The buyer
    // never types an address.

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
      // ---------- WEB PATH ----------
      const surface: "web" = "web";
      try {
        setProcessing(true);
        setPaymentError(null);
        mixpanelService.track("ticket_checkout_pay_started", {
          surface,
          eventId,
        });
        // issue #2188 — ONE create per checkout, structurally.
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
          eventId,
          buyer,
          lines,
          surface,
          // issue #2135 — forward the chosen occurrence ONLY when present. The
          // service already omits the field for an empty value, so a single-date
          // request is byte-identical; `orders.event_date_id` (#1188) persists it.
          ...(eventDateId !== null ? { eventDateId } : {}),
        });
        // issue #2188 — provider-neutral. Stripe brands answer with
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
        writeCheckoutResumePayload(storage, eventId, {
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
        // issue #2188 — NEVER render the raw thrown string. supabase-js reports
        // every handled refusal as "Edge Function returned a non-2xx status
        // code"; the mapper is total and turns each bounded case into a
        // sentence that also says whether money moved.
        const message = paidCheckoutErrorMessage(error);
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
        eventId,
      });

      const outcome = await nativeCheckout({
        eventId,
        lines,
        buyer: {
          name: buyer.name,
          email: buyer.email,
          phone: buyer.phone,
          marketingOptIn: buyer.marketingOptIn === true,
        },
        // ORCH-1246 (Apple 4.9) — event title so the Apple Pay sheet line item
        // shows the product, not the company. Fallback "Ticket" if event unloaded.
        displayTitle: event?.name ?? undefined,
        ...(previewCalculationId
          ? { taxCalculationId: previewCalculationId }
          : {}),
        // issue #2135 — the chosen occurrence, forwarded ONLY when present.
        // `useNativeCheckoutFlow` already accepts and omits it the same way, so
        // a single-date native charge is byte-identical.
        ...(eventDateId !== null ? { eventDateId } : {}),
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
            setTimeout(() => reject(new Error("client_confirm_timeout")), 3000)
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
          reason: confirmErr instanceof Error ? confirmErr.message : "unknown",
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
      const message = error instanceof Error
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
    allInPreviewCents,
    // issue #2188 — the redirect follower + the cart identity the held
    // provider hand-off is keyed by are both read inside this handler.
    assignLocation,
    cartFingerprint,
    buyer,
    event,
    eventId,
    // issue #2135 — the chosen occurrence is read inside this handler.
    eventDateId,
    lines,
    nativeCheckout,
    previewCalculationId,
    processing,
    router,
    totals.currency,
  ]);

  // ORCH-1147 — the headline Total is sourced from the server fee-grossed
  // all-in (totals.allInTotal, from priceAllInGbp/pg_public_event_tier_allin),
  // NOT the bare base subtotal. Web shows it synchronously; native shows it
  // synchronously and UPGRADES to the tax-inclusive preview once the silent
  // no-address preview resolves (>= floor guard prevents a stale/lower preview
  // from regressing the headline). The client owns ZERO fee/tax math — it sums
  // the server per-tier all-in and subtracts the base.
  // I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN (DRAFT).
  //
  // OQ-2 exclusive-tax CAVEAT (documented, NOT fixed here): priceAllInGbp folds
  // FEES but EXCLUDES tax, so in exclusive-tax regions (US pass_tax=true) the
  // web/native floor understates by the tax. Today's blast radius is ZERO (all
  // charges-enabled brands are inclusive-tax GB/EU/CH where all_in == buyer_total).
  // Closing it requires routing display off the buyer-detail-gated preview — a
  // larger follow-on (ORCH-1147 OQ-2).
  const baseTotalCents = Math.round(totals.subtotal * 100);
  const allInFloorCents = Math.round(totals.allInTotal * 100);
  const headlineCents =
    Platform.OS !== "web" &&
    allInPreviewCents !== null &&
    allInPreviewCents >= allInFloorCents
      ? allInPreviewCents
      : allInFloorCents;
  // ORCH-1147 — single combined "Fees & tax" line (NEVER split service-fee +
  // VAT, per feedback_cart_combined_fees_tax_line). On native with a tax-
  // inclusive preview this correctly folds tax; on web/floor it is the fee delta.
  const feesTaxLineCents = Math.max(0, headlineCents - baseTotalCents);
  const showFeesTaxLine = feesTaxLineCents > 0;
  const displayAllIn = formatCurrency(headlineCents, totals.currency, true);

  // Render an empty shell while defensive guards redirect.
  if (
    eventId === null ||
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
              rendered only when there's a real delta (absorb-all brands show
              nothing, unchanged). NEVER split service-fee + VAT. */}
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
          {/* issue #2188 — provider-NEUTRAL. This screen serves Stripe brands
              and Nigerian Paystack brands from the same code path, and a Lagos
              guest was being told they were going to Stripe. Naming the
              provider here would be wrong for whichever half it isn't. */}
          <Text style={styles.paymentCopy}>
            You'll be taken to our secure payment page to complete your purchase.
          </Text>
          {checkoutSessionId !== null
            ? (
              <Text style={styles.paymentMeta}>
                Session {checkoutSessionId.slice(0, 8)}
              </Text>
            )
            : null}
        </GlassCard>

        {
          /* ORCH-0852: the prior post-payment blocking GlassCard was removed.
            PaymentSheet success no longer parks the buyer on this screen;
            the success toast + auto-navigate happen inside handlePay so
            this surface stays minimal. */
        }

        {paymentError !== null
          ? <Text style={styles.errorText}>{paymentError}</Text>
          : null}
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
          accentColor={ctaAccent}
          size="lg"
          fullWidth
          loading={processing}
          // ORCH-1130 Fix #2 — no "Calculate tax" gate; Pay is enabled
          // immediately (only blocked while a charge is in flight).
          disabled={processing}
          accessibilityLabel={`Pay ${displayAllIn} with card`}
        />
      </View>

      {
        /* Toast — top-anchored absolute wrapper (Cycle 8a lesson per
          feedback_toast_needs_absolute_wrap.md). ORCH-0852: success toast
          fires on PaymentSheet success before navigation; decline toast
          retained from ORCH-0839-B for parity even though dormant. */
      }
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
  // ORCH-1147 — combined "Fees & tax" line in the order summary.
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
