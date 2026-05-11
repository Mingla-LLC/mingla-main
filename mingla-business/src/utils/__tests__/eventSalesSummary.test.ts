import { describe, expect, test } from "@jest/globals";

import type { TicketStub } from "../../store/draftEventStore";
import type { OrderRecord } from "../../store/orderStore";
import { buildEventSalesSummary } from "../eventSalesSummary";

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-general",
  name: "General",
  priceGbp: 50,
  currency: "USD",
  capacity: 20,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  ...patch,
});

const order = (patch: Partial<OrderRecord> = {}): OrderRecord => ({
  id: "order-1",
  eventId: "event-1",
  brandId: "brand-1",
  buyer: {
    name: "Buyer",
    email: "buyer@example.com",
    phone: "+15555550123",
    marketingOptIn: false,
  },
  lines: [
    {
      ticketTypeId: "ticket-general",
      ticketNameAtPurchase: "General",
      unitPriceGbpAtPurchase: 50,
      unitPriceAtPurchase: 50,
      isFreeAtPurchase: false,
      quantity: 3,
      refundedQuantity: 0,
      refundedAmountGbp: 0,
      refundedAmount: 0,
    },
  ],
  totalGbpAtPurchase: 150,
  totalAtPurchase: 150,
  currency: "USD",
  paymentMethod: "card",
  paidAt: "2026-05-11T12:00:00.000Z",
  status: "paid",
  refundedAmountGbp: 0,
  refundedAmount: 0,
  refunds: [],
  cancelledAt: null,
  lastSeenEventUpdatedAt: "2026-05-11T12:00:00.000Z",
  ...patch,
});

describe("eventSalesSummary", () => {
  test("shows finite capacity and explicit zero revenue for zero-sale events", () => {
    const summary = buildEventSalesSummary({
      eventId: "event-1",
      tickets: [ticket({ capacity: 20 })],
      eventCurrency: "USD",
      orders: [],
    });

    expect(summary.soldCount).toBe(0);
    expect(summary.finiteCapacity).toBe(20);
    expect(summary.soldLabel).toBe("0 / 20");
    expect(summary.revenueLabel).toBe("$0");
  });

  test("shows finite capacity and amount for nonzero sales", () => {
    const summary = buildEventSalesSummary({
      eventId: "event-1",
      tickets: [ticket({ capacity: 20 })],
      eventCurrency: "USD",
      orders: [order()],
    });

    expect(summary.soldCount).toBe(3);
    expect(summary.onlineRevenue).toBe(150);
    expect(summary.soldLabel).toBe("3 / 20");
    expect(summary.revenueLabel).toBe("$150");
  });

  test("shows explicit sold count for unlimited zero-sale events", () => {
    const summary = buildEventSalesSummary({
      eventId: "event-1",
      tickets: [ticket({ capacity: null, isUnlimited: true })],
      eventCurrency: "USD",
      orders: [],
    });

    expect(summary.finiteCapacity).toBeNull();
    expect(summary.hasUnlimitedTickets).toBe(true);
    expect(summary.soldLabel).toBe("0 sold");
    expect(summary.revenueLabel).toBe("$0");
  });

  test("subtracts refunded quantities and refunded amount from live totals", () => {
    const summary = buildEventSalesSummary({
      eventId: "event-1",
      tickets: [ticket({ capacity: null, isUnlimited: true })],
      eventCurrency: "USD",
      orders: [
        order({
          lines: [
            {
              ticketTypeId: "ticket-general",
              ticketNameAtPurchase: "General",
              unitPriceGbpAtPurchase: 50,
              unitPriceAtPurchase: 50,
              isFreeAtPurchase: false,
              quantity: 3,
              refundedQuantity: 1,
              refundedAmountGbp: 50,
              refundedAmount: 50,
            },
          ],
          totalGbpAtPurchase: 150,
          totalAtPurchase: 150,
          refundedAmountGbp: 50,
          refundedAmount: 50,
          status: "refunded_partial",
        }),
      ],
    });

    expect(summary.soldCount).toBe(2);
    expect(summary.onlineRevenue).toBe(100);
    expect(summary.soldLabel).toBe("2 sold");
    expect(summary.revenueLabel).toBe("$100");
  });

  test("keeps currency mismatch honest when expected-currency revenue is zero", () => {
    const summary = buildEventSalesSummary({
      eventId: "event-1",
      tickets: [ticket({ capacity: null, isUnlimited: true })],
      eventCurrency: "USD",
      orders: [order({ currency: "GBP" })],
    });

    expect(summary.soldCount).toBe(3);
    expect(summary.onlineRevenue).toBe(0);
    expect(summary.mismatches).toHaveLength(1);
    expect(summary.revenueLabel).toBe("Currency review");
  });

  test("does not convert query errors into fabricated zero labels", () => {
    const summary = buildEventSalesSummary({
      eventId: "event-1",
      tickets: [ticket({ capacity: 20 })],
      eventCurrency: "USD",
      orders: [],
      hasError: true,
    });

    expect(summary.hasError).toBe(true);
    expect(summary.soldLabel).toBe("Unable to load");
    expect(summary.revenueLabel).toBe("Unable to load");
  });
});
