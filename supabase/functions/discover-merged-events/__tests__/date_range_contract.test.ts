// ORCH-0828 — date-range contract test for discover-merged-events.
//
// Verifies that `localStartEndDateTime` is actually applied to the
// business-events branch. Pre-0828 this filter was silently dropped on
// the business side (it was only forwarded to Ticketmaster), so events
// outside the window were returned. The fix joins event_dates!inner +
// `event_dates.start_at` range constraints anchored by the request's
// IANA timezone.
//
// This is a pure-function contract test that exercises the timezone
// helper used inside the edge function. A full HTTP integration test
// against the deployed function (requiring SUPABASE_URL + service-role
// key) is documented in the SPEC as a manual gate; this file is the
// CI-runnable portion.
//
// Run with:
//   deno test supabase/functions/discover-merged-events/__tests__/date_range_contract.test.ts

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { parseLocalStartEndDateTime } from "../../_shared/timezone.ts";

Deno.test("ORCH-0828 contract — Tonight window in NY anchors Big Party correctly", () => {
  // Tonight in NY (2026-05-14): wall-clock window 00:00 → 23:59 EDT
  // = 04:00 UTC May 14 → 03:59 UTC May 15.
  const { startUtc, endUtc } = parseLocalStartEndDateTime(
    "2026-05-14T00:00:00,2026-05-14T23:59:00",
    "America/New_York",
  );
  const bigPartyStart = "2026-05-14T20:00:00.000Z"; // 4pm EDT
  // Big Party MUST be inside the Tonight window.
  if (Date.parse(bigPartyStart) < Date.parse(startUtc)) {
    throw new Error("Big Party should be after window start");
  }
  if (Date.parse(bigPartyStart) > Date.parse(endUtc)) {
    throw new Error("Big Party should be before window end");
  }
});

Deno.test("ORCH-0828 contract — early-morning window excludes Big Party", () => {
  // Wall-clock 00:00–06:00 EDT on 2026-05-14 = 04:00–10:00 UTC same day.
  // Big Party is 20:00 UTC — must NOT fall inside this window.
  const { startUtc, endUtc } = parseLocalStartEndDateTime(
    "2026-05-14T00:00:00,2026-05-14T06:00:00",
    "America/New_York",
  );
  const bigPartyStart = Date.parse("2026-05-14T20:00:00.000Z");
  if (
    bigPartyStart >= Date.parse(startUtc) &&
    bigPartyStart <= Date.parse(endUtc)
  ) {
    throw new Error(
      "Big Party erroneously inside early-morning window — date filter would over-include",
    );
  }
});

Deno.test("ORCH-0828 contract — exact start/end of Big Party window", () => {
  const { startUtc, endUtc } = parseLocalStartEndDateTime(
    "2026-05-14T16:00:00,2026-05-14T22:00:00",
    "America/New_York",
  );
  assertEquals(startUtc, "2026-05-14T20:00:00.000Z");
  assertEquals(endUtc, "2026-05-15T02:00:00.000Z");
});

Deno.test("ORCH-0828 contract — Pacific timezone window also correct", () => {
  // Event organizer in PT scheduling for 7pm PDT on 2026-05-14.
  const { startUtc } = parseLocalStartEndDateTime(
    "2026-05-14T19:00:00,2026-05-14T23:59:00",
    "America/Los_Angeles",
  );
  assertEquals(startUtc, "2026-05-15T02:00:00.000Z");
});
