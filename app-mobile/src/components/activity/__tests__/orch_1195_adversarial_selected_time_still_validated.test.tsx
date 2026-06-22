// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1195 [schedule-button-disabled-when-place-closed-now] — ADVERSARIAL regression test.
//
// DIFFERENT ANGLE than the implementor's happy-path test (which asserts the
// Schedule button is ENABLED when closed-now). The danger this test guards
// against is the OPPOSITE failure mode: that removing the open-now button gate
// also (accidentally, now or in a future refactor) removed the REAL safety
// gate — the per-SELECTED-datetime validation that must still REJECT scheduling
// a future time when the place is actually closed at that time.
//
// The whole justification for enabling the button when closed-now is that the
// confirm-time validation in handleProposeDateTime still protects the user.
// If THAT is ever stripped, the bug fix turns into a hole (users schedule
// closed-time visits). This test fails loudly if the protection regresses.
//
// SOURCE-STRING assertions — RN cannot mount under node (established
// ORCH-1138/1148/1195 consumer pattern). Owner: mingla-tester.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

const APP = "app-mobile";
const src = read(`${APP}/src/components/activity/SavedTab.tsx`);

// Isolate the regular-card branch of handleProposeDateTime — the block that
// runs for a non-curated liked place (the cards whose button we just enabled).
// It starts at the "Regular card" comment and runs through proceedWithScheduling.
const regularBranchMatch = src.match(
  /Regular card[\s\S]*?proceedWithScheduling\(date\);/,
);
ok(
  "handleProposeDateTime has the regular-card scheduling branch",
  Boolean(regularBranchMatch),
  "could not locate the regular-card branch in handleProposeDateTime",
);
const branch = regularBranchMatch ? regularBranchMatch[0] : "";

// ── CORE ADVERSARIAL ASSERTIONS: the selected-time safety gate must survive ──

// 1. The selected `date` (NOT the current time) is what gets validated.
ok(
  "regular-card branch validates the user-SELECTED date via checkSingleCardSchedulingAvailability(cardToSchedule, date, …)",
  /checkSingleCardSchedulingAvailability\(\s*cardToSchedule,\s*date,/.test(branch),
  "the selected-datetime availability check is missing or no longer passed `date`",
);

// 2. An unsafe selected time must short-circuit BEFORE proceedWithScheduling —
//    i.e. there is an early `return` guarded by !isSafeToSchedule.
ok(
  "an unsafe selected time short-circuits with an early return (closed-future-time is still blocked)",
  /if\s*\(\s*!availability\.isSafeToSchedule\s*\)\s*\{[\s\S]*?return;[\s\S]*?\}/.test(
    branch,
  ),
  "the !isSafeToSchedule early-return guard was removed — closed-future-time would no longer be blocked",
);

// 3. The block must surface the rejection to the user ("Not Safe to Schedule"),
//    not fail silently (Constitution rule 3).
ok(
  'the rejection is surfaced to the user via a "Not Safe to Schedule" alert',
  /Alert\.alert\(\s*\n?\s*"Not Safe to Schedule"/.test(branch),
  "no Not-Safe-to-Schedule alert — an unsafe time would be rejected silently or not at all",
);

// 4. proceedWithScheduling must be reached ONLY after the guard, i.e. the guard's
//    return precedes the proceed call in source order within the branch.
const guardIdx = branch.search(/!availability\.isSafeToSchedule/);
const proceedIdx = branch.search(/proceedWithScheduling\(date\)/);
ok(
  "the safety guard precedes proceedWithScheduling (cannot proceed past an unsafe time)",
  guardIdx !== -1 && proceedIdx !== -1 && guardIdx < proceedIdx,
  `guard@${guardIdx} must come before proceed@${proceedIdx}`,
);

// ── Curated-card Schedule button gate is UNCHANGED (was never the bug) ────────
// The curated path's button must remain gated by isScheduled + schedulingCardId
// and must NOT have acquired an open-now (!isPlaceOpen) gate.
const curatedSchedMatch = src.match(
  /disabled=\{isScheduled \|\| schedulingCardId === card\.id\}/,
);
ok(
  "curated-card Schedule button stays gated by isScheduled || schedulingCardId (unchanged, no open-now gate)",
  Boolean(curatedSchedMatch),
  "curated-card button gate changed unexpectedly",
);

console.log(`\n${passed} assertions passed.`);
