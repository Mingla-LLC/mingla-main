import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  filterVenueOrdersForVenue,
  type VenueOrder,
} from "../venueOrderViews";
import {
  orderableSpotGroups,
  venueLocalTabs,
  type OrderPadSpot,
  type OrderPadTab,
} from "../orderPad/venueOrderPad";

const order = (id: string, venueId: string, zone: string | null): VenueOrder => ({
  id,
  brandId: "brand-1",
  venueId,
  sessionId: `session-${id}`,
  fulfillmentStatus: "placed",
  paymentStatus: "paid",
  source: "guest_qr",
  spotLabel: `Table ${id}`,
  pickupCode: null,
  zone,
  buyerName: "Guest",
  currency: "USD",
  totalCents: 1200,
  tipCents: 0,
  itemCount: 1,
  lines: [],
  placedAt: "2026-08-12T12:00:00.000Z",
  acknowledgedAt: null,
  acknowledgedByUserId: null,
  readyAt: null,
  deliveredAt: null,
  refundRequestedAt: null,
  refundDecision: null,
  escalationLevel: 0,
});

const tab = (sessionId: string, venueId: string): OrderPadTab => ({
  sessionId,
  venueId,
  qrSpotId: `spot-${sessionId}`,
  spotLabel: `Table ${sessionId}`,
  tabState: "open",
  currency: "USD",
  roundCount: 1,
  outstandingSubtotalCents: 1000,
  outstandingServiceChargeCents: 0,
  outstandingTipCents: 0,
  outstandingTotalCents: 1000,
  openedAt: "2026-08-12T12:00:00.000Z",
  lastOrderAt: "2026-08-12T12:00:00.000Z",
});

const spot = (
  id: string,
  venueId: string,
  servingVenueId: string,
  kind: OrderPadSpot["kind"],
  isActive = true,
): OrderPadSpot => ({
  id,
  brandId: "brand-1",
  venueId,
  kind,
  venueTableId: kind === "table" ? `table-${id}` : null,
  stayUnitId: kind === "room_unit" ? `room-${id}` : null,
  zone: null,
  label: id,
  servingVenueId,
  servingMenuId: "menu-a",
  code: `code-${id}`,
  isActive,
  autoProvisioned: false,
  sortOrder: 0,
  lastPrintedAt: null,
});

describe("issue #1943 venue-local Orders", () => {
  it("keeps mixed order and tab payloads inside the route venue", () => {
    const orders = [
      order("a-foh", "venue-a", "Front"),
      order("a-patio", "venue-a", "Patio"),
      order("b-front", "venue-b", "Front"),
    ];
    expect(filterVenueOrdersForVenue(orders, "venue-a", null).map((row) => row.id))
      .toEqual(["a-foh", "a-patio"]);
    expect(filterVenueOrdersForVenue(orders, "venue-a", "Front").map((row) => row.id))
      .toEqual(["a-foh"]);
    expect(filterVenueOrdersForVenue(orders, null, null)).toEqual([]);

    expect(
      venueLocalTabs(
        [tab("a-open", "venue-a"), tab("b-open", "venue-b")],
        "venue-a",
      ).map((row) => row.sessionId),
    ).toEqual(["a-open"]);
    expect(venueLocalTabs([tab("a-open", "venue-a")], null)).toEqual([]);
  });

  it("offers only active destinations served by the route venue", () => {
    const groups = orderableSpotGroups(
      [
        spot("Table 4", "venue-a", "venue-a", "table"),
        spot("Room 204", "stay-b", "venue-a", "room_unit"),
        spot("Room 205", "stay-b", "venue-c", "room_unit"),
        spot("Room 206", "stay-b", "venue-a", "room_unit", false),
        spot("Pool pickup", "stay-b", "venue-a", "custom"),
      ],
      [
        { id: "venue-a", name: "Academy Street Bistro", slug: "academy" },
        { id: "stay-b", name: "Mingla Stay", slug: "stay" },
      ],
      "venue-a",
    );

    expect(groups.map((group) => group.venueName)).toEqual([
      "Tables",
      "Rooms",
      "Other pickup spots",
    ]);
    expect(groups.flatMap((group) => group.spots.map((row) => row.id))).toEqual([
      "Table 4",
      "Room 204",
      "Pool pickup",
    ]);
  });

  it("removes sibling navigation and binds reads, tabs, spots and mutations to venueId", () => {
    const source = readFileSync(
      join(__dirname, "..", "VenueOrdersModule.tsx"),
      "utf8",
    );
    expect(source).not.toContain("All venues");
    expect(source).not.toContain("venueFilter");
    expect(source).toContain("useVenueOrders(scopedBrandId, venueId)");
    expect(source).toContain("useVenueTabs(scopedBrandId, venueId)");
    expect(source).toContain("useQrSpots(scopedBrandId, venueId)");
    expect(source).toContain("order.venueId !== venueId");
    expect(source).toContain("tab.venueId !== venueId");
    expect(source).toContain("venueId={venueId}");
  });
});
