/**
 * #4490 08-O5 fix 2 (carried 1) — which guest orders are waiting for a swap or
 * a refund, as the Till shows them. Pure: no I/O.
 *
 * The order list says which orders were flagged "sold out after payment"; the
 * server's own read of an order (order_sold_out, the same one the order sheet
 * uses) says which of their lines still wait. The Till only lists an order
 * while a line waits (or while the person has it open to read what happened).
 */
import type { OrderSoldOut } from "../../../services/venueStockService";
import { venueOrderDestinationLabel, type VenueOrder } from "../venueOrderViews";

/** At most this many flagged orders are read at a time (newest first). */
export const TILL_SOLD_OUT_MAX_ORDERS = 8;

export interface TillSoldOutWaiting {
  orderId: string;
  currency: string;
  destination: string;
  items: string[];
}

/** The newest flagged orders (the order list is already newest first). */
export function flaggedOrders(orders: readonly VenueOrder[]): VenueOrder[] {
  return orders.filter((o) => o.soldOutAfterPayment === true).slice(0, TILL_SOLD_OUT_MAX_ORDERS);
}

/** Orders with at least one line still waiting, from the server's read of each. */
export function waitingOrders(
  flagged: readonly VenueOrder[],
  details: ReadonlyArray<OrderSoldOut | undefined>,
): TillSoldOutWaiting[] {
  const out: TillSoldOutWaiting[] = [];
  flagged.forEach((order, i) => {
    const detail = details[i];
    if (detail === undefined) return;
    const waiting = detail.lines.filter((l) => l.resolution === null);
    if (waiting.length === 0) return;
    out.push({
      orderId: order.id,
      currency: order.currency,
      destination: venueOrderDestinationLabel(order),
      items: waiting.map((l) => `${l.quantity} × ${l.name}`),
    });
  });
  return out;
}

/**
 * What the sheet lists: every waiting order, plus the one the person has open
 * (so "Swapped for ..." stays readable after the last line is resolved).
 */
export function listedOrders(
  waiting: readonly TillSoldOutWaiting[],
  openId: string | null,
  openFallback: TillSoldOutWaiting | null,
): TillSoldOutWaiting[] {
  if (openId === null || waiting.some((w) => w.orderId === openId)) return [...waiting];
  return openFallback !== null && openFallback.orderId === openId ? [...waiting, openFallback] : [...waiting];
}
