/**
 * META-ORCH-1059 Pass 2 — recent-activity derivation regression.
 *
 * Pins that the experience/trip dashboards' "Recent activity" feed derives
 * purchase / refund / cancel rows from OrderRecord[] (the same shape the event
 * dashboard walks), newest-first and capped.
 *
 * Fails-on-revert: deleting offeringActivityFromOrders or breaking the
 * purchase/refund/cancel mapping breaks these assertions.
 */

import { describe, expect, test } from "@jest/globals";

import { offeringActivityFromOrders } from "../offeringActivityFromOrders";
import type { OrderRecord } from "../../store/orderStore";

function order(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "ord_1",
    eventId: "exp_1",
    brandId: "brand_1",
    buyer: { name: "Ada Lovelace", email: "ada@x.io", phone: "", marketingOptIn: false },
    lines: [
      {
        ticketTypeId: "tt_1",
        ticketNameAtPurchase: "Standard",
        unitPriceGbpAtPurchase: 120,
        isFreeAtPurchase: false,
        quantity: 2,
        refundedQuantity: 0,
        refundedAmountGbp: 0,
      },
    ],
    totalGbpAtPurchase: 240,
    currency: "USD",
    paymentMethod: "card" as OrderRecord["paymentMethod"],
    paidAt: "2026-06-01T10:00:00Z",
    status: "paid",
    refundedAmountGbp: 0,
    refunds: [],
    cancelledAt: null,
    ...over,
  } as OrderRecord;
}

describe("offeringActivityFromOrders", () => {
  test("a paid order yields a purchase row with buyer name + ticket summary", () => {
    const feed = offeringActivityFromOrders([order()]);
    expect(feed).toHaveLength(1);
    const row = feed[0];
    expect(row.kind).toBe("purchase");
    if (row.kind !== "purchase") throw new Error("expected purchase row");
    expect(row.buyerName).toBe("Ada Lovelace");
    expect(row.summary).toBe("bought 2× Standard");
  });

  test("anonymous (blank name) buyer renders as 'Anonymous'", () => {
    const feed = offeringActivityFromOrders([
      order({ buyer: { name: "  ", email: "x@y.io", phone: "", marketingOptIn: false } }),
    ]);
    const row = feed[0];
    if (row.kind !== "purchase") throw new Error("expected purchase row");
    expect(row.buyerName).toBe("Anonymous");
  });

  test("refunds produce a refund row; cancellations produce a cancel row", () => {
    const feed = offeringActivityFromOrders([
      order({
        refunds: [
          {
            id: "rf_1",
            orderId: "ord_1",
            amountGbp: 120,
            reason: "buyer requested a refund",
            refundedAt: "2026-06-02T10:00:00Z",
            lines: [{ ticketTypeId: "tt_1", quantity: 1, amountGbp: 120 }],
          },
        ],
      }),
      order({
        id: "ord_2",
        status: "cancelled",
        cancelledAt: "2026-06-03T10:00:00Z",
      }),
    ]);
    expect(feed.some((e) => e.kind === "refund")).toBe(true);
    expect(feed.some((e) => e.kind === "cancel")).toBe(true);
  });

  test("feed is newest-first and capped", () => {
    const orders = Array.from({ length: 8 }, (_, i) =>
      order({ id: `ord_${i}`, paidAt: `2026-06-0${i + 1}T10:00:00Z` }),
    );
    const feed = offeringActivityFromOrders(orders, 5);
    expect(feed).toHaveLength(5);
    // Newest-first: the highest date sorts first.
    expect(new Date(feed[0].at).getTime()).toBeGreaterThan(
      new Date(feed[1].at).getTime(),
    );
  });
});
