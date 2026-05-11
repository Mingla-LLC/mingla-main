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
});
