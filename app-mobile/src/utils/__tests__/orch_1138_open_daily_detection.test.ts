// @ts-nocheck
// ORCH-1138 Leg 3 REWORK — P2-2 open-daily detection regression test
// (implementor-owned, happy-path). Deno-runnable (experienceOpenDaily.ts is a
// pure, dep-free util — no RN imports).
//
// THE BUG (P2-2): the prior heuristic classified an experience as "open-daily"
// (→ the date→arbitrary-time-within-window picker) whenever there was >1
// occurrence AND every window was >=90 min. A legitimately DISCRETE fixed-start
// multi-date experience (e.g. 3 evenings, each a 3-hour set-start session)
// satisfied that and was wrongly offered a fabricated 30-min time grid for a
// set-time event.
//
// THE FIX: open-daily now ALSO requires a dense, near-DAILY cadence (median gap
// <= ~1.5 days) AND a meaningful run (>=7 occurrences). A genuine recurrence-
// materialized open-daily run (one occurrence per day) passes; a handful of
// fixed-start evenings over weeks fails → the slot list is used.
//
// FAILS-ON-REVERT: delete the count + cadence gates (revert to "every window
// >=90 min" only) → the FIXED-MULTI-DATE case below flips to open-daily=true and
// this test FAILS. Verified by true line-deletion in the implementation report.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  isOpenDailyModel,
  medianConsecutiveGapMs,
} from "../experienceOpenDaily.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Build N occurrences starting `stepMs` apart, each `windowMs` wide.
const buildRun = (n: number, startMs: number, stepMs: number, windowMs: number) =>
  Array.from({ length: n }, (_, i) => {
    const s = startMs + i * stepMs;
    return {
      startAt: new Date(s).toISOString(),
      endAt: new Date(s + windowMs).toISOString(),
    };
  });

const BASE = Date.parse("2026-07-01T21:00:00Z");

// 1) GENUINE OPEN-DAILY: 51 daily occurrences, each a wide open window (the QA
//    fixture shape — one per calendar day for ~7 weeks). MUST be open-daily.
Deno.test("genuine open-daily (51 daily wide windows) → open-daily=true", () => {
  const occ = buildRun(51, BASE, DAY, 6 * HOUR);
  assertEquals(isOpenDailyModel(occ), true);
});

// 2) THE P2-2 BUG CASE: 3 FIXED-start evenings, weeks apart, each 3 hours wide.
//    Each window is >=90 min (would have false-positived the old rule), but the
//    run is sparse (3) and the cadence is multi-day → MUST NOT be open-daily.
Deno.test("fixed-start multi-date (3 evenings, 3h windows, weeks apart) → open-daily=false", () => {
  const occ = [
    { startAt: new Date(BASE).toISOString(), endAt: new Date(BASE + 3 * HOUR).toISOString() },
    { startAt: new Date(BASE + 7 * DAY).toISOString(), endAt: new Date(BASE + 7 * DAY + 3 * HOUR).toISOString() },
    { startAt: new Date(BASE + 21 * DAY).toISOString(), endAt: new Date(BASE + 21 * DAY + 3 * HOUR).toISOString() },
  ];
  assertEquals(isOpenDailyModel(occ), false);
});

// 3) Edge: a dense daily run but each window is SHORT (fixed 1-hour slots every
//    day) — NOT open-daily (no time-within-window to pick).
Deno.test("dense daily run but short 1h windows → open-daily=false", () => {
  const occ = buildRun(14, BASE, DAY, 1 * HOUR);
  assertEquals(isOpenDailyModel(occ), false);
});

// 4) Edge: enough wide-window occurrences but NOT daily (every 3 days) → the
//    cadence gate rejects it (still a scheduled-slot model, not open-daily).
Deno.test("wide windows but 3-day cadence → open-daily=false (cadence gate)", () => {
  const occ = buildRun(10, BASE, 3 * DAY, 6 * HOUR);
  assertEquals(isOpenDailyModel(occ), false);
});

// 5) Single occurrence (one-off) → never open-daily.
Deno.test("single occurrence → open-daily=false", () => {
  const occ = buildRun(1, BASE, DAY, 6 * HOUR);
  assertEquals(isOpenDailyModel(occ), false);
});

// 6) median helper sanity: daily run → ~1 day median gap.
Deno.test("medianConsecutiveGapMs of a daily run ≈ 1 day", () => {
  const occ = buildRun(10, BASE, DAY, 6 * HOUR);
  const m = medianConsecutiveGapMs(occ);
  assert(m !== null);
  assertEquals(m, DAY);
});
