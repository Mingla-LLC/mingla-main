jest.mock("../supabase", () => ({
  supabase: { from: jest.fn() },
}));

import {
  getEventOrderRevenue,
  getEventSoldCounts,
  mapEventOrderRows,
  type OrderRow,
} from "../eventOrdersService";
import { summarizeEventMoney } from "../../utils/moneySummary";
import { OrderCurrencyContractError } from "../../utils/orderCurrencyContract";

const freeRow = (id: string, quantity: number): OrderRow => ({
  id,
  event_id: "event_2411",
  buyer_email: `${id}@example.com`,
  buyer_name: `Buyer ${id}`,
  buyer_phone_e164: null,
  buyer_phone: null,
  total_cents: 0,
  currency: null,
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
  order_line_items: [
    {
      id: `line_${id}`,
      ticket_type_id: "ticket_free",
      quantity,
      unit_price_cents: 0,
      total_cents: 0,
      ticket_types: { name: "Free admission", is_free: true },
    },
  ],
  refunds: [],
});

const expectContractCode = (work: () => unknown, code: string): void => {
  try {
    work();
    throw new Error("expected currency contract failure");
  } catch (error) {
    expect(error).toBeInstanceOf(OrderCurrencyContractError);
    expect((error as OrderCurrencyContractError).code).toBe(code);
  }
};

describe("#2411 free orders with no established currency", () => {
  test("maps every free order atomically and preserves truthful sold counts without money", () => {
    const thirdOrder = freeRow("order_3", 1);
    thirdOrder.order_line_items.push({
      ...thirdOrder.order_line_items[0],
      id: "line_order_3_second",
      quantity: 2,
    });
    const orders = mapEventOrderRows([
      freeRow("order_1", 1),
      freeRow("order_2", 2),
      thirdOrder,
    ]);

    expect(orders).toHaveLength(3);
    expect(orders.map((order) => order.currency)).toEqual([null, null, null]);
    expect(orders.every((order) => order.paymentMethod === "free")).toBe(true);
    expect(getEventSoldCounts(orders)).toEqual({ ticket_free: 6 });
    expect(getEventOrderRevenue(orders, null)).toMatchObject({
      soldCount: 6,
      revenue: 0,
      refunded: 0,
      netRevenue: 0,
      currency: null,
    });

    expect(
      summarizeEventMoney({ expectedCurrency: null, orders, doorSales: [] }),
    ).toMatchObject({
      expectedCurrency: null,
      onlineRevenue: 0,
      onlineRefunded: 0,
      grossRevenue: 0,
      expectedPayoutMajor: null,
      byCurrency: [],
      currenciesPresent: [],
    });
  });

  test("fails the entire mapping for positive money without a valid currency", () => {
    const paidWithoutCurrency = {
      ...freeRow("order_paid", 1),
      total_cents: 1000,
      payment_method: "online_card",
      order_line_items: [
        {
          ...freeRow("seed", 1).order_line_items[0],
          id: "line_paid",
          unit_price_cents: 1000,
          total_cents: 1000,
          ticket_types: { name: "Paid admission", is_free: false },
        },
      ],
    } satisfies OrderRow;
    expectContractCode(
      () => mapEventOrderRows([freeRow("order_free", 1), paidWithoutCurrency]),
      "order_currency_missing_for_money",
    );
  });

  test("fails closed for missing or mismatched positive refund currency", () => {
    const paid = {
      ...freeRow("order_refund", 1),
      total_cents: 1000,
      currency: "GBP",
      payment_method: "online_card",
      refunded_amount_cents: 500,
      order_line_items: [
        {
          ...freeRow("seed", 1).order_line_items[0],
          id: "line_refund",
          unit_price_cents: 1000,
          total_cents: 1000,
          ticket_types: { name: "Paid admission", is_free: false },
        },
      ],
      refunds: [
        {
          id: "refund_1",
          amount_cents: 500,
          currency: null,
          reason: "Requested by buyer",
          status: "succeeded",
          processed_at: "2026-08-21T13:00:00.000Z",
          created_at: "2026-08-21T13:00:00.000Z",
          stripe_refund_id: "re_1",
          application_fee_refunded_cents: 0,
          application_fee_refund_status: "not_applicable" as const,
          refund_line_items: [],
        },
      ],
    } satisfies OrderRow;

    expectContractCode(
      () => mapEventOrderRows([paid]),
      "refund_currency_missing_for_money",
    );
    expectContractCode(
      () =>
        mapEventOrderRows([
          { ...paid, refunds: [{ ...paid.refunds[0], currency: "USD" }] },
        ]),
      "refund_currency_mismatch",
    );

    const [mappedPaid] = mapEventOrderRows([{ ...paid, refunded_amount_cents: 0, refunds: [] }]);
    mappedPaid.refunds = [
      {
        id: "refund_explicit_null",
        orderId: mappedPaid.id,
        amountGbp: 5,
        amount: 5,
        currency: null,
        reason: "Requested by buyer",
        refundedAt: "2026-08-21T13:00:00.000Z",
        lines: [],
      },
    ];
    expectContractCode(
      () => summarizeEventMoney({ expectedCurrency: "GBP", orders: [mappedPaid], doorSales: [] }),
      "refund_currency_missing_for_money",
    );
  });
});
