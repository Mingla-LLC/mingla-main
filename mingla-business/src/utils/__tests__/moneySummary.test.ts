import { describe, expect, test } from "@jest/globals";

import type { DoorSaleRecord } from "../../store/doorSalesStore";
import type { OrderRecord } from "../../store/orderStore";
import {
  effectiveDraftCurrency,
  summarizeEventMoney,
  summarizeLegacyBrandFinance,
} from "../moneySummary";

const order = (patch: Partial<OrderRecord> = {}): OrderRecord => ({
  id: "order-1",
  eventId: "event-1",
  brandId: "brand-1",
  buyer: { name: "Ada", email: "ada@example.com", phone: "", marketingOptIn: false },
  lines: [],
  totalGbpAtPurchase: 100,
  totalAtPurchase: undefined,
  currency: "GBP",
  paymentMethod: "card",
  paidAt: "2026-05-01T10:00:00.000Z",
  status: "paid",
  refundedAmountGbp: 0,
  refundedAmount: undefined,
  refunds: [],
  cancelledAt: null,
  lastSeenEventUpdatedAt: "2026-05-01T10:00:00.000Z",
  ...patch,
});

const doorSale = (patch: Partial<DoorSaleRecord> = {}): DoorSaleRecord => ({
  id: "sale-1",
  eventId: "event-1",
  brandId: "brand-1",
  recordedBy: "operator-1",
  buyerName: "Walk-up",
  buyerEmail: "",
  buyerPhone: "",
  paymentMethod: "cash",
  lines: [],
  totalGbpAtSale: 40,
  totalAtSale: undefined,
  currency: "GBP",
  notes: "",
  recordedAt: "2026-05-01T11:00:00.000Z",
  status: "completed",
  refundedAmountGbp: 0,
  refundedAmount: undefined,
  refunds: [],
  ...patch,
});

describe("moneySummary", () => {
  test("keeps USD event revenue clean when a stale GBP order is present", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "USD",
      orders: [
        order({
          id: "usd-order",
          currency: "USD",
          totalGbpAtPurchase: 80,
          totalAtPurchase: 80,
          paymentMethod: "card",
        }),
        order({
          id: "gbp-order",
          currency: "GBP",
          totalGbpAtPurchase: 50,
          paymentMethod: "apple_pay",
        }),
      ],
      doorSales: [],
    });

    expect(summary.expectedCurrency).toBe("USD");
    expect(summary.onlineRevenue).toBe(80);
    expect(summary.grossRevenue).toBe(80);
    expect(summary.revenueByMethod.card).toBe(80);
    expect(summary.revenueByMethod.apple_pay).toBeUndefined();
    expect(summary.currenciesPresent).toEqual(["GBP", "USD"]);
    expect(summary.mismatches).toEqual([
      expect.objectContaining({
        source: "order",
        id: "gbp-order",
        expectedCurrency: "USD",
        actualCurrency: "GBP",
        amount: 50,
      }),
    ]);
  });

  test("excludes stale GBP door sales from a CAD door reconciliation", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "CAD",
      orders: [],
      doorSales: [
        doorSale({
          id: "cad-sale",
          currency: "CAD",
          totalGbpAtSale: 35,
          totalAtSale: 35,
          paymentMethod: "manual",
        }),
        doorSale({
          id: "gbp-sale",
          currency: "GBP",
          totalGbpAtSale: 25,
          paymentMethod: "cash",
        }),
      ],
    });

    expect(summary.doorRevenue).toBe(35);
    expect(summary.revenueByMethod.manual).toBe(35);
    expect(summary.revenueByMethod.cash).toBeUndefined();
    expect(summary.mismatches).toEqual([
      expect.objectContaining({
        source: "door_sale",
        id: "gbp-sale",
        expectedCurrency: "CAD",
        actualCurrency: "GBP",
      }),
    ]);
  });

  test("does not repaint GBP finance stubs as CAD", () => {
    const summary = summarizeLegacyBrandFinance({
      brandCurrency: "CAD",
      events: [{ id: "event-1", revenueGbp: 120 }],
      refunds: [{ id: "refund-1", amountGbp: 20 }],
    });

    expect(summary.currency).toBe("GBP");
    expect(summary.grossSales).toBe(120);
    expect(summary.totalRefunds).toBe(20);
    expect(summary.mismatches).toHaveLength(2);
    expect(summary.mismatches[0]).toMatchObject({
      expectedCurrency: "CAD",
      actualCurrency: "GBP",
    });
  });

  test("wizard effective currency prefers draft then brand and stays empty when unset", () => {
    expect(effectiveDraftCurrency(null, "usd")).toBe("USD");
    expect(effectiveDraftCurrency("eur", "usd")).toBe("EUR");
    expect(effectiveDraftCurrency(null, null)).toBe("");
  });

  // ===========================================================================
  // ORCH-0796 — expected-payout from real Stripe application-fee columns.
  // Replaces the prior 4% Stripe-fee stub. expectedPayoutMajor is null when
  // there are no payments (UI renders "—" rather than £0.00).
  // ===========================================================================

  test("T-01 zero orders + zero door → expectedPayoutMajor is null", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [],
      doorSales: [],
    });
    expect(summary.expectedPayoutMajor).toBeNull();
    expect(summary.onlineNetMajor).toBeNull();
    expect(summary.stripeFeeOnlineMajor).toBeNull();
  });

  test("T-02 one paid order, no refund → net = total - stripe app fee", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [
        order({
          id: "ord-1",
          currency: "GBP",
          totalGbpAtPurchase: 50,
          totalAtPurchase: 50,
          totalCents: 5000,
          stripeApplicationFeeAmountCents: 250, // £2.50 platform fee
          applicationFeeAmountCents: 250,
          refundedAmountCents: 0,
          paymentMethod: "card",
        }),
      ],
      doorSales: [],
    });
    expect(summary.onlineNetMajor).toBe(47.5);
    expect(summary.stripeFeeOnlineMajor).toBe(2.5);
    expect(summary.expectedPayoutMajor).toBe(47.5);
  });

  test("T-03 full refund → net = 0 (app-fee portion refunds back)", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [
        order({
          id: "ord-full-refund",
          status: "refunded_full",
          currency: "GBP",
          totalGbpAtPurchase: 50,
          totalAtPurchase: 50,
          totalCents: 5000,
          stripeApplicationFeeAmountCents: 250,
          refundedAmountGbp: 50,
          refundedAmount: 50,
          refundedAmountCents: 5000,
          refunds: [
            {
              id: "rf-1",
              orderId: "ord-full-refund",
              amountGbp: 50,
              amount: 50,
              reason: "buyer requested refund within window",
              refundedAt: "2026-05-01T12:00:00.000Z",
              lines: [],
              applicationFeeRefundedCents: 250,
            },
          ],
        }),
      ],
      doorSales: [],
    });
    // refunded_full orders don't contribute (live=0; status not "paid"/"refunded_partial").
    // hasAnyOnlinePayment stays false → expectedPayoutMajor null.
    expect(summary.expectedPayoutMajor).toBeNull();
  });

  test("T-04 partial refund → net reflects remaining + app-fee refund add-back", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [
        order({
          id: "ord-partial",
          status: "refunded_partial",
          currency: "GBP",
          totalGbpAtPurchase: 100,
          totalAtPurchase: 100,
          totalCents: 10000,
          stripeApplicationFeeAmountCents: 500, // £5 platform fee
          refundedAmountGbp: 40,
          refundedAmount: 40,
          refundedAmountCents: 4000,
          refunds: [
            {
              id: "rf-2",
              orderId: "ord-partial",
              amountGbp: 40,
              amount: 40,
              reason: "partial refund for one ticket",
              refundedAt: "2026-05-01T12:00:00.000Z",
              lines: [],
              applicationFeeRefundedCents: 200, // £2 of platform fee refunded
            },
          ],
        }),
      ],
      doorSales: [],
    });
    // total=100, appFee=5, refunded=40, appFeeRefunded=2 → 100-5-40+2 = 57
    expect(summary.onlineNetMajor).toBe(57);
    expect(summary.stripeFeeOnlineMajor).toBe(3); // 5 - 2 (refunded) = 3 retained
    expect(summary.expectedPayoutMajor).toBe(57);
  });

  test("T-05 cash door sale only → expectedPayout = door revenue (no fees)", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [],
      doorSales: [
        doorSale({ id: "dr-1", totalGbpAtSale: 30, paymentMethod: "cash" }),
      ],
    });
    expect(summary.onlineNetMajor).toBeNull();
    expect(summary.expectedPayoutMajor).toBe(30);
  });

  test("T-06 mixed online + door → expectedPayout = onlineNet + door", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [
        order({
          id: "ord-mix",
          totalGbpAtPurchase: 80,
          totalAtPurchase: 80,
          totalCents: 8000,
          stripeApplicationFeeAmountCents: 400,
        }),
      ],
      doorSales: [
        doorSale({ id: "dr-mix", totalGbpAtSale: 25, paymentMethod: "cash" }),
      ],
    });
    // online net = 80 - 4 = 76. door = 25. expected = 101.
    expect(summary.onlineNetMajor).toBe(76);
    expect(summary.expectedPayoutMajor).toBe(101);
  });

  test("T-07 stripeApplicationFee null → falls back to applicationFeeAmountCents", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [
        order({
          id: "ord-pre-webhook",
          totalGbpAtPurchase: 60,
          totalAtPurchase: 60,
          totalCents: 6000,
          stripeApplicationFeeAmountCents: null, // webhook hasn't landed yet
          applicationFeeAmountCents: 300, // Mingla-intended fee
        }),
      ],
      doorSales: [],
    });
    expect(summary.onlineNetMajor).toBe(57);
  });

  test("T-08 refund-overshoot edge case clamps net to 0 (Math.max guard)", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [
        order({
          id: "ord-overshoot",
          status: "refunded_partial",
          totalGbpAtPurchase: 100,
          totalAtPurchase: 100,
          totalCents: 10000,
          stripeApplicationFeeAmountCents: 500,
          refundedAmountGbp: 100,
          refundedAmount: 100,
          refundedAmountCents: 10000, // full refund without app_fee_refunded set
          refunds: [
            {
              id: "rf-overshoot",
              orderId: "ord-overshoot",
              amountGbp: 100,
              amount: 100,
              reason: "overshoot edge case where app-fee refund not captured",
              refundedAt: "2026-05-01T12:00:00.000Z",
              lines: [],
              // applicationFeeRefundedCents omitted -> defaults to 0
            },
          ],
        }),
      ],
      doorSales: [],
    });
    // 100 - 5 - 100 + 0 = -5 → clamped to 0
    expect(summary.onlineNetMajor).toBe(0);
    expect(summary.expectedPayoutMajor).toBe(0);
  });

  test("T-09 currency mismatch path unaffected by expectedPayout wiring", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "USD",
      orders: [
        order({
          id: "usd-paid",
          currency: "USD",
          totalGbpAtPurchase: 50,
          totalAtPurchase: 50,
          totalCents: 5000,
          stripeApplicationFeeAmountCents: 250,
          paymentMethod: "card",
        }),
        order({
          id: "gbp-stale",
          currency: "GBP",
          totalGbpAtPurchase: 100,
          paymentMethod: "card",
        }),
      ],
      doorSales: [],
    });
    expect(summary.mismatches).toHaveLength(1);
    expect(summary.mismatches[0].id).toBe("gbp-stale");
    expect(summary.onlineNetMajor).toBe(47.5); // only USD order contributes
    expect(summary.expectedPayoutMajor).toBe(47.5);
  });
});
