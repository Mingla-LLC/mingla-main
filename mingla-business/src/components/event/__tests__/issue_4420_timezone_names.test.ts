/**
 * #4420 round-3 item 12 — time zones never show as slugs in the event When
 * step. Fails when the label or the picker rows go back to raw zone ids.
 *
 * [TEST-MOD-APPROVED #4420] — the city rule moved to the shared
 * `timezoneCityName` / `timezoneMatchesQuery` in utils/timezones.
 * [TEST-MOD-APPROVED #4420] — the source-text half moved to the I-4420-HOST-WIRING
 * strict-grep gate (I-PROPOSED-1047-NO-SOLE-SOURCE-PIN); this file keeps the behaviour.
 */
import { timezoneCityName, timezoneMatchesQuery } from "../../../utils/timezones";

describe("#4420 time zone names", () => {
  it("reads a city, not a slug", () => {
    expect(timezoneCityName("America/New_York")).toBe("New York");
    expect(timezoneCityName("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(timezoneCityName("UTC")).toBe("UTC");
  });

  it("labels the field and the picker rows with the name, keeping the stored id searchable", () => {
    expect(timezoneMatchesQuery("America/New_York", "new york")).toBe(true);
    expect(timezoneMatchesQuery("America/New_York", "America/New_York")).toBe(true);
    expect(timezoneMatchesQuery("America/New_York", "lagos")).toBe(false);
  });
});
