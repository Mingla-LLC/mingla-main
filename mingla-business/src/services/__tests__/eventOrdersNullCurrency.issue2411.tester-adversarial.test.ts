jest.mock("../supabase", () => ({
  supabase: { from: jest.fn() },
}));

import {
  mapEventOrderRows,
  type OrderRow,
} from "../eventOrdersService";
import { summarizeEventMoney } from "../../utils/moneySummary";
import { OrderCurrencyContractError } from "../../utils/orderCurrencyContract";

const row = (id: string, currency: string | null = null): OrderRow => ({
  id,
  event_id: "event_2411",
  buyer_email: `${id}@example.test`,
  buyer_name: `Buyer ${id}`,
  buyer_phone_e164: null,
  buyer_phone: null,
  total_cents: 0,
  currency,
  payment_method: "free",
  payment_status: "paid",
  confirmed_at: "2026-08-21T12:00:00.000Z",
  created_at: "2026-08-21T12:00:00.000Z",
  cancelled_at: null,
  cancelled_by: null,
  cancellation_reason: null,
  refunded_amount_cents: 0,
  stripe_application_fee_amount_cents: null,
  pricing_breakdown: null,
  events: { brand_id: "brand_2411" },
  order_line_items: [{
    id: `line_${id}`,
    ticket_type_id: "ticket_free",
    quantity: 1,
    unit_price_cents: 0,
    total_cents: 0,
    ticket_types: { name: "Free admission", is_free: true },
  }],
  refunds: [],
});

const expectCode = (work: () => unknown, code: string): void => {
  try {
    work();
    throw new Error("expected contract error");
  } catch (error) {
    expect(error).toBeInstanceOf(OrderCurrencyContractError);
    expect((error as OrderCurrencyContractError).code).toBe(code);
  }
};

describe("#2411 tester adversarial currency contract", () => {
  test("normalizes whitespace without assigning a denomination to genuinely free rows", () => {
    const orders = mapEventOrderRows([
      row("free_null"),
      row("free_blank", "   "),
      row("free_real_code", " ngn "),
    ]);

    expect(orders.map((order) => order.currency)).toEqual([null, null, "NGN"]);
    expect(orders.map((order) => order.paymentMethod)).toEqual(["free", "free", "free"]);
    expect(
      summarizeEventMoney({ expectedCurrency: null, orders: orders.slice(0, 2), doorSales: [] }),
    ).toMatchObject({
      expectedCurrency: null,
      onlineRevenue: 0,
      onlineRefunded: 0,
      expectedPayoutMajor: null,
      byCurrency: [],
      currenciesPresent: [],
    });
  });

  test("rejects a mixed response atomically when a line carries money without currency", () => {
    const invalid = row("invalid_line");
    invalid.order_line_items[0] = {
      ...invalid.order_line_items[0],
      unit_price_cents: 500,
      total_cents: 500,
      ticket_types: { name: "Paid admission", is_free: false },
    };

    expectCode(
      () => mapEventOrderRows([row("valid_before"), invalid, row("valid_after")]),
      "order_currency_missing_for_money",
    );
  });

  test("rejects succeeded refund disagreement even when the cached refunded total is zero", () => {
    const paid = row("paid", " ngn ");
    paid.total_cents = 1000;
    paid.payment_method = "online_card";
    paid.order_line_items[0] = {
      ...paid.order_line_items[0],
      unit_price_cents: 1000,
      total_cents: 1000,
      ticket_types: { name: "Paid admission", is_free: false },
    };
    paid.refunds = [{
      id: "refund_mismatch",
      amount_cents: 500,
      currency: " usd ",
      reason: "Buyer request",
      status: "succeeded",
      processed_at: "2026-08-21T13:00:00.000Z",
      created_at: "2026-08-21T13:00:00.000Z",
      stripe_refund_id: "re_2411",
      application_fee_refunded_cents: 0,
      application_fee_refund_status: "not_applicable",
      refund_line_items: [],
    }];

    expectCode(() => mapEventOrderRows([paid]), "refund_currency_mismatch");
  });
});
