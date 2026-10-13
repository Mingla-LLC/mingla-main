/**
 * @jest-environment ./__tests__/support/issue3801TimeZoneEnvironment.cjs
 *
 * Issue #3801 — TESTER adversarial: calendar dates at the edges of the map, on
 * daylight-saving days, and the opposite mistake (a real moment read at UTC).
 *
 * A DIFFERENT ANGLE from the implementor suite
 * (`issue_3801_onboarding_calendar_dates.implementor.test.tsx`), which proves
 * the reported case (New York, plus Lagos and Kiritimati through the helper)
 * and mounts Step 1. This file attacks what that does not:
 *
 *   1. The far WEST of the date line (Pacific/Pago_Pago, UTC-11) beside the
 *      far EAST (Pacific/Kiritimati, UTC+14) and Lagos: 25 hours apart, the
 *      same stored day must read the same day, start AND end.
 *   2. The END date: written as the last second of its day at UTC from every
 *      zone, whatever time of day the native picker hands back.
 *   3. Every day of two years round-trips through the native picker seed and
 *      write in every zone, including zones whose daylight-saving jump lands
 *      on local MIDNIGHT (Havana, Cairo, Beirut), where a midnight seed would
 *      not exist.
 *   4. THE OPPOSITE BUG: a "days after booking" due time is a real moment. It
 *      must still be shown in the buyer's own timezone. A fix that read every
 *      due date at UTC would pass the implementor suite and show a buyer in
 *      Kiritimati the wrong day. Both buyer-facing formatters are exercised
 *      from their REAL source (`InstallmentScheduleDisplay.formatDueDate`,
 *      `TripPaymentChoice.formatScheduleDate`).
 *   5. Every producer of the `dueIsCalendarDate` flag: set for a fixed date,
 *      absent for an offset, an empty or null fixed date, and after a quantity
 *      multiplier.
 *   6. Malformed stored values never invent a day.
 *
 * Timezones are switched through the environment named above. Assigning
 * `process.env.TZ` inside a test changes nothing, so each block first proves
 * the switch took effect.
 *
 * Fails on revert (verified, see the tester report on the issue): read the
 * local parts in `readCalendarDate`, or drop the calendar branch in
 * `formatDueDate`, and the zone tests go red; send every due date through the
 * calendar branch and the "real moment" tests go red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { afterAll, describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";
import * as calendarDate from "../../../utils/calendarDate";
import { projectInstallmentSchedule } from "../../../utils/installmentScheduleProjection";

const TRIP_DIR = path.resolve(__dirname, "..");

const setZone = (zone: string): void => {
  (
    globalThis as unknown as { __setProcessTimeZone: (zone: string) => void }
  ).__setProcessTimeZone(zone);
};
afterAll(() => setZone("UTC"));

// The stored values of production trip 2385da2f….
const START = "2026-11-12T00:00:00.000Z";
const END = "2026-11-16T23:59:59.000Z";
const BALANCE = "2026-10-29";

const pad = (n: number): string => String(n).padStart(2, "0");
const localDay = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const EDGE_ZONES = ["Pacific/Pago_Pago", "Pacific/Kiritimati", "Africa/Lagos"] as const;

// ---------------------------------------------------------------------------
// 0. the switch is real
// ---------------------------------------------------------------------------

describe("#3801 tester — the timezone switch is real at both ends of the date line", () => {
  test("Pago Pago is 11 hours behind UTC: the naive local read of the start is the day BEFORE", () => {
    setZone("Pacific/Pago_Pago");
    expect(new Date(START).getTimezoneOffset()).toBe(660);
    expect(localDay(new Date(START))).toBe("2026-11-11");
    // …while the end, 23:59:59Z, is still the 16th there.
    expect(localDay(new Date(END))).toBe("2026-11-16");
  });

  test("Kiritimati is 14 hours ahead: the naive local read of the end is the day AFTER", () => {
    setZone("Pacific/Kiritimati");
    expect(new Date(END).getTimezoneOffset()).toBe(-840);
    expect(localDay(new Date(END))).toBe("2026-11-17");
    expect(localDay(new Date(START))).toBe("2026-11-12");
  });

  test("Lagos is one hour ahead: the naive local read of the end is the day after", () => {
    setZone("Africa/Lagos");
    expect(new Date(END).getTimezoneOffset()).toBe(-60);
    expect(localDay(new Date(END))).toBe("2026-11-17");
  });
});

// ---------------------------------------------------------------------------
// 1-2. same day everywhere; the end is the last second of its day
// ---------------------------------------------------------------------------

describe.each(EDGE_ZONES)("#3801 tester — %s", (zone) => {
  test("start, end and balance read the stored day", () => {
    setZone(zone);
    expect(calendarDate.calendarDateToInputValue(START)).toBe("2026-11-12");
    expect(calendarDate.calendarDateToInputValue(END)).toBe("2026-11-16");
    expect(calendarDate.calendarDateToInputValue(BALANCE)).toBe("2026-10-29");
    expect(calendarDate.formatCalendarDate(START, undefined, "en-GB")).toBe("12 Nov 2026");
    expect(calendarDate.formatCalendarDate(END, undefined, "en-GB")).toBe("16 Nov 2026");
    expect(calendarDate.formatCalendarDate(BALANCE, undefined, "en-GB")).toBe("29 Oct 2026");
    // The form PostgREST returns for a timestamptz reads the same.
    expect(calendarDate.calendarDateToInputValue("2026-11-12T00:00:00+00:00")).toBe("2026-11-12");
    expect(calendarDate.calendarDateToInputValue("2026-11-16T23:59:59+00:00")).toBe("2026-11-16");
  });

  test("a typed end date is stored as 23:59:59 UTC of that day, a start as 00:00:00", () => {
    setZone(zone);
    expect(calendarDate.inputValueToCalendarIso("2026-11-16", true)).toBe(END);
    expect(calendarDate.inputValueToCalendarIso("2026-11-12", false)).toBe(START);
    // Reading back what was written gives the day that was typed.
    expect(
      calendarDate.calendarDateToInputValue(
        calendarDate.inputValueToCalendarIso("2026-12-31", true),
      ),
    ).toBe("2026-12-31");
  });

  test("the native picker writes the day it shows, whatever time of day it returns", () => {
    setZone(zone);
    // A picker can hand back any time on the chosen LOCAL day.
    for (const [h, m, s] of [
      [0, 0, 0],
      [0, 0, 1],
      [12, 0, 0],
      [23, 59, 59],
    ]) {
      const picked = new Date(2026, 10, 16, h, m, s);
      expect(calendarDate.pickerDateToCalendarIso(picked, true)).toBe(END);
      expect(calendarDate.pickerDateToCalendarIso(picked, false)).toBe(
        "2026-11-16T00:00:00.000Z",
      );
      expect(calendarDate.pickerDateToInputValue(picked)).toBe("2026-11-16");
    }
  });

  test("opening the picker and tapping Done changes nothing, for the start and the end", () => {
    setZone(zone);
    const startSeed = calendarDate.calendarDateToPickerDate(START) as Date;
    const endSeed = calendarDate.calendarDateToPickerDate(END) as Date;
    expect(localDay(startSeed)).toBe("2026-11-12");
    expect(localDay(endSeed)).toBe("2026-11-16");
    expect(calendarDate.pickerDateToCalendarIso(startSeed, false)).toBe(START);
    expect(calendarDate.pickerDateToCalendarIso(endSeed, true)).toBe(END);
    // The balance date is stored bare and round-trips bare.
    const balanceSeed = calendarDate.calendarDateToPickerDate(BALANCE) as Date;
    expect(calendarDate.pickerDateToInputValue(balanceSeed)).toBe(BALANCE);
  });

  test("an invalid picker value writes nothing", () => {
    setZone(zone);
    expect(calendarDate.pickerDateToCalendarIso(new Date(Number.NaN), true)).toBeNull();
  });
});

describe("#3801 tester — 'today' for a date input's minimum is the viewer's own day", () => {
  // 10:30 UTC on 12 November: still the 11th in Pago Pago, already the 13th in Kiritimati.
  const now = new Date("2026-11-12T10:30:00.000Z");
  test.each([
    ["Pacific/Pago_Pago", "2026-11-11"],
    ["Africa/Lagos", "2026-11-12"],
    ["Pacific/Kiritimati", "2026-11-13"],
  ])("%s -> %s", (zone, expected) => {
    setZone(zone);
    expect(calendarDate.todayInputValue(now)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 3. every day, every zone, including midnight daylight-saving jumps
// ---------------------------------------------------------------------------

const ROUND_TRIP_ZONES = [
  "Pacific/Pago_Pago",
  "Pacific/Kiritimati",
  "Africa/Lagos",
  "America/New_York",
  "Europe/London",
  // Daylight saving starts AT local midnight here: that midnight does not exist.
  "America/Havana",
  "Africa/Cairo",
  "Asia/Beirut",
  // Half-hour and 45-minute offsets.
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Australia/Lord_Howe",
] as const;

describe("#3801 tester — every day of 2026 and 2027 survives the picker in every zone", () => {
  test.each(ROUND_TRIP_ZONES)("%s", (zone) => {
    setZone(zone);
    const broken: string[] = [];
    for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2027, 11, 31); t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10);
      const startIso = `${day}T00:00:00.000Z`;
      const endIso = `${day}T23:59:59.000Z`;
      const seedStart = calendarDate.calendarDateToPickerDate(startIso) as Date;
      const seedEnd = calendarDate.calendarDateToPickerDate(endIso) as Date;
      const ok =
        localDay(seedStart) === day &&
        localDay(seedEnd) === day &&
        calendarDate.pickerDateToCalendarIso(seedStart, false) === startIso &&
        calendarDate.pickerDateToCalendarIso(seedEnd, true) === endIso &&
        calendarDate.calendarDateToInputValue(startIso) === day &&
        calendarDate.calendarDateToInputValue(endIso) === day &&
        calendarDate.pickerDateToInputValue(
          calendarDate.calendarDateToPickerDate(day) as Date,
        ) === day;
      if (!ok) broken.push(day);
    }
    expect(broken).toEqual([]);
  });

  test("New York's clock-change days in 2026 (8 March, 1 November) keep their day", () => {
    setZone("America/New_York");
    for (const day of ["2026-03-08", "2026-11-01"]) {
      const iso = `${day}T00:00:00.000Z`;
      expect(calendarDate.calendarDateToInputValue(iso)).toBe(day);
      const seed = calendarDate.calendarDateToPickerDate(iso) as Date;
      expect(localDay(seed)).toBe(day);
      expect(seed.getHours()).toBe(12);
      expect(calendarDate.pickerDateToCalendarIso(seed, true)).toBe(`${day}T23:59:59.000Z`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. the opposite bug: a real moment must stay in the viewer's zone
// ---------------------------------------------------------------------------

const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};

/**
 * Compile a REAL component source and hand back one of its module-private
 * functions. The function is appended to the exports after compilation; the
 * source file itself is untouched.
 */
function privateFunction<T>(file: string, name: string): T {
  const boundary: Record<string, () => unknown> = {
    react: () => React,
    "react-native": () => jest.requireActual("react-native"),
    designSystem: () => designSystem,
    // REAL: the helper under test.
    calendarDate: () => calendarDate,
    GlassCard: () => ({ GlassCard: leaf("GlassCardProbe") }),
    installmentReassurance: () => ({ installmentReassuranceText: () => "" }),
    currencyGlyph: () => ({ withCurrencyGlyph: (value: string) => value }),
    currency: () => ({ formatCurrency: () => "" }),
    InstallmentScheduleDisplay: () => ({
      InstallmentScheduleDisplay: leaf("InstallmentScheduleDisplayProbe"),
    }),
  };
  const source = fs.readFileSync(path.join(TRIP_DIR, file), "utf8");
  expect(source).toContain(`function ${name}(`);
  const output =
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText + `\nmodule.exports.__private = ${name};\n`;
  const boundaryRequire = (specifier: string): unknown => {
    const supply = boundary[specifier] ?? boundary[specifier.split("/").pop() as string];
    if (supply !== undefined) return supply();
    throw new Error(`Unclassified ${file} boundary: ${specifier}`);
  };
  const module = { exports: {} as { __private?: T } };
  new Function("require", "module", "exports", output)(boundaryRequire, module, module.exports);
  expect(typeof module.exports.__private).toBe("function");
  return module.exports.__private as T;
}

type FormatDueDate = (inst: { dueAt: string; dueIsCalendarDate?: boolean }) => string;
type FormatScheduleDate = (iso: string, isCalendarDate: boolean) => string;

const formatDueDate = privateFunction<FormatDueDate>(
  "InstallmentScheduleDisplay.tsx",
  "formatDueDate",
);
const formatScheduleDate = privateFunction<FormatScheduleDate>(
  "TripPaymentChoice.tsx",
  "formatScheduleDate",
);

/** What "in the viewer's own timezone" means, computed in the current zone. */
const localLong = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(iso),
  );
const utcLong = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
const localShort = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const utcShort = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const tierWith = (installments: Record<string, unknown>[]): {
  priceCents: number;
  currency: string;
  installmentSchedule: never;
} => ({
  priceCents: 120_000,
  currency: "USD",
  installmentSchedule: { deposit_pct: 20, installments } as never,
});

// A buyer books at 23:30 UTC on 13 October. "30 days after booking" is the
// moment 23:30 UTC on 12 November: the 13th in Kiritimati, the 12th in Pago Pago.
const BOOKED_AT = new Date("2026-10-13T23:30:00.000Z");

describe("#3801 tester — a 'days after booking' due time is a real moment and stays local", () => {
  const projected = projectInstallmentSchedule(
    tierWith([
      { ordinal: 1, pct: 40, days_after_booking: 30 },
      { ordinal: 2, pct: 40, fixed_date: BALANCE },
    ]),
    BOOKED_AT,
  );
  const offsetDue = projected?.installments[0] as { dueAt: string; dueIsCalendarDate?: boolean };
  const fixedDue = projected?.installments[1] as { dueAt: string; dueIsCalendarDate?: boolean };

  test("the projection hands the display one of each kind", () => {
    expect(offsetDue.dueAt).toBe("2026-11-12T23:30:00.000Z");
    expect(offsetDue.dueIsCalendarDate).toBeUndefined();
    expect(fixedDue.dueAt).toBe("2026-10-29T00:00:00.000Z");
    expect(fixedDue.dueIsCalendarDate).toBe(true);
  });

  test("Kiritimati: the offset due shows the 13th (local), NOT the UTC day; the fixed date shows the 29th", () => {
    setZone("Pacific/Kiritimati");
    // The two readings really differ here, so this cannot pass by accident.
    expect(localLong(offsetDue.dueAt)).not.toBe(utcLong(offsetDue.dueAt));
    expect(localDay(new Date(offsetDue.dueAt))).toBe("2026-11-13");

    expect(formatDueDate(offsetDue)).toBe(localLong(offsetDue.dueAt));
    expect(formatDueDate(offsetDue)).toMatch(/13/);
    expect(formatScheduleDate(offsetDue.dueAt, offsetDue.dueIsCalendarDate === true)).toBe(
      localShort(offsetDue.dueAt),
    );

    expect(formatDueDate(fixedDue)).toBe(utcLong(fixedDue.dueAt));
    expect(formatDueDate(fixedDue)).toMatch(/29/);
    expect(formatScheduleDate(fixedDue.dueAt, fixedDue.dueIsCalendarDate === true)).toBe(
      utcShort(fixedDue.dueAt),
    );
  });

  test("Pago Pago: the fixed date shows the 29th (the local read says the 28th); the offset due stays local", () => {
    setZone("Pacific/Pago_Pago");
    expect(localDay(new Date(fixedDue.dueAt))).toBe("2026-10-28");
    expect(localLong(fixedDue.dueAt)).not.toBe(utcLong(fixedDue.dueAt));

    expect(formatDueDate(fixedDue)).toBe(utcLong(fixedDue.dueAt));
    expect(formatDueDate(fixedDue)).toMatch(/29/);
    expect(formatScheduleDate(fixedDue.dueAt, true)).toBe(utcShort(fixedDue.dueAt));
    expect(formatScheduleDate(fixedDue.dueAt, true)).toMatch(/29/);

    expect(formatDueDate(offsetDue)).toBe(localLong(offsetDue.dueAt));
    expect(formatScheduleDate(offsetDue.dueAt, false)).toBe(localShort(offsetDue.dueAt));
  });

  test("Lagos: an offset due at 23:30 UTC is already tomorrow there, and is shown as tomorrow", () => {
    setZone("Africa/Lagos");
    expect(localDay(new Date(offsetDue.dueAt))).toBe("2026-11-13");
    expect(formatDueDate(offsetDue)).toBe(localLong(offsetDue.dueAt));
    expect(formatDueDate(offsetDue)).not.toBe(utcLong(offsetDue.dueAt));
    expect(formatDueDate(fixedDue)).toMatch(/29/);
  });

  test("an order's stored due time carries no flag and is read as a moment", () => {
    setZone("Pacific/Kiritimati");
    // The Money tab maps order rows without the flag (app/trip/[id]/money).
    const orderRow = { dueAt: "2026-11-12T23:30:00.000Z" };
    expect(formatDueDate(orderRow)).toBe(localLong(orderRow.dueAt));
    expect(formatDueDate({ ...orderRow, dueIsCalendarDate: false })).toBe(
      localLong(orderRow.dueAt),
    );
  });

  test("a flagged value that is not a date falls back without throwing or inventing a day", () => {
    setZone("Pacific/Pago_Pago");
    expect(formatDueDate({ dueAt: "not-a-date", dueIsCalendarDate: true })).toBe("not-a-date");
    expect(formatScheduleDate("not-a-date", true)).toBe("not-a-date");
  });
});

// ---------------------------------------------------------------------------
// 5. every producer of the flag
// ---------------------------------------------------------------------------

describe("#3801 tester — the calendar-date flag is set exactly when the plan stores a fixed date", () => {
  const flagsOf = (installments: Record<string, unknown>[], qty = 1): (boolean | undefined)[] =>
    (projectInstallmentSchedule(tierWith(installments), BOOKED_AT, qty)?.installments ?? []).map(
      (inst) => (inst as { dueIsCalendarDate?: boolean }).dueIsCalendarDate,
    );

  test("fixed date -> flagged; offset -> not flagged", () => {
    expect(
      flagsOf([
        { ordinal: 1, pct: 40, fixed_date: BALANCE },
        { ordinal: 2, pct: 40, days_after_booking: 45 },
      ]),
    ).toEqual([true, undefined]);
  });

  test("an empty or null fixed date is an offset, never a flagged calendar date", () => {
    expect(
      flagsOf([
        { ordinal: 1, pct: 40, fixed_date: "", days_after_booking: 10 },
        { ordinal: 2, pct: 40, fixed_date: null, days_after_booking: 20 },
      ]),
    ).toEqual([undefined, undefined]);
  });

  test("when both are present the fixed date wins and is flagged", () => {
    const projected = projectInstallmentSchedule(
      tierWith([{ ordinal: 1, pct: 80, fixed_date: BALANCE, days_after_booking: 5 }]),
      BOOKED_AT,
    );
    expect(projected?.installments[0]).toMatchObject({
      dueAt: "2026-10-29T00:00:00.000Z",
      dueIsCalendarDate: true,
    });
  });

  test("a cart quantity scales the amounts and keeps the flag", () => {
    expect(flagsOf([{ ordinal: 1, pct: 80, fixed_date: BALANCE }], 3)).toEqual([true]);
  });

  test("the only projection in the app is the one that sets the flag", () => {
    // Any second place that builds `dueAt` from a fixed date would have to set
    // the flag too. Today there is exactly one.
    const projection = fs.readFileSync(
      path.resolve(TRIP_DIR, "..", "..", "utils", "installmentScheduleProjection.ts"),
      "utf8",
    );
    expect(projection.match(/fixed_date\}T00:00:00\.000Z/g)).toHaveLength(1);
    expect(projection).toContain("dueIsCalendarDate: true");
  });
});

// ---------------------------------------------------------------------------
// 6. malformed stored values
// ---------------------------------------------------------------------------

describe("#3801 tester — a malformed stored value is 'no date', in every zone", () => {
  const NONSENSE = [
    null,
    undefined,
    "",
    " ",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "2026-11-00",
    "0000-00-00",
    "16/11/2026",
    "tomorrow",
    "NaN",
  ];

  test.each(EDGE_ZONES)("%s", (zone) => {
    setZone(zone);
    for (const value of NONSENSE) {
      expect({ value, read: calendarDate.readCalendarDate(value) }).toEqual({ value, read: null });
      expect(calendarDate.calendarDateToInputValue(value)).toBe("");
      expect(calendarDate.formatCalendarDate(value)).toBe("");
      expect(calendarDate.calendarDateToPickerDate(value)).toBeNull();
    }
    // A write only accepts a bare, real calendar day.
    for (const typed of ["", " ", "2026-02-30", "16/11/2026", START]) {
      expect(calendarDate.inputValueToCalendarIso(typed, true)).toBeNull();
    }
  });

  test("a leap day is a real day; 29 February in a common year is not", () => {
    setZone("Pacific/Kiritimati");
    expect(calendarDate.inputValueToCalendarIso("2028-02-29", true)).toBe(
      "2028-02-29T23:59:59.000Z",
    );
    expect(calendarDate.inputValueToCalendarIso("2027-02-29", true)).toBeNull();
  });
});
