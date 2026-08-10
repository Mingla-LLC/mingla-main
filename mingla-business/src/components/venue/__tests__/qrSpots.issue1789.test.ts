/**
 * Issue #1789 (#1767 Phase 1) — Spots inventory + menu-depth client contract.
 * SPEC #1788 P-7c, P-10, P-11, P-12, P-15, P-27.
 *
 * Append-only. Pure logic only (no react-native), so it runs under the default
 * mingla-business node/ts-jest config.
 *
 * fails-on-revert, per test:
 *   T-1  delete the venue grouping             -> the brand loses its ONE list. RED.
 *   T-2  delete spotNeedsServingChoice         -> a room's to-do disappears and a
 *                                                 dead QR looks printable. RED.
 *   T-3  delete the isPrintable gate           -> an inactive spot prints. RED.
 *   T-4  change the printed URL                -> every laminated card opens the
 *                                                 wrong thing (P-10). RED.
 *   T-5  delete the print request builders     -> bulk/single stop agreeing. RED.
 *   T-6  relax validateModifierGroup           -> the client stops mirroring the
 *                                                 DB CHECK and the operator gets a
 *                                                 400 instead of a sentence. RED.
 *   T-7  drop the wrap-past-midnight wording   -> a late-night menu reads as a
 *                                                 typo (P-12). RED.
 *   T-8  delete the one-tap 86 row control     -> 86'ing is 5 taps again (P-15). RED.
 *
 * Run: npx jest src/components/venue/__tests__/qrSpots.issue1789.test.ts --runInBand
 */

import fs from "fs";
import path from "path";

import {
  bulkPrintRequest,
  groupSpotsByVenue,
  isPrintable,
  singlePrintRequest,
  SPOT_SERVING_TODO_LABEL,
  spotNeedsServingChoice,
  spotScanUrl,
  spotSubtitle,
  type QrSpot,
} from "../qrSpots";
import {
  modifierGroupSummary,
  normalizeTimeInput,
  serviceWindowSummary,
  validateModifierGroup,
  validateServiceWindow,
} from "../menuDepth";

const BRAND = "brand-1";
const RESTAURANT = "venue-restaurant";
const STAY = "venue-stay";

const spot = (over: Partial<QrSpot> & Pick<QrSpot, "id" | "label">): QrSpot => ({
  brandId: BRAND,
  venueId: RESTAURANT,
  kind: "table",
  venueTableId: "t-1",
  stayUnitId: null,
  zone: null,
  servingVenueId: RESTAURANT,
  servingMenuId: null,
  code: "kq7m3pd2xr",
  isActive: true,
  autoProvisioned: true,
  sortOrder: 0,
  lastPrintedAt: null,
  ...over,
});

const VENUES = [
  { id: RESTAURANT, name: "The Brasserie", slug: "brasserie" },
  { id: STAY, name: "Grand Hotel", slug: "grandhotel" },
];

describe("#1789 Spots inventory", () => {
  it("T-1 — ONE brand list, grouped by venue, rooms and tables side by side", () => {
    const groups = groupSpotsByVenue(
      [
        spot({ id: "s-2", label: "Table 12", sortOrder: 2 }),
        spot({ id: "s-1", label: "Table 3", sortOrder: 1 }),
        spot({
          id: "s-3",
          label: "Room 204",
          kind: "room_unit",
          venueId: STAY,
          venueTableId: null,
          stayUnitId: "u-1",
          servingVenueId: STAY,
          isActive: false,
        }),
      ],
      VENUES,
    );

    // Two venues, ordered by name: Grand Hotel then The Brasserie.
    expect(groups.map((g) => g.venueName)).toEqual([
      "Grand Hotel",
      "The Brasserie",
    ]);
    // Rooms and tables live in the SAME list, not two.
    expect(groups).toHaveLength(2);
    // Sort order wins inside a venue.
    const brasserie = groups.find((g) => g.venueId === RESTAURANT);
    expect(brasserie?.spots.map((s) => s.label)).toEqual([
      "Table 3",
      "Table 12",
    ]);
    expect(brasserie?.activeCount).toBe(2);
    // The un-set-up room counts as needing attention and prints nothing.
    const hotel = groups.find((g) => g.venueId === STAY);
    expect(hotel?.activeCount).toBe(0);
    expect(hotel?.needsAttentionCount).toBe(1);
  });

  it("T-2 — a room whose kitchen was never chosen carries the to-do, not a dead QR", () => {
    const room = spot({
      id: "s-3",
      label: "Room 204",
      kind: "room_unit",
      venueId: STAY,
      venueTableId: null,
      stayUnitId: "u-1",
      servingVenueId: STAY,
      isActive: false,
    });
    expect(spotNeedsServingChoice(room)).toBe(true);
    expect(SPOT_SERVING_TODO_LABEL).toBe(
      "Choose which kitchen serves this room",
    );

    // Once re-pointed at the sibling restaurant it is a normal, printable spot.
    const repointed = { ...room, servingVenueId: RESTAURANT, isActive: true };
    expect(spotNeedsServingChoice(repointed)).toBe(false);
    expect(
      spotSubtitle(repointed, {
        servingVenueName: "The Brasserie",
        servingMenuName: "In-room dining",
      }),
    ).toBe("Room · Serving: The Brasserie · In-room dining");
  });

  it("T-3 — only ACTIVE spots are printable", () => {
    expect(isPrintable(spot({ id: "a", label: "Table 1" }))).toBe(true);
    expect(
      isPrintable(spot({ id: "b", label: "Table 2", isActive: false })),
    ).toBe(false);
    // A stopped spot still says so on its own row rather than vanishing.
    expect(
      spotSubtitle(spot({ id: "b", label: "Table 2", isActive: false }), {}),
    ).toContain("Not printing");
  });

  it("T-4 — the printed URL is the canonical P-10 string, on the serving venue", () => {
    expect(
      spotScanUrl({
        brandSlug: "brasserie",
        servingVenueSlug: "kitchen",
        code: "kq7m3pd2xr",
      }),
    ).toBe(
      "https://business.usemingla.com/b/brasserie/v/kitchen?tab=menu&spot=kq7m3pd2xr&src=qr",
    );
  });

  it("T-5 — bulk and single print requests hit the same function, one shape", () => {
    expect(bulkPrintRequest(BRAND, null)).toEqual({
      brandId: BRAND,
      layout: "bulk",
    });
    expect(bulkPrintRequest(BRAND, RESTAURANT)).toEqual({
      brandId: BRAND,
      venueId: RESTAURANT,
      layout: "bulk",
    });
    expect(singlePrintRequest(BRAND, "s-1")).toEqual({
      brandId: BRAND,
      spotIds: ["s-1"],
      layout: "single",
    });
  });
});

describe("#1789 menu depth", () => {
  it("T-6 — the client mirrors the modifier-group CHECK so the operator reads a sentence", () => {
    // Happy: a required single choice with two options.
    expect(
      validateModifierGroup({
        name: "How would you like it?",
        selectionMode: "single",
        minSelect: 1,
        maxSelect: 1,
        optionCount: 2,
      }),
    ).toBeNull();
    // A single choice can never allow two.
    expect(
      validateModifierGroup({
        name: "How would you like it?",
        selectionMode: "single",
        minSelect: 0,
        maxSelect: 3,
        optionCount: 3,
      }),
    ).toBe("A single choice allows exactly one option.");
    // Multi with max below min is the DB's select-shape violation.
    expect(
      validateModifierGroup({
        name: "Extras",
        selectionMode: "multi",
        minSelect: 3,
        maxSelect: 1,
        optionCount: 5,
      }),
    ).toBe("The maximum cannot be lower than the minimum.");
    // A group with no options is not a question.
    expect(
      validateModifierGroup({
        name: "Extras",
        selectionMode: "multi",
        minSelect: 0,
        maxSelect: null,
        optionCount: 0,
      }),
    ).toBe("Add at least one option.");

    expect(
      modifierGroupSummary({
        selectionMode: "single",
        minSelect: 1,
        maxSelect: 1,
        optionCount: 3,
      }),
    ).toBe("Pick one · required · 3 options");
    expect(
      modifierGroupSummary({
        selectionMode: "multi",
        minSelect: 0,
        maxSelect: 3,
        optionCount: 1,
      }),
    ).toBe("Pick up to 3 · 1 option");
  });

  it("T-7 — a service window that wraps past midnight says so", () => {
    expect(normalizeTimeInput("07:00")).toBe("07:00");
    expect(normalizeTimeInput("21:00:00")).toBe("21:00");
    expect(normalizeTimeInput("7:0")).toBeNull();
    expect(normalizeTimeInput("")).toBeNull();

    // A half-open window is the DB's menus_service_window_shape violation.
    expect(
      validateServiceWindow({ start: "07:00", end: null, days: null }),
    ).toBe("Set both a start and an end time, or leave both blank.");
    expect(
      validateServiceWindow({ start: "07:00", end: "11:00", days: [1, 2] }),
    ).toBeNull();

    expect(
      serviceWindowSummary({ start: null, end: null, days: null }),
    ).toBe("Available all day, every day");
    expect(
      serviceWindowSummary({ start: "07:00", end: "11:00", days: null }),
    ).toBe("07:00–11:00 · every day");
    // The case a naive reader gets wrong.
    expect(
      serviceWindowSummary({ start: "21:00", end: "02:00", days: [5, 6, 7] }),
    ).toBe("21:00–02:00 (wraps past midnight) · Fri, Sat, Sun");
  });

  it("T-8 — the 86 control lives on the ROW, is one tap, and is manager-plus", () => {
    // P-15 is a UI contract: the flag already existed, so what this test guards
    // is that the CONTROL is on the row rather than five taps inside the form.
    // The module is an RN .tsx that cannot mount under this node config, so the
    // contract is asserted against its source — the house idiom for a
    // structural UI pin.
    const source = fs.readFileSync(
      path.join(__dirname, "..", "VenueMenuModule.tsx"),
      "utf8",
    );
    // The row-level toggle exists, keyed per item.
    expect(source).toContain("venue-menu-item-86-${item.id}");
    // It is a SIBLING Pressable in the row, with a switch role — never nested
    // inside another Pressable (that flattens the a11y subtree).
    expect(source).toMatch(/toggle86\(menu, item\)[\s\S]{0,400}accessibilityRole="switch"/);
    // One tap flips exactly one bit through the EXISTING upsert.
    expect(source).toContain("isAvailable: !item.isAvailable");
    // Manager-plus: the control only renders for a mutating role, and RLS
    // enforces the same floor server-side.
    expect(source).toMatch(/canMutate \? \(\s*<Pressable/);
    // The Spots inventory is reachable from the module every venue has.
    expect(source).toContain("venue-menu-spots-entry");
  });
});
