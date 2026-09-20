#!/usr/bin/env node
/**
 * issue #3449 — the Class A shard COMPLETENESS authority (contract R12).
 *
 * WHAT WENT WRONG, AND WHAT THIS PREVENTS. Class A ran all 1,033 strict-grep
 * executions in one job. Measured over 14 runs it averaged 519 s against the
 * #3336 readiness ceiling of 540 s, with a worst run at 539 s — ONE SECOND of
 * margin — growing +3.6 to +8.8 s/day because the corpus grows by policy. The fix
 * is three parallel shards at about 183 s each. But splitting a completeness
 * check is the one change that can make things WORSE than the problem: a split
 * that loses a third of the class while still reporting green is strictly worse
 * than a slow check, and it is exactly the dark-gate failure the whole ORCH-1383
 * runner exists to make impossible.
 *
 * WHY PER-SHARD `executed === expected` IS NOT ENOUGH. Each shard asserts R4 over
 * its OWN set (R11). Three shards each honestly reporting "I ran all of mine" is
 * perfectly compatible with executions belonging to NO shard at all — a planner
 * bug, a stale cost table read, a shard index collision, or a `shard` value that
 * silently drifted. Per-shard R4 can never see that, because each shard's notion
 * of "expected" comes from the same possibly-wrong plan. So this job:
 *
 *   * recomputes the plan ITSELF from the checked-out registry and cost table —
 *     it never trusts a shard's claim about what it was supposed to run;
 *   * compares IDENTITIES as well as counts, because equal counts with different
 *     identities is a real failure shape;
 *   * checks every row's `shard` against the shard the plan assigns it, which is
 *     the only way to catch SILENT REASSIGNMENT;
 *   * is fail-closed: "I could not look" exits NON-ZERO, on purpose. "I could not
 *     look" and "I looked and it is wrong" must never be the same silence.
 *
 * It runs out-of-band, in its own job, with `if: always()`. Without `always()` a
 * failing or cancelled shard would SKIP the completeness proof at exactly the
 * moment completeness is most in doubt. A cancelled shard uploads nothing, so the
 * "fewer result files than shards" clause is what turns the one shape the
 * per-shard adjudicators cannot refuse — one shard neutral-cancelled while its
 * siblings pass — into a red.
 *
 * NAMING CONSTRAINT, load-bearing. This file names NO workflow file. The frozen
 * provider seal in .github/scripts/ci-batch/validate-manifest-v2.mjs derives, for
 * every workflow filename, the sorted set of tracked files containing that name as
 * a literal; one mention here would rewrite that record and red `external
 * reference file inventory drifted` with no escape. Hosts and jobs are referred to
 * by the display name and job key GitHub itself shows.
 *
 * MODES
 *   --aggregate --input <dir> [--out <file>]   the CI invocation (its own job)
 *   --self-test                                 the registered gate row's mode
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHARD_COUNT_FIELD,
  classAShardOf,
  classAShardPlan,
  executionKey,
  expectedExecutions,
  loadManifest,
  loadShardCosts,
} from "./run-batch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

/** Exit 0 only when every clause holds; 1 when a row FAILED; 2 for every "could not look". */
export const EXIT_OK = 0;
export const EXIT_ROW_FAILED = 1;
export const EXIT_INCONCLUSIVE = 2;

const pretty = (script, mode) => `${script} [${mode}]`;

/**
 * Discover the shard result files under `dir`. Recursive, because artifact
 * downloads land one directory per artifact and every shard's file is NAMED THE
 * SAME (`gate-results-A.json`) — that filename is inside shard 1's sealed step and
 * cannot change, so distinctness lives at the artifact-name layer instead.
 *
 * This is also why `merge-multiple` must never be enabled on the download: with it,
 * three artifacts each holding a file of that one name collapse into a single path
 * and two shards' rows are SILENTLY OVERWRITTEN — a green run that lost 693
 * executions, the precise failure this file exists to prevent.
 */
export function discoverShardFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
    }
  };
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  walk(dir);
  return files;
}

/**
 * The completeness proof. Returns { exitCode, errors, rows } and NEVER throws for a
 * data defect — a thrown stack is a worse report than a named clause.
 *
 * `rows` is the canonical aggregate on success: the shard arrays concatenated in
 * MANIFEST ORDER, the same top-level array shape a single unsharded run produced,
 * every row carrying its `shard`. It is null whenever any clause failed.
 */
export function aggregate({ inputDir, manifest, costs, shardCount, log = () => {} }) {
  const errors = [];
  const inconclusive = [];
  const fail = (message) => errors.push(message);
  const cannotLook = (message) => {
    errors.push(message);
    inconclusive.push(message);
  };

  // ---- (c) recompute the plan ourselves -----------------------------------
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    cannotLook(`${SHARD_COUNT_FIELD} must be an integer >= 1; got ${JSON.stringify(shardCount)}. Refusing to guess how many shards should have reported.`);
    return { exitCode: EXIT_INCONCLUSIVE, errors, rows: null };
  }
  let plan;
  let expected;
  try {
    plan = classAShardPlan({ manifest, costs, shardCount });
    expected = expectedExecutions(manifest, "A");
  } catch (error) {
    cannotLook(`could not recompute the class A shard plan: ${error.message}`);
    return { exitCode: EXIT_INCONCLUSIVE, errors, rows: null };
  }

  // ---- (a) one parseable result file per shard ----------------------------
  const files = discoverShardFiles(inputDir);
  if (files === null) {
    cannotLook(`shard results directory "${inputDir}" does not exist. No shard reported anything.`);
    return { exitCode: EXIT_INCONCLUSIVE, errors, rows: null };
  }

  const perFile = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      cannotLook(`${file}: unparseable shard result file (${error.message})`);
      continue;
    }
    if (!Array.isArray(parsed)) {
      cannotLook(`${file}: shard result file must be a top-level array of result rows`);
      continue;
    }
    perFile.push({ file, rows: parsed });
  }

  const allRows = perFile.flatMap((entry) => entry.rows);

  // ---- (i) an unsharded run's output inside a sharded aggregate -----------
  // This is the "a shard lost its env:" shape. The runner's fallback is to run
  // the WHOLE class (slow and duplicated, never dark), so the rows are honest —
  // but they cannot be attributed, and the aggregate must not pretend otherwise.
  const nullShardRows = allRows.filter((row) => row?.shard == null);
  if (nullShardRows.length) {
    cannotLook(`${nullShardRows.length} row(s) carry no shard index — an UNSHARDED run's output inside a sharded aggregate. A shard job lost its shard environment value; first offender ${pretty(nullShardRows[0]?.script, nullShardRows[0]?.mode)}.`);
  }

  // ---- (b) the shard indices present are exactly {1 … shardCount} ---------
  const claimedByFile = perFile.map((entry) => {
    const indices = [...new Set(entry.rows.map((row) => row?.shard).filter((value) => value != null))];
    return { file: entry.file, indices };
  });
  for (const entry of claimedByFile) {
    if (entry.indices.length > 1) {
      cannotLook(`${entry.file}: one shard result file carries more than one shard index (${entry.indices.join(", ")}). Shard results must not be merged.`);
    }
  }
  const present = new Set(allRows.map((row) => row?.shard).filter((value) => value != null));
  const wanted = Array.from({ length: shardCount }, (unused, index) => index + 1);
  const missingShards = wanted.filter((index) => !present.has(index));
  const strayShards = [...present].filter((index) => !wanted.includes(index)).sort((a, b) => a - b);
  if (missingShards.length) {
    cannotLook(`shard(s) ${missingShards.join(", ")} reported NOTHING. A cancelled, skipped or never-started shard uploads no result file, and a third of the class going unrun must never read as green.`);
  }
  if (strayShards.length) {
    cannotLook(`shard index/indices ${strayShards.join(", ")} are outside 1..${shardCount}`);
  }

  // (a) again, on the file count itself: a duplicated upload or a collapsed
  // download both change the file count even when the index set looks right.
  if (perFile.length !== shardCount) {
    const claims = claimedByFile.map((entry) => `${path.basename(path.dirname(entry.file))}/${path.basename(entry.file)} -> shard ${entry.indices.join("+") || "none"}`);
    cannotLook(`expected exactly ${shardCount} shard result file(s), found ${perFile.length}: ${claims.join("; ") || "none"}`);
  }

  // ---- (d)/(e) the shards PARTITION the class ------------------------------
  const expectedCount = new Map();
  for (const item of expected) expectedCount.set(executionKey(item), (expectedCount.get(executionKey(item)) ?? 0) + 1);
  const actualCount = new Map();
  for (const row of allRows) {
    const key = executionKey(row);
    actualCount.set(key, (actualCount.get(key) ?? 0) + 1);
  }

  const dropped = [];
  const duplicated = [];
  for (const [key, want] of expectedCount) {
    const have = actualCount.get(key) ?? 0;
    if (have < want) dropped.push({ key, want, have });
    if (have > want) duplicated.push({ key, want, have });
  }
  const unexpected = [...actualCount.keys()].filter((key) => !expectedCount.has(key));

  const split = (key) => key.split(String.fromCharCode(31));
  for (const entry of dropped.slice(0, 20)) {
    const [script, mode] = split(entry.key);
    cannotLook(`DROPPED: ${pretty(script, mode)} is a class A execution and no shard ran it (expected ${entry.want}, saw ${entry.have}).`);
  }
  if (dropped.length > 20) cannotLook(`DROPPED: ${dropped.length - 20} further execution(s) not listed.`);
  for (const entry of duplicated.slice(0, 20)) {
    const [script, mode] = split(entry.key);
    cannotLook(`DUPLICATED: ${pretty(script, mode)} ran ${entry.have} time(s); the plan assigns it to exactly ${entry.want} shard.`);
  }
  if (duplicated.length > 20) cannotLook(`DUPLICATED: ${duplicated.length - 20} further execution(s) not listed.`);
  for (const key of unexpected.slice(0, 20)) {
    const [script, mode] = split(key);
    cannotLook(`UNKNOWN: ${pretty(script, mode)} was executed but is not a class A execution in the registry.`);
  }

  if (allRows.length !== expected.length) {
    cannotLook(`executed ${allRows.length} / expected ${expected.length} — the shards do not add up to the class.`);
  }

  // ---- (f) no SILENT REASSIGNMENT ----------------------------------------
  // The clause a count-and-set comparison cannot see: every row present, the
  // count exactly right, and one row executed by a shard the plan did not assign
  // it to. That means the runner and the plan disagree, so the next planner change
  // could drop it entirely and nothing else here would notice.
  let reassigned = 0;
  for (const row of allRows) {
    if (row?.shard == null) continue;
    let owner;
    try {
      owner = classAShardOf({ script: row.script, mode: row.mode }, plan);
    } catch {
      continue; // already reported as UNKNOWN above
    }
    if (owner !== row.shard) {
      reassigned += 1;
      if (reassigned <= 20) {
        cannotLook(`REASSIGNED: ${pretty(row.script, row.mode)} was executed by shard ${row.shard} but the plan assigns it to shard ${owner}.`);
      }
    }
  }
  if (reassigned > 20) cannotLook(`REASSIGNED: ${reassigned - 20} further row(s) not listed.`);

  // ---- (h) a MISSING gate file, surfaced at aggregate level ---------------
  const missingRows = allRows.filter((row) => row?.status === "MISSING");
  for (const row of missingRows.slice(0, 20)) {
    cannotLook(`MISSING: ${pretty(row.script, row.mode)} names a gate file that does not exist on disk. This is R3's class, and it is a hard failure, never a skip.`);
  }
  if (missingRows.length > 20) cannotLook(`MISSING: ${missingRows.length - 20} further row(s) not listed.`);

  // ---- (g) every row PASSed ----------------------------------------------
  // Not redundant with a shard's own red: this is what makes the aggregate
  // artifact a TRUTHFUL "<n>/<n> PASS" record rather than a count of rows that ran.
  const failedRows = allRows.filter((row) => row?.status !== "MISSING" && (row?.status !== "PASS" || row?.exit !== 0));
  for (const row of failedRows.slice(0, 20)) {
    fail(`${row?.status ?? "UNKNOWN"}: ${pretty(row?.script, row?.mode)} -> exit ${row?.exit} (shard ${row?.shard})`);
  }
  if (failedRows.length > 20) fail(`${failedRows.length - 20} further failing row(s) not listed.`);

  if (errors.length) {
    // Exit 2 dominates exit 1: a structural doubt is never downgraded to "a gate
    // failed", because the two demand different human responses.
    return { exitCode: inconclusive.length ? EXIT_INCONCLUSIVE : EXIT_ROW_FAILED, errors, rows: null };
  }

  // ---- (R-5.4) the canonical aggregate, in MANIFEST order -----------------
  const byKey = new Map(allRows.map((row) => [executionKey(row), row]));
  const rows = expected.map((item) => byKey.get(executionKey(item)));
  log(`#3449 class A shard completeness: executed ${rows.length} / expected ${expected.length}`);
  log(`  shards reporting: ${[...present].sort((a, b) => a - b).join(", ")} of ${shardCount}`);
  log(`  dropped 0 · duplicated 0 · reassigned 0 · MISSING 0 · non-PASS 0`);
  return { exitCode: EXIT_OK, errors, rows };
}

function runAggregate() {
  const inputIndex = process.argv.indexOf("--input");
  const inputDir = inputIndex === -1 ? null : process.argv[inputIndex + 1];
  if (!inputDir) {
    console.error("usage: node .github/scripts/strict-grep/issue-3449-class-a-shard-completeness.mjs --aggregate --input <dir> [--out <file>]");
    process.exitCode = EXIT_INCONCLUSIVE;
    return;
  }
  const outIndex = process.argv.indexOf("--out");
  const outPath = path.resolve(REPO_ROOT, outIndex === -1 ? "gate-results-A-aggregate.json" : process.argv[outIndex + 1]);

  let manifest;
  let costs;
  try {
    manifest = loadManifest();
    costs = loadShardCosts();
  } catch (error) {
    console.error(`::error::#3449 aggregate: could not read the registry or the cost table — ${error.message}`);
    // A diagnostic object, deliberately NOT an array: the success shape is an
    // array of rows, so no consumer can mistake a failure for a result set.
    fs.writeFileSync(outPath, `${JSON.stringify({ issue: 3449, status: "FAILED", exit: EXIT_INCONCLUSIVE, errors: [error.message] }, null, 2)}\n`);
    process.exitCode = EXIT_INCONCLUSIVE;
    return;
  }

  const result = aggregate({
    inputDir: path.resolve(inputDir),
    manifest,
    costs,
    shardCount: manifest[SHARD_COUNT_FIELD],
    log: (line) => console.log(line),
  });

  if (result.exitCode === EXIT_OK) {
    fs.writeFileSync(outPath, `${JSON.stringify(result.rows, null, 2)}\n`);
    console.log(`  aggregate written: ${path.relative(REPO_ROOT, outPath)}`);
    console.log("#3449 class A shard completeness: PASS — the shards partition the class exactly.");
    return;
  }

  for (const error of result.errors) console.error(`::error::${error}`);
  console.error(`#3449 class A shard completeness: ${result.exitCode === EXIT_INCONCLUSIVE ? "INCONCLUSIVE" : "FAIL"} (${result.errors.length} error(s), exit ${result.exitCode})`);
  fs.writeFileSync(outPath, `${JSON.stringify({ issue: 3449, status: "FAILED", exit: result.exitCode, errors: result.errors }, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

// ── fixtures ──────────────────────────────────────────────────────────────
//
// Synthetic and small on purpose: every clause is proved on a registry whose whole
// class fits on one screen, so a fixture failure points at the clause rather than
// at 1,033 rows. The LIVE-scale proof lives in the regression suites, which drive
// the real registry, the real cost table and the real workflow.

const FIXTURE_MANIFEST = Object.freeze({
  classAShardCount: 3,
  gates: [
    { script: "g/alpha.mjs", kind: "file", enforcement: "batch:A", invocation: "node", modes: ["self-test", "plain"], selfTest: "wired", jobKeys: [] },
    { script: "g/bravo.mjs", kind: "file", enforcement: "batch:A", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] },
    { script: "g/charlie.mjs", kind: "file", enforcement: "batch:A", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] },
    { script: "g/delta.mjs", kind: "file", enforcement: "batch:A", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] },
    { script: "g/echo.mjs", kind: "file", enforcement: "batch:A", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] },
    { script: "g/foxtrot.mjs", kind: "file", enforcement: "batch:A", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] },
    { script: "g/not-class-a.mjs", kind: "file", enforcement: "batch:B", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] },
  ],
});

const FIXTURE_COSTS = Object.freeze({
  defaultCostMs: 100,
  costMs: {
    "g/alpha.mjs": { plain: 9000, "self-test": 4000 },
    "g/bravo.mjs": { plain: 7000 },
    "g/charlie.mjs": { plain: 5000 },
  },
});

/** Build the row a healthy shard would write for one execution. */
function fixtureRow(item, shard, overrides = {}) {
  return {
    script: item.gate.script,
    jobKeys: item.gate.jobKeys,
    mode: item.mode,
    exit: 0,
    durationMs: 10,
    status: "PASS",
    shard,
    ...overrides,
  };
}

/** Lay out one directory per shard, the way an un-merged artifact download does. */
function writeFixture(root, shardRows) {
  fs.rmSync(root, { recursive: true, force: true });
  for (const [index, rows] of shardRows.entries()) {
    if (rows === null) continue; // the cancelled-shard shape: no artifact at all
    const dir = path.join(root, index === 0 ? "gate-results-A" : `gate-results-A-shard-${index + 1}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "gate-results-A.json"), `${JSON.stringify(rows, null, 2)}\n`);
  }
  return root;
}

function healthyShardRows() {
  const plan = classAShardPlan({ manifest: FIXTURE_MANIFEST, costs: FIXTURE_COSTS, shardCount: 3 });
  return plan.shards.map((shard, index) => shard.map((item) => fixtureRow(item, index + 1)));
}

export function runSelfTest(log = console.log) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "issue-3449-completeness-"));
  let assertions = 0;
  const run = (shardRows, label, { shardCount = 3 } = {}) => {
    const dir = writeFixture(path.join(base, label.replace(/[^a-z0-9]+/gi, "-")), shardRows);
    return aggregate({ inputDir: dir, manifest: FIXTURE_MANIFEST, costs: FIXTURE_COSTS, shardCount });
  };
  const expect = (label, result, exitCode, needle) => {
    assert.equal(result.exitCode, exitCode, `${label}: expected exit ${exitCode}, got ${result.exitCode} (${result.errors.join(" | ")})`);
    if (needle) {
      assert.ok(result.errors.some((error) => error.includes(needle)),
        `${label}: no error mentioned "${needle}"; got ${JSON.stringify(result.errors)}`);
    }
    assertions += 1;
  };

  try {
    const expected = expectedExecutions(FIXTURE_MANIFEST, "A");

    // Healthy — the only shape that may exit 0.
    const healthy = run(healthyShardRows(), "complete");
    expect("a complete, correctly-attributed set", healthy, EXIT_OK);
    assert.equal(healthy.rows.length, expected.length);
    assert.deepEqual(healthy.rows.map((row) => `${row.script} ${row.mode}`), expected.map((item) => `${item.gate.script} ${item.mode}`),
      "the aggregate must be emitted in MANIFEST order");
    assert.deepEqual([...new Set(healthy.rows.map((row) => row.shard))].sort(), [1, 2, 3]);
    assertions += 3;

    // (d) one row dropped — the under-executing shard.
    const droppedRows = healthyShardRows();
    const victim = droppedRows[1].pop();
    expect("one row dropped", run(droppedRows, "dropped"), EXIT_INCONCLUSIVE, `DROPPED: ${victim.script} [${victim.mode}]`);

    // (d) one row duplicated across two shards.
    const dupRows = healthyShardRows();
    const twin = { ...dupRows[2][0], shard: 2 };
    dupRows[1].push(twin);
    expect("one row duplicated", run(dupRows, "duplicated"), EXIT_INCONCLUSIVE, "DUPLICATED:");

    // (f) SILENT REASSIGNMENT — every row present, the count exactly right, one
    // row's shard wrong. The case count-and-set comparison cannot see.
    const movedRows = healthyShardRows();
    const moved = movedRows[0][0];
    movedRows[0].shift();
    movedRows[1].push({ ...moved, shard: 2 });
    const movedResult = run(movedRows, "reassigned");
    assert.equal(movedRows.flat().length, expected.length, "the reassignment fixture must keep the count exact");
    expect("a silently reassigned row", movedResult, EXIT_INCONCLUSIVE, "REASSIGNED:");
    assertions += 1;

    // (a) a shard file absent — the cancelled / skipped / never-started shape.
    const absent = healthyShardRows();
    absent[1] = null;
    expect("a shard file absent", run(absent, "absent"), EXIT_INCONCLUSIVE, "shard(s) 2 reported NOTHING");

    // (b) two shard files claiming the same index — the merge-multiple shape.
    const collided = healthyShardRows();
    collided[2] = collided[2].map((row) => ({ ...row, shard: 2 }));
    expect("two shard files claiming one index", run(collided, "collided"), EXIT_INCONCLUSIVE, "shard(s) 3 reported NOTHING");

    // (b) ONE file carrying two shard indices — what a concatenating merge of two
    // shards' rows into a single path looks like from here.
    const mergedDir = writeFixture(path.join(base, "merged-into-one-file"), healthyShardRows());
    const mergedRows = healthyShardRows();
    fs.writeFileSync(path.join(mergedDir, "gate-results-A", "gate-results-A.json"),
      `${JSON.stringify([...mergedRows[0], ...mergedRows[1]], null, 2)}\n`);
    expect("one file carrying two shard indices", aggregate({ inputDir: mergedDir, manifest: FIXTURE_MANIFEST, costs: FIXTURE_COSTS, shardCount: 3 }),
      EXIT_INCONCLUSIVE, "carries more than one shard index");

    // (h) a MISSING gate file.
    const missing = healthyShardRows();
    missing[0][0] = { ...missing[0][0], status: "MISSING", exit: 2 };
    expect("a MISSING row", run(missing, "missing"), EXIT_INCONCLUSIVE, "MISSING:");

    // (i) an unsharded run's output inside a sharded aggregate.
    const unsharded = healthyShardRows();
    unsharded[0] = unsharded[0].map((row) => ({ ...row, shard: null }));
    expect("a shard that lost its shard value", run(unsharded, "null-shard"), EXIT_INCONCLUSIVE, "carry no shard index");

    // (g) a failing row — exit 1, NOT 2. "A gate failed" and "I could not look"
    // are different verdicts and must stay different exit codes.
    const failing = healthyShardRows();
    failing[0][0] = { ...failing[0][0], status: "FAIL", exit: 1 };
    expect("a failing row", run(failing, "failing"), EXIT_ROW_FAILED, "-> exit 1");

    // An execution that is not in the registry at all.
    const stranger = healthyShardRows();
    stranger[0].push({ script: "g/ghost.mjs", jobKeys: [], mode: "plain", exit: 0, durationMs: 1, status: "PASS", shard: 1 });
    expect("an execution absent from the registry", run(stranger, "ghost"), EXIT_INCONCLUSIVE, "UNKNOWN:");

    // The directory itself missing, and a malformed shardCount.
    expect("the results directory missing", aggregate({
      inputDir: path.join(base, "no-such-directory"),
      manifest: FIXTURE_MANIFEST,
      costs: FIXTURE_COSTS,
      shardCount: 3,
    }), EXIT_INCONCLUSIVE, "does not exist");
    expect("a malformed shard count", aggregate({
      inputDir: base,
      manifest: FIXTURE_MANIFEST,
      costs: FIXTURE_COSTS,
      shardCount: "3",
    }), EXIT_INCONCLUSIVE, `${SHARD_COUNT_FIELD} must be an integer`);

    // An unparseable shard file.
    const bad = writeFixture(path.join(base, "unparseable"), healthyShardRows());
    fs.writeFileSync(path.join(bad, "gate-results-A", "gate-results-A.json"), "{ not json");
    expect("an unparseable shard file", aggregate({ inputDir: bad, manifest: FIXTURE_MANIFEST, costs: FIXTURE_COSTS, shardCount: 3 }),
      EXIT_INCONCLUSIVE, "unparseable shard result file");

    // A fixture set that produces zero errors would itself be a failure — the
    // "matched nothing, therefore green" mode. Proved by construction: every
    // expect() above with a non-zero code asserted a NAMED error.
    log(`#3449 class A shard completeness self-test: PASS (${assertions} assertions)`);
    return assertions;
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }
  if (process.argv.includes("--aggregate")) {
    runAggregate();
    return;
  }
  console.error("usage: node .github/scripts/strict-grep/issue-3449-class-a-shard-completeness.mjs (--aggregate --input <dir> [--out <file>] | --self-test)");
  process.exitCode = EXIT_INCONCLUSIVE;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
