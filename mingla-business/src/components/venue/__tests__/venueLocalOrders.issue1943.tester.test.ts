import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  availableZones,
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
  brandId: "brand-shared",
  venueId,
  sessionId: `session-${id}`,
  fulfillmentStatus: "placed",
  paymentStatus: "paid",
  source: "guest_qr",
  spotLabel: id,
  pickupCode: null,
  zone,
  buyerName: "Guest",
  currency: "USD",
  totalCents: 1000,
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
  qrSpotId: null,
  spotLabel: sessionId,
  tabState: "open",
  currency: "USD",
  roundCount: 1,
  outstandingSubtotalCents: 1000,
  outstandingServiceChargeCents: 0,
  outstandingTipCents: 0,
  outstandingTotalCents: 1000,
  openedAt: "2026-08-12T12:00:00.000Z",
  lastOrderAt: null,
});

const spot = (
  id: string,
  physicalVenueId: string,
  servingVenueId: string,
  isActive = true,
): OrderPadSpot => ({
  id,
  brandId: "brand-shared",
  venueId: physicalVenueId,
  kind: "room_unit",
  venueTableId: null,
  stayUnitId: `unit-${id}`,
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

describe("issue #1943 tester adversarial venue boundary", () => {
  it("never flashes sibling records when poll/realtime snapshots reintroduce mixed rows", () => {
    const snapshots = [
      [order("a-initial", "venue-a", "Patio")],
      [
        order("b-realtime", "venue-b", "Sibling only"),
        order("a-realtime", "venue-a", "Dining room"),
      ],
      [
        order("b-poll", "venue-b", "Sibling only"),
        order("a-poll", "venue-a", "Patio"),
      ],
    ];

    for (const payload of snapshots) {
      const visible = filterVenueOrdersForVenue(payload, "venue-a", null);
      expect(visible.every((row) => row.venueId === "venue-a")).toBe(true);
      expect(availableZones(visible)).not.toContain("Sibling only");
    }

    expect(
      venueLocalTabs(
        [tab("same-name-a", "venue-a"), tab("same-name-b", "venue-b")],
        "venue-a",
      ).map((row) => row.sessionId),
    ).toEqual(["same-name-a"]);
  });

  it("ignores duplicate property names and keeps only rooms actually served by A", () => {
    const groups = orderableSpotGroups(
      [
        spot("Room A-serves", "stay-b", "venue-a"),
        spot("Room C-serves", "stay-c", "venue-c"),
        spot("Room inactive", "stay-b", "venue-a", false),
      ],
      [
        { id: "stay-b", name: "Duplicate Stay", slug: "stay-b" },
        { id: "stay-c", name: "Duplicate Stay", slug: "stay-c" },
      ],
      "venue-a",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.venueName).toBe("Rooms");
    expect(groups[0]?.spots.map((row) => row.id)).toEqual(["Room A-serves"]);
    expect(JSON.stringify(groups)).not.toContain("Duplicate Stay");
  });

  it("keeps every network and mutation boundary pinned to the route venue", () => {
    const moduleSource = readFileSync(join(__dirname, "..", "VenueOrdersModule.tsx"), "utf8");
    const ordersSource = readFileSync(join(__dirname, "..", "..", "..", "hooks", "useVenueOrders.ts"), "utf8");
    const tabsSource = readFileSync(join(__dirname, "..", "..", "..", "hooks", "useVenueOrderTabs.ts"), "utf8");
    const spotsSource = readFileSync(join(__dirname, "..", "..", "..", "hooks", "useQrSpots.ts"), "utf8");

    expect(ordersSource).toContain('.eq("venue_id", venueId)');
    expect(ordersSource).toContain('`venue_id=eq.${venueId}`');
    expect(ordersSource).toContain("venueOrdersKeys.venue(brandId, venueId)");
    expect(tabsSource).toContain(".filter((tab) => venueId === null || tab.venueId === venueId)");
    expect(spotsSource).toContain('.eq("serving_venue_id", servingVenueId)');
    expect(spotsSource).toContain('.eq("is_active", true)');
    expect(moduleSource.match(/order\.venueId !== venueId/g)).toHaveLength(2);
    expect(moduleSource.match(/tab\.venueId !== venueId/g)).toHaveLength(2);
    expect(moduleSource).not.toContain("All venues");
    expect(moduleSource).not.toContain("venueFilter");
  });
});
