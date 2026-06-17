// ===========================================================================
// META-ORCH-1148 sub-ORCH 2.2g — venue-reservation-cancel
// ---------------------------------------------------------------------------
// The signed-in consumer cancels their OWN venue reservation. Two responsibili-
// ties, in order:
//
//   1. CANCEL (authoritative, atomic) — call the SECURITY DEFINER
//      pg_cancel_my_reservation AS THE USER so auth.uid() inside it enforces
//      ownership, asserts the status transition is legal, flips the row to
//      cancelled_by_guest + writes the audit row, and returns refund_eligible
//      (= payment_status='paid' AND venue fee_refundable AND before the venue's
//      cancel cutoff). Cancellation itself is always allowed for a legal-state
//      (upcoming, confirmed/requested) reservation — the cutoff only governs the
//      REFUND, never the ability to cancel (Seth, 2026-06-17: "cancel any
//      upcoming; refund before cutoff, else forfeit").
//
//   2. REFUND (only when eligible) — execute the Stripe deposit refund on the
//      brand's CONNECTED account (direct-charge refund, mirrors refund-order
//      ORCH-0843), idempotent on the reservation id, then flip payment_status
//      to 'refunded'. A refund failure does NOT un-cancel the reservation (the
//      seat is already freed) — it returns cancelled:true, refunded:false with
//      the detail so the client can tell the guest the refund will be retried.
//
// Auth: the caller MUST be the owner — there is no anon path. verify_jwt=false
// in config.toml (the fn validates the JWT itself); the RPC's auth.uid() is the
// real gate.
//
// Contract:
//   POST { reservationId }
//   → 200 { status:"cancelled", cancelled:true, refundEligible, refunded,
//           refundAmountCents }
//   → 400 invalid input · 401 not authenticated · 404 unknown/not-owned
//   → 409 { error:"cancel_not_allowed" } when the state can't transition
//   → 200 { cancelled:true, refunded:false, refundError } refund-side failure
//          (the cancel SUCCEEDED; only the deposit refund is pending retry)
//   → 500 internal
// ===========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { stripeTicketRefund } from "../_shared/stripe.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

interface CancelledReservation {
  id: string;
  brand_id: string;
  status: string;
  payment_status: string;
  payment_intent_id: string | null;
  fee_cents: number | null;
  fee_currency: string | null;
}

serve(
  wrapEdgeHandler("venue-reservation-cancel", async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    // ── input ────────────────────────────────────────────────────────────
    let body: { reservationId?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    const reservationId =
      typeof body.reservationId === "string" ? body.reservationId.trim() : "";
    if (reservationId.length === 0) {
      return jsonResponse({ error: "reservation_id_required" }, 400);
    }

    // ── auth (owner only) ─────────────────────────────────────────────────
    const userId = await userIdFromAuthHeader(req);
    if (!userId) {
      return jsonResponse({ error: "not_authenticated" }, 401);
    }

    // ── 1. cancel (as the user → auth.uid() enforces ownership + transition) ─
    const asUser = userClient(req);
    const { data: cancelData, error: cancelErr } = await asUser.rpc(
      "pg_cancel_my_reservation",
      { p_reservation_id: reservationId },
    );
    if (cancelErr !== null) {
      const msg = cancelErr.message ?? "";
      if (msg.includes("not_authenticated")) {
        return jsonResponse({ error: "not_authenticated" }, 401);
      }
      if (msg.includes("reservation_not_found")) {
        return jsonResponse({ error: "reservation_not_found" }, 404);
      }
      if (msg.includes("cancel_not_allowed")) {
        return jsonResponse(
          { error: "cancel_not_allowed", detail: msg },
          409,
        );
      }
      console.error("[venue-reservation-cancel] cancel RPC failed", cancelErr);
      return jsonResponse({ error: "cancel_failed", detail: msg }, 500);
    }

    const row = (Array.isArray(cancelData) ? cancelData[0] : cancelData) as
      | { reservation?: CancelledReservation | null; refund_eligible?: boolean }
      | null;
    const reservation = row?.reservation ?? null;
    const refundEligible = row?.refund_eligible === true;
    if (!reservation) {
      console.error("[venue-reservation-cancel] RPC returned no reservation");
      return jsonResponse({ error: "cancel_failed" }, 500);
    }

    const feeCents = Number(reservation.fee_cents ?? 0);
    const paymentIntentId = reservation.payment_intent_id ?? null;

    // ── 2. refund (only when eligible + a real charge exists) ─────────────
    if (!refundEligible || feeCents <= 0 || !paymentIntentId) {
      return jsonResponse({
        status: "cancelled",
        cancelled: true,
        refundEligible,
        refunded: false,
        refundAmountCents: 0,
      });
    }

    // Resolve the connected account that owns the PI (direct-charge refund).
    const svc = serviceClient();
    const { data: brandRow, error: brandErr } = await svc
      .from("brands")
      .select("stripe_connect_id")
      .eq("id", reservation.brand_id)
      .maybeSingle();
    const connectedAccountId =
      typeof brandRow?.stripe_connect_id === "string" &&
      brandRow.stripe_connect_id.length > 0
        ? brandRow.stripe_connect_id
        : null;
    if (brandErr || !connectedAccountId) {
      console.error(
        "[venue-reservation-cancel] connected-account lookup failed",
        brandErr,
      );
      // Cancelled, but we can't refund right now — surface for retry.
      return jsonResponse(
        {
          status: "cancelled",
          cancelled: true,
          refundEligible: true,
          refunded: false,
          refundAmountCents: 0,
          refundError: "missing_connected_account",
        },
        200,
      );
    }

    try {
      const stripe = stripeTicketRefund();
      // @ts-ignore — Stripe SDK namespace is runtime-provided in Deno.
      const created = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          amount: feeCents,
          reason: "requested_by_customer",
          refund_application_fee: true,
          metadata: {
            mingla_reservation_id: reservation.id,
            mingla_kind: "venue_reservation_deposit",
          },
        },
        {
          idempotencyKey: `venue_resv_refund:${reservation.id}`,
          stripeAccount: connectedAccountId,
        },
      );
      const status = String(created.status ?? "");
      if (status === "failed" || status === "canceled") {
        // Cancellation already succeeded (seat freed); only the money retry is
        // pending → 200 so the client doesn't read a freed-seat cancel as a hard
        // failure. refundError tells the guest the refund will follow.
        return jsonResponse(
          {
            status: "cancelled",
            cancelled: true,
            refundEligible: true,
            refunded: false,
            refundAmountCents: 0,
            refundError: `stripe refund status=${status}`,
          },
          200,
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[venue-reservation-cancel] refunds.create failed", detail);
      return jsonResponse(
        {
          status: "cancelled",
          cancelled: true,
          refundEligible: true,
          refunded: false,
          refundAmountCents: 0,
          refundError: detail,
        },
        200,
      );
    }

    // Refund succeeded → reflect it on the row (service role; the guest already
    // cancelled, this is the money-state bookkeeping).
    const { error: updErr } = await svc
      .from("reservations")
      .update({ payment_status: "refunded", updated_at: new Date().toISOString() })
      .eq("id", reservation.id);
    if (updErr) {
      // The money moved; a stale payment_status is non-fatal (webhook/retry can
      // reconcile). Log + still report the refund as done.
      console.error(
        "[venue-reservation-cancel] payment_status update failed (refund DID succeed)",
        updErr,
      );
    }

    return jsonResponse({
      status: "cancelled",
      cancelled: true,
      refundEligible: true,
      refunded: true,
      refundAmountCents: feeCents,
    });
  }),
);
