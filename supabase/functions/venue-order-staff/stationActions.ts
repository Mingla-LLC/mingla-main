// #4490 spec 08 O3 — the kitchen and bar station actions of venue-order-staff.
//
//   station_board { venueId, station: kitchen|bar|all }   -> { board }
//   station_accept { orderId, station }                    -> { ticket, already, alreadyAcceptedBy? }
//   item_ready     { orderItemId }                         -> { ticket, already }
//   ticket_ready   { orderId, station }                    -> { ticket, already, orderReady }
//   recall         { orderId, station }                    -> { ticket }
//   picked_up      { orderId, station }                    -> { ticket, already, delivered }
//   printed        { orderId, station }                    -> { ticket }
//
// The caller's bearer is verified by the function before this runs; the
// verified user is passed as p_actor to service-only RPCs that check the
// station gate (release switch VENUE_TILL AND the venue's kitchen_screens
// feature) and issue_4490_can_kitchen (picked_up also accepts a seller). A Till
// device login acts as itself and shows as "Kitchen screen". Held Till rounds,
// carriers, tab settlements and unpaid guest checkouts are refused as
// station_ticket_not_found. Accept, ticket ready and picked up are idempotent.
//
// Errors: { error: <code> } with a status; the Host maps codes to words.

export const STATION_ACTIONS = new Set([
  "station_board",
  "station_accept",
  "item_ready",
  "ticket_ready",
  "recall",
  "picked_up",
  "printed",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<string, number> = {
  not_authorized: 403,
  stations_not_enabled: 422,
  station_invalid: 400,
  station_ticket_not_found: 404,
  venue_not_found: 404,
  station_ticket_closed: 409,
  station_ticket_not_ready: 409,
};

export type StationRpcClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

type Respond = (body: Record<string, unknown>, status?: number) => Response;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function handleStationAction(
  client: StationRpcClient,
  action: string,
  body: Record<string, unknown>,
  userId: string,
  respond: Respond,
): Promise<Response> {
  const station = str(body.station);
  const orderId = str(body.orderId).toLowerCase();
  let rpcName: string;
  let params: Record<string, unknown>;
  switch (action) {
    case "station_board": {
      const venueId = str(body.venueId).toLowerCase();
      if (!UUID.test(venueId) || !["kitchen", "bar", "all"].includes(station)) {
        return respond({ error: "invalid_request" }, 400);
      }
      rpcName = "issue_4490_station_board";
      params = { p_venue_id: venueId, p_station: station, p_actor: userId };
      break;
    }
    case "item_ready": {
      const itemId = str(body.orderItemId).toLowerCase();
      if (!UUID.test(itemId)) return respond({ error: "invalid_request" }, 400);
      rpcName = "issue_4490_station_item_ready";
      params = { p_order_item_id: itemId, p_actor: userId };
      break;
    }
    case "station_accept":
    case "ticket_ready":
    case "recall":
    case "picked_up":
    case "printed": {
      if (!UUID.test(orderId) || (station !== "kitchen" && station !== "bar")) {
        return respond({ error: "invalid_request" }, 400);
      }
      rpcName = {
        station_accept: "issue_4490_station_accept",
        ticket_ready: "issue_4490_station_ticket_ready",
        recall: "issue_4490_station_recall",
        picked_up: "issue_4490_order_picked_up",
        printed: "issue_4490_station_mark_printed",
      }[action] as string;
      params = { p_order_id: orderId, p_station: station, p_actor: userId };
      break;
    }
    default:
      return respond({ error: "unknown_action" }, 400);
  }
  const { data, error } = await client.rpc(rpcName, params);
  if (error) {
    const code = str(error.message);
    if (STATUS[code] !== undefined) return respond({ error: code }, STATUS[code]);
    console.error(`[venue-order-staff] ${action} failed`, error.code ?? "unknown");
    return respond({ error: "internal_error" }, 500);
  }
  if (action === "station_board") return respond({ board: data ?? null });
  return respond((data ?? {}) as Record<string, unknown>);
}
