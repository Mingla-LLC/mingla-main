/**
 * offeringActivityFromOrders — META-ORCH-1059 Pass 2.
 *
 * Derives the dashboard "Recent activity" feed (purchase / refund / cancel
 * rows) from an offering's OrderRecord[] — the same OrderRecord shape the event
 * dashboard's activity feed walks. Factored out so the experience dashboard
 * reuses the EXACT event-dashboard purchase/refund/cancel logic rather than
 * re-deriving it (the event dashboard additionally merges edit/scan/door/
 * lifecycle streams it owns locally; experiences only have order-level streams
 * today). Newest-first, capped.
 */

import type { OrderRecord } from "../store/orderStore";
import type { ActivityEvent } from "../components/event/EventDetailActivityRow";

export function offeringActivityFromOrders(
  orders: OrderRecord[],
  cap = 5,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const o of orders) {
    const buyerName =
      o.buyer.name.trim().length > 0 ? o.buyer.name : "Anonymous";
    const totalQty = o.lines.reduce((s, l) => s + l.quantity, 0);
    const purchaseSummary =
      o.lines.length === 1
        ? `bought ${o.lines[0].quantity}× ${o.lines[0].ticketNameAtPurchase}`
        : `bought ${totalQty}× tickets`;
    events.push({
      kind: "purchase",
      orderId: o.id,
      buyerName,
      summary: purchaseSummary,
      amountGbp: o.totalGbpAtPurchase,
      currency: o.currency,
      at: o.paidAt,
    });
    for (const r of o.refunds) {
      const refundedQty = r.lines.reduce((s, l) => s + l.quantity, 0);
      events.push({
        kind: "refund",
        orderId: o.id,
        buyerName,
        summary: `refunded ${refundedQty}× tickets`,
        amountGbp: r.amountGbp,
        currency: o.currency,
        at: r.refundedAt,
      });
    }
    if (o.status === "cancelled" && o.cancelledAt !== null) {
      events.push({
        kind: "cancel",
        orderId: o.id,
        buyerName,
        summary: "cancelled their order",
        at: o.cancelledAt,
      });
    }
  }

  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, cap);
}
