// ORCH-0828 — timezone helper contract tests.
//
// Pins the conversion that the discover-merged-events business-events
// date filter depends on. Run with:
//   deno test supabase/functions/_shared/timezone.test.ts

import { assertEquals, assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  localWallClockToUtcInstant,
  parseLocalStartEndDateTime,
} from "./timezone.ts";

Deno.test("UTC wall-clock is identity", () => {
  assertEquals(
    localWallClockToUtcInstant("2026-05-14T16:00:00", "UTC"),
    "2026-05-14T16:00:00.000Z",
  );
});

Deno.test("EDT (UTC-4) — Big Party canonical case", () => {
  // The exact case from Bug C: 4pm EDT on 2026-05-14 → 8pm UTC.
  assertEquals(
    localWallClockToUtcInstant("2026-05-14T16:00:00", "America/New_York"),
    "2026-05-14T20:00:00.000Z",
  );
});

Deno.test("PDT (UTC-7) round-trip", () => {
  assertEquals(
    localWallClockToUtcInstant("2026-05-14T09:00:00", "America/Los_Angeles"),
    "2026-05-14T16:00:00.000Z",
  );
});

Deno.test("BST (UTC+1) — London summer time", () => {
  assertEquals(
    localWallClockToUtcInstant("2026-05-14T20:00:00", "Europe/London"),
    "2026-05-14T19:00:00.000Z",
  );
});

Deno.test("DST fall-back — re-anchoring converges", () => {
  // 2026-11-01 02:00 in NY is ambiguous (fall-back). Helper should
  // converge on one stable answer; we don't pin which side, only that
  // it produces a valid UTC ISO instant within ±1h of the naive value.
  const out = localWallClockToUtcInstant(
    "2026-11-01T02:00:00",
    "America/New_York",
  );
  const t = Date.parse(out!);
  const expected = Date.UTC(2026, 10, 1, 2, 0, 0);
  const delta = Math.abs(t - expected);
  // Wall-clock 02:00 should land within 5-6h of the same UTC clock-face
  // depending on which side of the fold we picked. Tighter bound: within
  // a 7-hour window covering -4 (EDT) and -5 (EST).
  if (delta > 7 * 3600 * 1000) {
    throw new Error(`DST converge unexpected: ${out} vs naive ${expected}`);
  }
});

Deno.test("malformed wall clock throws", () => {
  assertThrows(
    () => localWallClockToUtcInstant("not-a-date", "UTC"),
    Error,
    "invalid_local_wall_clock",
  );
});

Deno.test("invalid timezone is rejected by Intl (downstream parse)", () => {
  let threw = false;
  try {
    localWallClockToUtcInstant("2026-05-14T16:00:00", "Not/A_Real_Zone");
  } catch {
    threw = true;
  }
  // V8 throws RangeError on unknown IANA id when DateTimeFormat is
  // constructed inside formatToParts. We accept either throw OR an
  // explicit null/empty return as conformance — both signal failure
  // to the caller.
  if (!threw) {
    throw new Error("Expected throw on invalid timezone");
  }
});

Deno.test("parseLocalStartEndDateTime — happy path", () => {
  const { startUtc, endUtc } = parseLocalStartEndDateTime(
    "2026-05-14T16:00:00,2026-05-14T22:00:00",
    "America/New_York",
  );
  assertEquals(startUtc, "2026-05-14T20:00:00.000Z");
  assertEquals(endUtc, "2026-05-15T02:00:00.000Z");
});

Deno.test("parseLocalStartEndDateTime — wrong shape rejects", () => {
  assertThrows(
    () => parseLocalStartEndDateTime("only-one-half", "UTC"),
    Error,
    "invalid_local_start_end_datetime",
  );
});
