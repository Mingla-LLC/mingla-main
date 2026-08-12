/**
 * Issue #1791 (#1767 Phase 3) — pure Orders-queue logic (SPEC #1788 P-26, P-53,
 * P-55; DESIGN D-3b, D-7).
 *
 * No React, no react-native, no network: everything here is a function of its
 * arguments, so the queue's rules can be proven under the default node/ts-jest
 * config. The module RENDERS what these functions decide.
 *
 * Two product rules this file encodes, and they are the reason it exists:
 *
 *  1. ONE QUEUE PER BRAND, filterable by venue and zone (D-3b). A hotel's
 *     room-service tickets and its restaurant's table tickets are one kitchen,
 *     so they belong in one list — and every ticket therefore has to say where
 *     it is GOING, or the pass cannot tell them apart.
 *  2. ACKNOWLEDGED IS A TAP. `legalActionsFor` never returns an action that
 *     happens by itself, and nothing in this file derives an acknowledgement
 *     from having rendered a row. Render-implies-seen is unverifiable — a
 *     backgrounded tab would "see" everything — and it is the exact
 *     unfalsifiable-test bug class the house rule names.
 *     (I-PROPOSED-1767-ACK-IS-A-HUMAN-TAP)
 */

export type VenueOrderFulfillmentStatus =
  | "placed"
  | "acknowledged"
  | "in_progress"
  | "ready"
  | "delivered"
  | "cancelled"
  | "refunded";

export type VenueOrderPaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "partial_refund"
  | "cancelled";

export type VenueOrderAction =
  | "acknowledge"
  | "start"
  | "ready"
  | "deliver"
  | "cancel";

export type VenueOrderView =
  | "new"
  | "in_progress"
  | "ready"
  | "refunds"
  | "done";

export type VenueOrderSource = "guest_qr" | "guest_page" | "staff";

export interface VenueOrderLine {
  id: string;
  lineNo: number;
  itemName: string;
  quantity: number;
  notes: string | null;
  modifiers: string[];
}

export interface VenueOrder {
  id: string;
  brandId: string;
  venueId: string;
  sessionId: string;
  fulfillmentStatus: VenueOrderFulfillmentStatus;
  paymentStatus: VenueOrderPaymentStatus;
  source: VenueOrderSource;
  /** The printed label of the spot the order came from, snapshotted at order time. */
  spotLabel: string | null;
  /** Counter pickup: 2-3 digits, unique among the venue's LIVE orders. */
  pickupCode: string | null;
  zone: string | null;
  buyerName: string | null;
  currency: string;
  totalCents: number;
  tipCents: number;
  itemCount: number;
  lines: VenueOrderLine[];
  placedAt: string;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  refundRequestedAt: string | null;
  refundDecision: "approved" | "declined" | null;
  /** 0..3. Raised ONLY by the escalation sweep, never by the client. */
  escalationLevel: number;
}

/** The 5 segmented views in display order — a control INSIDE the module. */
export const VENUE_ORDER_VIEWS: readonly {
  id: VenueOrderView;
  label: string;
}[] = [
  { id: "new", label: "New" },
  { id: "in_progress", label: "Cooking" },
  { id: "ready", label: "Ready" },
  { id: "refunds", label: "Refunds" },
  { id: "done", label: "Done" },
];

/**
 * Mirrors `pg_venue_order_transition_is_legal` EXACTLY. The server is
 * authoritative; this only hides buttons that would bounce. Drifting from the
 * SQL is what `venueOrders.issue1791.test.ts` exists to catch.
 *
 * `delivered -> refunded` is in the map because the lifecycle allows it, but no
 * ACTION targets `refunded`: a fulfillment status of "refunded" is a claim that
 * money went back, and only the refund rail may make that claim.
 */
export function isVenueOrderTransitionLegal(
  from: VenueOrderFulfillmentStatus,
  to: VenueOrderFulfillmentStatus,
): boolean {
  switch (from) {
    case "placed":
      return to === "acknowledged" || to === "cancelled";
    case "acknowledged":
      return to === "in_progress" || to === "ready" || to === "cancelled";
    case "in_progress":
      return to === "ready" || to === "cancelled";
    case "ready":
      return to === "delivered" || to === "cancelled";
    case "delivered":
      return to === "refunded";
    default:
      // cancelled / refunded are terminal.
      return false;
  }
}

/** Action → the status it drives the order into. */
export const VENUE_ORDER_ACTION_TARGET: Record<
  VenueOrderAction,
  VenueOrderFulfillmentStatus
> = {
  acknowledge: "acknowledged",
  start: "in_progress",
  ready: "ready",
  deliver: "delivered",
  cancel: "cancelled",
};

export const VENUE_ORDER_ACTION_LABEL: Record<VenueOrderAction, string> = {
  acknowledge: "Got it",
  start: "Start cooking",
  ready: "Mark ready",
  deliver: "Mark delivered",
  cancel: "Cancel order",
};

/** Cancelling a paid order is the front half of a refund — reach + confirm. */
export const VENUE_ORDER_DESTRUCTIVE_ACTIONS: readonly VenueOrderAction[] = [
  "cancel",
];

export function legalActionsFor(
  status: VenueOrderFulfillmentStatus,
): VenueOrderAction[] {
  return (Object.keys(VENUE_ORDER_ACTION_TARGET) as VenueOrderAction[]).filter(
    (a) => isVenueOrderTransitionLegal(status, VENUE_ORDER_ACTION_TARGET[a]),
  );
}

/** Status pill presentation — colour is NEVER the only signal (label + tone). */
export interface VenueOrderStatusPresentation {
  label: string;
  tone: "neutral" | "success" | "warm" | "muted" | "error" | "faded";
}

export const VENUE_ORDER_STATUS_PRESENTATION: Record<
  VenueOrderFulfillmentStatus,
  VenueOrderStatusPresentation
> = {
  placed: { label: "New", tone: "neutral" },
  acknowledged: { label: "Got it", tone: "warm" },
  in_progress: { label: "Cooking", tone: "warm" },
  ready: { label: "Ready", tone: "success" },
  delivered: { label: "Delivered", tone: "muted" },
  cancelled: { label: "Canceled", tone: "faded" },
  refunded: { label: "Refunded", tone: "faded" },
};

/**
 * D-3 / D-3b — every ticket says where it is going. A room-service ticket and a
 * table ticket land in the same queue because it is the same kitchen, so the
 * destination is what makes them tellable apart at a glance. Counter pickup has
 * no spot at all, so it names the code and the person: `COLLECT · 42 · Amara`.
 *
 * Mirrors `venueOrderDestinationLabel` in
 * supabase/functions/_shared/venueOrderNotify.ts, so the push a phone shows and
 * the row the queue shows name the same place.
 */
export function venueOrderDestinationLabel(order: {
  spotLabel: string | null;
  pickupCode: string | null;
  buyerName: string | null;
}): string {
  const spot = (order.spotLabel ?? "").trim();
  if (spot.length > 0) return spot;
  const code = (order.pickupCode ?? "").trim();
  const name = (order.buyerName ?? "").trim();
  if (code.length > 0) {
    return name.length > 0 ? `COLLECT · ${code} · ${name}` : `COLLECT · ${code}`;
  }
  return name.length > 0 ? name : "Counter";
}

/** A refund the guest asked for and the venue has not answered yet. */
export function hasOpenRefundRequest(order: VenueOrder): boolean {
  return order.refundRequestedAt !== null && order.refundDecision === null;
}

/**
 * Which orders each view shows.
 *
 * `refunds` deliberately OVERLAPS the live views rather than removing a ticket
 * from them: a guest asking for their money back does not stop the kitchen
 * holding the food, and hiding the ticket from the pass while a manager decides
 * is how an order gets lost.
 */
export function filterVenueOrdersForView(
  orders: readonly VenueOrder[],
  view: VenueOrderView,
): VenueOrder[] {
  switch (view) {
    case "new":
      return orders.filter((o) => o.fulfillmentStatus === "placed");
    case "in_progress":
      return orders.filter(
        (o) =>
          o.fulfillmentStatus === "acknowledged" ||
          o.fulfillmentStatus === "in_progress",
      );
    case "ready":
      return orders.filter((o) => o.fulfillmentStatus === "ready");
    case "refunds":
      return orders.filter(hasOpenRefundRequest);
    case "done":
      return orders.filter(
        (o) =>
          o.fulfillmentStatus === "delivered" ||
          o.fulfillmentStatus === "cancelled" ||
          o.fulfillmentStatus === "refunded",
      );
    default:
      return [];
  }
}

/**
 * The brand-scoped queue's two filters (D-3b). `null` means "everything" — the
 * default, because one kitchen usually wants one list.
 */
export function filterVenueOrdersByScope(
  orders: readonly VenueOrder[],
  venueId: string | null,
  zone: string | null,
): VenueOrder[] {
  return orders.filter(
    (o) =>
      (venueId === null || o.venueId === venueId) &&
      (zone === null || (o.zone ?? "") === zone),
  );
}

/**
 * Issue #1943 — a Venue -> Orders route has one immutable queue owner.
 *
 * Unlike the legacy brand-queue helper above, a missing venue is fail-closed:
 * this screen must never turn an absent route id into "show every venue".
 */
export function filterVenueOrdersForVenue(
  orders: readonly VenueOrder[],
  venueId: string | null,
  zone: string | null,
): VenueOrder[] {
  if (venueId === null || venueId.length === 0) return [];
  return orders.filter(
    (order) =>
      order.venueId === venueId &&
      (zone === null || (order.zone ?? "") === zone),
  );
}

/** The zone filter's options, derived from what is actually in the queue. */
export function availableZones(orders: readonly VenueOrder[]): string[] {
  const seen = new Set<string>();
  for (const o of orders) {
    const zone = (o.zone ?? "").trim();
    if (zone.length > 0) seen.add(zone);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/** The count the module nav badges — live tickets nobody has finished. */
export function liveOrderCount(orders: readonly VenueOrder[]): number {
  return orders.filter(
    (o) =>
      o.fulfillmentStatus === "placed" ||
      o.fulfillmentStatus === "acknowledged" ||
      o.fulfillmentStatus === "in_progress" ||
      o.fulfillmentStatus === "ready",
  ).length;
}

/**
 * How an escalated ticket reads on the queue. The ladder only ever NOTIFIES;
 * this is the in-app half of the same honesty. Level 3 says the alerts have
 * stopped rather than pretending they continue — the ticket is still here, and
 * so is the guest's ability to walk away with their money (D-7a/D-7b).
 */
export function escalationNotice(order: VenueOrder): string | null {
  if (order.acknowledgedAt !== null) return null;
  switch (order.escalationLevel) {
    case 1:
      return "Waiting 2+ minutes — nobody has picked this up.";
    case 2:
      return "Waiting 5+ minutes. Your managers have been alerted and the guest has been told they can cancel for a full refund.";
    case 3:
      return "Waiting 10+ minutes. That was the last alert we'll send — the order is still here, and the guest can still cancel.";
    default:
      return null;
  }
}

/**
 * How long a ticket has been waiting, in whole minutes. Clamped at zero: a
 * device clock a few seconds ahead of the server must never render "-1 min ago"
 * at the pass, and an unparseable timestamp reads as "Just now" rather than
 * "NaN min ago".
 */
export function waitingMinutes(placedAtIso: string, now: number = Date.now()): number {
  const placed = new Date(placedAtIso).getTime();
  if (!Number.isFinite(placed)) return 0;
  return Math.max(0, Math.floor((now - placed) / 60000));
}

export function waitingLabel(minutes: number): string {
  if (minutes <= 0) return "Just now";
  if (minutes === 1) return "1 min ago";
  return `${minutes} min ago`;
}

/**
 * Newest first inside a view: the pass reads top-down and the thing that just
 * arrived is the thing nobody has looked at.
 */
export function sortForQueue(orders: readonly VenueOrder[]): VenueOrder[] {
  return [...orders].sort(
    (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime(),
  );
}
