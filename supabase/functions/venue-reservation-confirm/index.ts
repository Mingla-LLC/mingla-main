// ===========================================================================
// META-ORCH-1148 sub-ORCH 2.2a — venue-reservation-confirm
// ---------------------------------------------------------------------------
// The synchronous finalize of a FEE reservation, mirroring ticket-checkout-
// confirm (ORCH-0852). The buyer NEVER depends on Stripe webhook timing to know
// their reservation exists. Idempotent + concurrency-safe (the DB advisory lock
// + the session 'completed' flip serialize a confirm-vs-confirm double-fire).
//
// THE ATOMICITY CONTRACT (I-PROPOSED-1148-CHARGE-AND-RESERVATION-ATOMIC):
//   The reservations row is minted HERE, on a VERIFIED successful charge, via
//   the same pg_create_guest_reservation writer (payment_status='paid'). No fee
//   reservation is ever 'confirmed' without a verified charge; the session row
//   (written by venue-reservation-create BEFORE the charge) is the durable
//   "charge in flight" record, so there is never a charge without a record to
//   flip. If the slot was taken between create and confirm, the writer's
//   re-validation rejects with slot_unavailable and the charge is REFUNDED
//   (reuse refund-order — wired in 2.2b/2.2c; the seam is defined here).
//
// Contract:
//   POST { reservationDraftId, buyerStatusToken }
//   → 200 { status: "completed", reservationId, ... } on success
//   → 200 { status: "pending", reservationId: null } when the PI hasn't yet
//     succeeded (client falls through to a realtime/poll)
//   → 200 { status: "failed", reservationId: null } on a terminal failure
//   → 400 invalid input · 403 token mismatch · 404 unknown session
//   → 409 { error: "slot_unavailable" } when the slot was taken (refund seam)
//   → 502 stripe_unavailable · 500 internal
//
// Auth: anon-tolerant. verify_jwt = false (config.toml registration on deploy).
// Access gated by the buyerStatusToken (sha256-hash-matched) the client stashed
// at create time — NOT a Supabase JWT.
// ===========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import {
  jsonResponse,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

interface SessionRow {
  id: string;
  brand_id: string;
  reserved_for: string;
  party_size: number;
  buyer_name: string;
  buyer_email: string;
  buyer_phone_e164: string;
  occasion: string | null;
  guest_notes: string | null;
  amount_cents: number;
  currency: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_account_id: string | null;
  paystack_reference: string | null;
  created_via: "app" | "web";
  consumer_user_id: string | null;
  guest_cancel_token: string | null;
  buyer_status_token_hash: string | null;
  status: "pending" | "completed" | "expired" | "failed";
  reservation_id: string | null;
}

serve(wrapEdgeHandler("venue-reservation-confirm", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const sessionId = typeof body.reservationDraftId === "string"
    ? body.reservationDraftId
    : "";
  const buyerStatusToken = typeof body.buyerStatusToken === "string"
    ? body.buyerStatusToken
    : "";
  if (!sessionId || !buyerStatusToken) {
    return jsonResponse({ error: "invalid_input" }, 400);
  }

  const supabase = serviceClient();
  const { data: sessionRow, error: sessionErr } = await supabase
    .from("reservation_checkout_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr !== null) {
    return jsonResponse({ error: "session_lookup_failed", detail: sessionErr.message }, 500);
  }
  if (sessionRow === null) {
    return jsonResponse({ error: "session_not_found" }, 404);
  }
  const session = sessionRow as SessionRow;

  // Ownership: the plaintext token must hash-match the stored hash.
  const presentedHash = await sha256Hex(buyerStatusToken);
  if (session.buyer_status_token_hash !== presentedHash) {
    return jsonResponse({ error: "buyer_status_token_mismatch" }, 403);
  }

  // Fast-path: already completed (a prior confirm or webhook won the race).
  if (session.status === "completed" && session.reservation_id) {
    return jsonResponse({
      status: "completed",
      reservationId: session.reservation_id,
      reservedForUtc: session.reserved_for,
      partySize: session.party_size,
      brandId: session.brand_id,
      guestCancelToken: session.guest_cancel_token ?? undefined,
      receiptUrl: `/o/${session.reservation_id}`,
    });
  }
  if (session.status === "failed" || session.status === "expired") {
    return jsonResponse({ status: "failed", reservationId: null });
  }

  // Slow-path: verify the charge succeeded on the connected account.
  // (Paystack confirm is verified by the paystack-webhook → a future fn; for
  // 2.2a the Stripe verify is the proven seam. NG fee venues confirm via the
  // webhook arm — flagged in the report.)
  if (!session.stripe_payment_intent_id && session.stripe_checkout_session_id &&
      session.stripe_account_id) {
    // hosted Checkout (web): resolve the PI from the checkout session first.
    try {
      const stripe = stripeTicketCheckout();
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      const cs = await stripe.checkout.sessions.retrieve(
        session.stripe_checkout_session_id,
        {},
        { stripeAccount: session.stripe_account_id },
      );
      const piId = typeof cs.payment_intent === "string"
        ? cs.payment_intent
        : (cs.payment_intent as { id?: string } | null)?.id ?? null;
      if (piId) {
        await supabase
          .from("reservation_checkout_sessions")
          .update({ stripe_payment_intent_id: piId, updated_at: new Date().toISOString() })
          .eq("id", sessionId);
        session.stripe_payment_intent_id = piId;
      }
    } catch (err) {
      console.error("[venue-reservation-confirm] checkout session retrieve failed", err);
      return jsonResponse({ error: "stripe_unavailable" }, 502);
    }
  }

  if (!session.stripe_payment_intent_id || !session.stripe_account_id) {
    return jsonResponse({ status: "pending", reservationId: null });
  }

  let piStatus = "";
  try {
    const stripe = stripeTicketCheckout();
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    const pi = await stripe.paymentIntents.retrieve(
      session.stripe_payment_intent_id,
      {},
      { stripeAccount: session.stripe_account_id },
    );
    piStatus = String(pi.status ?? "");
  } catch (err) {
    console.error("[venue-reservation-confirm] PI retrieve failed", err);
    return jsonResponse({ error: "stripe_unavailable" }, 502);
  }

  if (piStatus === "processing" || piStatus === "requires_action" ||
      piStatus === "requires_confirmation" || piStatus === "requires_payment_method") {
    return jsonResponse({ status: "pending", reservationId: null });
  }
  if (piStatus !== "succeeded") {
    await supabase
      .from("reservation_checkout_sessions")
      .update({ status: "failed", failure_reason: `pi_status_${piStatus}`, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    return jsonResponse({ status: "failed", reservationId: null });
  }

  // Charge SUCCEEDED → finalize the reservation IDEMPOTENTLY (DEFECT-1 fix). The
  // pg_finalize_guest_reservation RPC locks the session row FOR UPDATE,
  // early-returns the existing reservation if this session/PI was already
  // finalized (a double-fired / replayed / flip-failure-retried confirm yields
  // exactly ONE reservation per charge — never two), and otherwise mints via the
  // same atomic writer (advisory-lock double-book guard + slot re-validation +
  // capacity/deposit enforcement) AND links the session in the SAME txn (the
  // session flip is no longer fire-and-forget). Mirrors biz_ticket_checkout_
  // finalize's FOR-UPDATE + return-existing structure.
  // If the slot was taken between create and confirm, the writer rejects with
  // slot_unavailable → the charge must be REFUNDED (reuse refund-order — the
  // seam; wired in 2.2b/2.2c).
  const { data: finalized, error: finalizeErr } = await supabase.rpc(
    "pg_finalize_guest_reservation",
    {
      p_session_id: sessionId,
      p_payment_intent_id: session.stripe_payment_intent_id,
    },
  );
  if (finalizeErr !== null || !finalized) {
    const msg = (finalizeErr as { message?: string } | null)?.message ?? "";
    if (msg.includes("slot_unavailable")) {
      // The seat was taken after we charged. Mark the session for refund. The
      // actual refund executes via refund-order (reuse) — wired in 2.2b/2.2c.
      await supabase
        .from("reservation_checkout_sessions")
        .update({ status: "failed", failure_reason: "slot_unavailable_after_charge_refund_due", updated_at: new Date().toISOString() })
        .eq("id", sessionId);
      return jsonResponse({ error: "slot_unavailable", refundDue: true }, 409);
    }
    console.error("[venue-reservation-confirm] reservation finalize failed", finalizeErr);
    return jsonResponse({ error: "reservation_create_failed", detail: msg }, 409);
  }
  // The RPC returns TABLE(reservation reservations, session_id uuid); PostgREST
  // surfaces it as a one-row array with a nested `reservation` composite.
  const finalRow = (Array.isArray(finalized) ? finalized[0] : finalized) as
    | { reservation?: Record<string, unknown> | null }
    | null;
  const reservationRow = finalRow?.reservation ?? null;
  const reservationId = String(reservationRow?.id ?? "");
  if (!reservationId) {
    console.error("[venue-reservation-confirm] finalize returned no reservation id", finalized);
    return jsonResponse({ error: "reservation_create_failed" }, 409);
  }

  return jsonResponse({
    status: "completed",
    reservationId,
    reservedForUtc: session.reserved_for,
    partySize: session.party_size,
    brandId: session.brand_id,
    guestCancelToken: session.guest_cancel_token ?? undefined,
    receiptUrl: `/o/${reservationId}`,
  });
}, {
  onError: (_err, requestId) =>
    jsonResponse({ error: "internal_error", requestId }, 500),
}));
