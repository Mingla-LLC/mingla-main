jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import {
  getEventHasWebPurchases,
  getEventOrderActivity,
  getEventOrderById,
  getEventOrderRevenue,
  getEventSoldCounts,
} from "../eventOrdersService";
import type { OrderRecord } from "../../store/orderStore";

const order = (overrides: Partial<OrderRecord> = {}): OrderRecord => ({
  id: "ord_1",
  eventId: "evt_1",
  brandId: "brand_1",
  buyer: {
    name: "Avery Buyer",
    email: "avery@example.com",
    phone: "+15555550123",
    marketingOptIn: false,
  },
  lines: [
    {
      ticketTypeId: "tt_general",
      ticketNameAtPurchase: "General",
      unitPriceGbpAtPurchase: 20,
      unitPriceAtPurchase: 20,
      isFreeAtPurchase: false,
      quantity: 2,
      refundedQuantity: 0,
      refundedAmountGbp: 0,
      refundedAmount: 0,
    },
  ],
  totalGbpAtPurchase: 40,
  totalAtPurchase: 40,
  currency: "GBP",
  paymentMethod: "card",
  paidAt: "2026-05-10T12:00:00.000Z",
  status: "paid",
  refundedAmountGbp: 0,
  refundedAmount: 0,
  refunds: [],
  cancelledAt: null,
  lastSeenEventUpdatedAt: "2026-05-10T12:00:00.000Z",
  ...overrides,
});

describe("eventOrdersService adapters", () => {
  it("projects server orders into sold counts, revenue, activity, detail, and web-purchase guard", () => {
    const orders = [
      order(),
      order({
        id: "ord_2",
        paymentMethod: "free",
        totalGbpAtPurchase: 0,
        totalAtPurchase: 0,
        lines: [
          {
            ticketTypeId: "tt_vip",
            ticketNameAtPurchase: "VIP",
            unitPriceGbpAtPurchase: 0,
            unitPriceAtPurchase: 0,
            isFreeAtPurchase: true,
            quantity: 1,
            refundedQuantity: 0,
            refundedAmountGbp: 0,
            refundedAmount: 0,
          },
        ],
      }),
    ];

    expect(getEventOrderById(orders, "ord_1")?.buyer.email).toBe("avery@example.com");
    expect(getEventOrderRevenue(orders, "GBP")).toMatchObject({
      soldCount: 3,
      revenue: 40,
      netRevenue: 40,
    });
    expect(getEventSoldCounts(orders)).toEqual({
      tt_general: 2,
      tt_vip: 1,
    });
    expect(getEventOrderActivity(orders).map((entry) => entry.orderId)).toEqual([
      "ord_1",
      "ord_2",
    ]);
    expect(getEventHasWebPurchases(orders)).toBe(true);
  });
});
