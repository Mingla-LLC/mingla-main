/**
 * ticket-checkout-confirm — ORCH-0852 bulletproof checkout-confirmation edge.
 *
 * Purpose: own the buyer's checkout success path synchronously, so the client
 * does NOT depend on Stripe webhook arrival timing to know whether an order
 * exists. Resolves the architectural race documented in:
 *   Mingla_Artifacts/reports/INVESTIGATION_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md
 * and specified in:
 *   Mingla_Artifacts/specs/SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md §M-SERVER.
 *
 * Contract:
 *   POST { checkoutSessionId, buyerStatusToken }
 *   → 200 { checkoutSessionId, status, order } on success (order may be null
 *     when status === "pending" — Stripe PI hasn't yet succeeded, rare).
 *   → 400 invalid input
 *   → 403 buyer status token mismatch
 *   → 404 unknown session
 *   → 502 stripe_unavailable when Stripe API throws
 *   → 500 unexpected internal error
 *
 * Flow:
 *   1. Validate inputs + verify buyerStatusToken hash matches session row.
 *   2. Fast-path: if session.order_id is already populated (webhook already
 *      won the race), fetch order + tickets + tax and return immediately.
 *   3. Slow-path: read session.stripe_payment_intent_id + stripe_account_id.
 *      Call stripe.paymentIntents.retrieve(piId, { stripeAccount: acctId }).
 *      - succeeded → call biz_ticket_checkout_finalize RPC (idempotent via
 *        FOR UPDATE + early-return-if-order-exists in the RPC body). Re-read
 *        the session/order and return the same shape as the fast-path.
 *      - processing → return { status: "pending", order: null }. Client falls
 *        through to Realtime subscription.
 *      - other (canceled/failed/etc) → return { status: "failed", order: null }.
 *   4. On any Stripe API throw, return 502. Client falls through to Realtime.
 *
 * Idempotency: safe to call any number of times concurrently against the
 * same session. The finalize RPC uses FOR UPDATE on ticket_checkout_sessions
 * and returns the existing order whenever session.order_id is non-null. The
 * concurrent webhook calls the same RPC and the database serializes them.
 *
 * Auth: anon-tolerant. Access gated by the buyerStatusToken stashed in the
 * client's sessionStorage at checkout-create time (sha256-hash-matched here).
 * verify_jwt: false (see supabase/config.toml registration).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import {
  jsonResponse,
  qrTokenPepper,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";
import { qrPayloadToDataUrl } from "../_shared/ticketQrImage.ts";

interface ConfirmRequest {
  checkoutSessionId: string;
  buyerStatusToken: string;
}

type FinalizeStatus = "paid" | "pending" | "failed" | "expired";

interface TicketRow {
  id: string;
  ticket_type_id: string;
  qr_code: string;
  status: string;
  ticket_types: { name?: string } | null;
}

type StripePaymentIntentLike = {
  id?: string;
  status?: string;
  payment_method_types?: string[];
  charges?: { data?: Array<{ id?: string }> };
  latest_charge?: string | { id?: string } | null;
  customer?: unknown;
  payment_method?: unknown;
  metadata?: Record<string, unknown>;
};

type StripeCheckoutSessionLike = {
  id?: string;
  status?: string;
  payment_status?: string;
  payment_intent?: string | StripePaymentIntentLike | null;
};

function paymentIntentIdFromCheckoutSession(
  checkoutSession: StripeCheckoutSessionLike,
): string | null {
  const ref = checkoutSession.payment_intent;
  if (typeof ref === "string" && ref.length > 0) return ref;
  if (
    ref !== null &&
    typeof ref === "object" &&
    typeof ref.id === "string" &&
    ref.id.length > 0
  ) {
    return ref.id;
  }
  return null;
}

function expandedPaymentIntentFromCheckoutSession(
  checkoutSession: StripeCheckoutSessionLike,
): StripePaymentIntentLike | null {
  const ref = checkoutSession.payment_intent;
  if (ref !== null && typeof ref === "object") return ref;
  return null;
}

function latestChargeId(paymentIntent: StripePaymentIntentLike): string | null {
  const firstCharge = paymentIntent.charges?.data?.[0]?.id;
  if (typeof firstCharge === "string" && firstCharge.length > 0) {
    return firstCharge;
  }
  const latestCharge = paymentIntent.latest_charge;
  if (typeof latestCharge === "string" && latestCharge.length > 0) {
    return latestCharge;
  }
  if (
    latestCharge !== null &&
    typeof latestCharge === "object" &&
    typeof latestCharge.id === "string" &&
    latestCharge.id.length > 0
  ) {
    return latestCharge.id;
  }
  return null;
}

async function fetchOrderPayload(
  supabase: ReturnType<typeof serviceClient>,
  session: {
    id: string;
    order_id: string;
    event_id: string;
    total_cents: number | null;
    currency: string | null;
  },
): Promise<
  {
    orderId: string;
    checkoutSessionId: string;
    eventId: string;
    paymentStatus: "paid";
    totalCents: number;
    currency: string;
    taxAmountCents: number;
    tickets: Array<{
      ticketId: string;
      ticketTypeId: string;
      ticketName: string;
      qrPayload: string;
      /** ORCH-0932 — server-rendered PNG data URI; carousel uses this on web. */
      qrImageDataUrl: string;
      status: string;
    }>;
    notificationStatus: "queued";
  } | null
> {
  const { data: tickets, error: ticketError } = await supabase
    .from("tickets")
    .select(`
      id,
      ticket_type_id,
      qr_code,
      status,
      ticket_types(name)
    `)
    .eq("order_id", session.order_id)
    .order("created_at", { ascending: true });
  if (ticketError) {
    console.error(
      "[ticket-checkout-confirm] ticket lookup failed",
      ticketError.message,
    );
    return null;
  }

  const { data: orderRow } = await supabase
    .from("orders")
    .select("tax_amount_cents")
    .eq("id", session.order_id)
    .maybeSingle();
  const taxAmountCents = Number(orderRow?.tax_amount_cents ?? 0);

  return {
    orderId: session.order_id,
    checkoutSessionId: session.id,
    eventId: session.event_id,
    paymentStatus: "paid",
    totalCents: Number(session.total_cents ?? 0),
    currency: String(session.currency ?? "USD").trim(),
    taxAmountCents,
    tickets: await Promise.all((tickets ?? []).map(async (ticket) => {
      const row = ticket as unknown as TicketRow;
      return {
        ticketId: row.id,
        ticketTypeId: row.ticket_type_id,
        ticketName: row.ticket_types?.name ?? "Ticket",
        qrPayload: row.qr_code,
        qrImageDataUrl: await qrPayloadToDataUrl(row.qr_code),
        status: row.status,
      };
    })),
    notificationStatus: "queued",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: ConfirmRequest;
  try {
    body = (await req.json()) as ConfirmRequest;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const checkoutSessionId = typeof body.checkoutSessionId === "string"
    ? body.checkoutSessionId
    : "";
  const buyerStatusToken = typeof body.buyerStatusToken === "string"
    ? body.buyerStatusToken
    : "";
  if (checkoutSessionId.length === 0) {
    return jsonResponse({ error: "checkout_session_required" }, 400);
  }
  if (buyerStatusToken.length === 0) {
    return jsonResponse({ error: "buyer_status_token_required" }, 401);
  }

  const supabase = serviceClient();

  const { data: session, error: lookupError } = await supabase
    .from("ticket_checkout_sessions")
    .select(
      "id, status, order_id, event_id, total_cents, currency, buyer_status_token_hash, stripe_checkout_session_id, stripe_payment_intent_id, stripe_account_id",
    )
    .eq("id", checkoutSessionId)
    .maybeSingle();
  if (lookupError) {
    return jsonResponse(
      { error: "session_lookup_failed", detail: lookupError.message },
      500,
    );
  }
  if (!session) {
    return jsonResponse({ error: "checkout_session_not_found" }, 404);
  }
  const expectedHash = await sha256Hex(buyerStatusToken);
  if (session.buyer_status_token_hash !== expectedHash) {
    return jsonResponse({ error: "buyer_status_token_invalid" }, 403);
  }

  // ---- Fast-path: order already finalized (webhook beat us). ----
  if (session.order_id) {
    const order = await fetchOrderPayload(supabase, {
      id: session.id,
      order_id: session.order_id,
      event_id: session.event_id,
      total_cents: session.total_cents,
      currency: session.currency,
    });
    return jsonResponse({
      checkoutSessionId: session.id,
      status: "paid" as FinalizeStatus,
      order,
    });
  }

  // ---- Slow-path: verify Stripe PI status directly, then finalize. ----
  let paymentIntentId = typeof session.stripe_payment_intent_id === "string" &&
      session.stripe_payment_intent_id.length > 0
    ? session.stripe_payment_intent_id
    : null;
  const stripeAccountId = session.stripe_account_id;
  let paymentIntentFromCheckoutSession: StripePaymentIntentLike | null = null;

  if (
    paymentIntentId === null &&
    typeof stripeAccountId === "string" &&
    stripeAccountId.length > 0 &&
    typeof session.stripe_checkout_session_id === "string" &&
    session.stripe_checkout_session_id.length > 0
  ) {
    try {
      const stripe = stripeTicketCheckout();
      const checkoutSession = await stripe.checkout.sessions.retrieve(
        session.stripe_checkout_session_id,
        { expand: ["payment_intent"] },
        { stripeAccount: stripeAccountId },
      ) as StripeCheckoutSessionLike;

      if (checkoutSession.status === "expired") {
        return jsonResponse({
          checkoutSessionId: session.id,
          status: "expired" as FinalizeStatus,
          order: null,
        });
      }

      if (
        checkoutSession.payment_status !== "paid" &&
        checkoutSession.status !== "complete"
      ) {
        return jsonResponse({
          checkoutSessionId: session.id,
          status: "pending" as FinalizeStatus,
          order: null,
        });
      }

      paymentIntentId = paymentIntentIdFromCheckoutSession(checkoutSession);
      paymentIntentFromCheckoutSession =
        expandedPaymentIntentFromCheckoutSession(checkoutSession);

      if (paymentIntentId !== null) {
        const { error: persistPaymentIntentError } = await supabase
          .from("ticket_checkout_sessions")
          .update({
            stripe_payment_intent_id: paymentIntentId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.id)
          .is("stripe_payment_intent_id", null);
        if (persistPaymentIntentError) {
          console.warn(
            "[ticket-checkout-confirm] checkout session PI persist failed",
            session.id,
            persistPaymentIntentError.message,
          );
        }
      }
    } catch (err) {
      console.error(
        "[ticket-checkout-confirm] checkout session retrieve failed",
        session.stripe_checkout_session_id,
        err instanceof Error ? err.message : String(err),
      );
      return jsonResponse({ error: "stripe_unavailable" }, 502);
    }
  }

  if (!paymentIntentId || !stripeAccountId) {
    // No PI tied to the session yet — checkout was created but the buyer
    // never returned from Stripe (or Stripe Checkout Session never minted a
    // PI for them). Surface pending; client subscribes to Realtime.
    return jsonResponse({
      checkoutSessionId: session.id,
      status: "pending" as FinalizeStatus,
      order: null,
    });
  }

  let paymentIntent: StripePaymentIntentLike;
  try {
    if (paymentIntentFromCheckoutSession !== null) {
      paymentIntent = paymentIntentFromCheckoutSession;
    } else {
      const stripe = stripeTicketCheckout();
      // orch-strict-grep-allow stripe-no-idempotency-key — paymentIntents.retrieve
      // is a read-only Stripe API call; idempotency keys are scoped to mutating
      // create/update operations per Stripe API conventions. Retrieve is safe to
      // retry without a key since it returns the same resource verbatim.
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        stripeAccount: stripeAccountId,
      }) as StripePaymentIntentLike;
    }
  } catch (err) {
    console.error(
      "[ticket-checkout-confirm] stripe retrieve failed",
      paymentIntentId,
      err instanceof Error ? err.message : String(err),
    );
    return jsonResponse({ error: "stripe_unavailable" }, 502);
  }

  const piStatus = typeof paymentIntent.status === "string"
    ? paymentIntent.status
    : "";
  if (piStatus === "succeeded") {
    const paymentMethodType =
      Array.isArray(paymentIntent.payment_method_types) &&
        typeof paymentIntent.payment_method_types[0] === "string"
        ? paymentIntent.payment_method_types[0]
        : null;
    const latestCharge = latestChargeId(paymentIntent);

    let pepper: string;
    try {
      pepper = qrTokenPepper();
    } catch (err) {
      console.error(
        "[ticket-checkout-confirm] qr_token_pepper unavailable",
        err instanceof Error ? err.message : String(err),
      );
      return jsonResponse({ error: "qr_token_pepper_missing" }, 500);
    }

    // ORCH-0924 ROLLBACK of ORCH-0921 [Trip payment-plan finalize compare-and-correct]:
    // Reverted to the pre-ORCH-0921 5-param shape because the strict customer/PM
    // requirement on installment-plan finalize was producing HTTP 500s when
    // paymentIntent.customer/payment_method came back null from Stripe (which
    // happens for the Checkout Session payment-plan flow because
    // ticket-checkout-create only sets customer_email + setup_future_usage —
    // Stripe creates a Customer but doesn't always attach it to the PI's
    // top-level .customer field). The 500 prevented order creation entirely,
    // which is worse than the silent installment-drop ORCH-0921 was fixing.
    // Real fix is ORCH-0925 [ticket-checkout-create must attach Stripe Customer
    // to plan PIs explicitly] — once it ships, ORCH-0921 can re-ship.
    // orch-strict-grep-allow finalize-no-plan-root — ORCH-0924 rollback of ORCH-0921; real fix is ORCH-0925
    const { error: finalizeError } = await supabase.rpc(
      "biz_ticket_checkout_finalize",
      {
        p_checkout_session_id: session.id,
        p_stripe_payment_intent_id: paymentIntentId,
        p_stripe_charge_id: latestCharge,
        p_stripe_payment_method_type: paymentMethodType,
        p_qr_token_pepper: pepper,
      },
    );
    if (finalizeError) {
      console.error(
        "[ticket-checkout-confirm] finalize RPC failed",
        session.id,
        finalizeError.message,
      );
      return jsonResponse(
        { error: "finalize_failed", detail: finalizeError.message },
        500,
      );
    }

    // ORCH-0808 parity: notification dispatch is fired by the webhook path
    // (see stripeWebhookRouter handleTicketCheckoutPaymentIntent). We do
    // NOT fire it again here — the order-notifications table has unique
    // idempotency keys per (order_id, channel) so a second dispatch would
    // be a no-op at the DB level, but skipping avoids an unnecessary HTTP
    // call from this synchronous path. The webhook is still in flight and
    // will handle notifications when it lands.

    // Re-fetch the session to read the just-populated order_id, then build
    // the order payload from the canonical tables.
    const { data: refreshedSession } = await supabase
      .from("ticket_checkout_sessions")
      .select("id, order_id, event_id, total_cents, currency")
      .eq("id", session.id)
      .maybeSingle();
    if (!refreshedSession || !refreshedSession.order_id) {
      // Finalize succeeded but order_id still null — shouldn't happen given
      // the RPC's UPDATE block. Surface pending; client will pick up via
      // Realtime.
      return jsonResponse({
        checkoutSessionId: session.id,
        status: "pending" as FinalizeStatus,
        order: null,
      });
    }
    const order = await fetchOrderPayload(supabase, {
      id: refreshedSession.id,
      order_id: refreshedSession.order_id,
      event_id: refreshedSession.event_id,
      total_cents: refreshedSession.total_cents,
      currency: refreshedSession.currency,
    });
    return jsonResponse({
      checkoutSessionId: session.id,
      status: "paid" as FinalizeStatus,
      order,
    });
  }

  if (piStatus === "processing" || piStatus === "requires_action") {
    return jsonResponse({
      checkoutSessionId: session.id,
      status: "pending" as FinalizeStatus,
      order: null,
    });
  }

  // canceled / requires_payment_method / requires_confirmation / etc.
  return jsonResponse({
    checkoutSessionId: session.id,
    status: "failed" as FinalizeStatus,
    order: null,
  });
});
