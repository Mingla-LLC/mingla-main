// ORCH-1186 Fix 1 — the ONE adaptive availability banner, per-case copy
// regression. Deno-runnable (experienceAvailabilityBanner.ts is pure, dep-free —
// no RN imports). Asserts the banner derives identical, correct copy for EVERY
// availability shape so consumer + business/web render the same string.
//
// Timezone is pinned to "UTC" with whole-hour startAt/endAt so the Intl day/time
// formats are deterministic across the CI host locale (we assert structure, not
// an exact "7:00 PM" the host locale might render "19:00").
//
// FAILS-ON-REVERT: drop the open-daily branch → the open-daily case stops saying
// "Open daily" and the test FAILS; drop the ≥2 branch → the fixed-slots case
// stops saying "upcoming dates" and FAILS.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { experienceAvailabilityBanner } from "../experienceAvailabilityBanner.ts";

const TZ = "UTC";

// 1) OPEN-DAILY with a window → "Open daily · {open}–{close}" + reserve sub.
Deno.test("open-daily with window → Open daily · hours + sub", () => {
  const b = experienceAvailabilityBanner({
    openDaily: true,
    occurrences: [
      { startAt: "2026-06-17T08:00:00.000Z", endAt: "2026-06-17T21:00:00.000Z" },
      { startAt: "2026-06-18T08:00:00.000Z", endAt: "2026-06-18T21:00:00.000Z" },
    ],
    timezone: TZ,
    bookable: true,
  });
  assert(b !== null);
  assert(b.primary.startsWith("Open daily · "), `got "${b.primary}"`);
  assert(b.primary.includes("–"), "expected an en-dash window range");
  assertEquals(b.sub, "Reserve any upcoming day");
});

// 1b) OPEN-DAILY but NO materialized window → "Open daily" fallback (no fabricate).
Deno.test("open-daily without occurrences → Open daily fallback", () => {
  const b = experienceAvailabilityBanner({
    openDaily: true,
    occurrences: [],
    timezone: TZ,
    bookable: true,
  });
  assertEquals(b, { primary: "Open daily", sub: "Reserve any upcoming day" });
});

// 2) FIXED SLOTS (≥2 dates) → "{N} upcoming dates" + "Next {day, time}".
Deno.test("fixed slots ≥2 → N upcoming dates + Next", () => {
  const b = experienceAvailabilityBanner({
    openDaily: false,
    occurrences: [
      { startAt: "2026-06-17T19:00:00.000Z", endAt: "2026-06-17T22:00:00.000Z" },
      { startAt: "2026-06-24T19:00:00.000Z", endAt: "2026-06-24T22:00:00.000Z" },
      { startAt: "2026-07-01T19:00:00.000Z", endAt: "2026-07-01T22:00:00.000Z" },
    ],
    timezone: TZ,
    bookable: true,
  });
  assert(b !== null);
  assertEquals(b.primary, "3 upcoming dates");
  assert(b.sub !== null && b.sub.startsWith("Next "), `got "${b.sub}"`);
});

// 2b) Out-of-order occurrences → still sorts future-first for "Next".
Deno.test("fixed slots unsorted → Next is the earliest", () => {
  const b = experienceAvailabilityBanner({
    openDaily: false,
    occurrences: [
      { startAt: "2026-07-01T19:00:00.000Z", endAt: "2026-07-01T22:00:00.000Z" },
      { startAt: "2026-06-17T19:00:00.000Z", endAt: "2026-06-17T22:00:00.000Z" },
    ],
    timezone: TZ,
    bookable: true,
  });
  assert(b !== null);
  assertEquals(b.primary, "2 upcoming dates");
  // The earliest (17 Jun) must be the "Next", not 1 Jul.
  assert(b.sub !== null && b.sub.includes("17"), `got "${b.sub}"`);
});

// 3) SINGLE DATE → "{day}" + "{time}".
Deno.test("single date → day primary + time sub", () => {
  const b = experienceAvailabilityBanner({
    openDaily: false,
    occurrences: [
      { startAt: "2026-06-17T19:00:00.000Z", endAt: "2026-06-17T22:00:00.000Z" },
    ],
    timezone: TZ,
    bookable: true,
  });
  assert(b !== null);
  assert(!b.primary.includes("upcoming"), "single date must not say upcoming");
  assert(b.primary.includes("17"), `expected the date in primary, got "${b.primary}"`);
  assert(b.sub !== null && b.sub.length > 0, "expected a time sub");
});

// 4) NO DATE but bookable → "Available anytime" (no sub).
Deno.test("no occurrences but bookable → Available anytime", () => {
  const b = experienceAvailabilityBanner({
    openDaily: false,
    occurrences: [],
    timezone: TZ,
    bookable: true,
  });
  assertEquals(b, { primary: "Available anytime", sub: null });
});

// 5) NO DATE and NOT bookable → null (render nothing — rule 9).
Deno.test("no occurrences and not bookable → null", () => {
  const b = experienceAvailabilityBanner({
    openDaily: false,
    occurrences: [],
    timezone: TZ,
    bookable: false,
  });
  assertEquals(b, null);
});

// 6) Garbage dates are filtered → falls through to the no-date branch.
Deno.test("invalid occurrence dates → filtered → Available anytime", () => {
  const b = experienceAvailabilityBanner({
    openDaily: false,
    occurrences: [{ startAt: "not-a-date", endAt: "also-bad" }],
    timezone: TZ,
    bookable: true,
  });
  assertEquals(b, { primary: "Available anytime", sub: null });
});
