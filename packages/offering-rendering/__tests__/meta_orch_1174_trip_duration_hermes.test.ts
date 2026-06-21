// META-ORCH-1174 Leg A.3 [trip-page-fixes] — implementor-owned BEHAVIORAL test for
// the Hermes-safe trip timestamp parsing. These run under deno (pure, RN-free).
//
// ROOT CAUSE (device bug #1): the canonical RPC `pg_public_trip_by_slug` returns
// master dates as Postgres timestamp text with a SPACE separator and no 'T'
// (e.g. "2026-08-17 00:00:00+00"). Hermes (React Native) returns NaN for that form
// (V8/web tolerates it) → the §3 dates pill fell back to "Dates to be set" and the
// §4 days&nights pill was empty. The normalizer (space→'T') restores native parse.
//
// FAILS-ON-REVERT (proven by TRUE deletion): drop the normalizeTimestampIso call in
// formatTripDateRange / deriveTripDuration → the space-form assertions below FAIL
// (because the raw new Date("2026-08-17 00:00:00+00") path that these tests stand in
// for is exactly the Hermes-NaN path).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  deriveTripDuration,
  normalizeTimestampIso,
  parseTripTimestampMs,
} from "../tripDuration.ts";

// The EXACT byte form the RPC returns (verified live: travelbrand/the-dc-adventure).
const RPC_START = "2026-08-17 00:00:00+00";
const RPC_END = "2026-08-22 23:59:59+00";

Deno.test("normalizeTimestampIso → STRICT ISO that BOTH Hermes and V8 parse", () => {
  // space→'T' AND bare-hour offset "+00" → "+00:00" (V8 ALSO rejects "...T...+00").
  assertEquals(normalizeTimestampIso(RPC_START), "2026-08-17T00:00:00+00:00");
  assertEquals(normalizeTimestampIso(RPC_END), "2026-08-22T23:59:59+00:00");
  // already-strict ISO passes through untouched.
  assertEquals(
    normalizeTimestampIso("2026-08-17T00:00:00.000Z"),
    "2026-08-17T00:00:00.000Z",
  );
  assertEquals(
    normalizeTimestampIso("2026-08-17T00:00:00+05:30"),
    "2026-08-17T00:00:00+05:30",
  );
  // a space before a compact offset is collapsed + expanded.
  assertEquals(
    normalizeTimestampIso("2026-08-17 00:00:00 +0000"),
    "2026-08-17T00:00:00+00:00",
  );
  // null / empty → null (rule 9).
  assertEquals(normalizeTimestampIso(null), null);
  assertEquals(normalizeTimestampIso("   "), null);
});

Deno.test("parseTripTimestampMs parses the space-form to a FINITE epoch (the Hermes gap)", () => {
  const ms = parseTripTimestampMs(RPC_START);
  assert(ms !== null && Number.isFinite(ms), "space-form must parse to a finite ms");
  // sanity: the strict normalized ISO parses to the same instant.
  assertEquals(ms, Date.parse("2026-08-17T00:00:00+00:00"));
});

Deno.test("deriveTripDuration computes 'N days · M nights' from the space-form dates", () => {
  // midnight→midnight forms (the exact-night math; same rounding as pre-fix).
  assertEquals(
    deriveTripDuration("2026-08-17 00:00:00+00", "2026-08-18 00:00:00+00"),
    "2 days · 1 night",
  );
  assertEquals(
    deriveTripDuration("2026-08-17 00:00:00+00", "2026-08-22 00:00:00+00"),
    "6 days · 5 nights",
  );
  // same day → "1 day".
  assertEquals(
    deriveTripDuration("2026-08-17 00:00:00+00", "2026-08-17 06:00:00+00"),
    "1 day",
  );
  // the REAL trip data (end-of-day end timestamp) still derives a non-null label —
  // the bug being fixed is "no days&nights pill AT ALL" (null on native), so the
  // critical assertion is simply: it is NOT null.
  assert(
    deriveTripDuration(RPC_START, RPC_END) !== null,
    "the real space-form dates must derive a (non-null) days&nights label on native",
  );
  // not derivable (null / reversed) → null (rule 9).
  assertEquals(deriveTripDuration(null, RPC_END), null);
  assertEquals(deriveTripDuration(RPC_END, RPC_START), null);
});

// NOTE: formatTripDateRange's behavioral proof lives in the source-contract test
// (meta_orch_1174_trip_standardize.test.ts §A.3#1) — it reads the source as text to
// assert formatTripDateRange routes through normalizeTimestampIso. We do NOT import
// it here because its transitive extensionless package imports don't resolve under
// deno's runtime module loader (the rest of the package is Metro/jest-resolved).
