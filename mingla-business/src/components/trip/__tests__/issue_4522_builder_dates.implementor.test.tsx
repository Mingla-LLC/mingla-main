// MINGLA-INVARIANT: I-4522-BUILDER-V2-DATES | issue #4522 | Trip dates are picked as one range on the shared calendar, the itinerary has one dated card per day with the day count locked to those dates, and the booking deadline is saved as the instant its wall clock is in the trip's time zone.
/**
 * Issue #4522 slice 11 (+ #4523 slice 7, the trip date fields): the trip date
 * range with a nights count, the dated itinerary with drag reorder and a
 * keyboard alternative, the booking deadline in the trip's time zone, and the
 * payment-plan date inputs on the calendar.
 *
 * Pure rules run for real (including real clock changes); the date picker and the
 * itinerary are compiled and mounted against an explicit module boundary.
 *
 * Fails on revert: read the deadline in the device zone, let a drag land on the
 * wrong card, renumber the slots wrongly, re-add the Add a day button, or bring
 * back a browser date input or OS spinner in the trip files -> red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";
import { describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";
import {
  deadlineBounds,
  deadlineProblem,
  describeTripLength,
  dragTargetIndex,
  dayDateLabel,
  instantFromWall,
  nightsBetweenDays,
  reorderDays,
  todayInZoneDay,
  tripDayOf,
  wallInZone,
} from "../tripBuilderV2Model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TI {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
  findAll: (p: (n: TI) => boolean) => TI[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (n: React.ReactElement) => { root: TI; unmount: () => void };
  act: (fn: () => void) => void;
};
const { act } = TestRenderer;

const TRIP_DIR = path.resolve(__dirname, "..");
const read = (rel: string): string => fs.readFileSync(path.join(TRIP_DIR, rel), "utf8");
const leaf = (name: string) => {
  const L = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  L.displayName = name;
  return L;
};
function compile<T>(file: string, boundary: Record<string, () => unknown>): T {
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const req = (specifier: string): unknown => {
    const supply = boundary[specifier] ?? boundary[specifier.split("/").pop() as string];
    if (supply === undefined) throw new Error(`Unclassified boundary in ${file}: ${specifier}`);
    return supply();
  };
  const mod = { exports: {} as T };
  new Function("require", "module", "exports", output)(req, mod, mod.exports);
  return mod.exports;
}
const CORE: Record<string, () => unknown> = {
  react: () => React,
  "react-native": () => jest.requireActual("react-native"),
  designSystem: () => designSystem,
  tripBuilderV2Model: () => jest.requireActual("../tripBuilderV2Model"),
  Icon: () => ({ Icon: leaf("Icon") }),
};
const byId = (root: TI, id: string): TI => {
  const hit = root.findAll((n) => n.props.testID === id);
  if (hit.length === 0) throw new Error(`no element ${id}`);
  return hit[0];
};

// ---------------------------------------------------------------------------
// range, nights, dated labels
// ---------------------------------------------------------------------------

describe("trip range and day labels", () => {
  test("nights and days: the itinerary has nights + 1 days", () => {
    expect(nightsBetweenDays("2027-03-12", "2027-03-16")).toBe(4);
    expect(describeTripLength("2027-03-12", "2027-03-16")).toBe("5 days · 4 nights");
    expect(describeTripLength("2027-03-12", "2027-03-13")).toBe("2 days · 1 night");
    expect(nightsBetweenDays("2027-12-30", "2028-01-02")).toBe(3);
    expect(nightsBetweenDays("2028-02-27", "2028-03-01")).toBe(3); // leap year
  });

  test("an unset or reversed range says nothing", () => {
    expect(describeTripLength("", "")).toBeNull();
    expect(describeTripLength("2027-03-16", "2027-03-12")).toBeNull();
  });

  test("stored trip dates read at UTC, whatever zone the device is in", () => {
    expect(tripDayOf("2027-03-12T00:00:00.000Z")).toBe("2027-03-12");
    expect(tripDayOf("2027-03-16T23:59:59.000Z")).toBe("2027-03-16");
    expect(tripDayOf(null)).toBe("");
  });

  test("Day 1 · Fri 12 Mar, and the labels count on across a month and a year", () => {
    expect(dayDateLabel(1, "2027-03-12T00:00:00.000Z")).toBe("Day 1 · Fri 12 Mar");
    expect(dayDateLabel(5, "2027-03-12T00:00:00.000Z")).toBe("Day 5 · Tue 16 Mar");
    expect(dayDateLabel(3, "2027-12-30T00:00:00.000Z")).toBe("Day 3 · Sat 1 Jan");
    expect(dayDateLabel(2, null)).toBe("Day 2");
  });

  test("the day count equals the old wizard's fit rule for a stored range", () => {
    const start = Date.parse("2027-03-12T00:00:00.000Z");
    const end = Date.parse("2027-03-16T23:59:59.000Z");
    const fitted = Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
    expect(fitted).toBe((nightsBetweenDays("2027-03-12", "2027-03-16") as number) + 1);
  });
});

// ---------------------------------------------------------------------------
// reorder
// ---------------------------------------------------------------------------

describe("reordering days", () => {
  const day = (ordinal: number, title: string) => ({ ordinal, title, narrative: `n${ordinal}`, media: [] as never[] });
  const days = [day(1, "Day 1"), day(2, "Cenotes"), day(3, "Day 3"), day(4, "Sunset sail")];

  test("content moves, the slots and dates stay: ordinals renumber in place", () => {
    const next = reorderDays(days, 3, 0);
    expect(next.map((d) => d.ordinal)).toEqual([1, 2, 3, 4]);
    expect(next.map((d) => d.narrative)).toEqual(["n4", "n1", "n2", "n3"]);
  });

  test("a title the host wrote travels with its day; a seeded 'Day N' follows its slot", () => {
    const next = reorderDays(days, 3, 0);
    expect(next.map((d) => d.title)).toEqual(["Sunset sail", "Day 2", "Cenotes", "Day 4"]);
  });

  test("nothing moves for the same slot or an out-of-range one", () => {
    expect(reorderDays(days, 1, 1)).toEqual(days);
    expect(reorderDays(days, 1, 9)).toEqual(days);
    expect(reorderDays(days, -1, 2)).toEqual(days);
  });

  test("where a drag lands, from card heights and distance", () => {
    const heights = [100, 100, 100, 100];
    const gap = 16;
    expect(dragTargetIndex(heights, gap, 0, 10)).toBe(0);
    expect(dragTargetIndex(heights, gap, 0, 60)).toBe(1);
    expect(dragTargetIndex(heights, gap, 0, 130)).toBe(1);
    expect(dragTargetIndex(heights, gap, 0, 190)).toBe(2);
    expect(dragTargetIndex(heights, gap, 0, 9999)).toBe(3);
    expect(dragTargetIndex(heights, gap, 3, -60)).toBe(2);
    expect(dragTargetIndex(heights, gap, 3, -9999)).toBe(0);
    expect(dragTargetIndex(heights, gap, 2, -20)).toBe(2);
  });
});

describe("the itinerary list", () => {
  const Step2 = compile<{ TripCreatorStep2Itinerary: React.ComponentType<Record<string, unknown>> }>(
    "TripCreatorStep2Itinerary.tsx",
    {
      ...CORE,
      TripDayEditor: () => ({ TripDayEditor: leaf("DayEditor") }),
      TripDayDragHandle: () => ({ TripDayDragHandle: leaf("DragHandle") }),
      TripDayMediaSheet: () => ({ TripDayMediaSheet: () => null }),
      tripDayTileModel: () => ({ tripDayMediaKey: () => "k" }),
      tripsService: () => ({}),
      tripDayMediaService: () => ({ MAX_TRIP_DAY_MEDIA: 10 }),
    },
  ).TripCreatorStep2Itinerary;
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ ordinal: i + 1, title: `Day ${i + 1}`, narrative: "", media: [] }));
  const mount = (props: Record<string, unknown>) => {
    let t!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      t = TestRenderer.create(React.createElement(Step2, { disabled: false, ...props }));
    });
    return t;
  };

  // The day card receives its drag handle as an element prop; read that element's props.
  const handleOf = (t: ReturnType<typeof TestRenderer.create>, index: number): Record<string, unknown> =>
    (t.root.findAll((n) => n.type === "DayEditor")[index].props.dragHandle as { props: Record<string, unknown> }).props;

  test("the builder: dated labels, day count locked, no Add a day", () => {
    const t = mount({ days: mk(3), onChange: jest.fn(), builderV2: true, startAt: "2027-03-12T00:00:00.000Z" });
    const editors = t.root.findAll((n) => n.type === "DayEditor");
    expect(editors.map((e) => e.props.dateLabel)).toEqual(["Day 1 · Fri 12 Mar", "Day 2 · Sat 13 Mar", "Day 3 · Sun 14 Mar"]);
    expect(editors.every((e) => e.props.dayCountLocked === true)).toBe(true);
    expect(t.root.findAll((n) => n.props.testID === "trip-step2-add-day")).toHaveLength(0);
  });

  test("without the builder it is today's list: Add a day, no date labels", () => {
    const t = mount({ days: mk(2), onChange: jest.fn() });
    expect(byId(t.root, "trip-step2-add-day")).toBeDefined();
    const editors = t.root.findAll((n) => n.type === "DayEditor");
    expect(editors.every((e) => e.props.dateLabel === undefined && e.props.dayCountLocked === false)).toBe(true);
  });

  test("keyboard / screen-reader step moves a day's plan one day, labels stay", () => {
    const onChange = jest.fn();
    const t = mount({ days: mk(3), onChange, builderV2: true, startAt: "2027-03-12T00:00:00.000Z" });
    const handle = handleOf(t, 2);
    act(() => (handle.onStep as (d: number) => void)(-1));
    const next = onChange.mock.calls[0][0] as { ordinal: number; narrative: string }[];
    expect(next.map((d) => d.ordinal)).toEqual([1, 2, 3]);
  });

  test("a drag moves the plan to the card it was dropped on", () => {
    const onChange = jest.fn();
    const days = mk(3).map((d, i) => ({ ...d, title: `Plan ${i + 1}` }));
    const t = mount({ days, onChange, builderV2: true, startAt: "2027-03-12T00:00:00.000Z" });
    // Measure the three cards (100px each).
    const wrappers = t.root.findAll((n) => typeof n.props.onLayout === "function");
    act(() => wrappers.forEach((w) => (w.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { height: 100 } } })));
    const first = handleOf(t, 0);
    act(() => (first.onDragStart as () => void)());
    act(() => (first.onDragEnd as (dy: number) => void)(190));
    const next = onChange.mock.calls[0][0] as { ordinal: number; title: string }[];
    expect(next.map((d) => d.title)).toEqual(["Plan 2", "Plan 3", "Plan 1"]);
    expect(next.map((d) => d.ordinal)).toEqual([1, 2, 3]);
  });

  test("a drag that goes nowhere changes nothing", () => {
    const onChange = jest.fn();
    const t = mount({ days: mk(3), onChange, builderV2: true, startAt: "2027-03-12T00:00:00.000Z" });
    const first = handleOf(t, 0);
    act(() => (first.onDragEnd as (dy: number) => void)(5));
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// booking deadline in the trip's time zone
// ---------------------------------------------------------------------------

describe("deadline zone maths (real clock changes)", () => {
  test("Lagos is UTC+1 all year: 09:00 there is 08:00Z", () => {
    expect(instantFromWall("2099-03-01", "09:00", "Africa/Lagos")).toBe("2099-03-01T08:00:00.000Z");
    expect(wallInZone("2099-03-01T08:00:00.000Z", "Africa/Lagos")).toEqual({ date: "2099-03-01", time: "09:00" });
  });

  test("the same wall clock is a different instant in another zone (never the device's)", () => {
    const lagos = instantFromWall("2099-06-10", "18:30", "Africa/Lagos");
    const tokyo = instantFromWall("2099-06-10", "18:30", "Asia/Tokyo");
    expect(lagos).toBe("2099-06-10T17:30:00.000Z");
    expect(tokyo).toBe("2099-06-10T09:30:00.000Z");
  });

  test("a round trip is the identity in every zone, including across clock changes", () => {
    for (const zone of ["Africa/Lagos", "Europe/London", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"]) {
      for (const [date, time] of [["2099-01-15", "00:00"], ["2099-07-04", "23:59"], ["2099-03-28", "12:00"], ["2099-10-31", "12:00"]]) {
        const iso = instantFromWall(date, time, zone) as string;
        expect(wallInZone(iso, zone)).toEqual({ date, time });
      }
    }
  });

  test("New York spring forward: 01:30 is EST, 03:30 is EDT, the skipped 02:30 lands just after the gap", () => {
    // 2099-03-08 is the second Sunday of March 2099.
    expect(instantFromWall("2099-03-08", "01:30", "America/New_York")).toBe("2099-03-08T06:30:00.000Z");
    expect(instantFromWall("2099-03-08", "03:30", "America/New_York")).toBe("2099-03-08T07:30:00.000Z");
    expect(instantFromWall("2099-03-08", "02:30", "America/New_York")).toBe("2099-03-08T07:30:00.000Z");
  });

  test("New York fall back: the 01:30 that happens twice is the first one", () => {
    // 2099-11-01 is the first Sunday of November 2099.
    expect(instantFromWall("2099-11-01", "01:30", "America/New_York")).toBe("2099-11-01T05:30:00.000Z");
    expect(instantFromWall("2099-11-01", "03:30", "America/New_York")).toBe("2099-11-01T08:30:00.000Z");
  });

  test("a bad zone or wall time returns null, never a made-up instant", () => {
    expect(instantFromWall("2099-13-40", "09:00", "Africa/Lagos")).toBeNull();
    expect(instantFromWall("2099-03-01", "09:00", "Not/AZone")).toBeNull();
    expect(wallInZone("garbage", "Africa/Lagos")).toBeNull();
  });

  test("today is read in the trip's zone: late evening in New York is already tomorrow in Auckland", () => {
    const instant = new Date("2099-06-10T10:30:00.000Z");
    expect(todayInZoneDay("America/New_York", instant)).toBe("2099-06-10");
    expect(todayInZoneDay("Pacific/Auckland", instant)).toBe("2099-06-10");
    const late = new Date("2099-06-10T23:30:00.000Z");
    expect(todayInZoneDay("Africa/Lagos", late)).toBe("2099-06-11");
    expect(todayInZoneDay("America/New_York", late)).toBe("2099-06-10");
  });

  test("a deadline must be in the future and before the trip starts", () => {
    const now = Date.parse("2099-01-01T00:00:00.000Z");
    expect(deadlineProblem("2098-12-31T00:00:00.000Z", "2099-06-01T00:00:00.000Z", now)).toBe("Deadline must be in the future.");
    expect(deadlineProblem("2099-06-01T00:00:00.000Z", "2099-06-01T00:00:00.000Z", now)).toBe("Deadline must be before trip starts.");
    expect(deadlineProblem("2099-05-31T10:00:00.000Z", "2099-06-01T00:00:00.000Z", now)).toBeNull();
    expect(deadlineProblem("2099-05-31T10:00:00.000Z", null, now)).toBeNull();
  });
});

describe("the booking deadline picker", () => {
  const Picker = compile<{ BookingDeadlinePicker: React.ComponentType<Record<string, unknown>> }>("BookingDeadlinePicker.tsx", {
    ...CORE,
    timezones: () => ({ timezoneCityName: (z: string) => z.split("/").pop() }),
    HostCalendarFields: () => ({ HostDateTimeField: leaf("DeadlineField") }),
    Switch: () => ({ Switch: leaf("SwitchProbe") }),
  }).BookingDeadlinePicker;
  const mount = (props: Record<string, unknown>) => {
    let t!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      t = TestRenderer.create(React.createElement(Picker, { tripStartIso: "2099-06-01T00:00:00.000Z", brandTimezone: "Africa/Lagos", ...props }));
    });
    return t;
  };
  const field = (t: ReturnType<typeof TestRenderer.create>): TI => t.root.findAll((n) => n.type === "DeadlineField")[0];
  const texts = (t: ReturnType<typeof TestRenderer.create>): string =>
    t.root.findAll((n) => n.type === "Text").map((n) => (n.children as unknown[]).join("")).join("|");

  test("the field is given the trip's zone and its own bounds; the saved instant is shown in that zone", () => {
    const t = mount({ value: "2099-03-01T08:00:00.000Z", onChange: jest.fn() });
    const f = field(t);
    expect(f.props.timeZone).toBe("Africa/Lagos");
    expect(f.props.value).toEqual({ date: "2099-03-01", time: "09:00" });
    // Today, read in the trip's zone (not the phone's): a real date, YYYY-MM-DD.
    expect(f.props.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // [TEST-MOD-APPROVED #4522 W-1] The stored start (2099-06-01T00:00Z) is the
    // trip's calendar date (#4420): departure day 1 June begins at 00:00 Lagos,
    // so the last day offered is 31 May, any time (was 1 June before 01:00,
    // which read the UTC-midnight instant in the zone as a start time).
    expect(f.props.max).toBe("2099-05-31");
    expect(f.props.maxTime).toBeUndefined();
    expect(texts(t)).toContain("In Lagos time");
  });

  // #4523 S-8 — the picker offers only what can be saved, read in the trip's
  // zone. FAILS ON REVERT: the max day is the UTC day and every time on it is
  // offered (a pick after the start was refused after the fact).
  // [TEST-MOD-APPROVED #4522 W-1] A trip's start is its stored calendar date
  // (UTC midnight, #4420); the departure day begins at 00:00 in the trip zone.
  // FAILS ON REVERT: New York offered 31 May only until 19:59 (the UTC-midnight
  // instant read in the zone) and Tokyo offered 1 June until 08:59.
  test("deadline bounds: before the departure day, in the trip's zone, from now on", () => {
    const now = new Date("2099-01-10T21:30:00.000Z");
    for (const zone of ["Africa/Lagos", "America/New_York", "Asia/Tokyo", "UTC"]) {
      expect(deadlineBounds("2099-06-01T00:00:00.000Z", zone, now)).toMatchObject({
        max: "2099-05-31",
      });
      expect(deadlineBounds("2099-06-01T00:00:00.000Z", zone, now).maxTime).toBeUndefined();
    }
    expect(deadlineBounds("2099-06-01T00:00:00.000Z", "Africa/Lagos", now)).toEqual({
      min: "2099-01-10",
      minTime: "22:30",
      max: "2099-05-31",
    });
    // A deadline is refused from the moment the departure day begins there.
    expect(
      deadlineProblem("2099-06-01T03:59:00.000Z", "2099-06-01T00:00:00.000Z", now.getTime(), "America/New_York"),
    ).toBeNull();
    expect(
      deadlineProblem("2099-06-01T04:00:00.000Z", "2099-06-01T00:00:00.000Z", now.getTime(), "America/New_York"),
    ).toBe("Deadline must be before trip starts.");
    // Today is read in the trip's zone: 21:30 UTC is already tomorrow in Tokyo.
    expect(deadlineBounds(null, "Asia/Tokyo", now)).toEqual({ min: "2099-01-11", minTime: "06:30" });
  });

  test("a pick commits the instant of that wall clock in the trip zone", () => {
    const onChange = jest.fn();
    const t = mount({ value: null, onChange });
    act(() => (byId(t.root, "booking-deadline-switch").props.onValueChange as (v: boolean) => void)(true));
    act(() => (field(t).props.onChangeValue as (v: unknown) => void)({ date: "2099-03-01", time: "09:00" }));
    expect(onChange).toHaveBeenCalledWith("2099-03-01T08:00:00.000Z");
  });

  test("the same pick in another trip zone is another instant", () => {
    const onChange = jest.fn();
    const t = mount({ value: null, onChange, brandTimezone: "Asia/Tokyo" });
    act(() => (byId(t.root, "booking-deadline-switch").props.onValueChange as (v: boolean) => void)(true));
    act(() => (field(t).props.onChangeValue as (v: unknown) => void)({ date: "2099-03-01", time: "09:00" }));
    expect(onChange).toHaveBeenCalledWith("2099-03-01T00:00:00.000Z");
  });

  test("a deadline in the past, or on or after the start, is said and not saved", () => {
    const onChange = jest.fn();
    const t = mount({ value: null, onChange });
    act(() => (byId(t.root, "booking-deadline-switch").props.onValueChange as (v: boolean) => void)(true));
    act(() => (field(t).props.onChangeValue as (v: unknown) => void)({ date: "2020-01-01", time: "09:00" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(texts(t)).toContain("Deadline must be in the future.");
    act(() => (field(t).props.onChangeValue as (v: unknown) => void)({ date: "2099-06-02", time: "09:00" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(texts(t)).toContain("Deadline must be before trip starts.");
    act(() => (field(t).props.onChangeValue as (v: unknown) => void)({ date: "2099-05-30", time: "09:00" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(texts(t)).not.toContain("Deadline must be");
  });

  test("a half-filled pick commits nothing; turning it off clears the deadline", () => {
    const onChange = jest.fn();
    const t = mount({ value: "2099-03-01T08:00:00.000Z", onChange });
    act(() => (field(t).props.onChangeValue as (v: unknown) => void)({ date: "2099-03-02", time: "" }));
    expect(onChange).not.toHaveBeenCalled();
    act(() => (byId(t.root, "booking-deadline-switch").props.onValueChange as (v: boolean) => void)(false));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(t.root.findAll((n) => n.type === "DeadlineField")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// source: one calendar in the trip files
// ---------------------------------------------------------------------------

describe("the trip files use the one calendar", () => {
  const tripSources = fs
    .readdirSync(TRIP_DIR)
    .filter((f) => /\.(tsx?)$/.test(f))
    .map((f) => ({ f, src: read(f) }));

  test("no trip file imports the browser date input, the OS date picker or the Android two-step", () => {
    for (const { f, src } of tripSources) {
      expect({ f, hit: /WebDateTimeInput|@react-native-community\/datetimepicker|androidDateTimeStep|showPicker\(/.test(src) }).toEqual({ f, hit: false });
    }
    expect(fs.existsSync(path.join(TRIP_DIR, "..", "..", "utils", "androidDateTimeStep.ts"))).toBe(false);
  });

  test("the screens this slice rewrote still parse", () => {
    for (const f of ["TripCreatorStep1Basics.tsx", "TripCreatorStep2Itinerary.tsx", "TripDayEditor.tsx", "TripDayDragHandle.tsx", "BookingDeadlinePicker.tsx", "PaymentPlanEditor.tsx"]) {
      const out = ts.transpileModule(read(f), {
        reportDiagnostics: true,
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
      });
      expect({ f, errors: (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")) }).toEqual({ f, errors: [] });
    }
  });

  test("trip dates are one range field with a nights read-out", () => {
    const step1 = read("TripCreatorStep1Basics.tsx");
    expect(step1).toContain("<HostDateRangeField");
    expect(step1).toContain("describeTripLength(startDay, endDay)");
    expect(step1).not.toMatch(/type:\s*"date"|Pick start date|Pick end date/);
  });

  test("payment-plan fixed dates are picked on the calendar", () => {
    const plan = read("PaymentPlanEditor.tsx");
    expect(plan).toContain("<DateField");
    expect(plan).toContain('accessibilityLabel={`Installment ${inst.ordinal} due date`}');
  });

  test("the wizard's chunk never imports the calendar package (boot payload)", () => {
    for (const { f, src } of tripSources) {
      expect({ f, hit: /from\s+["']@mingla\/calendar/.test(src) }).toEqual({ f, hit: false });
    }
  });

  test("the range field has its one lazy owner and body", () => {
    expect(fs.readFileSync(path.join(TRIP_DIR, "..", "ui", "HostDateRangeField.tsx"), "utf8")).toContain("export const HostDateRangeField = lazyHostField");
    expect(fs.readFileSync(path.join(TRIP_DIR, "..", "ui", "HostCalendarBody.tsx"), "utf8")).toContain("export function DateRangeBody");
  });

  test("the wizard passes the builder flag and the first day to the itinerary; the trim question uses the builder copy", () => {
    const wizard = read("TripCreatorWizard.tsx");
    expect(wizard).toContain("builderV2={V2}\n              startAt={step1Draft.startAt}");
    expect(wizard).toContain("`Remove Day ${pendingDayTrim.atRisk[0].ordinal}?`");
    expect(wizard).toContain('"Its plan will be deleted."');
  });
});
