import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import { loadGuestReservationManageView } from "../_shared/guestReservationManageView.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({}, 200);
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  const body = await req.json().catch(() => ({}));
  const reservationId = typeof body.reservationId === "string"
    ? body.reservationId
    : "";
  if (!reservationId) {
    return jsonResponse({ error: "reservation_id_required" }, 400);
  }
  const userId = await userIdFromAuthHeader(req);
  if (userId) {
    const { data, error } = await userClient(req).rpc(
      "pg_my_source_refund_summaries",
      {
        p_source_type: "venue_reservation",
        p_subject_ids: [reservationId],
      },
    );
    if (error) return jsonResponse({ error: "not_found" }, 404);
    return jsonResponse({
      refund: Array.isArray(data) ? data[0] ?? null : data,
    }, 200);
  }
  const token = typeof body.guestToken === "string" ? body.guestToken : "";
  if (!token) return jsonResponse({ error: "reservation_not_found" }, 404);
  const service = serviceClient();

  // #3392 — the manage link opens the BOOKING first. The refund summary RPC
  // raises `reservation_not_found` whenever no refund row exists, which used to
  // turn every free (and every not-yet-refunded paid) booking into "We couldn't
  // open this reservation." The token is checked against the booking's own
  // session hash; a mismatch stays a 404, identical to an unknown id.
  let view;
  try {
    view = await loadGuestReservationManageView(service, {
      reservationId,
      guestToken: token,
    });
  } catch {
    return jsonResponse({ error: "reservation_lookup_failed" }, 500);
  }
  if (view === null) {
    return jsonResponse({ error: "reservation_not_found" }, 404);
  }

  const { data, error } = await service.rpc(
    "pg_guest_venue_refund_summary",
    {
      p_reservation_id: reservationId,
      p_guest_token: token,
    },
  );
  let refund = data ?? null;
  if (error) {
    const message = error.message ?? "";
    // No refund row for this (already token-verified) booking: a normal state.
    if (!message.includes("reservation_not_found")) {
      return jsonResponse({ error: "refund_lookup_failed" }, 500);
    }
    refund = null;
  }
  return jsonResponse({ refund, reservation: view }, 200);
});
