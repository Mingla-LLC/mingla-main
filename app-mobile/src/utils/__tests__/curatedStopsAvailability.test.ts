// @ts-nocheck
// ORCH-1019 T-01 (implementor-owned, happy-path) regression test.
// Deno-runnable (curatedStopsAvailability.ts + openingHoursUtils.ts have NO RN
// deps), matching the sibling friendMenu.test.ts / discoverEventsCache.test.ts
// pattern.
//
// Fails-on-revert anchor for the F-2 fix: the proven adversarial fixture is a
// 2-stop curated plan whose dinner stop is open Saturday 5:00 – 10:00 PM, with
// the plan scheduled "Now" at ~Sat 15:07 → arrival (stop 1 ≈ 0 min, stop 2
// after stop-1 duration + travel) lands BEFORE the dinner opens → the validator
// MUST report not-all-open and name the closed dinner stop.
//
// The dinner stop's hours are supplied in the RAW Google Places v1 shape
// ({ weekdayDescriptions: [...] }) — exactly the shape the deleted bespoke
// SavedTab parser indexed by day name (openingHours[dayName]) and so always
// missed at runtime, returning false-OK. Reverting to that lookup makes this
// test FAIL (the validator would report allOpen:true).
import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkAllCuratedStopsOpen } from "../curatedStopsAvailability.ts";

// A fixed Saturday at 15:07 local. May 30 2026 is a Saturday.
const SATURDAY_3_07_PM = new Date(2026, 4, 30, 15, 7, 0);

Deno.test("ORCH-1019 T-01: dinner stop closed at arrival → not all open, names the stop (Google-v1 shape)", () => {
  const stops = [
    {
      placeName: "Nasher Museum of Art",
      address: "2001 Campus Dr, Durham, NC 27705, USA",
      // open all afternoon Saturday — stop 1 is fine
      openingHours: {
        weekdayDescriptions: [
          "Monday: 10:00 AM – 5:00 PM",
          "Tuesday: 10:00 AM – 5:00 PM",
          "Wednesday: 10:00 AM – 5:00 PM",
          "Thursday: 10:00 AM – 5:00 PM",
          "Friday: 10:00 AM – 5:00 PM",
          "Saturday: 10:00 AM – 5:00 PM",
          "Sunday: 12:00 PM – 5:00 PM",
        ],
      },
      estimatedDurationMinutes: 60,
      travelTimeFromPreviousStopMin: null,
    },
    {
      placeName: "Rey's Restaurant",
      address: "2200 W Main St, Durham, NC 27701, USA",
      // dinner: opens 5:00 PM Saturday — closed at the ~16:22 arrival
      openingHours: {
        weekdayDescriptions: [
          "Monday: 5:00 PM – 10:00 PM",
          "Tuesday: 5:00 PM – 10:00 PM",
          "Wednesday: 5:00 PM – 10:00 PM",
          "Thursday: 5:00 PM – 10:00 PM",
          "Friday: 5:00 PM – 10:00 PM",
          "Saturday: 5:00 PM – 10:00 PM",
          "Sunday: 5:00 PM – 10:00 PM",
        ],
      },
      estimatedDurationMinutes: 90,
      travelTimeFromPreviousStopMin: 15,
    },
  ];

  const { allOpen, results } = checkAllCuratedStopsOpen(
    stops,
    SATURDAY_3_07_PM,
    "en-US",
  );

  // The whole plan is NOT open (dinner closed at arrival).
  assertEquals(allOpen, false);
  // Stop 1 (museum) is open.
  assertEquals(results[0].isOpen, true);
  // Stop 2 (dinner) is reported closed, with a time-bearing reason.
  assertEquals(results[1].isOpen, false);
  assertEquals(results[1].stopName, "Rey's Restaurant");
  assert(
    typeof results[1].reason === "string" && /\d/.test(results[1].reason),
    `expected a reason mentioning a time, got: ${results[1].reason}`,
  );
});

Deno.test("ORCH-1019 T-04: stop with no parseable hours is non-blocking (honest-unknown ≠ closed)", () => {
  const stops = [
    {
      placeName: "Mystery Spot",
      address: "1 Unknown Way",
      openingHours: {}, // no weekdayDescriptions → null → must NOT block
      estimatedDurationMinutes: 45,
      travelTimeFromPreviousStopMin: null,
    },
  ];
  const { allOpen, results } = checkAllCuratedStopsOpen(
    stops,
    SATURDAY_3_07_PM,
    "en-US",
  );
  assertEquals(allOpen, true);
  assertEquals(results[0].isOpen, true);
  assertEquals(results[0].reason, undefined);
});

Deno.test("ORCH-1019 T-03: all stops open at the chosen time → allOpen true", () => {
  const stops = [
    {
      placeName: "Coffee Bar",
      address: "10 Main St",
      openingHours: {
        weekdayDescriptions: [
          "Saturday: 8:00 AM – 8:00 PM",
        ],
      },
      estimatedDurationMinutes: 30,
      travelTimeFromPreviousStopMin: null,
    },
    {
      placeName: "Gallery",
      address: "20 Main St",
      openingHours: {
        weekdayDescriptions: [
          "Saturday: 10:00 AM – 6:00 PM",
        ],
      },
      estimatedDurationMinutes: 60,
      travelTimeFromPreviousStopMin: 10,
    },
  ];
  const { allOpen } = checkAllCuratedStopsOpen(stops, SATURDAY_3_07_PM, "en-US");
  assertEquals(allOpen, true);
});
