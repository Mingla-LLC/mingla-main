// @ts-nocheck
// ORCH-1019 T-02 (tester-owned, ADVERSARIAL) regression test.
//
// Deno-runnable (curatedStopsAvailability.ts + openingHoursUtils.ts have NO RN
// deps), matching the sibling friendMenu.test.ts / discoverEventsCache.test.ts
// pattern. Distinct file from the implementor's append-only happy-path test
// (curatedStopsAvailability.test.ts), per the CLOSE Step-0.5(b) gate.
//
// ── Why this is ADVERSARIAL, not a copy of the happy-path ───────────────────
// The implementor's T-01 attacks ONE vector: a 2-stop plan, RAW Google-v1
// `weekdayDescriptions` shape, dinner stop closed because arrival is BEFORE the
// open time. This file attacks DIFFERENT vectors of the SAME false-OK bug class
// so a regression on any of them is caught:
//
//   A. LEGACY lowercase-day-record shape ({ saturday: "..." }) — the OTHER
//      persisted production shape. The deleted bespoke parser indexed
//      openingHours["Saturday"] (capitalized) against a {saturday:...} record,
//      so the lookup missed via CASE MISMATCH → false-OK. (Different miss
//      mechanism than the Google-v1 "no day key at all" miss in T-01.)
//   B. A stop explicitly "Saturday: Closed" — closed on the whole arrival day,
//      not merely "arrival before open". isPlaceOpenAt must return false here
//      via the /closed/ branch, NOT the time-range branch.
//   C. CLOSES-AT-ARRIVAL via the CUMULATIVE model: a 3-stop plan where a LATER
//      stop's arrival (after stop-1 duration + travel + stop-2 duration +
//      travel) falls AFTER that stop has CLOSED. T-01 only exercises the
//      "before open" direction at stop 2; this exercises the "after close"
//      direction at stop 3 and proves the cumulative-minutes accumulation is
//      respected for closed detection.
//   D. The Calendar-RESCHEDULE invariant the operator originally reported: a
//      curated entry MUST NOT be treated as a regular single-place card. We
//      assert the shared validator (the exact function CalendarTab F-1(c) calls
//      at the reschedule submit) returns a real per-stop verdict for a curated
//      stop array — i.e. the reschedule path can no longer fall through to the
//      "couldn't verify" (isPlaceOpenAt(null)) regular flow when stops exist.
//
// ── Fails-on-revert ─────────────────────────────────────────────────────────
// Reverting checkAllCuratedStopsOpen to the deleted bespoke
// `stop.openingHours?.[dayName]` lookup makes A, B, and C all report allOpen:true
// (false-OK) → these assertions FAIL. Proven by the tester at the cited commit.

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkAllCuratedStopsOpen } from "../curatedStopsAvailability.ts";

// May 30 2026 is a Saturday. 15:07 local — the proven repro arrival window.
const SATURDAY_3_07_PM = new Date(2026, 4, 30, 15, 7, 0);
// 10:30 AM Saturday — a morning start, used so a cumulative arrival can cross a
// venue's evening CLOSE for vector C.
const SATURDAY_10_30_AM = new Date(2026, 4, 30, 10, 30, 0);

// ── Vector A: legacy lowercase-day-record shape, stop closed at arrival ──────
Deno.test("ORCH-1019 T-02-A (adversarial): legacy {saturday} day-record shape, dinner closed at arrival → NOT all open (case-mismatch false-OK guard)", () => {
  const stops = [
    {
      placeName: "Morning Cafe",
      address: "1 Cafe St",
      // legacy lowercase day-record — the SECOND production shape. Open now.
      openingHours: {
        saturday: "8:00 AM – 11:00 AM",
      },
      estimatedDurationMinutes: 30,
      travelTimeFromPreviousStopMin: null,
    },
    {
      placeName: "Dinner Spot",
      address: "2 Dinner Ave",
      // legacy lowercase day-record, dinner opens 5 PM — closed at the
      // ~3:52 PM arrival. The deleted parser indexed openingHours["Saturday"]
      // (capital S) on this lowercase-keyed record → undefined → false-OK.
      openingHours: {
        saturday: "5:00 PM – 10:00 PM",
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

  assertEquals(allOpen, false);
  // Cafe (8–11 AM) is itself CLOSED at the 3:07 PM start → flagged closed too.
  assertEquals(results[0].isOpen, false);
  // The dinner stop (lowercase-record, opens 5 PM) is the case-mismatch
  // false-OK vector — it MUST be flagged closed with a time-bearing reason.
  assertEquals(results[1].isOpen, false);
  assertEquals(results[1].stopName, "Dinner Spot");
  assert(
    typeof results[1].reason === "string" && /\d/.test(results[1].reason),
    `expected a time-bearing reason for the closed dinner stop, got: ${results[1].reason}`,
  );
});

// ── Vector B: explicit "Closed" on the arrival day ──────────────────────────
Deno.test("ORCH-1019 T-02-B (adversarial): a stop marked 'Saturday: Closed' is reported CLOSED, never 'All Stops Are Open!'", () => {
  const stops = [
    {
      placeName: "Open Gallery",
      address: "10 Art Rd",
      openingHours: {
        weekdayDescriptions: ["Saturday: 10:00 AM – 6:00 PM"],
      },
      estimatedDurationMinutes: 30,
      travelTimeFromPreviousStopMin: null,
    },
    {
      placeName: "Closed-Today Boutique",
      address: "20 Shop Ln",
      openingHours: {
        weekdayDescriptions: ["Saturday: Closed"],
      },
      estimatedDurationMinutes: 30,
      travelTimeFromPreviousStopMin: 5,
    },
  ];

  const { allOpen, results } = checkAllCuratedStopsOpen(
    stops,
    SATURDAY_3_07_PM,
    "en-US",
  );

  assertEquals(allOpen, false);
  assertEquals(results[0].isOpen, true);
  assertEquals(results[1].isOpen, false);
  assertEquals(results[1].stopName, "Closed-Today Boutique");
});

// ── Vector C: closes-at-arrival via the cumulative model (3 stops) ──────────
Deno.test("ORCH-1019 T-02-C (adversarial): a LATER stop whose cumulative arrival falls AFTER it closes → reported closed (cumulative model in the close direction)", () => {
  // Start 10:30 AM. Stop 1: 90 min + 30 travel. Stop 2: 120 min + 30 travel.
  // Stop 3 arrival = 10:30 + 90 + 30 + 120 + 30 = +300 min = 3:30 PM.
  // Stop 3 closes at 2:00 PM → arrival 3:30 PM is AFTER close → CLOSED.
  const stops = [
    {
      placeName: "Brunch",
      address: "1 Brunch Way",
      openingHours: { weekdayDescriptions: ["Saturday: 9:00 AM – 3:00 PM"] },
      estimatedDurationMinutes: 90,
      travelTimeFromPreviousStopMin: null,
    },
    {
      placeName: "Afternoon Museum",
      address: "2 Museum Blvd",
      openingHours: { weekdayDescriptions: ["Saturday: 10:00 AM – 5:00 PM"] },
      estimatedDurationMinutes: 120,
      travelTimeFromPreviousStopMin: 30,
    },
    {
      placeName: "Lunch-Only Deli",
      address: "3 Deli St",
      // closes 2:00 PM — but the cumulative arrival is ~3:30 PM → closed.
      openingHours: { weekdayDescriptions: ["Saturday: 11:00 AM – 2:00 PM"] },
      estimatedDurationMinutes: 45,
      travelTimeFromPreviousStopMin: 30,
    },
  ];

  const { allOpen, results } = checkAllCuratedStopsOpen(
    stops,
    SATURDAY_10_30_AM,
    "en-US",
  );

  assertEquals(allOpen, false);
  assertEquals(results[0].isOpen, true); // brunch open 10:30 AM
  assertEquals(results[1].isOpen, true); // museum open at ~12:30 PM arrival
  assertEquals(results[2].isOpen, false); // deli CLOSED by 3:30 PM arrival
  assertEquals(results[2].stopName, "Lunch-Only Deli");
});

// ── Vector D: curated reschedule must NOT fall through to the regular flow ──
Deno.test("ORCH-1019 T-02-D (adversarial): curated stop array yields a real per-stop verdict (reschedule path no longer hits the 'couldn't verify' regular flow)", () => {
  // The CalendarTab F-1(c) reschedule submit calls THIS exact function on
  // entry.experience.stops. A curated entry must produce a concrete per-stop
  // result list — not a single null "couldn't verify". Here every stop is open
  // → allOpen true AND one result per stop (proving it ran the curated reader,
  // not the regular single-place isPlaceOpenAt(null) path that produced the
  // operator's false warning).
  const stops = [
    {
      placeName: "Park",
      address: "1 Green Way",
      openingHours: { weekdayDescriptions: ["Saturday: 6:00 AM – 10:00 PM"] },
      estimatedDurationMinutes: 60,
      travelTimeFromPreviousStopMin: null,
    },
    {
      placeName: "Bistro",
      address: "2 Food St",
      openingHours: { weekdayDescriptions: ["Saturday: 11:00 AM – 11:00 PM"] },
      estimatedDurationMinutes: 90,
      travelTimeFromPreviousStopMin: 10,
    },
  ];

  const { allOpen, results } = checkAllCuratedStopsOpen(
    stops,
    SATURDAY_3_07_PM,
    "en-US",
  );

  assertEquals(allOpen, true);
  assertEquals(results.length, 2); // a real per-stop verdict list, not a fallthrough
  assert(results.every((r) => typeof r.isOpen === "boolean"));
});
