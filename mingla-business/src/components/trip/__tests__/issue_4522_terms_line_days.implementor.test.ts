/**
 * issue #4522 W-11 — the Host plan terms line says "last one N days before
 * departure" with N counted in calendar days in the order's own zone.
 */
import { describe, expect, test } from "@jest/globals";

import { calendarDaysBefore } from "../tripMoneyV2Model";

describe("calendarDaysBefore", () => {
  test("09:00 New York a month before a UTC-midnight trip date is 30 days, not 29.4", () => {
    expect(calendarDaysBefore("2027-03-12T00:00:00Z", "2027-02-10T14:00:00Z", "America/New_York")).toBe(30);
  });
  test("Lagos and Tokyo", () => {
    expect(calendarDaysBefore("2027-03-12T00:00:00Z", "2027-02-10T08:00:00Z", "Africa/Lagos")).toBe(30);
    expect(calendarDaysBefore("2027-03-12T00:00:00Z", "2027-02-10T00:00:00Z", "Asia/Tokyo")).toBe(30);
  });
  test("zero days and an unknown zone", () => {
    expect(calendarDaysBefore("2027-03-12T00:00:00Z", "2027-03-12T09:00:00Z", "UTC")).toBe(0);
    expect(calendarDaysBefore("2027-03-12T00:00:00Z", "2027-02-10T09:00:00Z", "Not/AZone")).toBe(30);
    expect(calendarDaysBefore("2027-03-12T00:00:00Z", "2027-02-10T09:00:00Z", null)).toBe(30);
  });
});
