// #4490 spec 08 O5 part C — stock counts and the sold-out-after-payment way
// out, as venue-order-staff actions.
//
//   stock_set        { venueId, menuItemId, count: int|null, warnAt: int|null, staffSession? }
//                    -> { stock }   Menu: set, restock (sets the count) or stop
//                    tracking (count null). Menu manage rights. On a Till
//                    device login it needs a PIN session (runs as the member).
//   station_stock    { venueId, station: kitchen|bar|all } -> { items }
//                    the station's "Mark sold out" list (kitchen rights).
//   station_sold_out { venueId, menuItemId, on: boolean } -> { stock }
//                    T15: "Sold out" from the board sets the count to 0; "Back
//                    on" undoes only a kitchen mark from tonight. Kitchen
//                    rights; a Till device acts as itself (a station action).
//   order_sold_out   { venueId, orderId, staffSession? } -> { soldOut }
//                    the staff order's sold-out lines and what a swap may offer.
//   sold_out_resolve { venueId, orderId, orderItemIds, resolution: swap|refund,
//                      swapMenuItemId?, requestId, staffSession?, stepUp? }
//                    -> { resolution } T16: swap (kitchen or sell rights) or
//                    refund (the staff refund floor). A refund on a Till device
//                    also needs a fresh PIN with money rights (step-up), and
//                    runs as the approver. Idempotent by requestId: the same
//                    request answers what it did; one resolution per line and
//                    at most one refund per order (the database decides).
//
// Errors: { error: <code>, ...detail } with a status; the Host maps codes to
// words (never a raw database message).

import {
  requireStepUp,
  resolveTillActor,
} from "../_shared/venueTillStaffSession.ts";

export const STOCK_ACTIONS = new Set([
  "stock_set",
  "station_stock",
  "station_sold_out",
  "order_sold_out",
  "sold_out_resolve",
]);

/** Actions that start from a Till PIN session on a Till device login. */
export const STOCK_SESSION_ACTIONS = new Set([
  "stock_set",
  "order_sold_out",
  "sold_out_resolve",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;

export const STOCK_STATUS: Record<string, number> = {
  not_authorized: 403,
  forbidden: 403,
  stations_not_enabled: 422,
  till_not_enabled: 422,
  station_invalid: 400,
  stock_invalid: 400,
  sold_out_invalid: 400,
  venue_not_found: 404,
  stock_item_not_found: 404,
  order_not_found: 404,
  sold_out_line_not_found: 404,
  stock_not_kitchen_mark: 409,
  item_sold_out: 409,
  sold_out_already_resolved: 409,
  sold_out_swap_not_orderable: 409,
  sold_out_swap_other_station: 409,
  sold_out_swap_dearer: 409,
  sold_out_refund_once: 409,
  already_refunded: 409,
  pin_session_required: 401,
  pin_session_invalid: 401,
  // #4490 08-O5 fix 3: a sold-out refund or a swap that gives money back on a
  // Till device needs a fresh PIN (the database asks); a request key reused
  // for other lines is refused.
  pin_step_up_required: 403,
  sold_out_key_reused: 409,
};

// deno-lint-ignore no-explicit-any
export type StockClient = any;

type Respond = (body: Record<string, unknown>, status?: number) => Response;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function countOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (
    typeof value === "number" && Number.isInteger(value) && value >= 0 &&
    value <= 99999
  ) {
    return value;
  }
  return undefined;
}

/** The one error answer: a known code with its status, else internal_error. */
export function stockFailure(
  action: string,
  error: { code?: string; message?: string; details?: string | null },
  respond: Respond,
): Response {
  const code = str(error.message);
  const status = STOCK_STATUS[code];
  if (status === undefined) {
    console.error(
      `[venue-order-staff] ${action} failed`,
      error.code ?? "unknown",
    );
    return respond({ error: "internal_error" }, 500);
  }
  const body: Record<string, unknown> = { error: code };
  if (error.details) {
    try {
      const detail = JSON.parse(error.details);
      if (typeof detail?.itemName === "string") body.itemName = detail.itemName;
      if (typeof detail?.left === "number") body.left = detail.left;
    } catch {
      // optional detail
    }
  }
  return respond(body, status);
}

export async function handleStockAction(
  client: StockClient,
  action: string,
  body: Record<string, unknown>,
  user: { userId: string; jwt: string },
  respond: Respond,
): Promise<Response> {
  const venueId = str(body.venueId).toLowerCase();
  if (!UUID.test(venueId)) return respond({ error: "invalid_request" }, 400);

  // Kitchen board actions: the signed-in account acts as itself.
  if (action === "station_stock") {
    const station = str(body.station);
    if (!["kitchen", "bar", "all"].includes(station)) {
      return respond({ error: "invalid_request" }, 400);
    }
    const { data, error } = await client.rpc("issue_4490_station_stock", {
      p_venue_id: venueId,
      p_station: station,
      p_actor: user.userId,
    });
    return error
      ? stockFailure(action, error, respond)
      : respond({ items: data ?? [] });
  }
  if (action === "station_sold_out") {
    const itemId = str(body.menuItemId).toLowerCase();
    if (!UUID.test(itemId) || typeof body.on !== "boolean") {
      return respond({ error: "invalid_request" }, 400);
    }
    const venue = await client.rpc("issue_4490_stock_item_venue", {
      p_item_id: itemId,
    });
    if (venue.error) return stockFailure(action, venue.error, respond);
    if (String(venue.data ?? "") !== venueId) {
      return respond({ error: "stock_item_not_found" }, 404);
    }
    const { data, error } = await client.rpc("issue_4490_station_sold_out", {
      p_item_id: itemId,
      p_on: body.on,
      p_actor: user.userId,
    });
    return error
      ? stockFailure(action, error, respond)
      : respond({ stock: data });
  }

  // The rest start from a Till PIN session on a Till device login and run
  // as that member (their own rights, never more); anyone else as themselves.
  const who = await resolveTillActor(client, {
    venueId,
    userId: user.userId,
    jwt: user.jwt,
    staffSession: body.staffSession,
  });
  if (!who.ok) return respond({ error: who.code }, who.status);
  const actor = who.actor;

  if (action === "stock_set") {
    const itemId = str(body.menuItemId).toLowerCase();
    const count = countOrNull(body.count);
    const warnAt = body.warnAt === undefined ? null : countOrNull(body.warnAt);
    if (!UUID.test(itemId) || count === undefined || warnAt === undefined) {
      return respond({ error: "stock_invalid" }, 400);
    }
    const venue = await client.rpc("issue_4490_stock_item_venue", {
      p_item_id: itemId,
    });
    if (venue.error) return stockFailure(action, venue.error, respond);
    if (String(venue.data ?? "") !== venueId) {
      return respond({ error: "stock_item_not_found" }, 404);
    }
    const { data, error } = await client.rpc("issue_4490_stock_set", {
      p_item_id: itemId,
      p_count: count,
      p_warn_at: count === null ? null : warnAt,
      p_actor: actor.actorUserId,
      p_device_user: actor.deviceUserId,
    });
    return error
      ? stockFailure(action, error, respond)
      : respond({ stock: data });
  }

  const orderId = str(body.orderId).toLowerCase();
  if (!UUID.test(orderId)) return respond({ error: "invalid_request" }, 400);
  const { data: order, error: orderError } = await client.from("venue_orders")
    .select("id, venue_id").eq("id", orderId).maybeSingle();
  if (orderError) {
    console.error(
      `[venue-order-staff] ${action} order read failed`,
      orderError.code ?? "unknown",
    );
    return respond({ error: "internal_error" }, 500);
  }
  if (!order || String(order.venue_id) !== venueId) {
    return respond({ error: "order_not_found" }, 404);
  }

  if (action === "order_sold_out") {
    const { data, error } = await client.rpc("issue_4490_order_sold_out", {
      p_order_id: orderId,
      p_actor: actor.actorUserId,
    });
    return error
      ? stockFailure(action, error, respond)
      : respond({ soldOut: data });
  }

  // sold_out_resolve
  const resolution = str(body.resolution);
  const requestId = str(body.requestId);
  const itemIds = Array.isArray(body.orderItemIds)
    ? (body.orderItemIds as unknown[]).map((v) => str(v).toLowerCase())
    : [];
  const swapId = body.swapMenuItemId == null
    ? null
    : str(body.swapMenuItemId).toLowerCase();
  if (
    (resolution !== "swap" && resolution !== "refund") ||
    !REQUEST_ID.test(requestId) ||
    itemIds.length < 1 || itemIds.length > 50 ||
    !itemIds.every((id) => UUID.test(id)) ||
    (resolution === "swap") !== (swapId !== null) ||
    (swapId !== null && !UUID.test(swapId))
  ) {
    return respond({ error: "sold_out_invalid" }, 400);
  }
  let runAs = actor.actorUserId;
  // A refund on a Till device follows the refund rule: a fresh PIN from
  // someone with money rights (the seller, or a manager on the spot). A swap
  // that gives money back is a refund too (#4490 08-O5 fix 3): the app sends
  // the PIN when the database answers pin_step_up_required (or up front when
  // it knows the swap is cheaper); a swap that gives nothing back needs none.
  if (
    actor.isDevice &&
    (resolution === "refund" || (resolution === "swap" && body.stepUp != null))
  ) {
    const step = await requireStepUp(client, {
      venueId,
      actor,
      stepUp: body.stepUp,
      purpose: resolution === "refund" ? "refund" : "swap_refund",
      target: orderId,
    });
    if (!step.ok) {
      // The PIN refusal's details (triesLeft, lockedUntil) ride along so the
      // prompt can say how many tries are left or when the lock ends.
      return respond({
        ...step.body,
        error: String(step.body.code ?? "pin_step_up_required"),
      }, step.status);
    }
    runAs = step.approverUserId;
  }
  const { data, error } = await client.rpc(
    "issue_4490_order_sold_out_resolve",
    {
      p_order_id: orderId,
      p_item_ids: itemIds,
      p_resolution: resolution,
      p_swap_item_id: swapId,
      p_actor: runAs,
      p_device_user: actor.deviceUserId,
      p_key: `sold_out:${requestId}`,
    },
  );
  return error
    ? stockFailure(action, error, respond)
    : respond({ resolution: data });
}
