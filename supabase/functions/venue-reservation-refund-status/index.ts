import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

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
  const { data, error } = await serviceClient().rpc(
    "pg_guest_venue_refund_summary",
    {
      p_reservation_id: reservationId,
      p_guest_token: token,
    },
  );
  if (error) return jsonResponse({ error: "reservation_not_found" }, 404);
  return jsonResponse({ refund: data }, 200);
});
