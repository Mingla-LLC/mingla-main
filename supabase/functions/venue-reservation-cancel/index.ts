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
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  runSourceRefundOperation,
  type SourceRefundOperation,
} from "../_shared/sourceRefundControlPlane.ts";

serve(
  wrapEdgeHandler("venue-reservation-cancel", async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    // ── input ────────────────────────────────────────────────────────────
    let body: { reservationId?: unknown; guestToken?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    const reservationId = typeof body.reservationId === "string"
      ? body.reservationId.trim()
      : "";
    if (reservationId.length === 0) {
      return jsonResponse({ error: "reservation_id_required" }, 400);
    }

    // ── auth (owner only) ─────────────────────────────────────────────────
    const userId = await userIdFromAuthHeader(req);
    const guestToken = typeof body.guestToken === "string"
      ? body.guestToken.trim()
      : "";
    if (!userId && !guestToken) {
      return jsonResponse({ error: "not_authenticated" }, 401);
    }

    // #1221: cancellation + the exact refund obligation commit atomically in
    // the database. Provider acceptance is best-effort; the returned state is
    // always the durable control-plane truth, never an optimistic "refunded".
    const prepared = userId
      ? await userClient(req).rpc(
        "pg_prepare_my_venue_cancellation_refund",
        { p_reservation_id: reservationId },
      )
      : await serviceClient().rpc(
        "pg_prepare_guest_venue_cancellation_refund",
        { p_reservation_id: reservationId, p_guest_token: guestToken },
      );
    if (prepared.error) {
      const message = prepared.error.message ?? "";
      if (message.includes("reservation_not_found")) {
        return jsonResponse({ error: "reservation_not_found" }, 404);
      }
      if (message.includes("cancel_not_allowed")) {
        return jsonResponse({ error: "cancel_not_allowed" }, 409);
      }
      console.error("venue_refund_prepare_failed", {
        reservation_id: reservationId,
      });
      return jsonResponse({ error: "cancel_failed" }, 500);
    }
    const durable = prepared.data as {
      cancelled?: boolean;
      refund?: { refund_id?: string; buyer_state?: string } | null;
    };
    if (!durable.refund?.refund_id) {
      return jsonResponse({
        status: "cancelled",
        cancelled: true,
        refundEligible: false,
        refund: null,
      }, 200);
    }
    const svc1221 = serviceClient();
    const { data: operation } = await svc1221.from("source_refunds")
      .select("*").eq("id", durable.refund.refund_id).maybeSingle();
    if (operation) {
      try {
        await runSourceRefundOperation(
          svc1221,
          operation as SourceRefundOperation,
        );
      } catch (caught) {
        console.warn("venue_refund_runner_deferred", {
          refund_id: durable.refund.refund_id,
          error_code: caught instanceof Error
            ? caught.message.split(":")[0]
            : "runner_failed",
        });
      }
    }
    const { data: current } = await svc1221.rpc(
      "pg_my_source_refund_summaries",
      {
        p_source_type: "venue_reservation",
        p_subject_ids: [reservationId],
      },
    );
    const summary = Array.isArray(current) ? current[0] : durable.refund;
    const state = summary?.buyer_state ?? durable.refund.buyer_state ??
      "queued";
    return jsonResponse({
      status: "cancelled",
      cancelled: true,
      refundEligible: true,
      refund: summary,
    }, state === "processed" ? 200 : 202);
  }),
);
