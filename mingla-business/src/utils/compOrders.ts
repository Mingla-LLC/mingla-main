/**
 * issue #3827 — guest-list (comp) orders.
 *
 * A comp is a real ticket a host added with no checkout. It takes a place
 * (capacity, "X left", going) but is never a sale: sold counts, revenue and the
 * Orders ledger skip it; capacity guards count it.
 */
import type { OrderRecord } from "../store/orderStore";

export const isCompOrder = (order: Pick<OrderRecord, "source">): boolean =>
  order.source === "comp";

/** Live (not void, not refunded) tickets of one order: the places it holds. */
export const liveTicketCount = (order: OrderRecord): number => {
  if (order.status !== "paid" && order.status !== "refunded_partial") return 0;
  if (order.ticketDays !== undefined && order.ticketDays.length > 0) {
    return order.ticketDays.filter(
      (ticket) => ticket.status === "valid" || ticket.status === "used",
    ).length;
  }
  return order.lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantity - line.refundedQuantity),
    0,
  );
};

/** Places held by live guest-list tickets across the event's orders. */
export const guestListTicketCount = (orders: OrderRecord[]): number =>
  orders.reduce(
    (sum, order) => (isCompOrder(order) ? sum + liveTicketCount(order) : sum),
    0,
  );

/** Sales only: drops guest-list orders. */
export const withoutCompOrders = (orders: OrderRecord[]): OrderRecord[] =>
  orders.filter((order) => !isCompOrder(order));
