/**
 * #4490 P1-8 / P1-9 / P1-10 — pure rules behind Spaces, Availability & pricing
 * and Settings › Venue type and features.
 */
import type { VenueSpace } from "../../../services/venueFeaturesService";
import { featureSetFrom } from "../../../types/venueFeatures";
import type { BrandHourEntry } from "../../../types/brand";
import { brandHoursToRpcPayload, hoursWeekIssue } from "../../../utils/venueBrandHours";
import { featureSwitchConfirm } from "../features/featureSwitchModel";
import { longDateLabel, specialDayIssue, windowsSummary } from "../features/hoursModel";
import {
  autoPlanShapes,
  changedShapes,
  clampShape,
  combinationIssues,
  spaceDraftIssues,
  spaceUsedFor,
} from "../features/spaceModel";

// [TEST-MOD-APPROVED #4490] Spec 07-H extends the existing space fixtures and
// validation matrix with the five fixed other-layout capacity rows.
const space = (id: string, extra: Partial<VenueSpace> = {}): VenueSpace => ({
  id,
  venueId: "v",
  name: id,
  setting: "indoor",
  capacityStanding: 100,
  capacitySeated: null,
  layouts: [],
  photos: [],
  planShape: null,
  sortOrder: 0,
  canBeHired: true,
  stepFree: null,
  amenities: [],
  version: 1,
  ...extra,
});

const draft = (name: string, standing: number | null, seated: number | null) => ({
  name,
  setting: "indoor" as const,
  capacityStanding: standing,
  capacitySeated: seated,
  layouts: [],
  photos: [],
  canBeHired: true,
  stepFree: null,
  amenities: [],
});

describe("spaces", () => {
  it("a space needs a name and at least one capacity; no 50 or 500 cap", () => {
    expect(spaceDraftIssues(draft("", 10, null)).name).toMatch(/name/);
    expect(spaceDraftIssues(draft("Lounge", null, null)).capacity).toMatch(/standing, seated/);
    expect(spaceDraftIssues(draft("Green Area", 5000, null))).toEqual({ name: null, capacity: null, layouts: null });
    expect(spaceDraftIssues(draft("lounge", 10, null), ["Lounge"]).name).toMatch(/already/);
  });
  it("accepts each fixed other layout once and rejects a duplicate or invalid capacity", () => {
    const base = draft("Main Hall", 200, 120);
    expect(spaceDraftIssues({ ...base, layouts: [{ layout: "banquet", capacity: 120 }] }).layouts).toBeNull();
    expect(spaceDraftIssues({ ...base, layouts: [{ layout: "banquet", capacity: 120 }, { layout: "banquet", capacity: 80 }] }).layouts).toMatch(/once/);
    expect(spaceDraftIssues({ ...base, layouts: [{ layout: "theatre", capacity: 0 }] }).layouts).toMatch(/1 to 100,000/);
  });
  it("a combination needs a name and two or more different parts, once", () => {
    expect(combinationIssues({ name: "", spaceIds: ["a"] }, [])).toEqual({
      name: expect.stringMatching(/Name/),
      parts: "Pick at least two spaces.",
    });
    expect(combinationIssues({ name: "Whole Green", spaceIds: ["a", "b"] }, [])).toEqual({ name: null, parts: null });
    expect(
      combinationIssues({ name: "Again", spaceIds: ["b", "a"] }, [{ id: "c1", venueId: "v", name: "Whole", spaceIds: ["a", "b"], version: 1 }]).parts,
    ).toMatch(/already combined/);
  });
  it("Used for comes from features scoped to the venue or to that space", () => {
    const features = featureSetFrom([
      { key: "events_here", enabled: true, spaceIds: null },
      { key: "table_reservations", enabled: true, spaceIds: ["lounge"] },
    ]);
    expect(spaceUsedFor(space("lounge"), features)).toEqual(["Events", "Tables"]);
    expect(spaceUsedFor(space("green"), features)).toEqual(["Events"]);
    expect(spaceUsedFor(space("green"), null)).toEqual([]);
  });
  it("arranging places unplaced spaces on a grid inside the plan, and only writes what moved", () => {
    const placed = space("a", { planShape: { x: 10, y: 10, w: 30, h: 30 } });
    const shapes = autoPlanShapes([placed, space("b"), space("c")]);
    for (const shape of Object.values(shapes)) {
      expect(shape.x).toBeGreaterThanOrEqual(0);
      expect(shape.x + shape.w).toBeLessThanOrEqual(100);
      expect(shape.y + shape.h).toBeLessThanOrEqual(100);
    }
    expect(shapes.a).toEqual({ x: 10, y: 10, w: 30, h: 30 });
    const changed = changedShapes([placed, space("b"), space("c")], shapes);
    expect(changed.map((c) => c.space.id).sort()).toEqual(["b", "c"]);
    expect(clampShape({ x: 95, y: -4, w: 2, h: 200 })).toEqual({ x: 92, y: 0, w: 8, h: 100 });
  });
});

const week = (patch: (d: number) => Partial<BrandHourEntry> = () => ({})): BrandHourEntry[] =>
  Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openTime: "12:00",
    closeTime: "00:00",
    isClosed: false,
    ...patch(weekday),
  }));

describe("opening hours with several windows", () => {
  it("a single-window week keeps the pre-#4490 payload byte for byte", () => {
    const payload = brandHoursToRpcPayload(week());
    expect(payload[0]).toEqual({ weekday: 0, open_time: "12:00", close_time: "00:00", is_closed: false });
  });
  it("a split shift and a past-midnight close use the windows shape for the whole week", () => {
    const hours = week((d) =>
      d === 6
        ? { openTime: "10:00:00", closeTime: "14:00:00", extraWindows: [{ openTime: "18:00", closeTime: "02:00" }] }
        : d === 0
          ? { isClosed: true, openTime: null, closeTime: null }
          : {},
    );
    expect(hoursWeekIssue(hours)).toBeNull();
    const payload = brandHoursToRpcPayload(hours);
    expect(payload[6]).toEqual({
      weekday: 6,
      is_closed: false,
      windows: [
        { open: "10:00", close: "14:00" },
        { open: "18:00", close: "02:00" },
      ],
    });
    expect(payload[0]).toEqual({ weekday: 0, is_closed: true, windows: [] });
    expect(payload[1]).toEqual({ weekday: 1, is_closed: false, windows: [{ open: "12:00", close: "00:00" }] });
  });
  it("refuses overlapping windows, missing times and equal open and close", () => {
    expect(hoursWeekIssue(week((d) => (d === 2 ? { extraWindows: [{ openTime: "20:00", closeTime: "23:00" }] } : {})))).toMatch(/overlap/);
    expect(hoursWeekIssue(week((d) => (d === 2 ? { extraWindows: [{ openTime: null, closeTime: "23:00" }] } : {})))).toMatch(/required/);
    expect(hoursWeekIssue(week((d) => (d === 3 ? { openTime: "09:00", closeTime: "09:00" } : {})))).toMatch(/same time/);
    expect(hoursWeekIssue(week((d) => (d === 3 ? { openTime: "09:00", closeTime: "12:00", extraWindows: [{ openTime: "12:00", closeTime: "15:00" }] } : {})))).toBeNull();
  });
});

describe("special days and closing a day", () => {
  const today = "2026-11-18";
  it("needs a date from today on, and windows unless closed", () => {
    expect(specialDayIssue({ localDate: "", isClosed: true, windows: [], label: "" }, today)).toBe("Pick a date.");
    expect(specialDayIssue({ localDate: "2026-11-17", isClosed: true, windows: [], label: "" }, today)).toMatch(/today or a later/);
    expect(specialDayIssue({ localDate: "2026-12-25", isClosed: true, windows: [], label: "Christmas Day" }, today)).toBeNull();
    expect(specialDayIssue({ localDate: "2026-12-31", isClosed: false, windows: [], label: "" }, today)).toMatch(/at least one window/);
    expect(
      specialDayIssue({ localDate: "2026-12-31", isClosed: false, windows: [{ open: "18:00", close: "04:00" }], label: "" }, today),
    ).toBeNull();
  });
  it("names the day in full and says until 00:00 for a midnight close", () => {
    expect(longDateLabel("2026-12-25")).toBe("Friday 25 December");
    // #4490 D20/D21 — 24-hour everywhere in venue hours, never AM/PM or seconds.
    expect(windowsSummary([{ open: "12:00", close: "00:00" }])).toBe("12:00 until 00:00");
    expect(windowsSummary([{ open: "18:00:00", close: "02:00:00" }])).toBe("18:00–02:00 (next day)");
  });
});

describe("feature switches confirm before they act", () => {
  it("turning on a child names the parents it turns on", () => {
    expect(featureSwitchConfirm("table_ordering", true, ["menu"])).toEqual({
      title: "Turn on Table ordering?",
      body: "Table ordering needs Menu, so it turns on too.",
      confirm: "Turn on both",
    });
    expect(featureSwitchConfirm("menu", true, [])).toBeNull();
  });
  it("turning off a parent names the children it turns off", () => {
    expect(featureSwitchConfirm("menu", false, ["table_ordering"])?.body).toBe(
      "Table ordering needs Menu, so it turns off too.",
    );
  });
  it("turning off table reservations says bookings already made stay valid", () => {
    expect(featureSwitchConfirm("table_reservations", false, [])?.body).toBe(
      "Bookings already made stay valid; guests can't book new ones.",
    );
    expect(featureSwitchConfirm("waitlist", false, [])).toBeNull();
  });
});
