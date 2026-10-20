// issue #3827 — guest-list comps: sales vs places, on the client.
//
// invariant: I-3827-COMP-NOT-SOLD — client sold, revenue and Orders-list
// helpers exclude comps; capacity-guard helpers include them.
//
// FAILS-ON-REVERT (recorded on #3827):
//   5. delete the comp skip in liveCountsByTier / getEventTicketsSold
//      -> "sold excludes comps" and the sold-label test fail
//   6. revert buildSoldCountContextFromOrders.soldCountByTier to sold-only
//      -> "a capacity guard counts guest-list places" fails

jest.mock("../supabase", () => ({
  supabase: { from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock("../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));

import { describe, expect, test } from "@jest/globals";

import {
  buildSoldCountContextFromOrders,
  getEventIssuedCounts,
  getEventOrderActivity,
  getEventOrderRevenue,
  getEventSoldCounts,
  mapEventOrderRows,
  type OrderRow,
} from "../eventOrdersService";
import type { OrderRecord } from "../../store/orderStore";
import type { TicketStub } from "../../store/draftEventStore";
import { buildEventSalesSummary } from "../../utils/eventSalesSummary";
import { guestListTicketCount, isCompOrder, withoutCompOrders } from "../../utils/compOrders";
import { computeReconciliation } from "../../utils/reconciliation";
import { serializeGuestsToCsv, type ExportGuestRow } from "../../utils/guestCsvExport";

const sale = (patch: Partial<OrderRecord> = {}): OrderRecord => ({
  id: "sale-1",
  eventId: "event-1",
  brandId: "brand-1",
  buyer: { name: "Paid Buyer", email: "buyer@example.com", phone: "+15555550123", marketingOptIn: false },
  lines: [{
    ticketTypeId: "tt-ga",
    ticketNameAtPurchase: "General admission",
    unitPriceGbpAtPurchase: 20,
    unitPriceAtPurchase: 20,
    isFreeAtPurchase: false,
    quantity: 2,
    refundedQuantity: 0,
    refundedAmountGbp: 0,
    refundedAmount: 0,
  }],
  ticketDays: [
    { ticketId: "t-s1", ticketTypeId: "tt-ga", eventDateIds: [], status: "valid", usedAt: null },
    { ticketId: "t-s2", ticketTypeId: "tt-ga", eventDateIds: [], status: "used", usedAt: "2026-11-01T20:00:00Z" },
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

const comp = (patch: Partial<OrderRecord> = {}): OrderRecord =>
  sale({
    id: "comp-1",
    buyer: { name: "Ana Bello", email: "ana@example.com", phone: "", marketingOptIn: false },
    lines: [{
      ticketTypeId: "tt-ga",
      ticketNameAtPurchase: "General admission",
      unitPriceGbpAtPurchase: 0,
      unitPriceAtPurchase: 0,
      isFreeAtPurchase: true,
      quantity: 3,
      refundedQuantity: 0,
      refundedAmountGbp: 0,
      refundedAmount: 0,
    }],
    ticketDays: [
      { ticketId: "t-c1", ticketTypeId: "tt-ga", eventDateIds: [], status: "valid", usedAt: null },
      { ticketId: "t-c2", ticketTypeId: "tt-ga", eventDateIds: [], status: "valid", usedAt: null },
      { ticketId: "t-c3", ticketTypeId: "tt-ga", eventDateIds: [], status: "valid", usedAt: null },
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

describe("issue #3827 — the server row maps its source", () => {
  const row = (patch: Partial<OrderRow>): OrderRow => ({
    id: "o-1",
    event_id: "event-1",
    buyer_email: "ana@example.com",
    buyer_name: "Ana Bello",
    buyer_phone_e164: null,
    buyer_phone: null,
    total_cents: 0,
    currency: "GBP",
    payment_method: "free",
    payment_status: "paid",
    confirmed_at: "2026-10-20T10:00:00Z",
    created_at: "2026-10-20T10:00:00Z",
    cancelled_at: null,
    cancelled_by: null,
    cancellation_reason: null,
    refunded_amount_cents: 0,
    stripe_application_fee_amount_cents: 0,
    pricing_breakdown: null,
    events: { brand_id: "brand-1" },
    order_line_items: [],
    refunds: [],
    ...patch,
  });

  test("source comp, the note and the party lead are mapped", () => {
    const [mapped] = mapEventOrderRows([row({
      source: "comp",
      comp_reason: "Press list",
      comp_party_lead_order_id: "lead-1",
      party_lead_name: "Ada Okoro",
    })]);
    expect(mapped.source).toBe("comp");
    expect(isCompOrder(mapped)).toBe(true);
    expect(mapped.compReason).toBe("Press list");
    expect(mapped.partyLeadOrderId).toBe("lead-1");
    expect(mapped.partyLeadName).toBe("Ada Okoro");
  });

  test("an absent source is a sale; an unknown one maps to legacy", () => {
    expect(mapEventOrderRows([row({})])[0].source).toBe("online_checkout");
    expect(mapEventOrderRows([row({ source: "mystery" })])[0].source).toBe("legacy");
  });
});

describe("issue #3827 — sold and revenue are sales only (I-3827-COMP-NOT-SOLD)", () => {
  const orders = [sale(), comp()];

  test("sold excludes comps; issued includes them", () => {
    expect(getEventSoldCounts(orders)).toEqual({ "tt-ga": 2 });
    expect(getEventIssuedCounts(orders)).toEqual({ "tt-ga": 5 });
    expect(getEventOrderRevenue(orders, "GBP")).toMatchObject({ soldCount: 2, revenue: 40 });
  });

  test("a capacity guard counts guest-list places; the buyer count does not", () => {
    const ctx = buildSoldCountContextFromOrders(orders);
    expect(ctx.soldCountByTier).toEqual({ "tt-ga": 5 });
    expect(ctx.soldCountForEvent).toBe(1);
  });

  test("the Orders ledger drops comps; the guest count keeps them", () => {
    expect(withoutCompOrders(orders).map((o) => o.id)).toEqual(["sale-1"]);
    expect(guestListTicketCount(orders)).toBe(3);
    expect(guestListTicketCount([comp({ status: "cancelled" })])).toBe(0);
    expect(guestListTicketCount([comp({
      ticketDays: [
        { ticketId: "t-c1", ticketTypeId: "tt-ga", eventDateIds: [], status: "void", usedAt: null },
        { ticketId: "t-c2", ticketTypeId: "tt-ga", eventDateIds: [], status: "used", usedAt: "2026-11-01T20:00:00Z" },
      ],
    })])).toBe(1);
  });

  test("a guest-list guest never 'bought' anything in the activity feed", () => {
    const activity = getEventOrderActivity([comp()]);
    expect(activity[0].summary).toBe("was added to the guest list");
    expect(activity.some((a) => a.summary.startsWith("bought"))).toBe(false);
  });
});

describe("issue #3827 — dashboard label: '{sold} sold · {guest list} guest list / {capacity}'", () => {
  test("finite capacity with guest-list places", () => {
    const summary = buildEventSalesSummary({
      eventId: "event-1",
      tickets: [ticket()],
      eventCurrency: "GBP",
      orders: [sale(), comp()],
    });
    expect(summary.soldCount).toBe(2);
    expect(summary.guestListCount).toBe(3);
    expect(summary.issuedCount).toBe(5);
    expect(summary.soldLabel).toBe("2 sold · 3 guest list / 100");
    expect(summary.revenueLabel).toContain("40");
  });

  test("no guest list keeps today's label exactly", () => {
    const summary = buildEventSalesSummary({
      eventId: "event-1",
      tickets: [ticket()],
      eventCurrency: "GBP",
      orders: [sale()],
    });
    expect(summary.soldLabel).toBe("2 / 100");
  });

  test("unlimited capacity", () => {
    const summary = buildEventSalesSummary({
      eventId: "event-1",
      tickets: [ticket({ isUnlimited: true, capacity: null })],
      eventCurrency: "GBP",
      orders: [sale(), comp()],
    });
    expect(summary.soldLabel).toBe("2 sold · 3 guest list");
  });
});

describe("issue #3827 — reconciliation reads guest-list tickets from the server", () => {
  test("comps come from orders; online sold and revenue skip them", () => {
    const summary = computeReconciliation({
      eventId: "event-1",
      status: "live",
      eventName: "Rooftop",
      currency: "GBP",
      orderEntries: [sale(), comp()],
      doorEntries: [],
      scanEntries: [],
    });
    expect(summary.onlineLiveTickets).toBe(2);
    expect(summary.compTickets).toBe(3);
    expect(summary.totalLiveTickets).toBe(5);
    expect(summary.onlineRevenue).toBe(40);
  });
});

describe("issue #3827 — CSV: a guest-list row is COMP with no money", () => {
  test("Kind COMP, payment method Guest list, money 0, the note, Came with; Day stays last", () => {
    const rows: ExportGuestRow[] = [
      { kind: "order", id: "comp-1", order: comp({ partyLeadOrderId: "lead-1", partyLeadName: "Ada Okoro" }), sortKey: "x" },
    ];
    const [header, line] = serializeGuestsToCsv(rows).split("\r\n");
    const cols = header.split(",");
    expect(cols[cols.length - 1]).toBe("Day");
    expect(cols[cols.length - 2]).toBe("Came with");
    const cells = line.split(",");
    expect(cells[0]).toBe("COMP");
    expect(cells[6]).toBe("Guest list");
    expect(cells[7]).toBe("Guest list");
    expect(cells[10]).toBe("Press list");
    expect([cells[11], cells[13], cells[15]]).toEqual(["0.00", "0.00", "0.00"]);
    expect(cells[cols.length - 2]).toBe("Ada Okoro");
  });
});
