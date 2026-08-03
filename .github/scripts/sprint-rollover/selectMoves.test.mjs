// ─────────────────────────────────────────────────────────────────────────────
// #1293 [sprint-rollover] — IMPLEMENTOR happy-path + fails-on-revert unit tests.
//
// Run: node --test .github/scripts/sprint-rollover/selectMoves.test.mjs
//
// These are the implementor's tests: the happy path and the revert-proof guard.
// The tester writes a SEPARATE adversarial file (future sprint, no-sprint,
// boundary today===startDate, idempotency, no-current-iteration) per the SPEC.
// ─────────────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import { selectMoves } from "./selectMoves.mjs";

// Fixed timeline used by the happy path.
//   Sprint 1 (S1): 2026-07-01 .. 2026-07-08 (exclusive)  -> ENDED before today
//   Sprint 2 (S2): 2026-07-08 .. 2026-07-15 (exclusive)  -> CURRENT (contains today)
//   Sprint 3 (S3): 2026-07-15 .. 2026-07-22 (exclusive)  -> FUTURE
const ITERATIONS = [
  { id: "S1", title: "Sprint 1", startDate: "2026-07-01", duration: 7 },
  { id: "S2", title: "Sprint 2", startDate: "2026-07-08", duration: 7 },
  { id: "S3", title: "Sprint 3", startDate: "2026-07-15", duration: 7 },
];
const TODAY = "2026-07-10"; // inside S2
const S1_END = "2026-07-08"; // <= today  -> ended
const S3_END = "2026-07-22"; // >  today  -> future

// A deliberately mixed item set. Only the two non-Done items on the ENDED S1 move.
function mixedItems() {
  return [
    // 1) non-Done on ended S1  -> MOVE, rollovers 0 -> 1
    {
      itemId: "PVTI_a",
      contentType: "Issue",
      issueNumber: 101,
      statusName: "In Progress",
      sprintIterationId: "S1",
      sprintEndISO: S1_END,
      rollovers: 0,
    },
    // 2) Done on ended S1  -> NEVER move (revert-proof guard hangs on this)
    {
      itemId: "PVTI_b",
      contentType: "Issue",
      issueNumber: 102,
      statusName: "Done",
      sprintIterationId: "S1",
      sprintEndISO: S1_END,
      rollovers: 2,
    },
    // 3) non-Done on ended S1, prior rollovers 1  -> MOVE, 1 -> 2
    {
      itemId: "PVTI_c",
      contentType: "DraftIssue",
      issueNumber: null,
      statusName: "In Review",
      sprintIterationId: "S1",
      sprintEndISO: S1_END,
      rollovers: 1,
    },
    // 4) non-Done with NO sprint  -> never move
    {
      itemId: "PVTI_d",
      contentType: "Issue",
      issueNumber: 104,
      statusName: "In Progress",
      sprintIterationId: null,
      sprintEndISO: null,
      rollovers: 0,
    },
    // 5) non-Done already on the CURRENT sprint S2  -> never move
    {
      itemId: "PVTI_e",
      contentType: "Issue",
      issueNumber: 105,
      statusName: "In Progress",
      sprintIterationId: "S2",
      sprintEndISO: "2026-07-15",
      rollovers: 0,
    },
    // 6) non-Done on a FUTURE sprint S3  -> never move
    {
      itemId: "PVTI_f",
      contentType: "Issue",
      issueNumber: 106,
      statusName: "In Progress",
      sprintIterationId: "S3",
      sprintEndISO: S3_END,
      rollovers: 0,
    },
  ];
}

test("happy path: exactly the non-Done items on the ended sprint move to the current sprint", () => {
  const moves = selectMoves({ items: mixedItems(), iterations: ITERATIONS, todayISO: TODAY });

  // Exactly items a and c are selected — nothing else.
  const movedIds = moves.map((m) => m.itemId).sort();
  assert.deepEqual(movedIds, ["PVTI_a", "PVTI_c"]);

  // Every selected move targets the CURRENT sprint (S2)...
  for (const m of moves) {
    assert.equal(m.toIterationId, "S2", `${m.itemId} must target current sprint S2`);
    assert.equal(m.fromIterationId, "S1", `${m.itemId} must come from ended sprint S1`);
  }

  // ...and stamps newRollovers = prev + 1.
  const byId = Object.fromEntries(moves.map((m) => [m.itemId, m]));
  assert.equal(byId["PVTI_a"].newRollovers, 1); // 0 -> 1
  assert.equal(byId["PVTI_c"].newRollovers, 2); // 1 -> 2

  // Pass-through fields survive.
  assert.equal(byId["PVTI_a"].contentType, "Issue");
  assert.equal(byId["PVTI_a"].issueNumber, 101);
  assert.equal(byId["PVTI_c"].contentType, "DraftIssue");
  assert.equal(byId["PVTI_c"].issueNumber, null);
});

// FAILS-ON-REVERT: this asserts the Done item (PVTI_b) is NEVER selected. If the
// `statusName !== 'Done'` guard in selectMoves.mjs is broken/removed, PVTI_b becomes
// selectable and BOTH this test and the happy-path set-equality above go RED. That is
// the proof the guard is load-bearing.
test("revert-proof: Done items are never selected", () => {
  const moves = selectMoves({ items: mixedItems(), iterations: ITERATIONS, todayISO: TODAY });
  const doneSelected = moves.some((m) => m.itemId === "PVTI_b");
  assert.equal(doneSelected, false, "a Done item must never be rolled over");
});

// Core contract guard: no current iteration => empty result, no throw. (The tester's
// adversarial suite covers this angle more broadly; kept here as a sanity floor.)
test("no current iteration => empty result, never throws", () => {
  const future = "2027-01-01"; // inside none of the iterations
  const moves = selectMoves({ items: mixedItems(), iterations: ITERATIONS, todayISO: future });
  assert.deepEqual(moves, []);
});
