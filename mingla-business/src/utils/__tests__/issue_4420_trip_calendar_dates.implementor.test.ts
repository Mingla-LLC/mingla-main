/**
 * #4420 — the trip checkout said "Jan 14" while the public trip page said
 * "Jan 15". Trip dates are calendar dates stored at UTC midnight and the
 * checkout formatted them in the viewer's timezone.
 *
 *   TD-1 a stored UTC-midnight date reads as its own calendar day, in both the
 *        ISO and the Postgres space-separated form.
 *   TD-2 the checkout line and the public page's shared formatter agree on the
 *        day for the same trip.
 *   TD-3 the viewer-timezone reading the checkout used is a day early west of
 *        UTC (the reported bug), so the helper must not use it.
 *
 * Also run with TZ=America/Los_Angeles; every assertion holds in any timezone.
 * FAILS-ON-REVERT: drop `timeZone: "UTC"` from src/utils/tripCalendarDates.ts
 * and TD-1 / TD-2 go red in any timezone west of UTC.
 */
import { formatTripDateRange } from "@mingla/offering-rendering";

import {
  formatTripCalendarDay,
  formatTripCalendarRange,
} from "../tripCalendarDates";

describe("#4420 trip dates are the trip's own calendar dates", () => {
  test("TD-1 UTC midnight reads as its stored day", () => {
    expect(formatTripCalendarDay("2027-01-15T00:00:00.000Z", "en-US")).toBe("Jan 15");
    expect(formatTripCalendarDay("2027-01-15 00:00:00+00", "en-US")).toBe("Jan 15");
    expect(formatTripCalendarRange("2027-01-15 00:00:00+00", "2027-01-18 00:00:00+00", "en-US"))
      .toBe("Jan 15 – Jan 18");
    expect(formatTripCalendarRange("2027-01-15T00:00:00Z", "2027-01-15T00:00:00Z", "en-US"))
      .toBe("Jan 15");
    expect(formatTripCalendarRange(null, null)).toBe("");
    expect(formatTripCalendarDay("not a date")).toBeNull();
  });

  test("TD-2 the checkout line names the same day as the public page", () => {
    const start = "2027-01-15 00:00:00+00";
    const end = "2027-01-18 00:00:00+00";
    const publicPage = formatTripDateRange(start, end);
    const checkout = formatTripCalendarRange(start, end);
    const day = checkout.split(" – ")[0];
    expect(publicPage.startsWith(day)).toBe(true);
  });

  test("TD-3 the viewer-timezone reading is a day early west of UTC", () => {
    const viewer = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "America/Los_Angeles",
    }).format(new Date("2027-01-15T00:00:00Z"));
    expect(viewer).toBe("Jan 14");
    expect(formatTripCalendarDay("2027-01-15T00:00:00Z", "en-US")).toBe("Jan 15");
  });
});
