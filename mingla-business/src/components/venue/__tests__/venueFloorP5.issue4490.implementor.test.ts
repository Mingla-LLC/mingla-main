/**
 * #4490 P5-2 — tables under spaces and the floor plan (Host), as pure data:
 * moves, snapping, keeping tables inside the room, undo, the room kept beside
 * the site plan, the live state words, the table form payloads, the By the
 * hour editor (no 60-minute cap, per-minute price), the waitlist line, and
 * `?module=tables` opening Spaces › Tables.
 */
import {
  changedPlaces,
  clampBox,
  defaultTableSize,
  floorErrorCopy,
  freeSpot,
  LIVE_STATE_WORD,
  liveTableLine,
  liveTableState,
  moveBox,
  parseRoom,
  resizeBox,
  roomHeight,
  roomPlanShape,
  rotateBy,
  seatDots,
  snap,
  undoPop,
  undoPush,
  undoReplace,
  undoStart,
  UNDO_LIMIT,
  type Placement,
} from "../features/floor/floorModel";
import {
  nextTableName,
  tableDepositLine,
  tableDepositModePatch,
  tableDepositShareMinor,
  tableDraftFrom,
  tableDraftIssues,
  tablePayload,
} from "../features/floor/tableDraft";
import { waitlistWantsLine } from "../features/floor/waitlistHostModel";
import {
  hourDraftFrom,
  hourIssueList,
  hourIssues,
  hourLengthPayload,
  hourOptionPayload,
  hourPlacePayload,
  hourPriceFor,
  hourReadinessCopy,
  hourRulesPayload,
  maxLengthOptions,
  minLengthOptions,
} from "../features/offers/hourModel";
import { deriveVenueNav, resolveTablesAlias } from "../venueModules";
import { filterVenueModulesForCapabilities } from "../venueCapabilityGate";
import { featureSetFrom } from "../../../types/venueFeatures";
import { mapVenueSpace } from "../../../services/venueFeaturesService";
import { mapFloorPlan, mapFloorTable, toVenueFloorError, type VenueFloorTable } from "../../../services/venueFloorService";

const box = { x: 100, y: 100, w: 90, h: 90, rotation: 0 };

describe("moving tables on the floor", () => {
  it("snaps to a 20-unit grid only when snap is on", () => {
    expect(snap(107, true)).toBe(100);
    expect(snap(111, true)).toBe(120);
    expect(snap(107, false)).toBe(107);
  });
  it("keeps a table inside the room (a wide room is shorter)", () => {
    expect(roomHeight("wide")).toBe(563);
    const out = clampBox({ ...box, x: 990, y: 990 }, "wide");
    expect(out.x).toBe(910);
    expect(out.y).toBe(563 - 90);
    expect(clampBox({ ...box, x: -40, y: -5 }, "rect")).toMatchObject({ x: 0, y: 0 });
  });
  it("nudges, rotates and resizes around the centre", () => {
    expect(moveBox(box, 10, -10, "rect", false)).toMatchObject({ x: 110, y: 90 });
    expect(rotateBy(box, -15).rotation).toBe(345);
    expect(rotateBy({ ...box, rotation: 350 }, 45).rotation).toBe(35);
    const bigger = resizeBox(box, 1.1, "rect");
    expect(bigger.w).toBeCloseTo(99);
    expect(bigger.x + bigger.w / 2).toBeCloseTo(145);
  });
  it("finds a free spot that does not overlap what is there", () => {
    const spot = freeSpot([{ ...box, x: 40, y: 40 }], { w: 90, h: 90 }, "rect");
    expect(spot).not.toEqual({ x: 40, y: 40 });
  });
  it("sizes a new table from its shape and seats", () => {
    expect(defaultTableSize("round", 4)).toEqual({ w: 100, h: 100 });
    expect(defaultTableSize("booth", 6).w).toBeGreaterThan(defaultTableSize("booth", 2).w);
    expect(seatDots("round", { w: 100, h: 100 }, 6)).toHaveLength(6);
    expect(seatDots("rect", { w: 120, h: 80 }, 5)).toHaveLength(5);
  });
});

describe("undo", () => {
  it("pushes, replaces during a drag, and pops", () => {
    let s = undoStart({ n: 1 });
    s = undoPush(s, { n: 2 });
    s = undoReplace(s, { n: 3 });
    expect(s.past).toEqual([{ n: 1 }]);
    s = undoPop(s);
    expect(s.present).toEqual({ n: 1 });
    expect(undoPop(s)).toBe(s);
  });
  it("ignores a step that changes nothing and keeps at most 50 steps", () => {
    let s = undoStart({ n: 0 });
    expect(undoPush(s, { n: 0 })).toBe(s);
    for (let i = 1; i <= UNDO_LIMIT + 10; i += 1) s = undoPush(s, { n: i });
    expect(s.past).toHaveLength(UNDO_LIMIT);
  });
});

describe("saving the layout", () => {
  it("sends only the tables that moved", () => {
    const saved: Record<string, Placement> = { a: { ...box, shape: "round" }, b: { ...box, x: 300, shape: "rect" } };
    const draft: Record<string, Placement> = { a: { ...box, shape: "round" }, b: { ...box, x: 320, shape: "rect" }, c: { ...box, shape: "booth" } };
    expect(changedPlaces(saved, draft).map((w) => w.tableId)).toEqual(["b", "c"]);
  });
  it("keeps the site plan's rectangle when it saves the room", () => {
    const shape = roomPlanShape({ x: 10, y: 20, w: 30, h: 40 }, { shape: "l_shape", landmarks: [{ id: "lm-1", kind: "bar", x: 1, y: 2, w: 300, h: 60, rotation: 0 }] });
    expect(shape).toMatchObject({ x: 10, y: 20, w: 30, h: 40 });
    expect(parseRoom(shape)).toEqual({ shape: "l_shape", landmarks: [{ id: "lm-1", kind: "bar", x: 1, y: 2, w: 300, h: 60, rotation: 0 }] });
  });
  it("a space not on the site plan gets a zero-size box the site plan ignores", () => {
    expect(roomPlanShape(null, { shape: "wide", landmarks: [] })).toMatchObject({ x: 0, y: 0, w: 0, h: 0, room: { shape: "wide" } });
    expect(mapVenueSpace({ id: "s", plan_shape: { x: 0, y: 0, w: 0, h: 0, room: { shape: "wide" } } }).planShape).toBeNull();
    expect(mapVenueSpace({ id: "s", plan_shape: { x: 0, y: 0, w: 0, h: 0, room: { shape: "wide" } } }).planRoom).toEqual({ shape: "wide" });
  });
  it("reads a missing or broken room as a plain rectangle", () => {
    expect(parseRoom(null)).toEqual({ shape: "rect", landmarks: [] });
    expect(parseRoom({ room: { shape: "hexagon", landmarks: [{ kind: "pool" }] } })).toEqual({ shape: "rect", landmarks: [] });
  });
});

describe("live service words (never colour alone)", () => {
  const clock = (iso: string): string => iso.slice(11, 16);
  it("names each state", () => {
    expect(liveTableState({ now: null, next: null })).toBe("free");
    expect(liveTableState({ now: { status: "seated", guestName: "Kunle", partySize: 5, freeAround: null }, next: null })).toBe("seated");
    expect(liveTableState({ now: { status: "requested", guestName: null, partySize: 2, freeAround: null }, next: null })).toBe("not_confirmed");
    expect(LIVE_STATE_WORD.booked).toBe("Booked");
    expect(liveTableLine({ now: { status: "seated", guestName: "Kunle A.", partySize: 5, freeAround: null }, next: null }, clock)).toBe("Seated · Kunle A. · 5");
    expect(liveTableLine({ now: null, next: { status: "confirmed", reservedFor: "2026-11-21T20:30:00Z" } }, clock)).toBe("Free · next 20:30");
  });
  it("maps every refusal to plain words (no raw codes)", () => {
    for (const code of ["stale_write", "table_taken", "min_spend_tables_off", "table_join_invalid", "network", "something_new"]) {
      const words = floorErrorCopy(code);
      expect(words).not.toContain("_");
      expect(words.length).toBeGreaterThan(10);
    }
    expect(toVenueFloorError({ message: "table_taken" }).code).toBe("table_taken");
    expect(toVenueFloorError(new TypeError("Failed to fetch")).code).toBe("network");
  });
});

describe("the floor read and the table form", () => {
  const raw = {
    venueId: "v",
    at: "2026-11-21T19:00:00Z",
    localDate: "2026-11-21",
    timezone: "Africa/Lagos",
    features: { floorPlan: true, pickATable: true, minSpendTables: true },
    partyMax: 8,
    spaces: [{ id: "s1", name: "Dining room", planShape: { room: { shape: "wide" } }, version: 3, tables: [{ id: "t1", name: "B3", capacity: 4, shape: "round", planX: 300, planY: 200, rotation: 0, combinable: true, guestPickable: true, minSpendMinor: 0, depositPerGuestMinor: 500000, joinsWith: ["t2"], now: { reservationId: "r1", guestName: "Ada", partySize: 4, reservedFor: "2026-11-21T18:30:00Z", status: "seated", freeAround: "2026-11-21T20:30:00Z" }, next: null }] }],
    unplaced: [],
    unassigned: [{ reservationId: "r9", guestName: "Halima", partySize: 8, reservedFor: "2026-11-21T19:45:00Z", status: "confirmed", version: 2 }],
  };
  it("maps the floor (tables, who is on them, bookings with no table)", () => {
    const plan = mapFloorPlan(raw);
    expect(plan.spaces[0]?.version).toBe(3);
    expect(plan.spaces[0]?.tables[0]?.now?.guestName).toBe("Ada");
    expect(plan.spaces[0]?.tables[0]?.depositPerGuestMinor).toBe(500000);
    expect(plan.unassigned[0]?.version).toBe(2);
  });
  it("sends only what changed on an update, and min spend only when that feature is on", () => {
    const table = mapFloorTable(raw.spaces[0]?.tables[0]) as VenueFloorTable;
    const d = tableDraftFrom(table, { spaceId: "s1" });
    expect(d.depositMode).toBe("per_guest");
    expect(tablePayload(d, table, { minSpendOn: true })).toEqual({});
    expect(tablePayload({ ...d, capacity: 6 }, table, { minSpendOn: true })).toEqual({ capacity: 6 });
    expect(tablePayload({ ...d, minSpendMinor: 8000000 }, table, { minSpendOn: false })).toEqual({});
    expect(tablePayload({ ...d, combinable: false }, table, { minSpendOn: true })).toEqual({ combinable: false, joinsWith: [] });
    const created = tablePayload(tableDraftFrom(null, { spaceId: "s1", name: "T1" }), null, { minSpendOn: false });
    expect(created).toMatchObject({
      name: "T1",
      spaceId: "s1",
      capacity: 4,
      shape: "round",
      depositMode: "venue_rule",
      depositPerGuestMinor: null,
      depositFlatMinor: null,
      depositShareBps: null,
      reservationPolicy: "reservable",
    });
    expect(created).not.toHaveProperty("minSpendMinor");
  });
  it("checks the form in plain words", () => {
    const d = tableDraftFrom(null, { spaceId: null });
    const issues = tableDraftIssues({ ...d, minParty: 6, capacity: 4, depositMode: "per_guest", holdPerGuestMinor: null });
    expect(issues.name).toBe("Give the table a name.");
    expect(issues.space).toBe("Pick the space this table is in.");
    expect(issues.minParty).toMatch(/smallest party/);
    expect(issues.hold).toBe("Enter an amount above zero.");
    expect(nextTableName(["T1", "t2", "B1"])).toBe("T3");
  });
  it("builds each table deposit mode, clears the other amounts, and labels the floor row", () => {
    const table = mapFloorTable(raw.spaces[0]?.tables[0]) as VenueFloorTable;
    const base = tableDraftFrom(table, { spaceId: "s1" });
    expect(base.depositMode).toBe("per_guest");
    expect(tableDepositLine(table, (m) => `N${m}`)).toBe("N500000 a guest");

    expect(tablePayload({ ...base, depositMode: "per_table", holdPerTableMinor: 900000 }, table, { minSpendOn: true })).toMatchObject({
      depositMode: "per_table",
      depositPerGuestMinor: null,
      depositFlatMinor: 900000,
    });
    expect(tablePayload({ ...base, depositMode: "min_spend_share", minSpendMinor: 1002, holdShareBps: 2500 }, table, { minSpendOn: true })).toMatchObject({
      depositMode: "min_spend_share",
      depositPerGuestMinor: null,
      depositShareBps: 2500,
    });
    expect(tableDepositShareMinor(1001, 2500)).toBe(250);
    expect(tableDepositShareMinor(1002, 2500)).toBe(251);
  });

  // [TEST-MOD-APPROVED #4490] The share selector and its visible 5% default
  // must update one state value; otherwise Add table refuses an untouched 5%.
  it("initializes the visible 5% minimum-spend share when that mode is selected", () => {
    const draft = {
      ...tableDraftFrom(null, { spaceId: "s1", name: "B1" }),
      minSpendMinor: 4_000_000,
      ...tableDepositModePatch({ holdShareBps: null }, "min_spend_share"),
    };
    expect(draft.holdShareBps).toBe(500);
    expect(tableDepositShareMinor(draft.minSpendMinor, draft.holdShareBps)).toBe(
      200_000,
    );
    expect(tableDraftIssues(draft).hold).toBeNull();
    expect(tablePayload(draft, null, { minSpendOn: true }).depositShareBps).toBe(500);
  });
});

describe("By the hour editor (no 60-minute cap; priced per minute)", () => {
  it("offers lengths well past an hour and up to 24 hours", () => {
    expect(minLengthOptions(30).map((o) => o.value)).toContain(150);
    const max = maxLengthOptions(30, 60).map((o) => o.value);
    expect(max[0]).toBe(0);
    expect(max).toContain(180);
    expect(max[max.length - 1]).toBe(1440);
  });
  it("prices part hours by the minute (Boardroom: 2 h = N24,000; 90 min = N18,000)", () => {
    expect(hourPriceFor(1200000, 120)).toBe(2400000);
    expect(hourPriceFor(1200000, 90)).toBe(1800000);
  });
  it("checks the draft and builds the payloads", () => {
    const d = { ...hourDraftFrom(null), name: "Boardroom", priceMinor: 1200000, stepMinutes: 30 as const, minMinutes: 60, maxMinutes: 120, placeMode: "spaces" as const, spaceIds: ["s1"] };
    expect(hourIssueList(hourIssues(d, { savedPlaces: 0 }))).toEqual([]);
    expect(hourIssues({ ...d, minMinutes: 45 }, { savedPlaces: 0 }).length).toMatch(/steps of 30 minutes/);
    expect(hourIssues({ ...d, maxMinutes: 30 }, { savedPlaces: 0 }).length).toMatch(/longest/);
    expect(hourLengthPayload(d, "o1")).toEqual({ offerId: "o1", stepMinutes: 30, minMinutes: 60, maxMinutes: 120 });
    expect(hourPlacePayload(d, "o1")).toEqual({ offerId: "o1", spaceIds: ["s1"], allocation: "all" });
    expect(hourPlacePayload({ ...d, placeMode: "units", unitName: "Pool table", unitCount: 3, unitSeats: 4 }, "o1")).toEqual({
      offerId: "o1",
      units: { count: 3, name: "Pool table", seats: 4, setting: "indoor" },
    });
    expect(hourRulesPayload({ ...d, releaseOn: true, releaseMinutes: 15, cleanupMinutes: 15 }, "o1")).toEqual({
      offerId: "o1",
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 15,
      noShowReleaseMinutes: 15,
      staffCanStart: false,
    });
    expect(hourOptionPayload(d, null)).toMatchObject({ unit: "hour", priceMinor: 1200000, busyRules: [] });
    expect(hourReadinessCopy("no_hours")).toMatch(/days and hours/);
  });
});

describe("waitlist and navigation", () => {
  it("says what a guest asked for", () => {
    expect(waitlistWantsLine({ desiredDate: "2026-11-21", desiredFrom: "19:00:00", desiredTo: "21:00:00" }, "2026-11-19")).toBe("Wants Sat 21 Nov · 19:00–21:00");
    expect(waitlistWantsLine({ desiredDate: "2026-11-19", desiredFrom: null, desiredTo: null }, "2026-11-19")).toBe("Wants Today · any time");
    expect(waitlistWantsLine({ desiredDate: null, desiredFrom: null, desiredTo: null })).toBeNull();
  });
  it("opens Spaces › Tables for ?module=tables once tables live in spaces", () => {
    const features = featureSetFrom({ table_reservations: true, waitlist: true, menu: true });
    const visible = deriveVenueNav({ features, activeSpaceCount: 2 });
    expect(visible).not.toContain("tables");
    expect(resolveTablesAlias({ activeModule: "tables", usesSpaces: true, visible })).toEqual({ module: "spaces", spacesView: "tables" });
    // A venue with no space yet keeps the old Tables module.
    const classic = deriveVenueNav({ features, activeSpaceCount: 0 });
    expect(classic).toContain("tables");
    expect(resolveTablesAlias({ activeModule: "tables", usesSpaces: false, visible: classic })).toBeNull();
    expect(filterVenueModulesForCapabilities(visible, true, ["restaurant.manage_reservations"])).toContain("spaces");
  });
  it("by the hour or a floor plan moves a venue to the feature layout", () => {
    expect(deriveVenueNav({ features: featureSetFrom({ by_the_hour: true }), activeSpaceCount: 0 })).toContain("offers");
  });
});
