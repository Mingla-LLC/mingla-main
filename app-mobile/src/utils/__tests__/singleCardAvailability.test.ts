// @ts-nocheck
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  checkSingleCardSchedulingAvailability,
} from "../singleCardAvailability.ts";

const SATURDAY_11_AM = new Date(2026, 4, 30, 11, 0, 0);

Deno.test("ORCH-1021: single card open is safe to schedule", () => {
  const result = checkSingleCardSchedulingAvailability(
    { openingHours: { weekdayDescriptions: ["Saturday: 9:00 AM - 12:00 PM"] } },
    SATURDAY_11_AM,
    "en-US",
  );

  assertEquals(result.status, "open");
  assertEquals(result.isSafeToSchedule, true);
  assertEquals(result.reason, undefined);
});

Deno.test("ORCH-1021: single card closed blocks scheduling with definitive reason", () => {
  const result = checkSingleCardSchedulingAvailability(
    { openingHours: { weekdayDescriptions: ["Saturday: 9:00 AM - 12:00 PM"] } },
    new Date(2026, 4, 30, 12, 1, 0),
    "en-US",
  );

  assertEquals(result.status, "closed");
  assertEquals(result.isSafeToSchedule, false);
  assertEquals(result.reason, "This place is closed at 12:01 PM. Please choose a different time.");
});

Deno.test("ORCH-1021: missing hours are unknown and block scheduling", () => {
  const result = checkSingleCardSchedulingAvailability(
    { openingHours: null },
    SATURDAY_11_AM,
    "en-US",
  );

  assertEquals(result.status, "unknown");
  assertEquals(result.isSafeToSchedule, false);
  assertEquals(result.reason, "Mingla could not confirm this place is open at 11:00 AM. Please choose a different time.");
});

Deno.test("ORCH-1021: unparseable hours are unknown and block scheduling", () => {
  const result = checkSingleCardSchedulingAvailability(
    { openingHours: { weekdayDescriptions: ["Saturday: appointment only"] } },
    SATURDAY_11_AM,
    "en-US",
  );

  assertEquals(result.status, "unknown");
  assertEquals(result.isSafeToSchedule, false);
  assert(result.reason?.includes("could not confirm this place is open"));
});

Deno.test("ORCH-1021: timezone offset changes the evaluated venue-local day/time", () => {
  const targetUtc = new Date(Date.UTC(2026, 4, 30, 2, 0, 0));
  const hours = {
    weekdayDescriptions: [
      "Friday: 9:00 PM - 11:00 PM",
      "Saturday: 9:00 PM - 11:00 PM",
    ],
  };

  const utcVenue = checkSingleCardSchedulingAvailability(
    { openingHours: hours, utcOffsetMinutes: 0 },
    targetUtc,
    "en-US",
  );
  const easternVenue = checkSingleCardSchedulingAvailability(
    { openingHours: hours, utc_offset_minutes: -300 },
    targetUtc,
    "en-US",
  );

  assertEquals(utcVenue.status, "closed");
  assertEquals(easternVenue.status, "open");
  assertEquals(easternVenue.isSafeToSchedule, true);
});
