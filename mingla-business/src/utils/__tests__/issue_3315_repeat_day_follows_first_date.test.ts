/**
 * #3315 — a recurring event's repeat day follows its first date unless the
 * organiser chose the day (found filming the tutorial, 2026-09-13).
 *
 * Switching to Recurring before a date is picked seeds "every Monday". Picking a
 * Tuesday left the rule on Monday: "starts Tuesday, repeats every Monday".
 *
 * Pure contract for `followFirstDate` — the When step wiring is proven by
 * src/components/event/__tests__/issue_3315_when_step_repeat_day.test.tsx.
 */

import { describe, expect, test } from "@jest/globals";

import type { RecurrenceRule } from "../../store/draftEventStore";
import {
  expandRecurrenceToDates,
  followFirstDate,
  monthDayOfIso,
  setPosOfIso,
  weekdayOfIso,
  type RecurrenceDayField,
} from "../recurrenceRule";

const NONE: ReadonlySet<RecurrenceDayField> = new Set();
const count4 = { kind: "count", count: 4 } as const;

// 2027-06-15 Tue (3rd week) · 2027-06-17 Thu (3rd) · 2027-06-29 Tue (5th = last)
// 2027-06-10 Thu (2nd) · 2027-07-22 Thu (4th)

describe("#3315 — date helpers", () => {
  test("week position uses the expander's vocabulary, with a 5th week as 'last'", () => {
    expect(setPosOfIso("2027-06-05")).toBe(1);
    expect(setPosOfIso("2027-06-10")).toBe(2);
    expect(setPosOfIso("2027-06-15")).toBe(3);
    expect(setPosOfIso("2027-07-22")).toBe(4);
    expect(setPosOfIso("2027-06-29")).toBe(-1);
  });

  test("day of month clamps to 28 like the preset seed", () => {
    expect(monthDayOfIso("2027-06-15")).toBe(15);
    expect(monthDayOfIso("2027-06-29")).toBe(28);
  });
});

describe("#3315 — the seeded pattern follows the first date", () => {
  test("THE BUG: weekly seeded on Monday with no date moves to the Tuesday picked", () => {
    const seeded: RecurrenceRule = { preset: "weekly", byDay: "MO", termination: count4 };
    const next = followFirstDate(seeded, null, "2027-06-15", NONE);
    expect(next.byDay).toBe("TU");
    // …and the series it describes now actually repeats on Tuesdays.
    const dates = expandRecurrenceToDates(next, "2027-06-15");
    expect(dates.map((d) => d.getDay())).toEqual([2, 2, 2, 2]);
  });

  test("every other week follows too", () => {
    const seeded: RecurrenceRule = { preset: "biweekly", byDay: "MO", termination: count4 };
    expect(followFirstDate(seeded, null, "2027-06-17", NONE).byDay).toBe("TH");
  });

  test("a pattern still matching the OLD date moves with a changed date", () => {
    const tuesdays: RecurrenceRule = { preset: "weekly", byDay: "TU", termination: count4 };
    expect(followFirstDate(tuesdays, "2027-06-15", "2027-06-17", NONE).byDay).toBe("TH");
  });

  test("monthly by date follows the day of month", () => {
    const rule: RecurrenceRule = { preset: "monthly_dom", byMonthDay: 15, termination: count4 };
    expect(followFirstDate(rule, "2027-06-15", "2027-07-22", NONE).byMonthDay).toBe(22);
    // No previous date: the seed came from today's date, so it follows.
    expect(followFirstDate(rule, null, "2027-06-10", NONE).byMonthDay).toBe(10);
  });

  test("monthly by weekday follows both the weekday and the week", () => {
    const seeded: RecurrenceRule = {
      preset: "monthly_dow",
      byDay: "MO",
      bySetPos: 1,
      termination: count4,
    };
    const onThirdTuesday = followFirstDate(seeded, null, "2027-06-15", NONE);
    expect(onThirdTuesday).toEqual(
      expect.objectContaining({ byDay: "TU", bySetPos: 3 }),
    );
    const onLastTuesday = followFirstDate(onThirdTuesday, "2027-06-15", "2027-06-29", NONE);
    expect(onLastTuesday).toEqual(
      expect.objectContaining({ byDay: "TU", bySetPos: -1 }),
    );
    expect(weekdayOfIso("2027-06-29")).toBe("TU");
  });
});

describe("#3315 — a day the organiser chose is never overwritten", () => {
  test("a weekday picked this session stays, even when it was the Monday seed", () => {
    const picked: RecurrenceRule = { preset: "weekly", byDay: "MO", termination: count4 };
    const next = followFirstDate(picked, null, "2027-06-15", new Set(["byDay"]));
    expect(next).toBe(picked);
  });

  test("a day that no longer matches the old date was chosen, so it stays", () => {
    const fridays: RecurrenceRule = { preset: "weekly", byDay: "FR", termination: count4 };
    expect(followFirstDate(fridays, "2027-06-15", "2027-06-17", NONE)).toBe(fridays);
    // With no date yet, anything but the Monday seed was chosen too.
    expect(followFirstDate(fridays, null, "2027-06-17", NONE)).toBe(fridays);
  });

  test("only the chosen field is held; the others still follow", () => {
    const rule: RecurrenceRule = {
      preset: "monthly_dow",
      byDay: "TU",
      bySetPos: 3,
      termination: count4,
    };
    const next = followFirstDate(rule, "2027-06-15", "2027-06-10", new Set(["bySetPos"]));
    expect(next).toEqual(expect.objectContaining({ byDay: "TH", bySetPos: 3 }));
  });

  test("daily has no day fields and is returned untouched", () => {
    const daily: RecurrenceRule = { preset: "daily", termination: count4 };
    expect(followFirstDate(daily, null, "2027-06-15", NONE)).toBe(daily);
  });
});
