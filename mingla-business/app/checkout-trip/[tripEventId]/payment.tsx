/**
 * Trip payment screen. ORCH-0876 [Trip CRUD + Purchase Flow Completion] —
 * mirror of `app/checkout/[eventId]/payment.tsx` for trips.
 *
 * Route: /checkout-trip/{tripEventId}/payment
 *
 * Inherits ORCH-0839-B (web hosted Checkout via window.location.assign)
 * + ORCH-0849 (native iOS/Android PaymentSheet via useNativeCheckoutFlow) +
 * ORCH-0852 (fire-and-forget confirm with 3s client-side timeout + webhook
 * backup) from event-side payment.tsx, verbatim. NO native Stripe SDK import
 * here — CI gate at
 * .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs
 * forbids re-introduction.
 *
 * issue #2190 (toward #3645): the web branch is NOT Stripe-only. Mirrors
 * #2188 on the event payment screen — Paystack brands return
 * `requires_paystack_redirect` + `authorizationUrl`; Stripe brands return
 * `requires_web_redirect` + `hostedCheckoutUrl`. This screen asks
 * `ticketCheckoutProviderHandoff` where to send the guest and follows the
 * answer. Do not reintroduce a provider check here.
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
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  accent,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { usePublicTripById } from "../../../src/hooks/usePublicTripById";
import { useTripIntakeSchemasByEvent } from "../../../src/hooks/useIntakeSchema";
import { isRequiredPhoneValid } from "../../../src/utils/phone";
import { tripPublicPath } from "../../../src/constants/publicUrls";
import {
  confirmTicketCheckout,
  createTicketCheckout,
  paidCheckoutErrorMessage,
  PAID_CHECKOUT_NO_HANDOFF_MESSAGE,
  ticketCheckoutProviderHandoff,
} from "../../../src/services/ticketCheckoutService";
import type { TicketCheckoutProviderHandoff } from "../../../src/services/ticketCheckoutService";
import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";
import { mixpanelService } from "../../../src/services/mixpanelService";
// ORCH-1192 — native `checkout_started` (mirrors web web_checkout_started),
// fired before purchase_completed. No-op on web / when key absent / opted out.
import { postHogService } from "../../../src/services/postHogService";
import type { NativeCheckoutExecutor } from "../../../src/payments/NativeCheckoutPaymentBoundary";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Toast } from "../../../src/components/ui/Toast";
import { TripPaymentChoice } from "../../../src/components/trip/TripPaymentChoice";
import { InstallmentScheduleDisplay } from "../../../src/components/trip/InstallmentScheduleDisplay";
import { projectInstallmentSchedule } from "../../../src/utils/installmentScheduleProjection";

import {
  useCart,
  useCartQuoteTotals,
} from "../../../src/components/checkout/CartContext";
import {
  readCheckoutResumePayload,
  writeCheckoutResumePayload,
} from "../../../src/components/checkout/checkoutPersistence";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import { tripFunnelTotalSteps, tripPaymentStepIndex } from "./tripFunnelSteps";
// issue #3351 [free trip intake loop] — the flattener and the presence probe
// both live in the step-order owner now, so the trip route holds exactly one
// copy of each.
import {
  tripCounterShape,
  tripIntakeFormDataArray,
  tripIntakeState,
  type TripIntakeState,
} from "./tripCheckoutStepOrder";
import { PrivacyChoicesLink } from "../../../src/analytics/PrivacyChoicesLink";

const formatQuoteMoney = (minor: number, currency: string): string => {
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(minor / 100),
      currency,
    );
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`.trim();
  }
};

const NativeCheckoutPaymentBoundary = React.lazy(
  () => import("../../../src/payments/NativeCheckoutPaymentBoundary"),
);
const TicketCheckoutReviewPanel = React.lazy(() =>
  import("../../../src/components/checkout/TicketQuoteSummary").then(
    (module) => ({ default: module.TicketCheckoutReviewPanel }),
  ),
);
const TicketQuoteSummary = React.lazy(() =>
  import("../../../src/components/checkout/TicketQuoteSummary").then(
    (module) => ({ default: module.TicketQuoteSummary }),
  ),
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
  const tripEventId =
    typeof params.tripEventId === "string" ? params.tripEventId : null;

  const publicTripQuery = usePublicTripById(tripEventId);
  const trip = publicTripQuery.data?.trip ?? null;
  // ORCH-1178 — anon-tolerant per-tier intake schemas, used ONLY to derive the
  // funnel length (whether /intake sits between /buyer and /payment). Mirrors
  // buyer.tsx's by-event query.
  const intakeSchemasQuery = useTripIntakeSchemasByEvent(tripEventId ?? "", {
    enabled: tripEventId !== null,
  });
  const {
    lines,
    buyer,
    discountCode,
    quote,
    quoteStatus,
    checkoutReview,
    setQuoteState,
    setCheckoutReview,
    intakeFormData,
    intakeUploadSessionId,
    setLineQuantity,
    setBuyer,
    // ORCH-1130 — the pay-full vs pay-over-time choice, pre-filled from the
    // public-page selection (seeded by the checkout index route param). The
    // Review & pay step is the last-chance editor.
    paymentPlanChoice,
    setPaymentPlanChoice,
    setLinePaymentPlanChoice,
    checkoutAttemptIdFor,
    resetCheckoutAttempt,
  } = useCart();
  const totals = useCartQuoteTotals();

  // #3859 — every eligible selected line owns its own plan choice on web.
  // Business-native deliberately stays on the legacy v1 scalar rail until its
  // preview + create pair are migrated together in a later reviewed slice.
  const planLines = React.useMemo(() => {
    if (trip === null) return [];
    return lines.flatMap((line) => {
      const tier = trip.pricingTiers.find(
        (candidate) => candidate.ticketTypeId === line.ticketTypeId,
      );
      if (tier?.installmentSchedule == null || line.quantity < 1) return [];
      const schedule = projectInstallmentSchedule(
        tier,
        new Date(),
        line.quantity,
      );
      return schedule === null ? [] : [{ line, tier, schedule }];
    });
  }, [lines, trip]);
  // Legacy Business-native still renders one scalar plan editor. Web never
  // uses this as money authority; each line below owns its own schedule.
  const projectedSchedule = planLines[0]?.schedule ?? null;
  const isPlanActive = planLines.length > 0;
  const planChoiceByTier = React.useMemo<
    Record<string, "full" | "installments">
  >(
    () =>
      Object.fromEntries(
        lines.map((line) => [
          line.ticketTypeId,
          Platform.OS === "web"
            ? (line.paymentPlanChoice ?? "full")
            : paymentPlanChoice,
        ]),
      ),
    [lines, paymentPlanChoice],
  );
  const installmentPlanLines = planLines.filter(
    ({ line }) => planChoiceByTier[line.ticketTypeId] === "installments",
  );
  const isUsingInstallments = installmentPlanLines.length > 0;
  const payLinkPlan = quote?.installmentChargeSchedule;
  const dueTodayCents = payLinkPlan !== undefined
    ? (quote?.buyerTotalCents ?? 0)
    : (quote?.dueTodayNetCents ?? 0);
  const futureInstallmentCount = payLinkPlan?.payments.length ??
    installmentPlanLines.reduce(
      (count, entry) => count + entry.schedule.installments.length,
      0,
    );

  // ORCH-0880 [Tr5 Traveler Intake Forms] — flatten per-tier intake answers
  // (keyed by ticket_type_id in CartContext) into the array shape expected
  // by ticket-checkout-create. Empty when buyer is purchasing tiers without
  // schemas OR when the intake step hasn't run yet.
  // issue #3351 — the same flattener the free rail uses (tripCheckoutStepOrder),
  // so the two rails can never disagree about the shape they send. It also
  // restricts the entries to tiers actually in the cart; for every cart the
  // intake screen can produce the output is identical to the inline loop this
  // replaces.
  const intakeFormDataArray: unknown[] = React.useMemo(
    () => tripIntakeFormDataArray(intakeFormData, lines),
    [intakeFormData, lines],
  );

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

  // ----- issue #2190 [paid-checkout-redirect]: one create per checkout -----
  // Mirrors #2188 on the event payment screen. Held in a ref (not state)
  // because nothing renders from it and it must be readable synchronously by
  // the very next Pay tap. Keyed by a fingerprint of what is actually being
  // bought, so it can only ever be replayed for the SAME cart.
  const providerHandoffRef = useRef<{
    fingerprint: string;
    handoff: TicketCheckoutProviderHandoff;
  } | null>(null);
  const cartFingerprint = JSON.stringify({
    eventId: tripEventId,
    email: buyer.email.trim().toLowerCase(),
    phone: buyer.phone.trim(),
    lines: lines.map((l) => [
      l.ticketTypeId,
      l.quantity,
      l.paymentPlanChoice ?? "full",
    ]),
    intakeFormData: intakeFormDataArray,
  });

  /**
   * Full-page navigation to the provider. Returns false ONLY where
   * `location.assign` genuinely does not exist (sandbox / test), so the caller
   * can tell "the guest is on their way" from "the guest is still here".
   */
  const assignLocation = useCallback((host: unknown, url: string): boolean => {
    const w = host as {
      location?: { assign?: (u: string) => void };
    };
    if (typeof w.location?.assign !== "function") return false;
    w.location.assign(url);
    return true;
  }, []);

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
          paymentPlanChoice: l.paymentPlanChoice ?? "full",
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

  // ----- Handlers -----
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (tripEventId !== null) {
      router.replace(`/checkout-trip/${tripEventId}/buyer` as never);
    }
  }, [router, tripEventId]);

  const handlePay = useCallback(
    async (acceptedQuote?: TicketQuote): Promise<void> => {
      if (processing) return;
      if (tripEventId === null) return;
      const activeQuote = acceptedQuote ?? quote;
      if (
        activeQuote === null ||
        (acceptedQuote === undefined && quoteStatus !== "ready")
      )
        return;
      // ORCH-1192 — fire `checkout_started` ONCE per attempt at the top of
      // handlePay (the `processing` early-return guards re-render/double-tap
      // double-fire), BEFORE the web hosted-redirect or native PaymentSheet opens
      // and BEFORE the purchase_completed success capture. value reflects the
      // server-computed all-in preview when available. capture() no-ops on web
      // (native postHogService is a web no-op) and when opted out / key absent.
      postHogService.capture("checkout_started", {
        event_id: tripEventId,
        offering_type: "trip",
        value: activeQuote.buyerTotalCents / 100,
        currency: activeQuote.currency,
        surface: "business_app",
      });
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
          // issue #2190 — ONE create per checkout, structurally (mirrors #2188).
          //
          // If this cart has already been handed a provider page, follow THAT
          // instead of asking the server for a second checkout. The server
          // refuses a duplicate create with 409 and it is right to: a second
          // create for a cart with a live provider attempt is never what the
          // guest wants. Re-following the URL we were already given is.
          const held = providerHandoffRef.current;
          if (held !== null && held.fingerprint === cartFingerprint) {
            if (assignLocation(globalThis, held.handoff.redirectUrl)) return;
            setProcessing(false);
            setPaymentError(PAID_CHECKOUT_NO_HANDOFF_MESSAGE);
            return;
          }
          // createTicketCheckout is event_type-agnostic — the RPC
          // biz_ticket_checkout_create_session branches on v_event.event_type='trip'.
          const checkout = await createTicketCheckout({
            eventId: tripEventId,
            brandId: trip?.brandId,
            buyer,
            lines,
            discountCode,
            quoteDigest: activeQuote.quoteDigest,
            quoteListDigest: activeQuote.quoteListDigest,
            surface,
            checkoutContractVersion: 2,
            checkoutAttemptId: checkoutAttemptIdFor({
              eventId: tripEventId,
              surface,
            }),
            // ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake answers
            // gathered by /checkout-trip/[tripEventId]/intake.tsx and stored
            // in CartContext. Edge fn gates HTTP 400 intake_form_required +
            // 409 intake_schema_stale; on stale, payment.tsx surfaces a Toast
            // + routes back to /intake (rare — schema rarely changes mid-pay).
            ...(intakeFormDataArray.length > 0
              ? { intakeFormData: intakeFormDataArray }
              : {}),
            ...(intakeFormDataArray.length > 0
              ? { intakeUploadSessionId }
              : {}),
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
          providerHandoffRef.current = {
            fingerprint: cartFingerprint,
            handoff,
          };

          // sessionStorage persist BEFORE redirect so a provider-side cancel
          // returns the buyer to a populated /payment screen and a success
          // returns to /confirm with the order summary intact.
          const storage = (
            globalThis as unknown as { sessionStorage?: Storage }
          ).sessionStorage;
          writeCheckoutResumePayload(storage, tripEventId, {
            checkoutSessionId: handoff.checkoutSessionId,
            buyerStatusToken: handoff.buyerStatusToken,
            lines,
            buyer,
          });
          // ORCH-0915 T-A02 pins `const w = globalThis` as the end of the
          // persist window: the resume payload is written, THEN the host is read.
          const w = globalThis;
          if (assignLocation(w, handoff.redirectUrl)) return;
          // Sandbox / test environments where location.assign is unavailable.
          setProcessing(false);
          setPaymentError(PAID_CHECKOUT_NO_HANDOFF_MESSAGE);
        } catch (error) {
          setProcessing(false);
          const review =
            await import("../../../src/services/ticketCheckoutReview").then(
              (module) =>
                module.ticketCheckoutReviewFromError(
                  error,
                  activeQuote.buyerTotalCents,
                ),
            );
          if (review !== null) {
            setCheckoutReview(review);
            setPaymentError(null);
            return;
          }
          // issue #2190 — NEVER render the raw thrown string. supabase-js reports
          // every handled refusal as "Edge Function returned a non-2xx status
          // code"; the mapper is total and turns each bounded case into a
          // sentence that also says whether money moved.
          const message = paidCheckoutErrorMessage(error);
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
          // #3859 boundary: Business-native preview + create remain paired on
          // v1, so line-v2 fields are intentionally stripped on this branch.
          lines: lines.map((line) => ({
            ticketTypeId: line.ticketTypeId,
            quantity: line.quantity,
          })),
          discountCode,
          quoteDigest: activeQuote.quoteDigest,
          quoteListDigest: activeQuote.quoteListDigest,
          buyer: {
            name: buyer.name,
            email: buyer.email,
            phone: buyer.phone,
            marketingOptIn: buyer.marketingOptIn === true,
          },
          // ORCH-1246 (Apple 4.9) — trip title so the Apple Pay sheet line item
          // shows the product, not the company. Fallback "Ticket" if trip unloaded.
          displayTitle: trip?.title ?? undefined,
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
          if (outcome.review !== undefined) {
            setCheckoutReview({
              ...outcome.review,
              previousTotalCents: activeQuote.buyerTotalCents,
            });
            setPaymentError(null);
            setProcessing(false);
            return;
          }
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
              setTimeout(
                () => reject(new Error("client_confirm_timeout")),
                3000,
              ),
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
    },
    [
      // issue #2190 — the redirect follower + the cart identity the held
      // provider hand-off is keyed by are both read inside this handler.
      assignLocation,
      cartFingerprint,
      buyer,
      discountCode,
      checkoutAttemptIdFor,
      trip,
      tripEventId,
      lines,
      intakeFormDataArray,
      intakeUploadSessionId,
      isPlanActive,
      nativeCheckout,
      paymentPlanChoice,
      processing,
      quote,
      quoteStatus,
      setCheckoutReview,
      router,
    ],
  );

  const displayAllIn =
    quote === null
      ? "Updating…"
      : formatQuoteMoney(quote.buyerTotalCents, quote.currency);

  // ORCH-1178 — the cart step ALWAYS shows now, so the "Review & pay" step is
  // the LAST step of the index → buyer → [intake] → payment funnel: "3 OF 3"
  // without an intake form, "4 OF 4" with one. (Supersedes the ORCH-1176
  // bookableTierCount-derived 2|3.) Reuse the SAME per-cart-line intake-presence
  // predicate buyer.tsx uses to route Continue → /intake, so the payment counter
  // and the funnel can never disagree.
  // issue #3351 — presence comes from the step-order owner, not from a second
  // hand-rolled predicate, and the total is `isFree`-aware. A free cart never
  // reaches this screen (the guard below returns a shell), so in practice this
  // reads the paid column: 4 with questions, 3 without.
  const intakeState = React.useMemo<TripIntakeState>(
    () =>
      tripIntakeState({
        lines,
        schemas: intakeSchemasQuery.data,
        committed: intakeFormData,
      }),
    [intakeSchemasQuery.data, lines, intakeFormData],
  );
  // issue #3351 P2-1 — the same fail-closed derivation every other pill uses,
  // so the denominator this screen shows is the one the buyer has been reading
  // since the cart step.
  const counterShape = tripCounterShape({
    cartIsFree: totals.isFree,
    cartIsEmpty: totals.isEmpty,
    tiers: trip === null ? undefined : trip.pricingTiers,
    intake: intakeState,
  });
  const totalSteps = tripFunnelTotalSteps(counterShape);
  const paymentStepIndex = tripPaymentStepIndex(counterShape);

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
          stepIndex={paymentStepIndex}
          totalSteps={totalSteps}
          title="Review & pay"
          onBack={handleBack}
        />
      </View>
    );
  }

  if (checkoutReview !== null) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={paymentStepIndex}
          totalSteps={totalSteps}
          title="Review changes"
          onBack={handleBack}
        />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <TicketCheckoutReviewPanel
            surface="web_trip"
            review={checkoutReview}
            accepting={processing}
            onBack={handleBack}
            onAccept={() => {
              const revisedQuote = checkoutReview.quote;
              if (revisedQuote === null) return;
              setQuoteState(revisedQuote, "ready");
              setCheckoutReview(null);
              resetCheckoutAttempt();
              void handlePay(revisedQuote);
            }}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={paymentStepIndex}
        totalSteps={totalSteps}
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
                  l.quantity <= 1 || processing ? styles.qtyBtnDisabled : null,
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
            </View>
          ))}
          <View style={styles.summaryDivider} />
          {quote !== null ? <TicketQuoteSummary quote={quote} compact /> : null}
        </GlassCard>

        {/* #3859 — web edits each eligible package independently. Native keeps
            its existing single v1 choice until preview + create migrate together. */}
        {Platform.OS === "web" ? (
          planLines.map(({ line, tier, schedule }) => (
            <View key={line.ticketTypeId}>
              <Text style={styles.summaryLabel}>{line.ticketName}</Text>
              <TripPaymentChoice
                schedule={schedule}
                fullPriceCents={schedule.fullPriceCents}
                currency={schedule.currency}
                depositPct={tier.installmentSchedule?.deposit_pct ?? 0}
                value={line.paymentPlanChoice ?? "full"}
                onChange={(choice) =>
                  setLinePaymentPlanChoice(line.ticketTypeId, choice)
                }
                showScheduleWhenInstallments={payLinkPlan === undefined}
              />
            </View>
          ))
        ) : planLines[0] !== undefined && projectedSchedule !== null ? (
          <TripPaymentChoice
            schedule={projectedSchedule}
            fullPriceCents={projectedSchedule.fullPriceCents}
            currency={projectedSchedule.currency}
            depositPct={planLines[0].tier.installmentSchedule?.deposit_pct ?? 0}
            value={paymentPlanChoice}
            onChange={setPaymentPlanChoice}
            showScheduleWhenInstallments={payLinkPlan === undefined}
          />
        ) : null}
        {isUsingInstallments && payLinkPlan !== undefined && projectedSchedule !== null ? (
          <InstallmentScheduleDisplay
            schedule={projectedSchedule}
            variant="buyer"
            isProjection={false}
            lockedChargeSchedule={payLinkPlan}
            depositChargeCents={quote?.buyerTotalCents}
            collection="auto_card_or_pay_link"
          />
        ) : null}

        {/* ORCH-1130 Fix #2 — the CartTaxPreview billing-address + "Calculate
            tax" form was REMOVED. Tax is venue-sourced server-side and the
            all-in (incl. tax) is shown above (WYSIWYP); the buyer types no
            address. */}

        <GlassCard variant="base" radius="lg" padding={spacing.md}>
          <Text style={styles.summaryLabel}>PAYMENT</Text>
          <Text style={styles.paymentCopy}>
            {"You'll be taken to our secure payment page to complete your purchase."}
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
        {/* #2331 — end of content: reopens the privacy bar. */}
        <PrivacyChoicesLink />
      </ScrollView>

      {/* Sticky bottom bar */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        {/* ORCH-0882 — pre-Stripe disclosure banner. Renders directly
            above the Pay button when cart has plan-active lines. Stripe's
            hosted checkout only displays the deposit amount, so this is
            the last in-product surface to set buyer expectations about
            the deposit + future-installment auto-charge schedule.
            Constitution #3 — no silent failures. */}
        {isPlanActive && isUsingInstallments ? (
          <View
            style={styles.planBanner}
            accessibilityRole="alert"
            accessibilityLabel={
              payLinkPlan !== undefined
                ? `Payment plan active. You'll be charged ${formatQuoteMoney(dueTodayCents, quote?.currency ?? totals.currency)} today. Your ${futureInstallmentCount} later ${futureInstallmentCount === 1 ? "payment is" : "payments are"} shown above. Pay by card to have them charged automatically, or we'll email you a secure link before each one.`
                : `Payment plan active. You will be charged ${formatQuoteMoney(dueTodayCents, quote?.currency ?? totals.currency)} today. Future scheduled payments will use the same card.`
            }
          >
            <Text style={styles.planBannerTitle}>Payment plan active</Text>
            <Text style={styles.planBannerBody}>
              You&rsquo;ll be charged{" "}
              <Text style={styles.planBannerStrong}>
                {formatQuoteMoney(
                  dueTodayCents,
                  quote?.currency ?? totals.currency,
                )}
              </Text>{" "}
              today. {payLinkPlan !== undefined ? (
                <>Your {futureInstallmentCount} later payment
                  {futureInstallmentCount === 1 ? " is" : "s are"} shown above.
                  Pay by card to have them charged automatically, or we&rsquo;ll
                  email you a secure link before each one.</>
              ) : (
                <>The {futureInstallmentCount} future scheduled payment
                  {futureInstallmentCount === 1 ? "" : "s"} will use the card you
                  enter next; each package&rsquo;s dates are shown above.</>
              )}
            </Text>
          </View>
        ) : null}
        {isPlanActive && !isUsingInstallments ? (
          <View
            style={[styles.planBanner, styles.fullPayBanner]}
            accessibilityRole="alert"
            accessibilityLabel={`Paid in full today. You will be charged ${displayAllIn} today and no future installment bills will be scheduled.`}
          >
            <Text style={styles.planBannerTitle}>Paid in full today</Text>
            <Text style={styles.planBannerBody}>
              You&rsquo;ll be charged{" "}
              <Text style={styles.planBannerStrong}>{displayAllIn}</Text> today.
              No future installment bills will be scheduled for this booking.
            </Text>
          </View>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{displayAllIn}</Text>
        </View>
        {/* ORCH-1130 Fix #1 — due-today (deposit) line in the sticky bar under
            pay-over-time; mirrors the order-summary box + buyer step. */}
        {isUsingInstallments ? (
          <View style={styles.dueTodayRow}>
            <Text style={styles.dueTodayLabel}>Total due today</Text>
            <Text style={styles.dueTodayValue}>
              {formatQuoteMoney(
                dueTodayCents,
                quote?.currency ?? totals.currency,
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
          // The per-line choice still announces
          // `Pay over time, ${projectedSchedule.depositCents} deposit`; this
          // cart CTA deliberately says "today" because mixed carts also include
          // full-pay lines in the aggregate amount.
          label={
            isUsingInstallments && projectedSchedule !== null
              ? `Pay ${formatQuoteMoney(dueTodayCents, quote?.currency ?? totals.currency)} today`
              : `Pay ${displayAllIn}`
          }
          onPress={() => void handlePay()}
          variant="primary"
          size="lg"
          fullWidth
          loading={processing}
          // ORCH-1130 Fix #2 — no "Calculate tax" gate; Pay is enabled
          // immediately (only blocked while a charge is in flight).
          disabled={processing || quoteStatus !== "ready" || quote === null}
          accessibilityLabel={
            isUsingInstallments && projectedSchedule !== null
              ? `Pay ${formatQuoteMoney(dueTodayCents, quote?.currency ?? totals.currency)} today with card`
              : `Pay ${displayAllIn} with card`
          }
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
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
  },
});
