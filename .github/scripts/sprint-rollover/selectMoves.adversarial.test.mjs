// ─────────────────────────────────────────────────────────────────────────────
// #1293 [sprint-rollover] — TESTER adversarial suite (independent gatekeeper).
//
// Run: node --test .github/scripts/sprint-rollover/selectMoves.adversarial.test.mjs
//
// This is NOT the implementor's happy-path test. Every test below attacks a
// DIFFERENT angle: boundary conditions on both date edges, exclusion invariants,
// idempotency of a second pass, malformed/missing input, no-current-iteration,
// and multiple ended sprints funnelling to one current sprint. Each test states
// an explicit expected-vs-actual assertion. The pure function must never throw.
// ─────────────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import { selectMoves } from "./selectMoves.mjs";

// A distinct timeline from the implementor's fixture (which uses TODAY=2026-07-10
// with S1/S2/S3). Here we lean on the boundaries.
//   S1: 2026-07-01 .. 2026-07-08 (exclusive)  -> ended
//   S2: 2026-07-08 .. 2026-07-15 (exclusive)  -> current when today is inside
//   S3: 2026-07-15 .. 2026-07-22 (exclusive)  -> future
const ITER = [
  { id: "S1", title: "Sprint 1", startDate: "2026-07-01", duration: 7 },
  { id: "S2", title: "Sprint 2", startDate: "2026-07-08", duration: 7 },
  { id: "S3", title: "Sprint 3", startDate: "2026-07-15", duration: 7 },
];

// Minimal item builder — every field explicit so each test controls its own attack.
function item(overrides) {
  return {
    itemId: "PVTI_x",
    contentType: "Issue",
    issueNumber: 900,
    statusName: "In Progress",
    sprintIterationId: "S1",
    sprintEndISO: "2026-07-08",
    rollovers: 0,
    ...overrides,
  };
}

// ── 1. Future sprint never moves ─────────────────────────────────────────────
// A non-Done item on a sprint that has NOT ended (end > today) is excluded even
// though it is not the current sprint. And the exclusion is SPECIFIC: an ended
// item alongside it still moves (so it is not a blanket empty).
test("future sprint (end > today, not current) is never selected", () => {
  const today = "2026-07-10"; // inside current S2
  const future = item({
    itemId: "PVTI_future",
    sprintIterationId: "S3",
    sprintEndISO: "2026-07-22", // > today
  });

  // Alone -> nothing to move.
  assert.deepEqual(selectMoves({ items: [future], iterations: ITER, todayISO: today }), []);

  // Beside an ended item -> only the ended one moves; future stays put.
  const ended = item({ itemId: "PVTI_ended", sprintIterationId: "S1", sprintEndISO: "2026-07-08" });
  const moves = selectMoves({ items: [future, ended], iterations: ITER, todayISO: today });
  assert.deepEqual(moves.map((m) => m.itemId), ["PVTI_ended"]);
});

// ── 2. No-sprint item never moves (regardless of status/date) ────────────────
// sprintIterationId === null is skipped even when the (irrelevant) sprintEndISO
// is in the past and even when Done — the un-sprinted guard is unconditional.
test("item with sprintIterationId=null is never selected, whatever its status/date", () => {
  const today = "2026-07-10";
  const items = [
    item({ itemId: "PVTI_ns1", sprintIterationId: null, sprintEndISO: "2026-07-01", statusName: "In Progress" }),
    item({ itemId: "PVTI_ns2", sprintIterationId: null, sprintEndISO: "2026-07-01", statusName: "Done" }),
    item({ itemId: "PVTI_ns3", sprintIterationId: null, sprintEndISO: null, statusName: "In Review" }),
  ];
  assert.deepEqual(selectMoves({ items, iterations: ITER, todayISO: today }), []);
});

// ── 3. Boundary: today === startDate of the current sprint ───────────────────
// The lower bound of the current iteration is INCLUSIVE, so the sprint whose
// startDate equals today is current. Items on the just-ended prior sprint move;
// items already on this current sprint do not.
test("today === current sprint startDate: prior-sprint items move, current-sprint items do not", () => {
  const today = "2026-07-08"; // == S2.startDate (S2 is current)
  const onPrior = item({
    itemId: "PVTI_prior",
    sprintIterationId: "S1",
    sprintEndISO: "2026-07-08", // prior sprint ended exactly at today's start
  });
  const onCurrent = item({
    itemId: "PVTI_current",
    sprintIterationId: "S2",
    sprintEndISO: "2026-07-15",
  });
  const moves = selectMoves({ items: [onPrior, onCurrent], iterations: ITER, todayISO: today });
  assert.deepEqual(moves.map((m) => m.itemId), ["PVTI_prior"]);
  assert.equal(moves[0].toIterationId, "S2");
  assert.equal(moves[0].fromIterationId, "S1");
});

// ── 4. Boundary: today === the item's exclusive endDate ──────────────────────
// sprintEndISO === today counts as ENDED and MOVES (exclusive-end). A sibling one
// day later (end === today+1 > today) does NOT move. This pins the off-by-one to
// the correct side: the last day is excluded from the sprint, so ending "today"
// means already over.
test("exclusive end: sprintEndISO === today moves; today+1 does not (off-by-one on the correct side)", () => {
  const today = "2026-07-10"; // inside current S2, and NOT a sprint boundary
  const endedToday = item({
    itemId: "PVTI_end_eq_today",
    sprintIterationId: "SA",
    sprintEndISO: "2026-07-10", // == today  -> ended (exclusive)
  });
  const endsTomorrow = item({
    itemId: "PVTI_end_tomorrow",
    sprintIterationId: "SB",
    sprintEndISO: "2026-07-11", // == today+1  -> still running, must NOT move
  });
  const moves = selectMoves({ items: [endedToday, endsTomorrow], iterations: ITER, todayISO: today });
  assert.deepEqual(moves.map((m) => m.itemId), ["PVTI_end_eq_today"]);
  assert.equal(moves[0].newRollovers, 1);
});

// ── 5. Done never moves (adversarial construction) ───────────────────────────
// Different from the implementor's fixture: a Done item on an ENDED sprint with a
// HIGH prior rollover count and even a boundary (== today) end date — still
// excluded. The Done guard short-circuits before any date math.
test("Done items never move — ended sprint, high rollovers, boundary end date, all excluded", () => {
  const today = "2026-07-10";
  const items = [
    item({ itemId: "PVTI_done1", statusName: "Done", sprintIterationId: "S1", sprintEndISO: "2026-07-08", rollovers: 9 }),
    item({ itemId: "PVTI_done2", statusName: "Done", sprintIterationId: "SA", sprintEndISO: "2026-07-10", rollovers: 5 }), // boundary end
  ];
  assert.deepEqual(selectMoves({ items, iterations: ITER, todayISO: today }), []);
});

// ── 6. Idempotency across a second pass ──────────────────────────────────────
// Pass 1 moves an item off ended S1 onto current S2. Feeding the resulting
// "post-move" state (sprintIterationId = current, rollovers = newRollovers) back
// in produces NO further move — the run is stable, no double-increment.
test("idempotent: an item already rolled onto the current sprint is not re-selected", () => {
  const today = "2026-07-10";
  const before = item({ itemId: "PVTI_idem", sprintIterationId: "S1", sprintEndISO: "2026-07-08", rollovers: 1 });

  const pass1 = selectMoves({ items: [before], iterations: ITER, todayISO: today });
  assert.equal(pass1.length, 1);
  assert.equal(pass1[0].toIterationId, "S2");
  assert.equal(pass1[0].newRollovers, 2);

  // Apply the move to the item's state, then re-run.
  const afterMove = item({
    itemId: "PVTI_idem",
    sprintIterationId: pass1[0].toIterationId, // now on current S2
    sprintEndISO: "2026-07-15", // current sprint's own (not-yet-ended) end
    rollovers: pass1[0].newRollovers, // 2
  });
  const pass2 = selectMoves({ items: [afterMove], iterations: ITER, todayISO: today });
  assert.deepEqual(pass2, []);
});

// ── 7. No current iteration => [] (never throws, never guesses) ──────────────
// (a) today outside every iteration; (b) empty iterations array. Both yield [].
test("no current iteration returns [] and never throws (today out of range, and empty iterations)", () => {
  const mixed = [
    item({ itemId: "PVTI_a", sprintIterationId: "S1", sprintEndISO: "2026-07-08" }),
    item({ itemId: "PVTI_b", sprintIterationId: "S2", sprintEndISO: "2026-07-15" }),
  ];
  // (a) today far outside every iteration window.
  assert.doesNotThrow(() => selectMoves({ items: mixed, iterations: ITER, todayISO: "2027-01-01" }));
  assert.deepEqual(selectMoves({ items: mixed, iterations: ITER, todayISO: "2027-01-01" }), []);
  // (b) no iterations at all.
  assert.deepEqual(selectMoves({ items: mixed, iterations: [], todayISO: "2026-07-10" }), []);
});

// ── 8. Unparseable / missing dates are skipped, never throw ──────────────────
// A valid current iteration exists (so items are actually processed). Items whose
// sprintEndISO is null, a garbage string, or too-short must be skipped by the NaN
// guard — no crash, no selection.
test("items with null / malformed / too-short sprintEndISO are skipped without throwing", () => {
  const today = "2026-07-10"; // current S2 exists
  const items = [
    item({ itemId: "PVTI_null", sprintIterationId: "S1", sprintEndISO: null }),
    item({ itemId: "PVTI_garbage", sprintIterationId: "S1", sprintEndISO: "not-a-real-date" }),
    item({ itemId: "PVTI_short", sprintIterationId: "S1", sprintEndISO: "2026" }), // length < 10
  ];
  let moves;
  assert.doesNotThrow(() => {
    moves = selectMoves({ items, iterations: ITER, todayISO: today });
  });
  assert.deepEqual(moves, []);
});

// ── 9. Multiple ended sprints funnel to the single current sprint ────────────
// Items sitting on TWO different past sprints both roll onto the one current
// sprint, each carrying its OWN fromIterationId and incrementing from its OWN
// prior rollover value.
test("items on two different ended sprints all move to the current sprint, incrementing each own prior", () => {
  const iters = [
    { id: "S0", title: "Sprint 0", startDate: "2026-06-24", duration: 7 }, // 06-24 .. 07-01 ended
    { id: "S1", title: "Sprint 1", startDate: "2026-07-01", duration: 7 }, // 07-01 .. 07-08 ended
    { id: "S2", title: "Sprint 2", startDate: "2026-07-08", duration: 7 }, // 07-08 .. 07-15 current
    { id: "S3", title: "Sprint 3", startDate: "2026-07-15", duration: 7 }, // future
  ];
  const today = "2026-07-10"; // inside S2
  const items = [
    item({ itemId: "PVTI_onS0", sprintIterationId: "S0", sprintEndISO: "2026-07-01", rollovers: 0 }),
    item({ itemId: "PVTI_onS1", sprintIterationId: "S1", sprintEndISO: "2026-07-08", rollovers: 4 }),
  ];
  const moves = selectMoves({ items, iterations: iters, todayISO: today });

  const byId = Object.fromEntries(moves.map((m) => [m.itemId, m]));
  assert.deepEqual(Object.keys(byId).sort(), ["PVTI_onS0", "PVTI_onS1"]);

  // Both target the single current sprint S2.
  assert.equal(byId["PVTI_onS0"].toIterationId, "S2");
  assert.equal(byId["PVTI_onS1"].toIterationId, "S2");

  // Each remembers its own origin.
  assert.equal(byId["PVTI_onS0"].fromIterationId, "S0");
  assert.equal(byId["PVTI_onS1"].fromIterationId, "S1");

  // Each increments from its OWN prior rollover value (0->1 and 4->5).
  assert.equal(byId["PVTI_onS0"].newRollovers, 1);
  assert.equal(byId["PVTI_onS1"].newRollovers, 5);
});
