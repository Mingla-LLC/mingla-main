// ===========================================================================
// Issue #1791 (SPEC #1788 P-25, P-29, P-52; DESIGN D-7a) — the guest's way out.
//
// D-7a, in full: "the guest always has a way out while the order is unserved,
// and the system never decides for them."
//
//   * UNACKNOWLEDGED -> `cancel`. Instant, automatic, FULL refund including the
//     tip, with no venue involvement, because nothing was started. This is the
//     shipped anon `guest_cancel_token` self-service pattern
//     (venue-reservation-cancel/index.ts:94).
//   * ACKNOWLEDGED / IN PROGRESS / READY -> `request_refund`. It lands on the
//     venue's ticket as a decision, because the kitchen may already have fired
//     it. NO money moves until a person decides.
//   * DELIVERED -> 409 `refund_window_closed`. The existing venue-initiated
//     refund flow, unchanged.
//
// There is no timer branch, and there is no fourth action, because there is no
// automatic refund (I-PROPOSED-1767-NO-MONEY-ON-A-TIMER).
//
// verify_jwt = false: this serves an ANON web guest holding a cancel token, or
// a signed-in app user who owns the order. Both are proven IN-CODE — the token
// by a hash match inside the RPC, the user by `auth.getUser` + a buyer_user_id
// comparison. The guest UI that calls this ships in Phase 4 (#1793); the
// contract ships here so Phase 4 has something real to call.
// ===========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  venueOrderErrorCopy,
  type VenueOrderErrorCode,
  venueOrderErrorStatus,
} from "../_shared/venueOrderPricing.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** P-29 — the machine code AND the exact GUEST-facing copy, together. */
function fail(code: VenueOrderErrorCode): Response {
  return jsonResponse(
    { error: code, message: venueOrderErrorCopy(code, "guest") },
    venueOrderErrorStatus(code),
  );
}

/**
 * Map the RPC's raised errors onto the P-29 table. An unmapped database error
 * must never leak its text to a guest — but it must also never be reported as
 * a success, so it becomes an honest `internal_error` that states plainly that
 * nothing was charged.
 */
function mapRpcError(message: string): Response {
  if (message.includes("not_authorized")) {
    return jsonResponse({ error: "not_authorized" }, 403);
  }
  if (message.includes("transition_not_allowed")) {
    return jsonResponse({
      error: "transition_not_allowed",
      message:
        "The venue has already picked this order up — ask them for a refund instead.",
    }, 409);
  }
  if (message.includes("refund_window_closed")) {
    return fail("refund_window_closed");
  }
  return fail("internal_error");
}

serve(wrapEdgeHandler("venue-order-guest-action", async (req) => {
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
    return fail("invalid_json");
  }

  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason : null;
  const guestCancelToken = typeof body.guestCancelToken === "string"
    ? body.guestCancelToken
    : "";

  if (!UUID_RE.test(orderId)) return jsonResponse({ error: "not_found" }, 404);
  if (action !== "cancel" && action !== "request_refund") {
    return jsonResponse({ error: "invalid_action" }, 400);
  }

  // TWO possession proofs, ONE code path (the RPC enforces whichever it is
  // given). A web guest holds the cancel token. A signed-in app user IS the
  // owner and never had to keep one — but the JWT is verified HERE, before the
  // id is passed, and a JWT for a different user resolves to a different id
  // that will not match `buyer_user_id`. `verify_jwt = false` only means the
  // GATEWAY does not check the token; this function does, cryptographically.
  let ownerUserId: string | null = null;
  if (guestCancelToken.length === 0) {
    ownerUserId = await userIdFromAuthHeader(req);
    if (ownerUserId === null) {
      return jsonResponse({ error: "not_authorized" }, 403);
    }
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("pg_venue_order_guest_action", {
    p_order_id: orderId,
    p_guest_token: guestCancelToken,
    p_action: action,
    p_reason: reason,
    p_owner_user_id: ownerUserId,
  });
  if (error) return mapRpcError(error.message);
  return jsonResponse(data ?? {});
}, {
  onError: (_err, requestId) =>
    jsonResponse({
      error: "internal_error",
      message: venueOrderErrorCopy("internal_error", "guest"),
      requestId,
    }, 500),
}));
