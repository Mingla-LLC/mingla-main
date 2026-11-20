/*
 * #4453 — Young and Stamped (19 Nov): reviews and a story saved at 12:00 UTC
 * showed a day late ("March 24" for March 23), because calendarDayOf rounded
 * the half day up. Host's review editor then re-saved the shifted day.
 */
import { describe, expect, it } from "vitest";
import { calendarDayOf } from "./siteContent";

describe("#4453 calendarDayOf keeps the day", () => {
  it("12:00 UTC is that same day (Payload's day-only midday)", () => {
    expect(calendarDayOf("2026-03-23T12:00:00.000Z")).toBe("2026-03-23");
  });
  it("midnight UTC is that day", () => {
    expect(calendarDayOf("2026-03-23T00:00:00.000Z")).toBe("2026-03-23");
  });
  it("local midnight within ±12 h still keeps its day", () => {
    expect(calendarDayOf("2026-03-22T23:00:00.000Z")).toBe("2026-03-23"); // UTC+1 midnight
    expect(calendarDayOf("2026-03-23T05:00:00.000Z")).toBe("2026-03-23"); // UTC-5 midnight
    expect(calendarDayOf("2026-03-22T13:00:00.000Z")).toBe("2026-03-23"); // UTC+11 midnight
  });
  it("refuses what is not a date", () => {
    expect(calendarDayOf("not a date")).toBeNull();
    expect(calendarDayOf(null)).toBeNull();
  });
});
