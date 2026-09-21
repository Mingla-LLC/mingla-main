/**
 * issue #3449 — TESTER-OWNED adversarial regression suite for the Class A shard
 * split. Written independently of issue-3449-class-a-shard-plan.implementor.test.mjs
 * and attacking the contract rather than confirming it.
 *
 * WHAT WENT WRONG. Class A ran all 1,033 strict-grep executions in one job: mean
 * 519 s over 14 runs against #3336's 540 s readiness ceiling, worst 539 s — ONE
 * SECOND of margin — growing +3.6 to +8.8 s/day, because the corpus grows by
 * policy (#2865) and the append-only ratchet forbids removing anything. Within
 * days ordinary pull requests would have gone red, each red costing a 13-minute
 * rerun before anything could merge.
 *
 * WHY A SPLIT IS THE FIX. Three shards run the same executions in parallel at
 * about 185 s each, so each has roughly 355 s of room instead of 1 s. That buys
 * four to ten months at the observed growth rate, and `classAShardCount` is a
 * one-line change when more room is needed again.
 *
 * WHY MEMBERSHIP IS COST-BASED AND NOT COUNT-BASED. The class is wildly skewed:
 * one execution (issue-2438-postgres-wave-shadow-parity.implementor.test.mjs
 * [plain]) has a measured median of 89.1 s — 18% of the whole class on its own —
 * while about 800 executions together are 6%. A count-based split would leave one
 * shard roughly twice as slow as another and spend the margin this change exists
 * to create. Membership is a longest-processing-time bin-pack over a committed
 * cost table instead.
 *
 * WHY EXPLICIT SIBLING JOBS AND NOT `strategy: matrix`. `fail-fast: true` is the
 * documented matrix default and cancels sibling shards. A cancelled shard reaches
 * issue-2594-class-a-budget.mjs's adjudicate() with a simultaneously-cancelled
 * peer and classifies as D5 NEUTRAL exit 0 — "the pool was busy" — the exact
 * "a kill reads as noise" failure #2594 and #3336 closed. TESTER-1 below
 * REPRODUCES that misclassification through the real, byte-identical adjudicate(),
 * so the rejection is falsifiable evidence rather than folklore.
 *
 * WHY PER-SHARD `executed === expected` IS NOT COMPLETENESS. Each shard asserts
 * R4 over its OWN set (contract R11). Three shards each honestly reporting "I ran
 * all of mine" is perfectly compatible with executions belonging to NO shard at
 * all, because each shard's notion of "expected" comes from the same
 * possibly-wrong plan. The out-of-band aggregate (R12) is the only authority that
 * can see that, and most of this file is an attack on it — at the REAL 1,033-row
 * scale, not on a seven-gate fixture.
 *
 * HOW THIS FILE DIFFERS FROM THE IMPLEMENTOR'S. The implementor's SC-1…SC-10 and
 * SC-15 prove the plan is total, deterministic, reproduces its measured numbers,
 * survives a synthetic insertion, and that the live wiring is clean. This file
 * never re-asserts any of that. It asserts what happens when each input is
 * HOSTILE: a truncated or emptied or stale cost table, a shard index of "03" or
 * "1e0" or " 2 ", a shard file that never arrives, a row that moved shards while
 * the count stayed exactly right, a row present twice under two different
 * statuses, an aggregate assembled from another commit's files, two jobs uploading
 * one artifact name, a registry whose shard count disagrees with the workflow, and
 * a matrix smuggled back in through `${{ matrix.shard }}` rather than through a
 * `strategy:` key.
 *
 * DELIBERATELY NOT ASSERTED HERE, each for a stated reason:
 *   * that any execution KEEPS its shard across a registry change. Adding one
 *     untabled row legitimately moves hundreds of rows, because the bin-pack's
 *     greedy placement depends on the whole sorted sequence. Asserting stability
 *     would freeze an accident and make an honest gate addition red. The
 *     completeness proof is what makes the churn safe. (The implementor's SC-15
 *     states the same prohibition from the other side.)
 *   * the literal planned loads and counts (168.8/168.8/168.8 s over 340/351/342).
 *     The implementor's SC-2 pins those against the committed inputs; repeating
 *     them here would only add a second file that goes red when the corpus grows
 *     rather than when a defect appears. This file asserts BALANCE and TOTALITY as
 *     properties instead.
 *   * the cost-refresh tool's median-over-three-samples logic (implementor SC-10).
 *   * any real cancelled CI run. Every cancellation shape below is a fixture
 *     through the real adjudicate(); the spec forbids scheduling one, and a
 *     scheduled cancellation is not reproducible evidence anyway.
 *   * a pinned sha256 of the two frozen files. A digest in an append-only file
 *     cannot be updated by a legitimate future change without a token, so the
 *     byte-identity of issue-2594-class-a-budget.mjs and
 *     issue-3336-class-a-margin.tester.test.mjs is verified out-of-band at TEST
 *     time. What IS pinned here (TESTER-13) are the three constants of that module
 *     the shard design depends on, which is the part a future edit could move
 *     without anybody noticing.
 *
 * FAILS-ON-REVERT. TESTER-1 (the matrix misclassification) and TESTER-10 (no
 * `strategy:` on any Class A job) must KEEP PASSING when #3449 is reverted: the
 * first asserts a property of the UNCHANGED adjudicator and is falsifiability
 * evidence for the matrix rejection, the second is forward defence against a
 * future matrix. Both are labelled so nobody later "fixes" them into
 * fails-on-revert cases they are not. Every other case here reds on revert,
 * because the module, the planner or the wiring it attacks does not exist.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  SHARD_COUNT_FIELD,
  SHARD_ENV_VAR,
  classAShardOf,
  classAShardPlan,
  executionKey,
  expectedExecutions,
  loadManifest,
  loadShardCosts,
  resolveShardSelection,
} from "./run-batch.mjs";
import {
  EXIT_INCONCLUSIVE,
  EXIT_OK,
  EXIT_ROW_FAILED,
  aggregate,
} from "./issue-3449-class-a-shard-completeness.mjs";
import {
  HOST_NAME,
  MINIMUM_COSTED_EXECUTIONS,
  auditHostDocuments,
  auditPlanInputs,
  parseWorkflows,
  readWorkflowSources,
} from "./issue-3449-class-a-shard-plan.mjs";
import {
  CLASS_A_TIMEOUT_CAP_SECONDS,
  READINESS_HEADROOM_RATIO,
  SELF_JOB_NAME,
  SIMULTANEOUS_WINDOW_SECONDS,
  adjudicate,
  adjudicateWithReadiness,
} from "./issue-2594-class-a-budget.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGGREGATE_MODULE = path.join(HERE, "issue-3449-class-a-shard-completeness.mjs");

const MANIFEST = loadManifest(path.join(HERE, "MANIFEST.json"));
const COSTS = loadShardCosts(path.join(HERE, "class-a-shard-costs.json"));
const SHARD_COUNT = MANIFEST[SHARD_COUNT_FIELD];
const CLASS_A = expectedExecutions(MANIFEST, "A");
const PLAN = classAShardPlan({ manifest: MANIFEST, costs: COSTS, shardCount: SHARD_COUNT });

/**
 * The live host workflow, Ruby-parsed exactly ONCE for the whole file. Every
 * workflow mutant below deep-clones this rather than shelling out again: one
 * shell-out per mutant measured 15 s across the mutant set, which is real Class E
 * budget spent to assert nothing extra.
 */
const HOST_DOCUMENTS = parseWorkflows(readWorkflowSources(path.resolve(HERE, "../../..")));
const HOST_FILE = Object.keys(HOST_DOCUMENTS).find((file) => HOST_DOCUMENTS[file]?.name === HOST_NAME);
const cloneHost = () => structuredClone({ [HOST_FILE]: HOST_DOCUMENTS[HOST_FILE] });

const tempDir = (label) => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `issue-3449-tester-${label}-`));
const cleanup = [];
test.after(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

/** The rows a healthy shard would write, at the REAL class scale. */
function healthyShardRows() {
  return PLAN.shards.map((shard, index) => shard.map((item) => ({
    script: item.gate.script,
    jobKeys: item.gate.jobKeys,
    mode: item.mode,
    exit: 0,
    durationMs: 10,
    status: "PASS",
    shard: index + 1,
  })));
}

/** One directory per artifact, the way an UN-merged download-artifact lands them. */
function layout(label, shardRows, extraFiles = {}) {
  const root = tempDir(label);
  cleanup.push(root);
  shardRows.forEach((rows, index) => {
    if (rows === null) return; // the cancelled-shard shape: no artifact at all
    const dir = path.join(root, index === 0 ? "gate-results-A" : `gate-results-A-shard-${index + 1}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "gate-results-A.json"), `${JSON.stringify(rows)}\n`);
  });
  for (const [rel, body] of Object.entries(extraFiles)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

const runAggregate = (shardRows, label, extraFiles = {}, overrides = {}) => aggregate({
  inputDir: layout(label, shardRows, extraFiles),
  manifest: MANIFEST,
  costs: COSTS,
  shardCount: SHARD_COUNT,
  ...overrides,
});

const named = (result, needle) => result.errors.some((error) => error.includes(needle));
const expectNamed = (result, code, needle, why) => {
  assert.equal(result.exitCode, code, `${why}: expected exit ${code}, got ${result.exitCode} — ${result.errors.join(" | ")}`);
  assert.ok(named(result, needle), `${why}: no error named "${needle}"; got ${JSON.stringify(result.errors.slice(0, 6))}`);
  assert.equal(result.rows, null, `${why}: a failed aggregate must publish NO rows`);
};

// ── TESTER-1 ── the matrix hazard, REPRODUCED. MUST KEEP PASSING ON REVERT ──
//
// This is the falsifiable evidence behind rejecting `strategy: matrix`, and it is
// a property of the UNCHANGED adjudicator, not of this change. It passes before
// #3449, after #3449, and after a revert of #3449. Do not convert it into a
// fails-on-revert case: if it ever STOPS passing, the argument for explicit
// sibling jobs has changed and the design should be revisited, not the test.
test("TESTER-1 a fail-fast matrix classifies its cancelled shard siblings as D5 NEUTRAL exit 0 (the hazard #3449 designs around; PASSES ON REVERT BY DESIGN)", () => {
  const at = (seconds) => new Date(Date.parse("2026-09-20T10:00:00Z") + seconds * 1000).toISOString();
  const job = (name, conclusion, endSeconds) => ({
    name, status: "completed", conclusion, started_at: at(0), completed_at: at(endSeconds),
  });
  // What GitHub actually produces for `strategy: {matrix: {shard: [1,2,3]}}`:
  // one display name per matrix value, and fail-fast cancels the survivors at the
  // same instant as the failure.
  const matrixName = (index) => `Strict grep — static gates (class A) (${index})`;
  const jobs = [
    job(matrixName(1), "failure", 305),
    job(matrixName(2), "cancelled", 306),
    job(matrixName(3), "cancelled", 307),
    job(SELF_JOB_NAME, "success", 320),
  ];

  for (const index of [2, 3]) {
    const verdict = adjudicate({
      jobs,
      run: { status: "in_progress" },
      jobName: matrixName(index),
      budgetSeconds: 600,
      timeoutKillSeconds: 890,
    });
    assert.equal(verdict.row, "D5", `cancelled matrix sibling ${index} must reproduce the D5 misclassification`);
    assert.equal(verdict.verdict, "NEUTRAL");
    assert.equal(verdict.exit, 0,
      "a matrix shard that ran NOTHING would exit 0 — this is why #3449 uses explicit sibling jobs");
  }

  // The same two conclusions under the CHOSEN shape, where the only cancelled job
  // is the shard itself, are NOT neutral. That contrast is the whole argument.
  const loneKill = adjudicate({
    jobs: [job("Strict grep — static gates (class A shard 2)", "cancelled", 902)],
    run: { status: "in_progress" },
    jobName: "Strict grep — static gates (class A shard 2)",
    budgetSeconds: 600,
    timeoutKillSeconds: 890,
  });
  assert.equal(loneKill.row, "D6");
  assert.equal(loneKill.exit, 1, "the identical cancellation, without a cancelled peer, is a FAILING cap kill");
});

// ── TESTER-2 ── the completeness authority, at the REAL 1,033-row scale ─────
test("TESTER-2 a dropped, duplicated, reassigned or absent shard is caught at the real class scale, each naming its offender", () => {
  const scale = CLASS_A.length;
  assert.ok(scale > 1000, `this suite is only meaningful at class scale; saw ${scale} executions`);

  // The control. If this is not exit 0, nothing below means anything.
  const healthy = runAggregate(healthyShardRows(), "healthy");
  assert.equal(healthy.exitCode, EXIT_OK, `a complete set must pass; got ${healthy.errors.join(" | ")}`);
  assert.equal(healthy.rows.length, scale);

  // (d) DROPPED — the under-executing shard. One row gone out of 1,033.
  {
    const rows = healthyShardRows();
    const victim = rows[1].splice(Math.floor(rows[1].length / 2), 1)[0];
    const result = runAggregate(rows, "dropped");
    expectNamed(result, EXIT_INCONCLUSIVE, `DROPPED: ${victim.script} [${victim.mode}]`, "a single dropped row out of the whole class");
    assert.ok(named(result, `executed ${scale - 1} / expected ${scale}`), "the headline count must be printed as an error too");
  }

  // (d) DUPLICATED — one execution run by two shards.
  {
    const rows = healthyShardRows();
    const twin = { ...rows[2][0], shard: 2 };
    rows[1].push(twin);
    expectNamed(runAggregate(rows, "duplicated"), EXIT_INCONCLUSIVE,
      `DUPLICATED: ${twin.script} [${twin.mode}]`, "one execution run twice");
  }

  // (f) SILENT REASSIGNMENT — the case a count-and-identity comparison CANNOT
  // see: every execution present exactly once, the total exactly right, and one
  // row executed by a shard the plan did not assign it to.
  {
    const rows = healthyShardRows();
    const moved = rows[0].shift();
    rows[1].push({ ...moved, shard: 2 });
    assert.equal(rows.flat().length, scale, "the reassignment fixture must keep the count EXACTLY right");
    const identities = new Set(rows.flat().map(executionKey));
    assert.equal(identities.size, scale, "and every identity must still be present exactly once");
    const result = runAggregate(rows, "reassigned");
    expectNamed(result, EXIT_INCONCLUSIVE, `REASSIGNED: ${moved.script} [${moved.mode}]`,
      "a row that moved shards while the count stayed exact");
    assert.ok(named(result, `assigns it to shard ${classAShardOf({ script: moved.script, mode: moved.mode }, PLAN)}`),
      "the error must name the shard the plan DOES assign it to, not only the one that ran it");
    assert.ok(!named(result, "DROPPED:") && !named(result, "DUPLICATED:"),
      "and it must be caught by the attribution clause alone — the count clauses see nothing here");
  }

  // (a) A shard's result file NEVER ARRIVES. Cancelled, skipped, or never started
  // all look the same from here, and all three must be red.
  {
    const rows = healthyShardRows();
    rows[SHARD_COUNT - 1] = null;
    const result = runAggregate(rows, "absent");
    expectNamed(result, EXIT_INCONCLUSIVE, `shard(s) ${SHARD_COUNT} reported NOTHING`, "a shard that uploaded nothing");
    assert.ok(named(result, `expected exactly ${SHARD_COUNT} shard result file(s), found ${SHARD_COUNT - 1}`),
      "the file count itself must be named, because it is what a cancelled job changes");
  }
});

test("TESTER-3 a row present TWICE under two different statuses, and a count-preserving swap, are both caught", () => {
  const scale = CLASS_A.length;

  // One execution reported by two shards with DISAGREEING verdicts. A reader that
  // only counted rows would see 1,034 and stop at "too many"; the identity clause
  // has to name the execution, and the structural doubt must dominate the row
  // failure — exit 2, not exit 1, because the two demand different responses.
  {
    const rows = healthyShardRows();
    const original = rows[2][3];
    rows[1].push({ ...original, shard: 2, status: "FAIL", exit: 1 });
    const result = runAggregate(rows, "two-statuses");
    expectNamed(result, EXIT_INCONCLUSIVE, `DUPLICATED: ${original.script} [${original.mode}]`,
      "one execution reported twice with conflicting statuses");
    assert.ok(named(result, `FAIL: ${original.script} [${original.mode}]`),
      "the failing copy must ALSO be named — a reader must not have to guess which copy failed");
  }

  // The count-preserving swap: one execution duplicated and a DIFFERENT one
  // dropped, so `rows.length` is exactly right and only identity comparison sees
  // it. This is the shape that makes "compare counts" an unsafe proof.
  {
    const rows = healthyShardRows();
    const dropped = rows[1].splice(7, 1)[0];
    const duplicated = { ...rows[2][11], shard: 2 };
    rows[1].push(duplicated);
    assert.equal(rows.flat().length, scale, "the swap fixture must keep the total exactly right");
    const result = runAggregate(rows, "swap");
    assert.equal(result.exitCode, EXIT_INCONCLUSIVE);
    assert.ok(named(result, `DROPPED: ${dropped.script} [${dropped.mode}]`), "the dropped half of the swap must be named");
    assert.ok(named(result, `DUPLICATED: ${duplicated.script} [${duplicated.mode}]`), "the duplicated half too");
    assert.ok(!named(result, "do not add up to the class"),
      "and the total-count clause must stay SILENT, proving identity comparison is what caught it");
  }
});

test("TESTER-4 a genuinely failing row is a DIFFERENT exit code from every 'I could not look' shape", () => {
  // R-5.5: "'I could not look' and 'I looked and it is wrong' must never be the
  // same silence." They must also never be the same NOISE — a human responds to a
  // failing gate by reading the gate, and to a lost shard by rerunning CI.
  const failing = healthyShardRows();
  const victim = failing[0][2];
  failing[0][2] = { ...victim, status: "FAIL", exit: 1 };
  const failed = runAggregate(failing, "row-failed");
  expectNamed(failed, EXIT_ROW_FAILED, `FAIL: ${victim.script} [${victim.mode}] -> exit 1`, "one genuinely failing gate");

  // A MISSING gate file is R3's class, not a gate verdict, so it is 2 and not 1
  // even though it also arrives as one bad row.
  const missing = healthyShardRows();
  const ghost = missing[0][3];
  missing[0][3] = { ...ghost, status: "MISSING", exit: 2 };
  expectNamed(runAggregate(missing, "row-missing"), EXIT_INCONCLUSIVE,
    `MISSING: ${ghost.script} [${ghost.mode}]`, "a gate file the registry names but disk does not have");

  // A shard that lost its `env:` ran the WHOLE class honestly, so its rows are
  // truthful but unattributable. That must not read as a pass either.
  const unsharded = healthyShardRows();
  unsharded[1] = unsharded[1].map((row) => ({ ...row, shard: null }));
  expectNamed(runAggregate(unsharded, "null-shard"), EXIT_INCONCLUSIVE,
    "carry no shard index", "an unsharded run's output inside a sharded aggregate");

  assert.notEqual(EXIT_ROW_FAILED, EXIT_INCONCLUSIVE, "the two verdicts must be distinguishable by exit code alone");
});

test("TESTER-5 the aggregate refuses an input assembled from ANOTHER commit's shard files", () => {
  // Nothing in a result row records the commit it was produced at. The aggregate's
  // defence is that it recomputes the plan from ITS OWN checkout, so any registry
  // difference between the run that produced the rows and the run that reads them
  // shows up as a dropped or unknown execution. Both directions are proved.
  const rows = healthyShardRows();

  // The registry GREW after the shards ran: the new execution is named as dropped.
  const grown = structuredClone(MANIFEST);
  grown.gates.push({
    script: ".github/scripts/strict-grep/issue-3449-tester-fixture-newer-commit.mjs",
    kind: "file",
    enforcement: "batch:A",
    invocation: "node",
    modes: ["plain"],
    selfTest: "none",
    jobKeys: [],
  });
  const grownResult = aggregate({
    inputDir: layout("stale-older", rows),
    manifest: grown,
    costs: COSTS,
    shardCount: SHARD_COUNT,
  });
  expectNamed(grownResult, EXIT_INCONCLUSIVE, "issue-3449-tester-fixture-newer-commit.mjs",
    "shard files produced before a gate was added");

  // The registry SHRANK after the shards ran: the removed execution is named as
  // unknown rather than quietly tolerated, because tolerating it would let a
  // renamed gate's old row stand in for its new one.
  const shrunk = structuredClone(MANIFEST);
  const removed = shrunk.gates.filter((gate) => gate.enforcement === "batch:A").at(-1);
  shrunk.gates = shrunk.gates.filter((gate) => gate.script !== removed.script);
  const shrunkResult = aggregate({
    inputDir: layout("stale-newer", rows),
    manifest: shrunk,
    costs: COSTS,
    shardCount: SHARD_COUNT,
  });
  expectNamed(shrunkResult, EXIT_INCONCLUSIVE, `UNKNOWN: ${removed.script}`,
    "shard files produced before a gate was removed");

  // THE RESIDUAL, ASSERTED AS A RESIDUAL. When the registry and the cost table are
  // identical at both commits, a stale set of rows is byte-indistinguishable from a
  // fresh one: the rows carry no commit, no run id and no timestamp of origin. This
  // is recorded here so it is a known limit rather than an assumed guarantee. It is
  // acceptable because the shards and the aggregate check out the same SHA in the
  // same run, and because a stale set can only arrive through a re-run, which also
  // changes the FILE COUNT (TESTER-6).
  const identical = runAggregate(rows, "same-registry");
  assert.equal(identical.exitCode, EXIT_OK,
    "documented residual: with an identical registry, provenance is not recoverable from a row");
});

test("TESTER-6 a previous attempt's aggregate artifact in the download path is fail-closed, never a false green", () => {
  // The completeness job downloads `gate-results-A*`, and its OWN artifact is
  // called gate-results-A-aggregate — so the pattern matches it. Inside one attempt
  // that is harmless (the aggregate does not exist when the download runs). On a
  // re-run of the failed job it may not be, so the behaviour is pinned HERE rather
  // than left to be discovered on a red PR.
  const rows = healthyShardRows();

  // A previous attempt's SUCCESS aggregate: a whole extra copy of the class.
  const successAggregate = runAggregate(rows, "rerun-success", {
    "gate-results-A-aggregate/gate-results-A-aggregate.json": `${JSON.stringify(rows.flat())}\n`,
  });
  assert.equal(successAggregate.exitCode, EXIT_INCONCLUSIVE,
    "a fourth file must never be tolerated: it is a whole duplicate class");
  assert.ok(named(successAggregate, `expected exactly ${SHARD_COUNT} shard result file(s), found ${SHARD_COUNT + 1}`),
    "and the file count must be named so the cause is one read");

  // A previous attempt's FAILURE diagnostic: an object, not an array.
  const failureAggregate = runAggregate(rows, "rerun-failure", {
    "gate-results-A-aggregate/gate-results-A-aggregate.json": `${JSON.stringify({ issue: 3449, status: "FAILED", exit: 2, errors: ["prior attempt"] })}\n`,
  });
  expectNamed(failureAggregate, EXIT_INCONCLUSIVE, "must be a top-level array",
    "a failed attempt's diagnostic object is not a result set");

  // An unparseable file is the same class of doubt, never a skip.
  expectNamed(runAggregate(rows, "truncated-shard", {
    "gate-results-A-shard-9/gate-results-A.json": '[{"script":"x","mode":"plain"',
  }), EXIT_INCONCLUSIVE, "unparseable shard result file", "a truncated shard result file");
});

// ── TESTER-7 ── hostile cost tables ────────────────────────────────────────
test("TESTER-7 a corrupt, emptied, truncated or stale-majority cost table is refused, and a stale MINORITY does not change the plan", () => {
  // An emptied table fails on the honesty floor — and the plan it WOULD have
  // produced still partitions the class exactly, which is the point: the floor is
  // about BALANCE, never about completeness. Completeness cannot depend on a
  // measurement file.
  const emptied = auditPlanInputs({ manifest: MANIFEST, costs: { defaultCostMs: 100, costMs: {} } });
  assert.ok(emptied.errors.some((error) => error.includes(`at least ${MINIMUM_COSTED_EXECUTIONS} are required`)),
    `an emptied cost table must fail the ${MINIMUM_COSTED_EXECUTIONS}-entry floor; got ${JSON.stringify(emptied.errors)}`);
  const degenerate = classAShardPlan({ manifest: MANIFEST, costs: { defaultCostMs: 100, costMs: {} }, shardCount: SHARD_COUNT });
  assert.equal(degenerate.shards.flat().length, CLASS_A.length, "even an emptied table still places every execution");
  assert.equal(new Set(degenerate.shards.flat().map(executionKey)).size, CLASS_A.length, "exactly once");
  assert.ok(degenerate.shards.every((shard) => shard.length > 0), "and leaves no shard empty");

  // A TRUNCATED file must throw on read rather than degrade to an empty object — a
  // silently-empty table is a rebalanced plan nobody chose.
  const dir = tempDir("truncated-costs");
  cleanup.push(dir);
  const truncated = path.join(dir, "class-a-shard-costs.json");
  fs.writeFileSync(truncated, fs.readFileSync(path.join(HERE, "class-a-shard-costs.json"), "utf8").slice(0, 400));
  assert.throws(() => loadShardCosts(truncated), /JSON|Unexpected|Unterminated/i,
    "a truncated cost table must throw, never read as {}");

  // Structurally hostile shapes, each named.
  const cases = [
    ["a null table", null, "is absent or is not a JSON object"],
    ["an array table", [], "is absent or is not a JSON object"],
    ["costMs absent", { defaultCostMs: 100 }, "costMs must be an object"],
    ["costMs an array", { defaultCostMs: 100, costMs: [] }, "costMs must be an object"],
    ["defaultCostMs absent", { costMs: COSTS.costMs }, "defaultCostMs must be a positive integer"],
    ["defaultCostMs zero", { defaultCostMs: 0, costMs: COSTS.costMs }, "defaultCostMs must be a positive integer"],
    ["defaultCostMs negative", { defaultCostMs: -1, costMs: COSTS.costMs }, "defaultCostMs must be a positive integer"],
    ["defaultCostMs a string", { defaultCostMs: "100", costMs: COSTS.costMs }, "defaultCostMs must be a positive integer"],
    ["defaultCostMs fractional", { defaultCostMs: 100.5, costMs: COSTS.costMs }, "defaultCostMs must be a positive integer"],
  ];
  for (const [label, costs, needle] of cases) {
    const result = auditPlanInputs({ manifest: MANIFEST, costs });
    assert.ok(result.errors.some((error) => error.includes(needle)),
      `${label} must be refused with "${needle}"; got ${JSON.stringify(result.errors)}`);
    assert.equal(result.plan, null, `${label} must not yield a plan`);
  }

  // A stale MAJORITY fails; a stale minority is reported and passes — and, the part
  // that matters, the planner IGNORES the stale key, so the plan is byte-identical
  // with and without it. Without that, removing one gate would silently rebalance
  // every shard through its orphaned cost entry.
  const ghosts = Object.fromEntries(Array.from({ length: Object.keys(COSTS.costMs).length + 10 },
    (unused, index) => [`.github/scripts/strict-grep/issue-3449-ghost-${index}.mjs`, { plain: 30000 }]));
  const majority = auditPlanInputs({ manifest: MANIFEST, costs: { ...COSTS, costMs: { ...COSTS.costMs, ...ghosts } } });
  assert.ok(majority.errors.some((error) => error.includes("name executions that are no longer class A")),
    `a stale majority must fail; got ${JSON.stringify(majority.errors.slice(0, 3))}`);

  const oneGhost = { ...COSTS, costMs: { ...COSTS.costMs, ".github/scripts/strict-grep/issue-3449-one-ghost.mjs": { plain: 599999 } } };
  const minority = auditPlanInputs({ manifest: MANIFEST, costs: oneGhost });
  assert.deepEqual(minority.errors, [],
    "a stale MINORITY must pass: failing would make removing any gate require a cost refresh, which is the hand maintenance this design refuses");
  assert.ok(minority.notes.some((note) => note.includes("stale")), "but it must still be REPORTED in the log");
  const withGhost = classAShardPlan({ manifest: MANIFEST, costs: oneGhost, shardCount: SHARD_COUNT });
  assert.deepEqual(withGhost.shards.map((shard) => shard.map(executionKey)), PLAN.shards.map((shard) => shard.map(executionKey)),
    "a cost entry for a script that is no longer a class A execution must not move ANY row");
  assert.deepEqual(withGhost.loadsMs, PLAN.loadsMs, "nor any shard's load");

  // A cost that is not a positive integer inside the bound is named, and the
  // PLANNER itself throws rather than sorting on nonsense — belt and braces,
  // because the gate and the runner read the same file at different moments.
  const [firstScript] = Object.keys(COSTS.costMs);
  const [firstMode] = Object.keys(COSTS.costMs[firstScript]);
  for (const bad of [0, -1, "8000", 8000.5, 600001, null]) {
    const poisoned = { ...COSTS, costMs: { ...COSTS.costMs, [firstScript]: { ...COSTS.costMs[firstScript], [firstMode]: bad } } };
    const audited = auditPlanInputs({ manifest: MANIFEST, costs: poisoned });
    if (bad === null) {
      // `null` is indistinguishable from absent by design (R-1.3): the execution
      // is DEFAULTED, not rejected, and is still placed exactly once.
      const defaulted = classAShardPlan({ manifest: MANIFEST, costs: poisoned, shardCount: SHARD_COUNT });
      assert.equal(defaulted.shards.flat().length, CLASS_A.length, "a null cost defaults and still places the row");
      assert.equal(defaulted.defaulted, PLAN.defaulted + 1, "and is counted as defaulted, so rot is visible in the log");
      continue;
    }
    assert.ok(audited.errors.length > 0, `a cost of ${JSON.stringify(bad)} must be named by the gate`);
    if (typeof bad === "number" && !Number.isInteger(bad)) {
      assert.throws(() => classAShardPlan({ manifest: MANIFEST, costs: poisoned, shardCount: SHARD_COUNT }),
        /must be a positive integer/, `the planner must refuse a fractional cost (${bad}) rather than sort on it`);
    }
  }
});

// ── TESTER-8 ── hostile shard selection ────────────────────────────────────
test("TESTER-8 every hostile STRICT_GREP_CLASS_A_SHARD value either runs the whole class or exits 2 — never a silent fraction", () => {
  const select = (value, cls = "A", manifest = MANIFEST) => {
    try {
      return { ok: true, value: resolveShardSelection({ manifest, cls, env: { [SHARD_ENV_VAR]: value }, costs: COSTS }) };
    } catch (error) {
      return { ok: false, exitCode: error.exitCode, message: error.message };
    }
  };

  // Unset and blank mean "not sharded": run the WHOLE class. That is the
  // local-development path AND the fallback for a shard job whose env: was
  // dropped — slower and duplicated, never dark.
  for (const blank of [undefined, "", " ", "\t", "\n", "   \n "]) {
    const outcome = select(blank);
    assert.ok(outcome.ok, `${JSON.stringify(blank)} must not throw`);
    assert.equal(outcome.value.requested, false,
      `${JSON.stringify(blank)} must run the whole class, not a fraction of it`);
  }

  // Refusals. Every one of these is exit 2 and runs nothing, because "I could not
  // work out what to run" must never mean "run nothing quietly".
  const refusals = ["0", "-1", "-0", "+1", "1.0", "1e0", "0x2", "1_0", "Infinity", "NaN", "two", "1 2", "1;true",
    `${SHARD_COUNT + 1}`, "99", "٢", "١", "２"];
  for (const value of refusals) {
    const outcome = select(value);
    assert.equal(outcome.ok, false, `${JSON.stringify(value)} must be REFUSED, not accepted`);
    assert.equal(outcome.exitCode, 2, `${JSON.stringify(value)} must exit 2, got ${outcome.exitCode}`);
    assert.match(outcome.message, /#3449/, `${JSON.stringify(value)}'s refusal must name the issue that owns the rule`);
  }

  // Tolerated forms, PINNED as observed rather than assumed. A zero-padded or
  // space-padded index is accepted and means the plain integer. That is safe —
  // the plan gate's duplicate-claim check catches "3" and "03" on two jobs — but
  // it is a real behaviour and it should be a deliberate one.
  for (const [value, expected] of [["03", 3], [" 2 ", 2], ["2\n", 2], ["001", 1]]) {
    if (expected > SHARD_COUNT) continue;
    const outcome = select(value);
    assert.ok(outcome.ok, `${JSON.stringify(value)} is currently tolerated; got ${outcome.message}`);
    assert.equal(outcome.value.index, expected,
      `${JSON.stringify(value)} resolves to shard ${expected} — pinned as observed behaviour, not as a requirement`);
  }

  // A stray variable must NEVER shard class B–E, whatever its value.
  for (const cls of ["B", "C", "D", "E"]) {
    const outcome = select("1", cls);
    assert.equal(outcome.ok, false, `class ${cls} must refuse a shard variable`);
    assert.equal(outcome.exitCode, 2);
    assert.match(outcome.message, new RegExp(`--class is ${cls}`), `and must say which class it refused (${cls})`);
  }

  // A shard index with a missing or malformed shard COUNT is exit 2 — deliberately
  // no default, because defaulting would make three shards each run all 1,033 rows
  // and hide the misconfiguration behind a slow green.
  for (const count of [undefined, null, 0, -1, "3", 3.5, [3]]) {
    const outcome = select("1", "A", { ...MANIFEST, [SHARD_COUNT_FIELD]: count });
    assert.equal(outcome.ok, false, `${SHARD_COUNT_FIELD}=${JSON.stringify(count)} must be refused`);
    assert.equal(outcome.exitCode, 2);
  }

  // A valid selection returns exactly that shard's set, and the sets are disjoint
  // and total. (The implementor's SC-7 proves manifest order within a shard; this
  // asserts the partition property the runner relies on.)
  const seen = new Set();
  for (let index = 1; index <= SHARD_COUNT; index += 1) {
    const { value } = select(String(index));
    const slice = value.plan.shards[index - 1];
    assert.ok(slice.length > 0, `shard ${index} must not be empty`);
    for (const item of slice) {
      const key = executionKey(item);
      assert.ok(!seen.has(key), `${key} appears in more than one shard`);
      seen.add(key);
    }
  }
  assert.equal(seen.size, CLASS_A.length, "the shards must cover the whole class and nothing else");
});

// ── TESTER-9 ── the LIVE workflow, attacked ────────────────────────────────
test("TESTER-9 the live host workflow is refused when a shard's topology is broken, including a matrix smuggled in through env", () => {
  assert.ok(HOST_FILE, `exactly one workflow must be named "${HOST_NAME}"`);
  const baseline = auditHostDocuments({ documents: cloneHost(), manifest: MANIFEST });
  assert.deepEqual(baseline.errors, [],
    `the LIVE host must be clean before any mutant means anything; got ${JSON.stringify(baseline.errors)}`);

  const shardKeys = Object.entries(HOST_DOCUMENTS[HOST_FILE].jobs)
    .filter(([, job]) => job?.env?.[SHARD_ENV_VAR] !== undefined)
    .map(([key]) => key);
  assert.equal(shardKeys.length, SHARD_COUNT, `the live host must declare ${SHARD_COUNT} shard jobs`);
  const lastShard = shardKeys.at(-1);
  const otherShard = shardKeys.at(-2);

  const mutate = (label, change, needle, { manifest = MANIFEST } = {}) => {
    const documents = cloneHost();
    change(documents[HOST_FILE]);
    const result = auditHostDocuments({ documents, manifest });
    assert.ok(result.errors.length > 0,
      `${label}: expected at least one error and got NONE. A mutant set that produces zero errors is itself the failure — it is the "matched nothing, therefore green" mode.`);
    assert.ok(result.errors.some((error) => error.includes(needle)),
      `${label}: no error named "${needle}"; got ${JSON.stringify(result.errors.slice(0, 5))}`);
  };

  // THE MATRIX, TWO WAYS. A `strategy:` key is the obvious form and is refused.
  mutate("a strategy: key on a live shard job",
    (host) => { host.jobs[lastShard].strategy = { matrix: { shard: [2, 3] } }; },
    "declares a strategy: key");
  // The form a `strategy:` check alone would MISS: one job, an expression-valued
  // shard index, and the count of jobs suddenly unequal to the count of shards.
  mutate("a shard index supplied by a matrix expression instead of a literal",
    (host) => { host.jobs[lastShard].env[SHARD_ENV_VAR] = "${{ matrix.shard }}"; },
    "must be a plain positive integer");

  // The registry and the workflow disagreeing about how many shards exist, in both
  // directions. This is the one-line change Seth's decision 7 asks for, so getting
  // it half-done must be loud.
  mutate(`${SHARD_COUNT_FIELD} raised without adding the job`, (host) => host,
    `no job declares ${SHARD_ENV_VAR}=${SHARD_COUNT + 1}`,
    { manifest: { ...MANIFEST, [SHARD_COUNT_FIELD]: SHARD_COUNT + 1 } });
  mutate(`${SHARD_COUNT_FIELD} lowered without removing the job`, (host) => host,
    `is outside 1..${SHARD_COUNT - 1}`,
    { manifest: { ...MANIFEST, [SHARD_COUNT_FIELD]: SHARD_COUNT - 1 } });

  // Two live jobs uploading ONE artifact name: the second upload is refused by the
  // action, so that shard reports nothing while its own check still goes green.
  mutate("two live shard jobs uploading one artifact name", (host) => {
    const donor = host.jobs[otherShard].steps.find((step) => String(step.uses ?? "").includes("upload-artifact"));
    for (const step of host.jobs[lastShard].steps) {
      if (String(step.uses ?? "").includes("upload-artifact")) step.with.name = donor.with.name;
    }
  }, "is uploaded by 2 jobs");

  // Two live jobs claiming one shard index: one shard then runs twice and another
  // not at all, while every per-shard check still passes.
  mutate("two live shard jobs claiming one index",
    (host) => { host.jobs[lastShard].env[SHARD_ENV_VAR] = host.jobs[otherShard].env[SHARD_ENV_VAR]; },
    "two jobs claim one shard");

  // The toolchain. Membership is COMPUTED, so any deno-dependent gate may land on
  // any shard at any time; a shard without deno is a gate that fails, or passes
  // vacuously, for a reason nobody edited.
  mutate("a live shard job losing its Deno toolchain", (host) => {
    host.jobs[lastShard].steps = host.jobs[lastShard].steps.filter((step) => !String(step.uses ?? "").includes("setup-deno"));
  }, "must set up Deno");

  // The upload contract. An upload without `always()` hides exactly the rows the
  // aggregate needs to name a failure; without `if-no-files-found: error` an empty
  // upload is indistinguishable from a shard that ran nothing.
  mutate("a live shard's upload losing if: always()", (host) => {
    for (const step of host.jobs[lastShard].steps) {
      if (String(step.uses ?? "").includes("upload-artifact")) delete step.if;
    }
  }, "must carry if: always()");
  mutate("a live shard's upload tolerating no files", (host) => {
    for (const step of host.jobs[lastShard].steps) {
      if (String(step.uses ?? "").includes("upload-artifact")) step.with["if-no-files-found"] = "warn";
    }
  }, "must set if-no-files-found: error");

  // The completeness job is the authority; every way of blinding it is refused.
  const completenessKey = Object.entries(HOST_DOCUMENTS[HOST_FILE].jobs)
    .find(([, job]) => (job.steps ?? []).some((step) => String(step.run ?? "").includes("--aggregate")))?.[0];
  assert.ok(completenessKey, "the live host must declare a completeness job");
  mutate("merge-multiple enabled on the live download", (host) => {
    for (const step of host.jobs[completenessKey].steps) {
      if (String(step.uses ?? "").includes("download-artifact")) step.with["merge-multiple"] = true;
    }
  }, "must not set merge-multiple");
  mutate("the live completeness job losing if: always()",
    (host) => { delete host.jobs[completenessKey].if; }, "must carry if: always()");
  mutate("the live completeness job no longer waiting for one shard", (host) => {
    host.jobs[completenessKey].needs = host.jobs[completenessKey].needs.filter((key) => key !== lastShard);
  }, "needs must be exactly every shard job");
  mutate("the live completeness job deleted outright", (host) => {
    delete host.jobs[completenessKey];
    host.jobs["main-red-alert"].needs = host.jobs["main-red-alert"].needs.filter((key) => key !== completenessKey);
  }, "exactly one job must run the class A shard completeness aggregate");

  // An adjudicator's subject drifting off its shard's display name. The subject is
  // matched by VALUE, so a rename on one side leaves D0 firing forever.
  const adjudicatorKey = Object.entries(HOST_DOCUMENTS[HOST_FILE].jobs)
    .find(([, job]) => (job.steps ?? []).some((step) => String(step.run ?? "").includes("--enforce")
      && step.env?.CLASS_A_JOB_NAME === HOST_DOCUMENTS[HOST_FILE].jobs[lastShard].name))?.[0];
  assert.ok(adjudicatorKey, `shard job ${lastShard} must have an adjudicator naming it`);
  mutate("an adjudicator's subject drifting off its shard's name", (host) => {
    for (const step of host.jobs[adjudicatorKey].steps) {
      if (step.env?.CLASS_A_JOB_NAME) step.env.CLASS_A_JOB_NAME = `${step.env.CLASS_A_JOB_NAME} (renamed)`;
    }
  }, "has no out-of-band elapsed-time adjudicator naming it");
  mutate("an adjudicator's constitutional bound raised above 600 s", (host) => {
    for (const step of host.jobs[adjudicatorKey].steps) {
      if (step.env?.CLASS_A_BUDGET_SECONDS) step.env.CLASS_A_BUDGET_SECONDS = "900";
    }
  }, "CLASS_A_BUDGET_SECONDS must be");

  // A red main must still reach a human. A cancelled shard yields 'cancelled', not
  // 'failure', so the aggregate's failure is what turns a LOST shard into an alert.
  mutate("the red-main alert no longer waiting for the completeness job", (host) => {
    host.jobs["main-red-alert"].needs = host.jobs["main-red-alert"].needs.filter((key) => key !== completenessKey);
  }, "needs must include every shard, adjudicator and completeness job");
});

// ── TESTER-10 ── forward defence. MUST KEEP PASSING ON REVERT ──────────────
//
// No Class A job declares `strategy:` today either, so this asserts nothing #3449
// created. It exists so a future edit that converts the shards to a matrix — and
// with it the D5 misclassification TESTER-1 reproduces — has to delete a test that
// says why. Do not convert it into a fails-on-revert case.
test("TESTER-10 no class A job in the live workflow declares strategy:, and the red-main alert covers every sibling job (PASSES ON REVERT BY DESIGN)", () => {
  const host = HOST_DOCUMENTS[HOST_FILE];
  const classAJobs = Object.entries(host.jobs).filter(([, job]) => (job.steps ?? [])
    .some((step) => String(step.run ?? "").includes("run-batch.mjs --class A")));
  assert.ok(classAJobs.length >= 1, "the host must declare at least one class A gate job");
  for (const [key, job] of classAJobs) {
    assert.ok(!Object.prototype.hasOwnProperty.call(job, "strategy"),
      `job "${key}" declares strategy:. A matrix's fail-fast default cancels siblings, and a cancelled sibling reads as a NEUTRAL eviction — see TESTER-1.`);
  }

  // The alert's own comment claims it covers every job in this host. A shard whose
  // key is missing lets the alert conclude before the shard does.
  const siblings = Object.keys(host.jobs).filter((key) => key !== "main-red-alert");
  const covered = host.jobs["main-red-alert"].needs ?? [];
  const uncovered = siblings.filter((key) => !covered.includes(key));
  assert.deepEqual(uncovered, [],
    `every job in this host must be in main-red-alert.needs; missing ${JSON.stringify(uncovered)}`);
});

// ── TESTER-11 ── per-shard adjudication semantics ──────────────────────────
test("TESTER-11 each shard is adjudicated alone: slow, cancelled, cap-killed, skipped and never-started all have distinct, non-green outcomes", () => {
  const at = (seconds) => new Date(Date.parse("2026-09-20T10:00:00Z") + seconds * 1000).toISOString();
  const job = (name, conclusion, endSeconds) => ({
    name, status: "completed", conclusion, started_at: at(0), completed_at: at(endSeconds),
  });
  const SHARD = (index) => (index === 1
    ? "Strict grep — static gates (class A)"
    : `Strict grep — static gates (class A shard ${index})`);
  const ADJ = (index) => (index === 1
    ? SELF_JOB_NAME
    : `Strict grep — class A shard ${index} elapsed-time budget (out-of-band)`);
  const verdict = (jobs, subject, run = { status: "in_progress" }) => adjudicateWithReadiness({
    jobs, run, jobName: subject, budgetSeconds: 600, timeoutKillSeconds: 890,
  });

  // The 600 s bound is a CEILING, not an equality: exactly 600 s is still D4, and
  // 601 s is the constitutional breach. The readiness ceiling is the code-owned
  // derivation round(600 × (1 − 0.1)) = 540 with no environment variable anywhere.
  assert.equal(READINESS_HEADROOM_RATIO, 0.1, "the readiness derivation must stay code-owned and unchanged");
  const boundary = [
    [539, "D4", "R0", 0],
    [540, "D4", "R0", 0],
    [541, "D4", "R1", 1],
    [600, "D4", "R1", 1],
    [601, "D3", null, 1],
  ];
  for (const [seconds, core, readiness, exit] of boundary) {
    const result = verdict([job(SHARD(2), "success", seconds)], SHARD(2));
    assert.equal(result.core.row, core, `a shard at ${seconds}s must be ${core}`);
    assert.equal(result.exit, exit, `a shard at ${seconds}s must exit ${exit}`);
    if (readiness) assert.equal(result.readiness.row, readiness, `a shard at ${seconds}s must be ${readiness}`);
  }

  // A lone cap kill is a FAILURE (D6) and a lone sub-floor cancellation is
  // INCONCLUSIVE (D7). Both are red, and they are deliberately different rows: one
  // means "this shard is too slow", the other means "nobody knows what happened".
  const healthySiblings = [job(SHARD(1), "success", 190), job(SHARD(3), "success", 185), job(ADJ(1), "success", 200)];
  const capKill = verdict([...healthySiblings, job(SHARD(2), "cancelled", 902)], SHARD(2));
  assert.equal(capKill.core.row, "D6");
  assert.equal(capKill.exit, 1);
  assert.ok(CLASS_A_TIMEOUT_CAP_SECONDS === 900 && 890 < CLASS_A_TIMEOUT_CAP_SECONDS,
    "the 890 s kill floor must stay strictly below the 900 s cap, or D6 becomes unreachable");
  const subFloor = verdict([...healthySiblings, job(SHARD(2), "cancelled", 400)], SHARD(2));
  assert.equal(subFloor.core.row, "D7");
  assert.equal(subFloor.exit, 2);

  // A shard that never started, and a shard that was skipped.
  assert.equal(verdict(healthySiblings, SHARD(2)).core.row, "D0", "a shard absent from the job list must be D0");
  assert.equal(verdict(healthySiblings, SHARD(2)).exit, 2);
  assert.equal(verdict([job(SHARD(2), "skipped", 0)], SHARD(2)).core.row, "D8", "a skipped shard must be D8");
  assert.equal(verdict([job(SHARD(2), "skipped", 0)], SHARD(2)).exit, 2);

  // A shard whose own gates failed is D2 pass-through: its own red already reports,
  // and the aggregate names the failing row. Reporting it twice under two causes is
  // what #2594 removed.
  const ownRed = verdict([...healthySiblings, job(SHARD(2), "failure", 200)], SHARD(2));
  assert.equal(ownRed.core.row, "D2");
  assert.equal(ownRed.exit, 0, "D2 is pass-through: the shard's own check carries the red");

  // THE MIXED SHAPE — the hole the aggregate exists to close, and the reason this
  // change could not rely on adjudication alone. One shard evicted, two healthy,
  // the run itself NOT cancelled: all three adjudicators exit 0.
  const mixed = [
    job(SHARD(1), "success", 190),
    job(SHARD(2), "cancelled", 120),
    job(SHARD(3), "success", 185),
    job("jest-suites", "cancelled", 121),
  ];
  const exits = [1, 2, 3].map((index) => verdict(mixed, SHARD(index)).exit);
  assert.deepEqual(exits, [0, 0, 0],
    "all three adjudicators are green in the mixed shape — which is exactly why completeness cannot be their job");
  assert.equal(verdict(mixed, SHARD(2)).core.row, "D5");
  // And the aggregate refuses it, because the evicted shard uploaded nothing.
  const rows = healthyShardRows();
  rows[1] = null;
  const refused = runAggregate(rows, "mixed-shape");
  assert.equal(refused.exitCode, EXIT_INCONCLUSIVE,
    "the aggregate is the only thing that turns the mixed shape red");
  assert.ok(named(refused, "shard(s) 2 reported NOTHING"));

  // A genuine run-level eviction: every shard cancelled together, the run
  // cancelled. Neutral is correct there — the superseding run supplies a verdict.
  const evicted = [1, 2, 3].map((index) => job(SHARD(index), "cancelled", 120));
  for (const index of [1, 2, 3]) {
    const result = verdict(evicted, SHARD(index), { status: "cancelled" });
    assert.equal(result.core.row, "D5", `a run-level cancellation must be D5 for shard ${index}`);
    assert.equal(result.exit, 0);
  }

  // THE §5.4 RESIDUAL, PINNED AS OBSERVED. adjudicate() excludes only
  // SELF_JOB_NAME from its cancelled-peer set, so a cancelled SIBLING ADJUDICATOR
  // within the simultaneity window masks a cap kill as an eviction. This is
  // unreachable through the wiring — an adjudicator carries `if: always()` and
  // needs only its own shard, so only a run-level cancellation cancels one, and a
  // cancelled run already forces D5 independently — and the aggregate makes the
  // outcome red regardless. Asserted AS IS so a future change cannot alter it
  // silently; if this ever stops being D5, the residual has been fixed and the
  // invariant's honesty paragraph should be updated with it.
  const masked = verdict([
    job(SHARD(1), "success", 190),
    job(SHARD(2), "cancelled", 902),
    job(SHARD(3), "success", 185),
    job(ADJ(3), "cancelled", 903),
  ], SHARD(2));
  assert.equal(masked.core.row, "D5",
    "observed residual: a cancelled sibling adjudicator inside the simultaneity window masks a cap kill");
  assert.equal(SIMULTANEOUS_WINDOW_SECONDS, 2, "the simultaneity window the residual depends on must stay pinned");
});

// ── TESTER-12 ── the process exit codes, not just the return values ────────
test("TESTER-12 the aggregate's PROCESS exit code matches its verdict, and a failed run publishes no result array", () => {
  // Everything above drives aggregate() in-process, which is cheap and precise.
  // This case spends two child processes to prove the part in-process assertions
  // cannot: that runAggregate() actually maps the verdict onto the process's exit
  // code, which is the only thing CI reads.
  const run = (inputDir, outPath) => spawnSync(process.execPath,
    [AGGREGATE_MODULE, "--aggregate", "--input", inputDir, "--out", outPath],
    { cwd: path.resolve(HERE, "../../.."), encoding: "utf8" });

  const dir = tempDir("exit-codes");
  cleanup.push(dir);

  const healthy = healthyShardRows();
  const okOut = path.join(dir, "ok.json");
  const okRun = run(layout("exit-ok", healthy), okOut);
  assert.equal(okRun.status, 0, `a complete set must exit 0; stderr: ${okRun.stderr}`);
  const published = JSON.parse(fs.readFileSync(okOut, "utf8"));
  assert.ok(Array.isArray(published), "success must publish a top-level ARRAY, the shape a single unsharded run produced");
  assert.equal(published.length, CLASS_A.length, "holding the whole class");
  assert.deepEqual([...new Set(published.map((row) => row.shard))].sort((a, b) => a - b),
    Array.from({ length: SHARD_COUNT }, (unused, index) => index + 1), "with every shard represented");
  assert.deepEqual(published.map((row) => `${row.script} ${row.mode}`),
    CLASS_A.map((item) => `${item.gate.script} ${item.mode}`), "in MANIFEST order, so it substitutes for the old artifact");

  const broken = healthyShardRows();
  broken[SHARD_COUNT - 1] = null;
  const badOut = path.join(dir, "bad.json");
  const badRun = run(layout("exit-inconclusive", broken), badOut);
  assert.equal(badRun.status, EXIT_INCONCLUSIVE, "a missing shard must exit 2 from the PROCESS, not merely return 2");
  assert.match(badRun.stderr, /reported NOTHING/, "and must say so on stderr where a CI log shows it");
  const diagnostic = JSON.parse(fs.readFileSync(badOut, "utf8"));
  assert.ok(!Array.isArray(diagnostic),
    "a failed run must NOT publish an array: no consumer may mistake a failure for a result set");
  assert.equal(diagnostic.status, "FAILED");
});

// ── TESTER-13 ── the constants the shard design leans on ───────────────────
test("TESTER-13 the shard design's borrowed constants are pinned, so a future edit to the adjudicator cannot move them silently", () => {
  // #3449 changes neither issue-2594-class-a-budget.mjs nor
  // issue-3336-class-a-margin.tester.test.mjs. Byte-identity is verified
  // out-of-band at TEST time rather than by a digest in an append-only file. What
  // is pinned here is what the shard topology actually depends on: the readiness
  // derivation, the simultaneity window that separates an eviction from a kill, and
  // the hard cap that `timeout-minutes: 15` backstops.
  assert.equal(READINESS_HEADROOM_RATIO, 0.1,
    "the 540 s ceiling is round(600 × 0.9); moving this ratio silently re-scopes every shard's readiness");
  assert.equal(SIMULTANEOUS_WINDOW_SECONDS, 2,
    "the eviction-versus-kill boundary; widening it turns more cap kills into neutral evictions");
  assert.equal(CLASS_A_TIMEOUT_CAP_SECONDS, 900,
    "15 minutes; a shorter shard timeout would kill below the 890 s floor and misclassify the kill as D7");

  // The manifest's shard count is a declared TOPOLOGY fact and must be a plain
  // integer, because "3" and 3 are not the same value to Number.isInteger and the
  // runner refuses the string form.
  assert.ok(Number.isInteger(SHARD_COUNT) && SHARD_COUNT >= 1,
    `${SHARD_COUNT_FIELD} must be a plain integer >= 1; got ${JSON.stringify(SHARD_COUNT)}`);

  // The plan must stay BALANCED as a property, not as the three literal numbers the
  // implementor's SC-2 pins. A 25% spread would mean the bin-pack stopped working
  // and would spend the margin this change exists to create; the measured spread
  // today is under 1%.
  const total = PLAN.loadsMs.reduce((sum, load) => sum + load, 0);
  const mean = total / SHARD_COUNT;
  const spread = (Math.max(...PLAN.loadsMs) - Math.min(...PLAN.loadsMs)) / mean;
  assert.ok(spread < 0.25, `planned shard loads must stay balanced; spread was ${(spread * 100).toFixed(1)}%`);
  assert.ok(Math.max(...PLAN.loadsMs) < 540000,
    `no planned shard may approach the 540 s readiness ceiling; worst was ${Math.max(...PLAN.loadsMs)} ms`);

  // And the whole class must still be reachable from the plan by identity, which is
  // the one property every clause of the aggregate is built on.
  for (const item of CLASS_A) {
    assert.ok(classAShardOf({ script: item.gate.script, mode: item.mode }, PLAN) >= 1,
      `${item.gate.script} [${item.mode}] must be owned by some shard`);
  }
});
