import { describe, expect, test } from "@jest/globals";
import { summarizeEventMoney } from "../moneySummary";
import type { OrderRecord } from "../../store/orderStore";

const baseOrder = (patch: Partial<OrderRecord>): OrderRecord => ({
  id: patch.id ?? "ord-x",
  eventId: "event-1",
  brandId: "brand-1",
  buyer: { name: "Test", email: "t@e.com", phone: "", marketingOptIn: false },
  lines: [],
  totalGbpAtPurchase: 0,
  currency: "GBP",
  paymentMethod: "card",
  paidAt: "2026-05-01T10:00:00.000Z",
  status: "paid",
  refundedAmountGbp: 0,
  refunds: [],
  cancelledAt: null,
  lastSeenEventUpdatedAt: "2026-05-01T10:00:00.000Z",
  ...patch,
});

describe("ORCH-0796 independent verification", () => {
  test("INDEP-1: mixed paid + fully-refunded orders → only the paid one nets", () => {
    const s = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [
        baseOrder({
          id: "paid-1",
          totalGbpAtPurchase: 50,
          totalCents: 5000,
          stripeApplicationFeeAmountCents: 250,
        }),
        baseOrder({
          id: "refunded-full",
          status: "refunded_full",
          totalGbpAtPurchase: 50,
          totalCents: 5000,
          stripeApplicationFeeAmountCents: 250,
          refundedAmountGbp: 50,
          refundedAmountCents: 5000,
          refunds: [{
            id: "rf", orderId: "refunded-full", amountGbp: 50, reason: "ten char min",
            refundedAt: "2026-05-01T12:00:00.000Z", lines: [],
            applicationFeeRefundedCents: 250,
          }],
        }),
      ],
      doorSales: [],
    });
    expect(s.expectedPayoutMajor).toBe(47.5);
    expect(s.onlineNetMajor).toBe(47.5);
    expect(s.onlineRevenue).toBe(50);
  });

  test("INDEP-2: cancelled order alongside paid → cancelled excluded", () => {
    const s = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [
        baseOrder({ id: "p", totalGbpAtPurchase: 30, totalCents: 3000, stripeApplicationFeeAmountCents: 150 }),
        baseOrder({ id: "c", status: "cancelled", totalGbpAtPurchase: 30, totalCents: 3000 }),
      ],
      doorSales: [],
    });
    expect(s.expectedPayoutMajor).toBe(28.5);
  });

  test("INDEP-3: zero app-fee on a paid order (e.g. comp/free flow) → net = total", () => {
    const s = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [
        baseOrder({
          id: "free-paid", totalGbpAtPurchase: 25, totalCents: 2500,
          stripeApplicationFeeAmountCents: 0, applicationFeeAmountCents: 0,
        }),
      ],
      doorSales: [],
    });
    expect(s.expectedPayoutMajor).toBe(25);
    expect(s.stripeFeeOnlineMajor).toBe(0);
  });

  test("INDEP-4: door + currency-mismatched online → expectedPayout = door only", () => {
    const s = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [baseOrder({ id: "usd", currency: "USD", totalGbpAtPurchase: 100, totalCents: 10000 })],
      doorSales: [{
        id: "cash", totalGbpAtSale: 40, currency: "GBP", paymentMethod: "cash" as const,
        refundedAmountGbp: 0, refunds: [],
      } as never],
    });
    expect(s.mismatches).toHaveLength(1);
    expect(s.expectedPayoutMajor).toBe(40);
    expect(s.onlineNetMajor).toBeNull();
  });

  test("INDEP-5: two paid orders with refunds → sums correctly with app-fee add-back", () => {
    const s = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [
        baseOrder({
          id: "p1", status: "refunded_partial",
          totalGbpAtPurchase: 80, totalCents: 8000,
          stripeApplicationFeeAmountCents: 400,
          refundedAmountGbp: 20, refundedAmountCents: 2000,
          refunds: [{
            id: "rf1", orderId: "p1", amountGbp: 20, reason: "ten char min",
            refundedAt: "2026-05-01T12:00:00.000Z", lines: [],
            applicationFeeRefundedCents: 100,
          }],
        }),
        baseOrder({
          id: "p2",
          totalGbpAtPurchase: 60, totalCents: 6000,
          stripeApplicationFeeAmountCents: 300,
        }),
      ],
      doorSales: [],
    });
    // p1: 80 - 4 - 20 + 1 = 57
    // p2: 60 - 3 - 0 + 0 = 57
    // total = 114
    expect(s.onlineNetMajor).toBe(114);
    expect(s.expectedPayoutMajor).toBe(114);
    // stripeFee retained: (4-1) + (3-0) = 6
    expect(s.stripeFeeOnlineMajor).toBe(6);
  });
});
