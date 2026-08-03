// ─────────────────────────────────────────────────────────────────────────────
// #1293 [sprint-rollover-tz-fix] — TESTER ADVERSARIAL suite for todayISO().
//
// Independent of the implementor's today.test.mjs — attacks DIFFERENT angles:
//   • the exact shipped-incident instant (the bug that rolled 9 items ~5h early)
//   • the one-SECOND Eastern-midnight boundary (impl used one minute)
//   • DST spring-forward (impl only covered fall-back)
//   • DST fall-back at the MIDNIGHT boundary + inside the repeated 1 o'clock hour
//   • timezones EAST of UTC read LATE in the UTC day (local already the NEXT day),
//     incl. UTC+14 Kiritimati (impl only used an early-UTC Lagos instant)
//   • the default arg proven EQUAL to the explicit-ET call (structural, not literal)
//   • an INVALID tz — documents that Intl throws (a bad SPRINT_ROLLOVER_TZ crashes
//     the runner). See the finding note on that test.
//
// Every case injects a FIXED `now` instant so the resolved date is deterministic.
// Run: node --test .github/scripts/sprint-rollover/today.adversarial.test.mjs
//
// EDT = UTC-4 (Mar 8 03:00 → Nov 1 02:00 local). EST = UTC-5 (rest of year).
// US/Eastern 2026: spring-forward 2026-03-08 02:00→03:00 local; fall-back 2026-11-01
// 02:00→01:00 local.
// ─────────────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import { todayISO, DEFAULT_ROLLOVER_TZ } from "./today.mjs";

const ET = "America/New_York";

// 1) THE EXACT INCIDENT INSTANT — 2026-07-28T02:46:00Z is 22:46 EDT on 2026-07-27,
//    still Sprint 1's LAST day. The shipped UTC clock returned 2026-07-28 and rolled
//    9 items early. todayISO in ET must return the prior calendar day.
test("adversarial: exact incident instant 2026-07-28T02:46:00Z @ ET is still 2026-07-27 (the bug that shipped)", () => {
  assert.equal(todayISO(ET, new Date("2026-07-28T02:46:00Z")), "2026-07-27");
});

// 2) EASTERN MIDNIGHT BOUNDARY to the SECOND. EDT = UTC-4 in July, so local midnight
//    on 2026-07-28 is exactly 04:00:00Z. One second before must NOT have rolled.
test("adversarial: Eastern midnight boundary — 03:59:59Z is 2026-07-27, 04:00:00Z (00:00 EDT) is 2026-07-28", () => {
  assert.equal(todayISO(ET, new Date("2026-07-28T03:59:59Z")), "2026-07-27", "one second before local midnight must still be the 27th");
  assert.equal(todayISO(ET, new Date("2026-07-28T04:00:00Z")), "2026-07-28", "00:00 EDT (UTC-4) is the new calendar day");
});

// 3) DST SPRING-FORWARD, 2026-03-08. The clock jumps 02:00 EST → 03:00 EDT at 07:00Z.
//    Two independent things must hold, and the offset flip must not corrupt either:
//    (a) The date rolls at LOCAL MIDNIGHT, which is still EST (UTC-5) that morning →
//        05:00Z. 04:59:59Z is the 7th; 05:00:00Z is the 8th.
//    (b) Instants straddling the 07:00Z spring gap are BOTH still 2026-03-08 — the
//        offset changing from -5 to -4 must not move the calendar date.
test("adversarial: DST spring-forward 2026-03-08 — midnight rolls at 05:00Z (EST) and the 02:00→03:00 gap stays on 2026-03-08", () => {
  // (a) midnight boundary, still EST
  assert.equal(todayISO(ET, new Date("2026-03-08T04:59:59Z")), "2026-03-07", "23:59:59 EST is still the 7th");
  assert.equal(todayISO(ET, new Date("2026-03-08T05:00:00Z")), "2026-03-08", "00:00 EST (UTC-5) is the 8th");
  // (b) straddle the spring-forward gap at 07:00Z — both sides are 2026-03-08
  assert.equal(todayISO(ET, new Date("2026-03-08T06:59:00Z")), "2026-03-08", "01:59 EST before the gap");
  assert.equal(todayISO(ET, new Date("2026-03-08T07:00:00Z")), "2026-03-08", "03:00 EDT after the gap — same date");
});

// 4) DST FALL-BACK, 2026-11-01. The clock falls 02:00 EDT → 01:00 EST at 06:00Z, so the
//    1 o'clock hour is LIVED TWICE. Attack the midnight boundary (still EDT, UTC-4 →
//    04:00Z) and an instant INSIDE the repeated hour after the fall-back — neither may
//    move the calendar date off 2026-11-01.
test("adversarial: DST fall-back 2026-11-01 — midnight at 04:00Z (EDT) and the repeated 01:30 hour both stay on 2026-11-01", () => {
  assert.equal(todayISO(ET, new Date("2026-11-01T03:59:59Z")), "2026-10-31", "23:59:59 EDT is still Oct 31");
  assert.equal(todayISO(ET, new Date("2026-11-01T04:00:00Z")), "2026-11-01", "00:00 EDT (UTC-4) is Nov 1");
  assert.equal(todayISO(ET, new Date("2026-11-01T05:30:00Z")), "2026-11-01", "01:30 EDT — first pass of the repeated hour");
  assert.equal(todayISO(ET, new Date("2026-11-01T06:30:00Z")), "2026-11-01", "01:30 EST — second pass, still Nov 1");
});

// 5) TIMEZONES EAST OF UTC read late in the UTC day: the local date is ALREADY the next
//    day. Lagos = UTC+1 (no DST); Kiritimati = UTC+14 (no DST) — the most extreme case,
//    where even at MIDDAY UTC the local clock is already on the next calendar date.
test("adversarial: east-of-UTC zones (Lagos UTC+1, Kiritimati UTC+14) resolve to the NEXT day late in the UTC day", () => {
  // Lagos: 2026-07-28T23:30:00Z = 00:30 WAT on 2026-07-29
  assert.equal(todayISO("Africa/Lagos", new Date("2026-07-28T23:30:00Z")), "2026-07-29");
  // Kiritimati +14: at 11:00Z UTC is still midday the 28th, but locally it is 01:00 on the 29th
  assert.equal(todayISO("Pacific/Kiritimati", new Date("2026-07-28T11:00:00Z")), "2026-07-29");
  // …and late in the UTC day it is well into the 29th locally
  assert.equal(todayISO("Pacific/Kiritimati", new Date("2026-07-28T23:30:00Z")), "2026-07-29");
});

// 6) DEFAULT ARG. Proven structurally, not by literal: todayISO(undefined, now) must be
//    byte-identical to the explicit America/New_York call, and the exported default
//    constant must be America/New_York. Uses a fresh instant (03:00:00Z) distinct from
//    the implementor's.
test("adversarial: omitting tz defaults to America/New_York (equals the explicit-ET result)", () => {
  const now = new Date("2026-07-28T03:00:00Z"); // 23:00 EDT on 2026-07-27
  assert.equal(DEFAULT_ROLLOVER_TZ, ET);
  assert.equal(todayISO(undefined, now), todayISO(ET, now));
  assert.equal(todayISO(undefined, now), "2026-07-27"); // sanity: 23:00 EDT is still the 27th
});

// 7) INVALID TZ — documents ACTUAL behavior.
//    FINDING (P3 / low, fail-closed): Intl.DateTimeFormat THROWS a RangeError on an
//    invalid IANA zone, so todayISO throws too. roll.mjs:336 calls todayISO(rolloverTz)
//    with rolloverTz = process.env.ROLLOVER_TZ (from vars.SPRINT_ROLLOVER_TZ). A typo'd
//    or bogus SPRINT_ROLLOVER_TZ therefore CRASHES the whole runner — the throw
//    propagates to main().catch (roll.mjs:406), which prints "sprint-rollover FATAL:
//    Invalid time zone specified: …" and exits 1. The nightly job goes RED.
//    This is FAIL-CLOSED (a crash before any board read/write — ZERO writes, no wrong
//    rollover), and only reachable if an operator sets the OPTIONAL var to a bad value;
//    the default path never hits it. Recommendation: validate/normalize ROLLOVER_TZ at
//    startup and fall back to DEFAULT_ROLLOVER_TZ with a WARN (or emit a clear
//    "invalid ROLLOVER_TZ" message) rather than a generic Intl RangeError.
test("adversarial: invalid tz throws a RangeError (documents that a bad SPRINT_ROLLOVER_TZ crashes the runner — fail-closed)", () => {
  const now = new Date("2026-07-28T03:00:00Z");
  assert.throws(
    () => todayISO("Not/AZone", now),
    (err) => err instanceof RangeError && /invalid time zone/i.test(err.message),
    "an invalid IANA zone must throw a RangeError (fail-closed) — see the finding note above",
  );
  // An empty-string tz is likewise rejected (not silently coerced to UTC/local).
  assert.throws(() => todayISO("", now), RangeError);
});
