/**
 * issue #3449 — implementor happy-path regressions for the three-shard Class A split.
 *
 * WHAT WENT WRONG. Class A ran all 1,033 strict-grep executions in one job: mean
 * 519 s over 14 runs against #3336's 540 s readiness ceiling, worst 539 s — ONE
 * SECOND of margin — growing +3.6 to +8.8 s/day, because the corpus grows by policy
 * (#2865: about 2.9 test files per issue closed) and the append-only ratchet forbids
 * removal. Within days ordinary pull requests would have gone red, each red costing
 * a 13-minute rerun before anything could merge.
 *
 * WHY A SPLIT IS THE FIX. Three shards run the SAME executions in parallel at about
 * 183 s each, so each has roughly 357 s of room instead of 1 s. That buys four to
 * ten months at the observed growth rate, and the number of shards is a one-line
 * change to MANIFEST.json's classAShardCount when more room is needed again.
 *
 * WHY MEMBERSHIP IS COST-BASED AND NOT COUNT-BASED. The class is wildly skewed: ONE
 * execution (issue-2438-postgres-wave-shadow-parity.implementor.test.mjs [plain]) is
 * 89.1 s — 18% of the whole class — while about 800 executions together are 6%. A
 * count-based split would leave one shard roughly twice as slow as another and spend
 * the very margin this change exists to create.
 *
 * WHY EXPLICIT SIBLING JOBS AND NOT `strategy: matrix`. `fail-fast: true` is the
 * documented matrix default and cancels sibling shards; a cancelled shard with a
 * simultaneously-cancelled peer classifies as D5 NEUTRAL exit 0 in
 * issue-2594-class-a-budget.mjs — "the pool was busy" — the exact "a kill reads as
 * noise" failure #2594 and #3336 closed. The tester's suite reproduces that
 * misclassification directly (SC-13.1), so the rejection stays falsifiable.
 *
 * WHY PER-SHARD `executed === expected` IS NOT COMPLETENESS. Each shard asserts R4
 * over its OWN set (R11), but three shards each honestly reporting "I ran all of
 * mine" is compatible with executions belonging to NO shard at all, because every
 * shard's notion of "expected" comes from the same possibly-wrong plan. That is why
 * R12's out-of-band aggregate recomputes the plan itself and is the authority.
 *
 * WHY THIS SUITE IS CLASS E. It runs about 45 s against a 600 s bound. A proof about
 * Class A's margin must not be charged to Class A's margin — putting these here
 * would make this issue's own regression suite a contributor to the problem.
 *
 * This file names NO workflow file and contains no self-test flag literal. The
 * frozen provider seal derives, per workflow filename, the set of tracked files
 * containing that name; and META-1383's P6 reads a self-test flag literal as a claim
 * that THIS file supports that flag, while its manifest row says selfTest:"none".
 * Both would red on a string that is about a different file entirely.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHARD_COUNT_FIELD,
  SHARD_ENV_VAR,
  classAShardOf,
  classAShardPlan,
  executionKey,
  expectedExecutions,
  expectedForClass,
  loadManifest,
  loadShardCosts,
  resolveShardSelection,
} from "./run-batch.mjs";
import {
  MINIMUM_COSTED_EXECUTIONS,
  auditPlanInputs,
  auditWorkflowWiring,
  readWorkflowSources,
} from "./issue-3449-class-a-shard-plan.mjs";
import { aggregate, EXIT_OK } from "./issue-3449-class-a-shard-completeness.mjs";
import {
  MINIMUM_SAMPLES,
  buildCostTable,
  collectSamples,
  median,
} from "../../../scripts/ci/refresh-class-a-shard-costs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const manifest = () => loadManifest(path.join(HERE, "MANIFEST.json"));
const costs = () => loadShardCosts(path.join(HERE, "class-a-shard-costs.json"));

/**
 * SC-2 — the five measured plan numbers, from the #3449 SPEC's own simulation over
 * ten archived result artifacts (10,330 row measurements, median per execution, top
 * 50 kept, defaultCostMs 100).
 *
 * THESE ARE MEASUREMENTS OF A CORPUS, NOT A CONTRACT ON MEMBERSHIP. If a batch:A
 * gate is added or removed, these numbers legitimately move and this assertion is
 * re-derived — run `node .github/scripts/strict-grep/issue-3449-class-a-shard-plan.mjs`
 * and read the planned loads and counts it prints. What must NEVER be added here is
 * an assertion that an existing execution keeps its shard across such a change; see
 * the purity test at the bottom of this file for why.
 */
const EXPECTED_PLAN = Object.freeze({
  // issue #3526 re-derived these after registering ONE new batch:A gate
  // (i-3526-gemini-model-single-source.mjs, modes [self-test, plain] = +2
  // executions), exactly as the note above instructs. Read off
  // `node .github/scripts/strict-grep/issue-3449-class-a-shard-plan.mjs`.
  executions: 1035,
  loadsSeconds: [168.9, 168.9, 168.8],
  counts: [341, 352, 342],
});

const tempDir = (label) => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `issue-3449-${label}-`));

const keysOf = (plan) => plan.shards.map((shard) => shard.map(executionKey));

test("SC-1 every class A execution lands in exactly one shard, and no shard is empty", () => {
  const live = manifest();
  const plan = classAShardPlan({ manifest: live, costs: costs(), shardCount: live[SHARD_COUNT_FIELD] });
  const whole = expectedExecutions(live, "A").map(executionKey);

  assert.equal(new Set(whole).size, whole.length, "the class itself must contain no duplicate (script, mode) pair");

  const flat = keysOf(plan).flat();
  assert.equal(flat.length, whole.length, `the plan must place every execution exactly once: placed ${flat.length}, class has ${whole.length}`);
  assert.equal(new Set(flat).size, flat.length, "zero duplicates: no execution may be placed in two shards");
  assert.deepEqual([...flat].sort(), [...whole].sort(), "the union of the shards must BE the class — identities, not just counts");
  for (const [index, shard] of plan.shards.entries()) {
    assert.ok(shard.length > 0, `shard ${index + 1} is empty; a shard that runs nothing is a job that always passes`);
  }
  assert.equal(plan.costed + plan.defaulted, whole.length, "every execution must be either costed or defaulted, never neither and never both");
});

test("SC-2 the plan reproduces the measured loads and counts from the committed inputs", () => {
  const live = manifest();
  const liveCount = expectedExecutions(live, "A").length;
  assert.equal(liveCount, EXPECTED_PLAN.executions,
    `the class A execution count moved to ${liveCount}. That is legitimate corpus growth — re-derive EXPECTED_PLAN from the plan gate's printed loads and counts, in the same commit that moved it.`);

  const plan = classAShardPlan({ manifest: live, costs: costs(), shardCount: 3 });
  const loads = plan.loadsMs.map((ms) => ms / 1000);
  for (const [index, expected] of EXPECTED_PLAN.loadsSeconds.entries()) {
    assert.ok(Math.abs(loads[index] - expected) <= 0.1,
      `shard ${index + 1} planned load ${loads[index].toFixed(1)} s is not within 0.1 s of the measured ${expected} s`);
  }
  assert.deepEqual(plan.shards.map((shard) => shard.length), EXPECTED_PLAN.counts);
  // Balance is the POINT of costing rather than counting: the heaviest planned
  // shard must not run away from the mean.
  const mean = plan.loadsMs.reduce((sum, ms) => sum + ms, 0) / plan.shardCount;
  assert.ok(Math.max(...plan.loadsMs) / mean <= 1.05,
    `planned imbalance ${(Math.max(...plan.loadsMs) / mean).toFixed(3)} exceeds 1.05; a cost-based split that is this unbalanced is not doing its job`);
});

test("SC-3 the plan is deterministic: equal inputs give byte-identical output", () => {
  const live = manifest();
  const table = costs();
  const first = classAShardPlan({ manifest: live, costs: table, shardCount: 3 });
  const second = classAShardPlan({ manifest: live, costs: table, shardCount: 3 });
  assert.deepEqual(keysOf(second), keysOf(first));
  assert.deepEqual(second.loadsMs, first.loadsMs);
  assert.equal(second.costed, first.costed);
  assert.equal(second.defaulted, first.defaulted);
  // Re-read from disk so the second call shares no object identity with the first.
  const third = classAShardPlan({ manifest: manifest(), costs: costs(), shardCount: 3 });
  assert.deepEqual(keysOf(third), keysOf(first));
});

test("SC-4 a synthetic new class A gate lands in exactly one shard, deterministically", () => {
  const base = structuredClone(manifest());
  const before = classAShardPlan({ manifest: base, costs: costs(), shardCount: 3 });
  const beforeUnion = keysOf(before).flat().length;

  const grown = structuredClone(base);
  grown.gates.push({
    script: ".github/scripts/strict-grep/issue-0000-synthetic-fixture.mjs",
    kind: "file",
    enforcement: "batch:A",
    invocation: "node",
    modes: ["self-test", "plain"],
    selfTest: "wired",
    jobKeys: [],
  });
  const after = classAShardPlan({ manifest: grown, costs: costs(), shardCount: 3 });
  const afterKeys = keysOf(after);

  assert.equal(afterKeys.flat().length, beforeUnion + 2, "the union must grow by exactly the new gate's mode count");
  for (const mode of ["self-test", "plain"]) {
    const key = executionKey({ script: ".github/scripts/strict-grep/issue-0000-synthetic-fixture.mjs", mode });
    const owners = afterKeys.map((shard, index) => (shard.includes(key) ? index + 1 : null)).filter((value) => value !== null);
    assert.deepEqual(owners.length, 1, `the new execution [${mode}] must be owned by exactly one shard, not ${owners.length}`);
  }
  // Same shard on repeated computation — the plan is a pure function of its inputs.
  const again = classAShardPlan({ manifest: grown, costs: costs(), shardCount: 3 });
  assert.deepEqual(keysOf(again), afterKeys);
  assert.equal(new Set(afterKeys.flat()).size, afterKeys.flat().length, "the grown plan must still place nothing twice");
});

test("SC-5 an execution with no cost entry is costed at the default and still placed exactly once", () => {
  const grown = structuredClone(manifest());
  const script = ".github/scripts/strict-grep/issue-0000-untabled-fixture.mjs";
  grown.gates.push({ script, kind: "file", enforcement: "batch:A", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] });

  const table = costs();
  assert.equal(table.costMs?.[script], undefined, "the fixture must genuinely have no cost entry");

  const before = classAShardPlan({ manifest: manifest(), costs: table, shardCount: 3 });
  const after = classAShardPlan({ manifest: grown, costs: table, shardCount: 3 });

  assert.equal(after.defaulted, before.defaulted + 1, "`defaulted` must increment by the new gate's mode count");
  assert.equal(after.costed, before.costed, "`costed` must not move for an untabled row");
  const key = executionKey({ script, mode: "plain" });
  const owners = keysOf(after).map((shard, index) => (shard.includes(key) ? index + 1 : null)).filter((value) => value !== null);
  assert.deepEqual(owners.length, 1, "an untabled execution must still be placed exactly once — a missing cost can never drop a row");
  // And the shard it landed in grew by exactly the committed default.
  const shard = owners[0] - 1;
  assert.equal(after.loadsMs[shard] - before.loadsMs[shard], table.defaultCostMs);
});

test("SC-6 shardCount is a registry field: raising it keeps the union exactly the whole class", () => {
  const live = manifest();
  assert.equal(Number.isInteger(live[SHARD_COUNT_FIELD]), true, `${SHARD_COUNT_FIELD} must be an integer in the committed registry`);
  assert.ok(live[SHARD_COUNT_FIELD] >= 1);

  const whole = expectedExecutions(live, "A").map(executionKey).sort();
  for (const shardCount of [1, 2, 3, 4, 6]) {
    const plan = classAShardPlan({ manifest: live, costs: costs(), shardCount });
    assert.equal(plan.shardCount, shardCount);
    assert.equal(plan.shards.length, shardCount);
    for (const [index, shard] of plan.shards.entries()) {
      assert.ok(shard.length > 0, `at shardCount ${shardCount}, shard ${index + 1} is empty`);
    }
    const flat = keysOf(plan).flat();
    assert.equal(new Set(flat).size, flat.length, `at shardCount ${shardCount} an execution was placed twice`);
    assert.deepEqual([...flat].sort(), whole, `at shardCount ${shardCount} the union is not the whole class`);
  }
  // The one-line change Seth's decision 7 asks for really is one line.
  const four = classAShardPlan({ manifest: { ...live, [SHARD_COUNT_FIELD]: 4 }, costs: costs(), shardCount: 4 });
  assert.equal(four.shards.filter((shard) => shard.length === 0).length, 0);
});

test("SC-7 shard selection yields exactly that shard's set, in manifest order", () => {
  const live = manifest();
  const table = costs();
  const plan = classAShardPlan({ manifest: live, costs: table, shardCount: live[SHARD_COUNT_FIELD] });
  const order = new Map(expectedExecutions(live, "A").map((item, index) => [executionKey(item), index]));

  for (let index = 1; index <= live[SHARD_COUNT_FIELD]; index += 1) {
    const selection = resolveShardSelection({ manifest: live, cls: "A", env: { [SHARD_ENV_VAR]: String(index) }, costs: table });
    assert.equal(selection.requested, true);
    assert.equal(selection.index, index);
    assert.deepEqual(selection.plan.shards[index - 1].map(executionKey), plan.shards[index - 1].map(executionKey));

    const positions = selection.plan.shards[index - 1].map((item) => order.get(executionKey(item)));
    for (let i = 1; i < positions.length; i += 1) {
      assert.ok(positions[i - 1] < positions[i],
        `shard ${index} must be emitted in MANIFEST order so its artifact row order stays a subsequence of the unsharded order`);
    }
    for (const item of selection.plan.shards[index - 1]) {
      assert.equal(classAShardOf(item, plan), index);
    }
  }

  // Unset means the WHOLE class — the local-development path, and the safe fallback
  // for a shard job whose env: was dropped: slower and duplicated, never dark.
  assert.deepEqual(resolveShardSelection({ manifest: live, cls: "A", env: {}, costs: table }), { requested: false });
  assert.deepEqual(resolveShardSelection({ manifest: live, cls: "A", env: { [SHARD_ENV_VAR]: "" }, costs: table }), { requested: false });
  assert.deepEqual(resolveShardSelection({ manifest: live, cls: "B", env: {}, costs: table }), { requested: false });
});

test("SC-8 the aggregate accepts a complete, correctly-attributed set of shard results", () => {
  const live = manifest();
  const table = costs();
  const shardCount = live[SHARD_COUNT_FIELD];
  const plan = classAShardPlan({ manifest: live, costs: table, shardCount });

  const dir = tempDir("aggregate");
  try {
    for (const [index, shard] of plan.shards.entries()) {
      const target = path.join(dir, index === 0 ? "gate-results-A" : `gate-results-A-shard-${index + 1}`);
      fs.mkdirSync(target, { recursive: true });
      const rows = shard.map((item) => ({
        script: item.gate.script,
        jobKeys: item.gate.jobKeys,
        mode: item.mode,
        exit: 0,
        durationMs: 12,
        status: "PASS",
        shard: index + 1,
      }));
      fs.writeFileSync(path.join(target, "gate-results-A.json"), `${JSON.stringify(rows, null, 2)}\n`);
    }

    const result = aggregate({ inputDir: dir, manifest: live, costs: table, shardCount });
    assert.deepEqual(result.errors, [], `the aggregate must accept a healthy set; got ${JSON.stringify(result.errors.slice(0, 3))}`);
    assert.equal(result.exitCode, EXIT_OK);
    assert.equal(result.rows.length, expectedExecutions(live, "A").length);
    assert.deepEqual([...new Set(result.rows.map((row) => row.shard))].sort((a, b) => a - b),
      Array.from({ length: shardCount }, (unused, i) => i + 1));
    // The canonical aggregate has the same shape a single unsharded run produced,
    // with `shard` ADDITIVE, so existing readers keep working unchanged.
    assert.deepEqual(Object.keys(result.rows[0]), ["script", "jobKeys", "mode", "exit", "durationMs", "status", "shard"]);
    assert.deepEqual(result.rows.map((row) => `${row.script} ${row.mode}`),
      expectedExecutions(live, "A").map((item) => `${item.gate.script} ${item.mode}`),
      "the aggregate must be emitted in MANIFEST order");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("SC-9 the live plan inputs are valid and the live host workflow is wired to run every shard", () => {
  const inputs = auditPlanInputs({ manifest: manifest(), costs: costs() });
  assert.deepEqual(inputs.errors, [], `the committed plan inputs must be valid; got ${JSON.stringify(inputs.errors)}`);

  const wiring = auditWorkflowWiring({ sources: readWorkflowSources(ROOT), manifest: manifest() });
  assert.deepEqual(wiring.errors, [], `the live host wiring must be complete; got ${JSON.stringify(wiring.errors)}`);
});

test("SC-10 the cost refresh tool takes a median over at least three samples and refuses fewer", () => {
  assert.equal(median([5, 1, 3]), 3, "median must sort before selecting");
  assert.equal(median([4, 1, 3, 2]), 2.5, "an even sample takes the mean of the two middles");

  const sample = (ms) => ({ file: `/fixture/${ms}/aggregate.json`, rows: [{ script: "g/a.mjs", mode: "plain", durationMs: ms }] });

  // Three samples: the median, NOT the mean — one wildly fast run must not drag
  // every cost down, and the #3449 corpus contained runs 16% and 27% faster.
  const built = buildCostTable({ samples: [sample(1000), sample(9000), sample(3000)], top: 10, defaultCostMs: 100, measuredOn: "2026-09-20", runIds: ["a", "b", "c"] });
  assert.equal(built.costMs["g/a.mjs"].plain, 3000);
  assert.equal(built.source.sampleRuns, 3);
  assert.equal(built.source.statistic, "median");
  assert.equal(built.defaultCostMs, 100);

  // Two samples is a refusal, exit 2, not a quieter table.
  assert.equal(MINIMUM_SAMPLES, 3);
  assert.throws(
    () => buildCostTable({ samples: [sample(1000), sample(9000)], top: 10, defaultCostMs: 100, measuredOn: "2026-09-20", runIds: ["a", "b"] }),
    (error) => error.exitCode === 2 && /at least 3 are required/.test(error.message),
  );

  // top-K keeps the heaviest and defaults the rest, and the entries are sorted so a
  // refresh produces a reviewable diff rather than a reshuffle.
  const many = [1, 2, 3].map((index) => ({
    file: `/fixture/${index}/aggregate.json`,
    rows: [
      { script: "g/heavy.mjs", mode: "plain", durationMs: 50000 },
      { script: "g/light.mjs", mode: "plain", durationMs: 10 },
      { script: "g/mid.mjs", mode: "plain", durationMs: 4000 },
    ],
  }));
  const topOne = buildCostTable({ samples: many, top: 1, defaultCostMs: 100, measuredOn: "2026-09-20", runIds: ["a", "b", "c"] });
  assert.deepEqual(Object.keys(topOne.costMs), ["g/heavy.mjs"]);
  assert.equal(topOne.source.topK, 1);
  assert.equal(topOne.source.classAExecutions, 3);

  // And the committed table really is what the tool would emit: same shape, same keys.
  const committed = costs();
  assert.deepEqual(Object.keys(committed).sort(), ["$comment", "costMs", "defaultCostMs", "source"]);
  assert.equal(committed.source.statistic, "median");
  assert.ok(committed.source.sampleRuns >= MINIMUM_SAMPLES);
  let entries = 0;
  for (const modes of Object.values(committed.costMs)) entries += Object.keys(modes).length;
  assert.equal(entries, committed.source.topK);
  assert.ok(entries >= MINIMUM_COSTED_EXECUTIONS);
  assert.deepEqual(Object.keys(committed.costMs), [...Object.keys(committed.costMs)].sort());

  // collectSamples ignores non-result JSON rather than costing it.
  const dir = tempDir("samples");
  try {
    fs.mkdirSync(path.join(dir, "run-1"));
    fs.writeFileSync(path.join(dir, "run-1", "aggregate.json"), JSON.stringify([{ script: "g/a.mjs", mode: "plain", durationMs: 7 }]));
    fs.writeFileSync(path.join(dir, "not-a-result.json"), JSON.stringify({ hello: "world" }));
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");
    const collected = collectSamples(dir);
    assert.equal(collected.samples.length, 1);
    assert.equal(collected.skipped.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("SC-15 the plan is a pure function of the registry order, the cost table and the shard count — and NOTHING else", () => {
  // INSERTION CHURN IS NOT A CONTRACT, and no future assertion may make it one.
  //
  // Adding a single untabled row legitimately moves HUNDREDS of existing rows
  // between shards: the bin-pack's greedy placement depends on the whole sorted
  // sequence, so one new item shifts every later tie. That churn is harmless — the
  // aggregate proves the shards still partition the class on every run, and a row's
  // shard has no meaning beyond "which job ran it this time". An assertion that an
  // existing row keeps its shard across a registry change would be a FALSE contract:
  // it would red on ordinary gate additions and would pressure a future change to
  // pin membership by hand, which is exactly the hand maintenance R10 forbids.
  //
  // What IS a contract is purity: same inputs, same output; no environment, no clock,
  // no filesystem, no spawn.
  const live = manifest();
  const table = costs();
  const reference = keysOf(classAShardPlan({ manifest: live, costs: table, shardCount: 3 }));

  const originalEnv = process.env[SHARD_ENV_VAR];
  const originalTz = process.env.TZ;
  try {
    process.env[SHARD_ENV_VAR] = "2";
    process.env.TZ = "Pacific/Kiritimati";
    assert.deepEqual(keysOf(classAShardPlan({ manifest: live, costs: table, shardCount: 3 })), reference,
      "the plan must ignore the environment entirely");
  } finally {
    if (originalEnv === undefined) delete process.env[SHARD_ENV_VAR];
    else process.env[SHARD_ENV_VAR] = originalEnv;
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }

  // Deep-cloned inputs with no shared object identity must give the same plan.
  assert.deepEqual(keysOf(classAShardPlan({ manifest: structuredClone(live), costs: structuredClone(table), shardCount: 3 })), reference);

  // A change to a NON-class-A gate must not move the plan at all: the planner reads
  // only the batch:A projection of the registry.
  const unrelated = structuredClone(live);
  unrelated.gates.push({ script: "g/not-class-a-fixture.mjs", kind: "file", enforcement: "batch:C", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] });
  assert.deepEqual(keysOf(classAShardPlan({ manifest: unrelated, costs: table, shardCount: 3 })), reference);

  // expectedForClass must keep returning the WHOLE class. META-1383's P5 imports it
  // and compares the registry's whole-class view; a runner that filtered here would
  // make a third of the class invisible to the parity gate.
  assert.equal(expectedForClass(live, "A").length, live.gates.filter((gate) => gate.enforcement === "batch:A").length);
  assert.equal(expectedExecutions(live, "A").length, EXPECTED_PLAN.executions);
});
