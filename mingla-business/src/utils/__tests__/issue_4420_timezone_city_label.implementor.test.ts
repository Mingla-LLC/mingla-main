/**
 * #4420 round-3 item 12 — time zones never show as slugs. The shared label is
 * "New York (GMT-5)" (city from the zone id, underscores to spaces); search
 * still finds a zone by its city or its id.
 *
 * FAILS-ON-REVERT: formatTimezoneLabel printing `${tz} (...)` fails block 1;
 * a picker filter that only matches the id fails block 2.
 */
import fs from "fs";
import path from "path";

import {
  formatTimezoneLabel,
  timezoneCityName,
  timezoneMatchesQuery,
} from "../timezones";

const winter = { localDate: "2026-12-10", localTime: "19:00" };

describe("#4420 time zone city label", () => {
  test("1. city + offset, never the slug", () => {
    expect(formatTimezoneLabel("America/New_York", winter)).toBe("New York (GMT-5)");
    expect(formatTimezoneLabel("America/Argentina/Buenos_Aires", winter)).toBe("Buenos Aires (GMT-3)");
    expect(formatTimezoneLabel("UTC", winter)).toBe("UTC (GMT+0)");
    expect(timezoneCityName("Etc/UTC")).toBe("UTC");
    expect(timezoneCityName("America/Port_of_Spain")).toBe("Port of Spain");
    expect(formatTimezoneLabel("Europe/London", winter)).not.toContain("/");
  });

  test("2. search matches by name or id", () => {
    for (const q of ["new york", "New_York", "america/new", "AMERICA", "york"]) {
      expect([q, timezoneMatchesQuery("America/New_York", q)]).toEqual([q, true]);
    }
    expect(timezoneMatchesQuery("America/New_York", "lagos")).toBe(false);
    expect(timezoneMatchesQuery("America/New_York", "  ")).toBe(true);
  });

  test("3. every picker uses the shared matcher and no surface prints the raw id", () => {
    const root = path.resolve(__dirname, "../..");
    for (const f of [
      "components/brand/BrandEditTimezoneField.tsx",
      "components/venue/VenueAvailabilityModule.tsx",
      "components/event/CreatorStep2When.tsx",
    ]) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect([f, src.includes("timezoneMatchesQuery")]).toEqual([f, true]);
    }
    const trip = fs.readFileSync(path.join(root, "components/trip/BookingDeadlinePicker.tsx"), "utf8");
    expect(trip).toContain("timezoneCityName(brandTimezone");
  });
});
