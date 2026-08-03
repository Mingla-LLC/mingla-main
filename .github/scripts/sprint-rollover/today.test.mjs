// ─────────────────────────────────────────────────────────────────────────────
// #1293 [sprint-rollover-tz-fix] — unit tests for the timezone-aware "today".
//
// Run: node --test .github/scripts/sprint-rollover/today.test.mjs
//
// This is the gap that let the premature-rollover ship: the old tests always fed
// selectMoves a fixed todayISO, so a WRONG todayISO (UTC instead of Eastern) could
// not be caught. These tests inject a fixed instant and assert the resolved date so
// the date SOURCE is itself pinned.
//
// The load-bearing case:
//   2026-07-28T02:46:00Z is 22:46 EDT on 2026-07-27 — Sprint 1's LAST day, NOT over.
//   The buggy UTC clock returned 2026-07-28 and rolled 9 items ~5h early.
// ─────────────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import { todayISO, DEFAULT_ROLLOVER_TZ } from "./today.mjs";

test("Eastern: 02:46Z resolves to the PRIOR calendar day (sprint's last day, NOT over)", () => {
  const now = new Date("2026-07-28T02:46:00Z"); // 22:46 EDT on 2026-07-27
  assert.equal(todayISO("America/New_York", now), "2026-07-27");
});

test("Eastern: 05:00Z resolves to the NEW calendar day (sprint over)", () => {
  const now = new Date("2026-07-28T05:00:00Z"); // 01:00 EDT on 2026-07-28
  assert.equal(todayISO("America/New_York", now), "2026-07-28");
});

test("the exact Eastern-midnight boundary rolls the date over at local midnight", () => {
  // 04:00Z = 00:00 EDT on 2026-07-28 (EDT = UTC-4). Local midnight => new day.
  assert.equal(todayISO("America/New_York", new Date("2026-07-28T04:00:00Z")), "2026-07-28");
  // One minute earlier is still 2026-07-27 in Eastern.
  assert.equal(todayISO("America/New_York", new Date("2026-07-28T03:59:00Z")), "2026-07-27");
});

test("non-US tz sanity (Africa/Lagos, UTC+1): same 02:46Z instant is already the NEXT day", () => {
  const now = new Date("2026-07-28T02:46:00Z"); // 03:46 WAT on 2026-07-28
  assert.equal(todayISO("Africa/Lagos", now), "2026-07-28");
  // And it genuinely differs from the Eastern reading of the same instant.
  assert.notEqual(todayISO("Africa/Lagos", now), todayISO("America/New_York", now));
});

test("DST-transition instant is handled by the zone, not a fixed offset", () => {
  // 2026-11-01 02:00 local is the EDT->EST fall-back. At 05:30Z it is 01:30 EDT,
  // still 2026-11-01 in Eastern (offset resolution owned by Intl, not us).
  assert.equal(todayISO("America/New_York", new Date("2026-11-01T05:30:00Z")), "2026-11-01");
});

test("output is always a valid YYYY-MM-DD string", () => {
  const out = todayISO("America/New_York", new Date("2026-07-28T02:46:00Z"));
  assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
});

test("default tz is America/New_York when tz is omitted", () => {
  assert.equal(DEFAULT_ROLLOVER_TZ, "America/New_York");
  const now = new Date("2026-07-28T02:46:00Z");
  assert.equal(todayISO(undefined, now), "2026-07-27"); // same as explicit Eastern
});
