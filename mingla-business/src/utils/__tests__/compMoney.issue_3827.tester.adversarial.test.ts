// issue #3827 — guest-list comps, TESTER ADVERSARIAL (client money + places).
//
// Angles the implementor file does not take:
//   M-1  a comp carrying a STRAY price (corrupt / future row) still never
//        reaches sold, revenue or reconciliation money
//   M-2  a comp in a different currency from the event never creates a
//        currency mismatch or flips the revenue label
//   M-3  comps-only event: the "Refund N orders" buyer count is 0 (no false
//        "time change with sales" refusal) while the capacity floor still
//        counts every issued place, per night too
//   M-4  cancelled comps and voided comp tickets hold no place anywhere
//   M-5  CSV: every row kind has exactly as many cells as the header, and a
//        comp row never prints a price even when its line carries one
//   M-6  getEventOrderActivity: a cancelled comp never reads "cancelled their
//        order" (the guest did nothing)

jest.mock("../../services/supabase", () => ({
  supabase: { from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock("../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));

import { describe, expect, test } from "@jest/globals";

import {
  buildSoldCountContextFromOrders,
  getEventOrderActivity,
  getEventOrderRevenue,
  getEventSoldCounts,
} from "../../services/eventOrdersService";
import type { OrderRecord } from "../../store/orderStore";
import type { TicketStub } from "../../store/draftEventStore";
import type { DoorSaleRecord } from "../../types/doorSales";
import { buildEventSalesSummary, getEventTicketsSold } from "../eventSalesSummary";
import { guestListTicketCount } from "../compOrders";
import { computeReconciliation } from "../reconciliation";
import { serializeGuestsToCsv, type ExportGuestRow } from "../guestCsvExport";

const line = (patch: Partial<OrderRecord["lines"][number]> = {}): OrderRecord["lines"][number] => ({
  ticketTypeId: "tt-ga",
  ticketNameAtPurchase: "General admission",
  unitPriceGbpAtPurchase: 20,
  unitPriceAtPurchase: 20,
  isFreeAtPurchase: false,
  quantity: 2,
  refundedQuantity: 0,
  refundedAmountGbp: 0,
  refundedAmount: 0,
  ...patch,
});

const sale = (patch: Partial<OrderRecord> = {}): OrderRecord => ({
  id: "sale-1",
  eventId: "event-1",
  brandId: "brand-1",
  buyer: { name: "Paid Buyer", email: "buyer@example.com", phone: "+15555550123", marketingOptIn: false },
  lines: [line()],
  ticketDays: [
    { ticketId: "t-s1", ticketTypeId: "tt-ga", eventDateIds: [], status: "valid", usedAt: null },
    { ticketId: "t-s2", ticketTypeId: "tt-ga", eventDateIds: [], status: "valid", usedAt: null },
  ],
  totalGbpAtPurchase: 40,
  totalAtPurchase: 40,
  totalCents: 4000,
  currency: "GBP",
  paymentMethod: "card",
  paidAt: "2026-10-20T10:00:00.000Z",
  status: "paid",
  refundedAmountGbp: 0,
  refundedAmount: 0,
  refunds: [],
  cancelledAt: null,
  source: "online_checkout",
  lastSeenEventUpdatedAt: "2026-10-20T10:00:00.000Z",
  ...patch,
});

// A comp whose line STILL carries a price (a corrupt or future row). The
// server shape check forbids money on the order; the client must not trust
// the line either.
const pricedComp = (patch: Partial<OrderRecord> = {}): OrderRecord =>
  sale({
    id: "comp-1",
    buyer: { name: "Ana Bello", email: "ana@example.com", phone: "", marketingOptIn: false },
    lines: [line({ quantity: 3, unitPriceGbpAtPurchase: 50, unitPriceAtPurchase: 50, isFreeAtPurchase: false })],
    ticketDays: [
      { ticketId: "t-c1", ticketTypeId: "tt-ga", eventDateIds: ["night-1"], status: "valid", usedAt: null },
      { ticketId: "t-c2", ticketTypeId: "tt-ga", eventDateIds: ["night-1"], status: "valid", usedAt: null },
      { ticketId: "t-c3", ticketTypeId: "tt-ga", eventDateIds: ["night-1"], status: "valid", usedAt: null },
    ],
    totalGbpAtPurchase: 0,
    totalAtPurchase: 0,
    totalCents: 0,
    paymentMethod: "free",
    source: "comp",
    compReason: "Press list",
    ...patch,
  });

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "tt-ga",
  name: "General admission",
  priceGbp: 20,
  currency: "GBP",
  capacity: 100,
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

describe("M-1 a priced comp line never becomes sold or revenue", () => {
  const orders = [sale(), pricedComp()];

  test("sold, revenue and the dashboard ignore the comp line price", () => {
    expect(getEventSoldCounts(orders)).toEqual({ "tt-ga": 2 });
    expect(getEventTicketsSold(orders)).toBe(2);
    const rev = getEventOrderRevenue(orders, "GBP");
    expect(rev.soldCount).toBe(2);
    expect(rev.revenue).toBe(40);
    const summary = buildEventSalesSummary({ eventId: "event-1", tickets: [ticket()], eventCurrency: "GBP", orders });
    expect(summary.soldCount).toBe(2);
    expect(summary.guestListCount).toBe(3);
    expect(summary.onlineRevenue).toBe(40);
  });

  test("reconciliation money skips the comp; its places still count", () => {
    const r = computeReconciliation({
      eventId: "event-1",
      status: "live",
      eventName: "Rooftop",
      currency: "GBP",
      orderEntries: orders,
      doorEntries: [],
      scanEntries: [],
    });
    expect(r.onlineRevenue).toBe(40);
    expect(r.onlineLiveTickets).toBe(2);
    expect(r.compTickets).toBe(3);
    expect(r.totalLiveTickets).toBe(5);
  });
});

describe("M-2 a comp in another currency never creates a mismatch", () => {
  test("NGN event, GBP-coded comp (the server's inert fallback currency)", () => {
    const ngnSale = sale({ currency: "NGN", totalGbpAtPurchase: 5000, totalAtPurchase: 5000, totalCents: 500000 });
    const gbpComp = pricedComp({ currency: "GBP" });
    const summary = buildEventSalesSummary({
      eventId: "event-1",
      tickets: [ticket({ currency: "NGN" })],
      eventCurrency: "NGN",
      orders: [ngnSale, gbpComp],
    });
    expect(summary.mismatches).toEqual([]);
    expect(summary.displayCurrency).toBe("NGN");
    expect(summary.onlineRevenue).toBe(5000);
    const r = computeReconciliation({
      eventId: "event-1",
      status: "live",
      eventName: "Lagos",
      currency: "NGN",
      orderEntries: [ngnSale, gbpComp],
      doorEntries: [],
      scanEntries: [],
    });
    expect(r.onlineRevenue).toBe(5000);
    expect(r.compTickets).toBe(3);
  });
});

describe("M-3 comps-only events: no false 'sales' refusal, a real capacity floor", () => {
  test("the buyer count is 0; every issued place is the floor", () => {
    const ctx = buildSoldCountContextFromOrders([pricedComp(), pricedComp({ id: "comp-2" })]);
    expect(ctx.soldCountForEvent).toBe(0);
    expect(ctx.soldCountByTier).toEqual({ "tt-ga": 6 });
  });

  test("a cancelled comp releases its places from the floor", () => {
    const ctx = buildSoldCountContextFromOrders([pricedComp({ status: "cancelled" })]);
    expect(ctx.soldCountByTier).toEqual({});
    expect(ctx.soldCountForEvent).toBe(0);
  });
});

describe("M-4 cancelled comps and void comp tickets hold no place", () => {
  test("guest-list count, dashboard and reconciliation agree", () => {
    const voided = pricedComp({
      id: "comp-v",
      ticketDays: [
        { ticketId: "v1", ticketTypeId: "tt-ga", eventDateIds: [], status: "void", usedAt: null },
        { ticketId: "v2", ticketTypeId: "tt-ga", eventDateIds: [], status: "void", usedAt: null },
        { ticketId: "v3", ticketTypeId: "tt-ga", eventDateIds: [], status: "used", usedAt: "2026-11-01T21:00:00Z" },
      ],
    });
    const cancelled = pricedComp({ id: "comp-x", status: "cancelled", cancelledAt: "2026-10-21T10:00:00Z" });
    const orders = [voided, cancelled];
    expect(guestListTicketCount(orders)).toBe(1);
    const summary = buildEventSalesSummary({ eventId: "event-1", tickets: [ticket()], eventCurrency: "GBP", orders });
    expect(summary.guestListCount).toBe(1);
    expect(summary.soldCount).toBe(0);
    expect(summary.soldLabel).toBe("0 sold · 1 guest list / 100");
    const r = computeReconciliation({
      eventId: "event-1",
      status: "live",
      eventName: "Rooftop",
      currency: "GBP",
      orderEntries: orders,
      doorEntries: [],
      scanEntries: [],
    });
    expect(r.compTickets).toBe(1);
    expect(r.onlineLiveTickets).toBe(0);
  });
});

describe("M-5 CSV shape and no comp money", () => {
  test("order, comp and door rows each have exactly as many cells as the header", () => {
    const door = {
      id: "door-1",
      eventId: "event-1",
      brandId: "brand-1",
      buyerName: "Walk In",
      buyerEmail: "",
      buyerPhone: "",
      lines: [{ ticketTypeId: "tt-ga", ticketNameAtSale: "General admission", unitPriceGbpAtSale: 20, unitPriceAtSale: 20, isFreeAtSale: false, quantity: 1, refundedQuantity: 0, refundedAmountGbp: 0, refundedAmount: 0 }],
      totalGbpAtSale: 20,
      totalAtSale: 20,
      currency: "GBP",
      paymentMethod: "cash",
      recordedAt: "2026-10-20T21:00:00.000Z",
      recordedBy: "user-1",
      status: "paid",
      refundedAmountGbp: 0,
      refundedAmount: 0,
      refunds: [],
      notes: "",
    } as unknown as DoorSaleRecord;
    const rows: ExportGuestRow[] = [
      { kind: "order", id: "sale-1", order: sale(), sortKey: "a" },
      { kind: "order", id: "comp-1", order: pricedComp({ compReason: "Press, VIP \"list\"" }), sortKey: "b" },
      { kind: "door", id: "door-1", sale: door, sortKey: "c" },
    ];
    const csv = serializeGuestsToCsv(rows);
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    const header = lines.find((l) => l.startsWith("Kind,")) ?? lines[0];
    const headerCells = header.split(",").length;
    // Count cells honouring quotes.
    const cellCount = (l: string): number => {
      let n = 1;
      let quoted = false;
      for (const ch of l) {
        if (ch === "\"") quoted = !quoted;
        else if (ch === "," && !quoted) n += 1;
      }
      return n;
    };
    const dataLines = lines.slice(lines.indexOf(header) + 1);
    expect(dataLines).toHaveLength(3);
    for (const l of dataLines) expect(cellCount(l)).toBe(headerCells);
    const compLine = dataLines.find((l) => l.startsWith("COMP,")) as string;
    expect(compLine).toBeDefined();
    expect(compLine).not.toContain("50.00");
    expect(compLine).not.toContain("150.00");
    expect(compLine).toContain("\"Press, VIP \"\"list\"\"\"");
  });
});

describe("M-6 activity copy for a cancelled comp", () => {
  test("never 'cancelled their order' and never 'bought'", () => {
    const activity = getEventOrderActivity([
      pricedComp({ status: "cancelled", cancelledAt: new Date().toISOString(), paidAt: new Date().toISOString() }),
    ]);
    expect(activity.length).toBeGreaterThan(0);
    for (const a of activity) {
      expect(a.summary).not.toBe("cancelled their order");
      expect(a.summary.startsWith("bought")).toBe(false);
    }
  });
});
