import {
  addDays,
  addMonths,
  addYears,
  compareDates,
  diffDays,
  parseCalendarDate,
  todayInZone,
  weekdayOf,
} from "../core/calendarDate";
import { reduceKeyboard } from "../core/keyboard";
import { formatRangeLong, formatTimezoneLabel, lengthLabel, DEFAULT_CALENDAR_LABELS } from "../core/labels";
import { isDisabled, monthMatrix } from "../core/monthGrid";
import { clampToBounds, isRangeComplete, nextRange, nights } from "../core/rangeRules";
import { timeSlots } from "../TimeList";

describe("calendarDate", () => {
  it("parses strictly and rejects impossible dates", () => {
    expect(parseCalendarDate("2027-02-28")).toEqual({ y: 2027, m: 2, d: 28 });
    expect(parseCalendarDate("2027-02-29")).toBeNull();
    expect(parseCalendarDate("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 });
    expect(parseCalendarDate("2027-13-01")).toBeNull();
    expect(parseCalendarDate("12/03/2027")).toBeNull();
  });

  it("adds days and months without a local clock", () => {
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2027-03-31", -1)).toBe("2027-02-28");
    expect(addMonths("2027-11-15", 3)).toBe("2028-02-15");
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
  });

  it("counts nights across month, year and DST-change boundaries", () => {
    expect(diffDays("2027-03-16", "2027-03-12")).toBe(4);
    expect(diffDays("2027-04-02", "2027-03-30")).toBe(3);
    expect(diffDays("2028-01-02", "2027-12-30")).toBe(3);
    // London 30 Mar / 26 Oct 2025, New York 9 Mar / 2 Nov 2025: days stay whole.
    expect(nights("2025-03-29", "2025-03-31")).toBe(2);
    expect(nights("2025-10-25", "2025-10-27")).toBe(2);
    expect(nights("2025-03-08", "2025-03-10")).toBe(2);
    expect(nights("2025-11-01", "2025-11-03")).toBe(2);
  });

  it("compares and finds weekdays", () => {
    expect(compareDates("2027-03-12", "2027-03-13")).toBeLessThan(0);
    expect(weekdayOf("2027-03-12")).toBe(5); // Friday
  });

  it("computes today in the field zone, not the device zone", () => {
    // 22:30 UTC on 11 Mar is 23:30 in Lagos (UTC+1) and 12:30 in Honolulu (UTC-10).
    const instant = new Date("2027-03-11T22:30:00Z");
    expect(todayInZone("Africa/Lagos", instant)).toBe("2027-03-11");
    expect(todayInZone("Pacific/Honolulu", instant)).toBe("2027-03-11");
    // 23:30 UTC is 00:30 next day in Lagos.
    expect(todayInZone("Africa/Lagos", new Date("2027-03-11T23:30:00Z"))).toBe("2027-03-12");
    expect(todayInZone("Pacific/Honolulu", new Date("2027-03-11T23:30:00Z"))).toBe("2027-03-11");
  });
});

describe("monthGrid", () => {
  it.each([0, 1] as const)("is 6x7 with every day of the month once, week start %i, 2024-2030", (weekStart) => {
    for (let y = 2024; y <= 2030; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const rows = monthMatrix(y, m, weekStart);
        expect(rows).toHaveLength(6);
        rows.forEach((row) => expect(row).toHaveLength(7));
        const inMonth = rows.flat().filter((c) => c.inMonth).map((c) => c.date);
        expect(new Set(inMonth).size).toBe(inMonth.length);
        expect(inMonth[0]).toBe(`${y}-${String(m).padStart(2, "0")}-01`);
        expect(weekdayOf(rows[0][0].date)).toBe(weekStart);
      }
    }
  });

  it("handles leap February", () => {
    const days = monthMatrix(2028, 2, 1).flat().filter((c) => c.inMonth);
    expect(days).toHaveLength(29);
  });

  it("disables outside bounds and by predicate", () => {
    const bounds = { min: "2027-03-10", max: "2027-03-20", isDateDisabled: (d: string) => d === "2027-03-15" };
    expect(isDisabled("2027-03-09", bounds)).toBe(true);
    expect(isDisabled("2027-03-21", bounds)).toBe(true);
    expect(isDisabled("2027-03-15", bounds)).toBe(true);
    expect(isDisabled("2027-03-16", bounds)).toBe(false);
  });
});

describe("rangeRules", () => {
  it("nextRange follows the tap table", () => {
    expect(nextRange({ start: "", end: "" }, "2027-03-12")).toEqual({ start: "2027-03-12", end: "" });
    expect(nextRange({ start: "2027-03-12", end: "" }, "2027-03-16")).toEqual({ start: "2027-03-12", end: "2027-03-16" });
    expect(nextRange({ start: "2027-03-12", end: "" }, "2027-03-10")).toEqual({ start: "2027-03-10", end: "" });
    expect(nextRange({ start: "2027-03-12", end: "2027-03-16" }, "2027-03-12")).toEqual({ start: "2027-03-12", end: "" });
    expect(nextRange({ start: "2027-03-12", end: "2027-03-16" }, "2027-03-20")).toEqual({ start: "2027-03-12", end: "2027-03-20" });
  });

  it("clamps and validates length in the field's unit", () => {
    expect(clampToBounds("2027-01-01", "2027-03-01", "2027-04-01")).toBe("2027-03-01");
    expect(clampToBounds("2027-05-01", "2027-03-01", "2027-04-01")).toBe("2027-04-01");
    const draft = { start: "2027-03-12", end: "2027-03-16" };
    expect(isRangeComplete(draft, "nights", 4, 4)).toBe(true);
    expect(isRangeComplete(draft, "nights", 5)).toBe(false);
    expect(isRangeComplete(draft, "days", 5, 5)).toBe(true);
    expect(isRangeComplete({ start: "2027-03-12", end: "" }, "nights")).toBe(false);
  });
});

describe("keyboard reducer", () => {
  it("moves by day, week, month and year without ever picking", () => {
    expect(reduceKeyboard("2027-03-12", { key: "ArrowRight" }, 1).focused).toBe("2027-03-13");
    expect(reduceKeyboard("2027-03-12", { key: "ArrowUp" }, 1).focused).toBe("2027-03-05");
    expect(reduceKeyboard("2027-03-12", { key: "PageDown" }, 1)).toMatchObject({ focused: "2027-04-12", action: null });
    expect(reduceKeyboard("2027-03-12", { key: "PageUp", shiftKey: true }, 1).focused).toBe("2026-03-12");
    expect(reduceKeyboard("2027-03-12", { key: "Home" }, 1).focused).toBe("2027-03-08");
    expect(reduceKeyboard("2027-03-12", { key: "End" }, 1).focused).toBe("2027-03-14");
    expect(reduceKeyboard("2027-03-12", { key: "Home" }, 0).focused).toBe("2027-03-07");
  });

  it("reports pick and dismiss, ignores other keys", () => {
    expect(reduceKeyboard("2027-03-12", { key: "Enter" }, 1).action).toBe("pick");
    expect(reduceKeyboard("2027-03-12", { key: " " }, 1).action).toBe("pick");
    expect(reduceKeyboard("2027-03-12", { key: "Escape" }, 1).action).toBe("dismiss");
    expect(reduceKeyboard("2027-03-12", { key: "a" }, 1).handled).toBe(false);
  });
});

describe("labels", () => {
  it("formats a same-month range with its nights", () => {
    const text = formatRangeLong("2027-03-12", "2027-03-16", lengthLabel(4, "nights", DEFAULT_CALENDAR_LABELS), "en-GB");
    expect(text).toMatch(/^Fri 12 – Tue,? 16 Mar 2027 · 4 nights$/);
  });

  it("singularises", () => {
    expect(lengthLabel(1, "nights", DEFAULT_CALENDAR_LABELS)).toBe("1 night");
    expect(lengthLabel(2, "days", DEFAULT_CALENDAR_LABELS)).toBe("2 days");
  });

  it("prints the zone for the visible date, DST-aware", () => {
    expect(formatTimezoneLabel("Africa/Lagos", "2027-03-12", "en-GB")).toMatch(/^Lagos time \((WAT, )?UTC\+1\)$/);
    const winter = formatTimezoneLabel("Europe/London", "2027-01-15", "en-GB");
    const summer = formatTimezoneLabel("Europe/London", "2027-07-15", "en-GB");
    expect(winter).toContain("UTC+0");
    expect(summer).toContain("UTC+1");
  });
});

describe("timeSlots", () => {
  it("steps and bounds", () => {
    expect(timeSlots(30).length).toBe(48);
    expect(timeSlots(15, "09:00", "10:00")).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00"]);
  });
});
