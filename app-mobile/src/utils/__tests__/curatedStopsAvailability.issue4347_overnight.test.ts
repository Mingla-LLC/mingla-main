// @ts-nocheck
// #4347 wave 3 follow-up (implementor-owned): ONE overnight-hours model.
//
// The schedule safety check (checkAllCuratedStopsOpen) and the single-place
// check decide "open at arrival" with the same interval model the plan sheet's
// chips and warning use (getOpenStatusAt): an overnight range belongs to the
// night it starts on. Before, the check read only the arrival day's own line,
// so after midnight it refused a time the sheet showed as "Open until 2am"
// (Sunday 01:00) and accepted one the sheet showed as closed (Friday 01:00).
//
// Run: deno test --no-check --sloppy-imports app-mobile/src/utils/__tests__/
// Fails on revert: restore the old isPlaceOpenAt body (arrival day's line only)
// and the Sunday 01:00 and Friday 01:00 cases below fail.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkAllCuratedStopsOpen } from "../curatedStopsAvailability.ts";
import { checkSingleCardSchedulingAvailability } from "../singleCardAvailability.ts";
import { getOpenStatusAt, isPlaceOpenAt } from "../openingHoursUtils.ts";

const BAR = [
  "Monday: Closed",
  "Tuesday: Closed",
  "Wednesday: Closed",
  "Thursday: Closed",
  "Friday: 6:00 PM – 2:00 AM",
  "Saturday: 6:00 PM – 2:00 AM",
  "Sunday: Closed",
];
// May 29 2026 is a Friday; device-local clock (no venue offset), like the
// sibling ORCH-1019 tests.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 4, day, hour, minute, 0);
const FRI = 29;
const SAT = 30;
const SUN = 31;

const CASES: Array<[string, Date, boolean]> = [
  ["Friday 01:00 (Thursday closed)", at(FRI, 1), false],
  ["Friday 23:30", at(FRI, 23, 30), true],
  ["Saturday 01:00 (Friday night)", at(SAT, 1), true],
  ["Saturday 23:30", at(SAT, 23, 30), true],
  ["Sunday 01:00 (Saturday night)", at(SUN, 1), true],
  ["Sunday 02:00 (closed at 2am)", at(SUN, 2), false],
];

for (const [label, when, open] of CASES) {
  Deno.test(`#4347 overnight: schedule check agrees with the sheet at ${label}`, () => {
    const status = getOpenStatusAt(BAR, when, null);
    const sheetSaysOpen = status !== null && status.kind !== "closed";
    assertEquals(sheetSaysOpen, open, "fixture sanity: the sheet's own verdict");
    assertEquals(isPlaceOpenAt(BAR, when, null), open);

    const curated = checkAllCuratedStopsOpen(
      [{ placeName: "Night Bar", openingHours: { weekdayDescriptions: BAR }, estimatedDurationMinutes: 60 }],
      when,
      "en-US",
    );
    assertEquals(curated.allOpen, open);
    assertEquals(curated.results[0].status, open ? "open" : "closed");

    const single = checkSingleCardSchedulingAvailability({ openingHours: { weekdayDescriptions: BAR } }, when);
    assertEquals(single.isSafeToSchedule, open);
  });
}

Deno.test("#4347 overnight: a plan starting Saturday 23:30 whose second stop lands at Sunday 01:00 is all open", () => {
  const result = checkAllCuratedStopsOpen(
    [
      { placeName: "First Bar", openingHours: { weekdayDescriptions: BAR }, estimatedDurationMinutes: 60 },
      {
        placeName: "Second Bar",
        openingHours: { weekdayDescriptions: BAR },
        estimatedDurationMinutes: 45,
        travelTimeFromPreviousStopMin: 30,
      },
    ],
    at(SAT, 23, 30),
    "en-US",
  );
  assertEquals(result.results.map((r) => r.status), ["open", "open"]);
  assertEquals(result.allOpen, true);
});

Deno.test("#4347 overnight: venue offset — Saturday 23:30 and Sunday 01:00 venue-local (UTC+1) are open", () => {
  // 22:30Z Saturday = 23:30 in UTC+1; 00:00Z Sunday = 01:00 in UTC+1.
  for (const iso of ["2026-05-30T22:30:00Z", "2026-05-31T00:00:00Z"]) {
    const result = checkAllCuratedStopsOpen(
      [{ placeName: "Lagos Bar", openingHours: { weekdayDescriptions: BAR }, utcOffsetMinutes: 60 }],
      new Date(iso),
      "en-US",
    );
    assertEquals(result.allOpen, true, iso);
  }
});

Deno.test("#4347 overnight: unknown stays unknown and blocks scheduling", () => {
  const result = checkAllCuratedStopsOpen(
    [{ placeName: "No Hours", openingHours: null }],
    at(SUN, 1),
    "en-US",
  );
  assertEquals(result.results[0].status, "unknown");
  assertEquals(result.allOpen, false);
});
