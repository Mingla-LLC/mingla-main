/**
 * #4271 retest T5 — one door sale, one set of numbers. Every row is the tester's
 * refund_arithmetic table (a 2 x £15 sale, 4.5% fee): the net is the charge, less
 * the refund, less the fee Mingla still holds after the provider's fee reversal.
 */
import type { DoorSaleRecord } from "../../types/doorSales";
import type { OrderRecord } from "../../store/orderStore";
import { doorSaleMoney, summarizeEventMoney } from "../moneySummary";
import { computeReconciliation, isDoorOrder } from "../reconciliation";
import { reconciliationCsvRows, serializeGuestsToCsv } from "../guestCsvExport";

jest.mock("react-native", () => ({ Platform: { OS: "web" }, Share: { share: jest.fn() } }));

const sale = (over: Partial<DoorSaleRecord>): DoorSaleRecord => ({
  id: "sale-1",
  eventId: "event-1",
  brandId: "brand-1",
  recordedBy: "",
  buyerName: "Ada",
  buyerEmail: "",
  buyerPhone: "",
  paymentMethod: "pay_code",
  lines: [],
  totalGbpAtSale: 31.35,
  totalAtSale: 31.35,
  currency: "GBP",
  notes: "",
  recordedAt: "2026-11-04T20:00:00.000Z",
  status: "completed",
  refundedAmountGbp: 0,
  refundedAmount: 0,
  refunds: [],
  minglaFeeAmount: 1.35,
  ...over,
});

const refunded = (charged: number, refund: number, feeBackCents: number): Partial<DoorSaleRecord> => ({
  totalGbpAtSale: charged,
  totalAtSale: charged,
  refundedAmountGbp: refund,
  refundedAmount: refund,
  status: refund === 0 ? "completed" : refund >= 30 ? "refunded_full" : "refunded_partial",
  refunds: refund === 0
    ? []
    : [{
        id: "refund-1",
        saleId: "sale-1",
        amountGbp: refund,
        amount: refund,
        reason: "Guest asked",
        refundedAt: "2026-11-04T21:00:00.000Z",
        applicationFeeRefundedCents: feeBackCents,
        lines: [],
      }],
});

// charged, refund, fee back (cents), live, fee held, true net: refund_arithmetic.txt.
const TABLE: [string, number, number, number, number, number, number][] = [
  ["guests pay, no refund", 31.35, 0, 0, 31.35, 1.35, 30],
  ["guests pay, half refund", 31.35, 15, 65, 16.35, 0.7, 15.65],
  ["guests pay, full refund", 31.35, 30, 129, 1.35, 0.06, 1.29],
  ["absorbed, no refund", 30, 0, 0, 30, 1.35, 28.65],
  ["absorbed, half refund", 30, 15, 68, 15, 0.67, 14.33],
  ["absorbed, full refund", 30, 30, 135, 0, 0, 0],
];

describe.each(["pay_code", "tap_to_pay"] as const)("#4271 T5 door money, %s", (paymentMethod) => {
  test.each(TABLE)("%s", (_name, charged, refund, feeBack, live, feeHeld, net) => {
    const record = sale({ paymentMethod, ...refunded(charged, refund, feeBack) });

    // Sale detail.
    const money = doorSaleMoney(record);
    expect(money.net).toBe(net);
    expect(money.minglaFee).toBeCloseTo(feeHeld, 2);

    // Door list and hub.
    const hub = summarizeEventMoney({ expectedCurrency: "GBP", orders: [], doorSales: [record] });
    expect(hub.doorRevenue).toBe(live);
    expect(hub.doorCardMinglaFee).toBeCloseTo(feeHeld, 2);
    expect(hub.doorNet).toBe(net);

    // Reconciliation: the same order also sits in the orders stream, at the
    // ticket base for a pay code. It must not change or double any figure.
    const order = {
      id: "sale-1",
      eventId: "event-1",
      source: "online_checkout",
      paymentMethod,
      status: refund >= 30 ? "refunded_full" : refund > 0 ? "refunded_partial" : "paid",
      totalGbpAtPurchase: 30,
      totalAtPurchase: 30,
      totalCents: 3000,
      refundedAmountGbp: refund,
      refundedAmount: refund,
      refundedAmountCents: refund * 100,
      stripeApplicationFeeAmountCents: 135,
      currency: "GBP",
      refunds: [],
      lines: [],
      paidAt: "2026-11-04T20:00:00.000Z",
      buyer: { name: "Ada", email: "", phone: "" },
    } as unknown as OrderRecord;
    const recon = computeReconciliation({
      eventId: "event-1",
      status: "live",
      eventName: "Night",
      currency: "GBP",
      orderEntries: [order],
      doorEntries: [record],
      scanEntries: [],
    });
    expect(recon.revenueByMethod[paymentMethod]).toBe(live > 0 ? live : 0);
    expect(recon.grossRevenue).toBe(live);
    expect(recon.expectedPayoutMajor).toBe(net);

    // CSV: one row for the sale, with the same numbers.
    const csv = serializeGuestsToCsv(
      reconciliationCsvRows({ orders: [order], doorSales: [record] }),
    );
    const rows = csv.split("\r\n").filter((line) => line.includes("sale-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0].startsWith("DOOR,")).toBe(true);
    expect(rows[0]).toContain(`,${charged.toFixed(2)},GBP,${refund.toFixed(2)},GBP,${net.toFixed(2)},GBP`);
  });
});

describe("#4271 T5 the rest of the shape", () => {
  test("Reconciliation Buyer's phone equals the door hub across many sales", () => {
    const sales = Array.from({ length: 11 }, (_, i) =>
      sale({ id: `s-${i}`, ...refunded(52.27, 0, 0), minglaFeeAmount: 2.25 }),
    );
    const hub = summarizeEventMoney({ expectedCurrency: "GBP", orders: [], doorSales: sales });
    const recon = computeReconciliation({
      eventId: "event-1",
      status: "live",
      eventName: "Night",
      currency: "GBP",
      orderEntries: [],
      doorEntries: sales,
      scanEntries: [],
    });
    expect(recon.revenueByMethod.pay_code).toBe(hub.revenueByMethod.pay_code);
    expect(recon.revenueByMethod.pay_code).toBe(574.97);
  });

  test("a refund whose fee reversal the provider hasn't confirmed shows no net", () => {
    const record = sale({
      ...refunded(31.35, 15, 0),
      refunds: [{ ...refunded(31.35, 15, 0).refunds![0], applicationFeeRefundedCents: null }],
    });
    expect(doorSaleMoney(record).net).toBeNull();
    expect(
      summarizeEventMoney({ expectedCurrency: "GBP", orders: [], doorSales: [record] }).doorNet,
    ).toBeNull();
  });

  test("cash carries no fee and its net is the money kept", () => {
    const cash = sale({ paymentMethod: "cash", totalGbpAtSale: 30, totalAtSale: 30, minglaFeeAmount: null });
    expect(doorSaleMoney(cash)).toMatchObject({ charged: 30, minglaFee: 0, net: 30 });
  });

  test("a cash door order in the orders stream appears once in the CSV", () => {
    const order = { id: "cash-1", source: "door_sale", paymentMethod: "cash" } as unknown as OrderRecord;
    expect(isDoorOrder(order)).toBe(true);
    const rows = reconciliationCsvRows({
      orders: [order],
      doorSales: [sale({ id: "cash-1", paymentMethod: "cash", minglaFeeAmount: null })],
    });
    expect(rows.map((row) => row.kind)).toEqual(["door"]);
  });

  test("an ordinary online order stays in the CSV as an online row", () => {
    const order = {
      id: "online-1",
      source: "online_checkout",
      paymentMethod: "card",
      paidAt: "2026-11-04T20:00:00.000Z",
    } as unknown as OrderRecord;
    expect(reconciliationCsvRows({ orders: [order], doorSales: [] }).map((row) => row.kind)).toEqual(["order"]);
  });
});
