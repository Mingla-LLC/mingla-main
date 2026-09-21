#!/usr/bin/env node
// ORCH-1383. This runner replaced 340 one-gate CI jobs with 5 batched jobs.
// The ONLY thing that makes that safe is: executed === manifest-expected.
//
// DO NOT add `break` on failure. DO NOT run under bare `set -e`. DO NOT treat a
// missing gate file as a skip. DO NOT replace the manifest with a glob.
// Each of those silently converts a gate into a no-op, and a green run into a lie.
//
// This repo has produced SIX classes of dark gate, incl. 21 gates on disk that CI
// never ran (one of them dark one day after its ORCH closed). Assume this WILL
// happen again and that this assertion is the only thing standing in the way.
//
// This proves EXECUTION, not EFFICACY. 168+ of the gates have no --self-test and
// cannot be shown to fail on their own defect. Green here != the suite is healthy.
//
// Contract: SPEC_ORCH-1383 §5.2 R1–R9.
//   R1 iterates MANIFEST.json, never a glob.
//   R2 never breaks early; every gate in the class runs.
//   R3 a missing script file is a FAIL (exit 2, status MISSING), never a skip.
//   R4 asserts executed === expected — a shortfall fails the run on its own.
//   R5 uses each entry's recorded invocation + modes verbatim.
//   R6 prints one line per gate naming the exact script.
//   R7 writes gate-results-<class>.json.
//   R8 exit 0 IFF all gates exit 0 AND executed === expected AND zero MISSING.
//   R9 exit-code passthrough — a gate's 2 is never collapsed to 1 or 0.
//
// ── issue #3449 — class A is SHARDED. Contract R10–R12, APPENDED to R1–R9. ──
//
// WHAT WENT WRONG. Class A grew to 1,033 executions in one job. Measured over 14
// runs: mean 519 s against the #3336 readiness ceiling of 540 s, worst 539 s —
// ONE SECOND of margin — and growing +3.6 to +8.8 s/day because the corpus grows
// by policy (#2865: ~2.9 test files per issue closed, and the append-only ratchet
// forbids removal). Within days ordinary pull requests would have gone red, each
// red costing a 13-minute rerun before anything could merge.
//
// WHY A SPLIT. Three shards run the SAME 1,033 executions in parallel at about
// 183 s each, so each has ~357 s of room instead of 1 s. That buys 4 to 10 months
// at the observed growth rate, and `classAShardCount` is a one-line change when
// more room is needed again.
//
// WHY MEMBERSHIP IS COST-BASED, NOT COUNT-BASED. The class is wildly skewed: ONE
// execution (issue-2438-postgres-wave-shadow-parity.implementor.test.mjs [plain])
// is 89.1 s — 18% of the whole class on its own — while ~800 executions together
// are 6%. Splitting by count would leave one shard roughly twice as slow as
// another and spend the margin this change exists to create. Membership is a
// longest-processing-time bin-pack over a committed cost table instead.
//
// WHY EXPLICIT SIBLING JOBS AND NOT `strategy: matrix`. `fail-fast: true` is the
// documented matrix default and cancels sibling shards. A cancelled shard reaches
// issue-2594-class-a-budget.mjs's adjudicate() with a simultaneously-cancelled
// peer, which classifies as D5 NEUTRAL exit 0 — "the pool was busy" — the exact
// "a kill reads as noise" failure #2594 and #3336 closed. `fail-fast: false` is a
// one-line default a future edit silently restores and no seal covers it.
// Explicit siblings carry no `fail-fast` at all and are immune by construction.
// The misclassification is reproduced as a fixture in
// issue-3449-class-a-shard-plan.tester.test.mjs (SC-13.1) so the rejection stays
// falsifiable rather than folkloric.
//
//   R10 shard membership is COMPUTED from MANIFEST.json + the committed cost
//       table (class-a-shard-costs.json) + MANIFEST.json's classAShardCount.
//       Never hand-enumerated, never carried as a `shard` field on a gate row.
//       A new batch:A gate lands in exactly one shard with no human decision.
//   R11 R4 (executed === expected) applies PER SHARD. Per-shard R4 alone does
//       NOT prove completeness: three shards each honestly reporting "I ran all
//       of mine" is compatible with executions belonging to no shard at all.
//       R11 therefore exists only alongside R12.
//   R12 an out-of-band aggregate — issue-3449-class-a-shard-completeness.mjs in
//       the class-a-shard-completeness job — is the completeness authority. It
//       recomputes the plan itself and proves the shards PARTITION the class:
//       every execution exactly once, none dropped, none duplicated, none run by
//       a shard other than the one the plan assigns it. R12 is fail-closed:
//       anything it cannot see is exit 2, never a pass.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(HERE, "MANIFEST.json");

export const CLASSES = ["A", "B", "C", "D", "E"];

export function loadManifest(p = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * The runner's expected set for a class, derived ONLY from the manifest (R1).
 * Exported so meta-1383-manifest-parity.mjs (P5) can cross-check that the
 * runner's view and the manifest's view are identical — a runner that silently
 * filtered entries would diverge here.
 */
export function expectedForClass(manifest, cls) {
  return manifest.gates.filter((g) => g.enforcement === `batch:${cls}`);
}

/** Flatten gates to one execution per (script, mode) — the unit R4 counts. */
export function expectedExecutions(manifest, cls) {
  const out = [];
  for (const g of expectedForClass(manifest, cls)) {
    for (const mode of g.modes) out.push({ gate: g, mode });
  }
  return out;
}

// ── issue #3449 shard plan (R10) ────────────────────────────────────────────
//
// The planner lives HERE, in the runner, and not in a new module. All three
// reasons are load-bearing:
//   * the shard filter must sit immediately downstream of expectedForClass(), so
//     meta-1383-manifest-parity.mjs's P5 keeps seeing the WHOLE class and cannot
//     be satisfied by a runner that silently runs a third of it;
//   * the gates and tests must import the EXACT function CI runs, so no drift is
//     possible between a planner module and the runner;
//   * run-batch.mjs is not a test path, so this needs no commit token.

/** The environment variable a shard job sets to claim its slice. */
export const SHARD_ENV_VAR = "STRICT_GREP_CLASS_A_SHARD";
/** The MANIFEST.json field that declares how many shards exist. */
export const SHARD_COUNT_FIELD = "classAShardCount";
/**
 * The committed cost table. Deliberately NOT a field of MANIFEST.json: that
 * file's own $comment declares it GENERATED by YAML-parsing the workflows, so a
 * regeneration would silently wipe measured cost data, collapse every row to the
 * default, and rebalance the plan without anyone noticing. classAShardCount DOES
 * live in the manifest because it is a declared topology fact, not measured data.
 */
export const SHARD_COSTS_PATH = path.join(HERE, "class-a-shard-costs.json");

export function loadShardCosts(p = SHARD_COSTS_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** The (script, mode) identity of an execution, accepted in either shape. */
function executionScript(item) {
  return item?.gate?.script ?? item?.script;
}

/**
 * The LPT bin-pack. Pure: reads no environment variable, no clock, no
 * filesystem, and spawns nothing. Two calls with equal inputs return
 * byte-identical output.
 *
 * Returns { shardCount, shards: [[{gate, mode}, …], …], loadsMs, costed, defaulted }.
 * `shards` is 0-indexed; shard INDICES in every message and in the result rows
 * are 1-based, because that is what the workflow's env values carry.
 */
export function classAShardPlan({ manifest, costs, shardCount }) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`#3449 shard plan: ${SHARD_COUNT_FIELD} must be an integer >= 1, got ${JSON.stringify(shardCount)}`);
  }
  const defaultCostMs = costs?.defaultCostMs;
  if (!Number.isInteger(defaultCostMs) || defaultCostMs <= 0) {
    throw new Error(`#3449 shard plan: defaultCostMs must be a positive integer, got ${JSON.stringify(defaultCostMs)}`);
  }

  // R-3.2(1) — manifest order, unfiltered.
  const items = expectedExecutions(manifest, "A");

  // R-3.2(2) — a missing entry takes the committed default. This path is SAFE
  // and never an error: a missing cost cannot drop, duplicate or skip a row,
  // because every item is placed below whatever its cost is. It is also bounded
  // by measurement, not hope: a brand-new 90 s untabled gate gives a 272.6 s
  // shard and an ENTIRELY EMPTY table gives 249.4 s — both under half the 540 s
  // ceiling.
  let costed = 0;
  let defaulted = 0;
  const costOf = (item) => {
    const declared = costs?.costMs?.[executionScript(item)]?.[item.mode];
    if (declared == null) {
      defaulted += 1;
      return defaultCostMs;
    }
    // A malformed cost THROWS rather than silently corrupting the sort order.
    // issue-3449-class-a-shard-plan.mjs is the table's validity authority and
    // reports this as a named error; a throw here is the fail-closed backstop.
    if (!Number.isInteger(declared) || declared <= 0) {
      throw new Error(`#3449 shard plan: cost for ${executionScript(item)} [${item.mode}] must be a positive integer, got ${JSON.stringify(declared)}`);
    }
    costed += 1;
    return declared;
  };
  const weighted = items.map((item) => ({ item, cost: costOf(item) }));

  // R-3.2(3) — descending by cost; ties by script then mode, plain
  // lexicographic. The comparator must be a TOTAL order so the sort result is
  // identical across Node versions and across V8's sort-stability boundary.
  weighted.sort((a, b) => {
    if (a.cost !== b.cost) return b.cost - a.cost;
    const sa = executionScript(a.item);
    const sb = executionScript(b.item);
    if (sa !== sb) return sa < sb ? -1 : 1;
    if (a.item.mode !== b.item.mode) return a.item.mode < b.item.mode ? -1 : 1;
    return 0;
  });

  // R-3.2(4) — greedy: smallest current load, ties to the smallest bin index.
  const loadsMs = new Array(shardCount).fill(0);
  const membership = new Map(); // executionKey -> 0-based bin
  for (const { item, cost } of weighted) {
    let best = 0;
    for (let i = 1; i < shardCount; i += 1) if (loadsMs[i] < loadsMs[best]) best = i;
    loadsMs[best] += cost;
    membership.set(executionKey(item), best);
  }

  // R-3.2(5) — within each shard, re-emit in MANIFEST order, not LPT order. That
  // keeps each shard's artifact row order a subsequence of today's order (so
  // historical artifacts stay directly comparable) and preserves R5/R6 semantics.
  const shards = Array.from({ length: shardCount }, () => []);
  for (const item of items) shards[membership.get(executionKey(item))].push(item);

  return { shardCount, shards, loadsMs, costed, defaulted };
}

/**
 * The 1-based shard index of an execution, or a throw if the plan owns no such
 * execution. Accepts {gate:{script}, mode} or {script, mode} — the aggregator
 * reads result ROWS, which carry `script` directly. This is what lets the
 * aggregator detect SILENT REASSIGNMENT, which a count-and-set comparison alone
 * cannot see (R12 / R-5.3(f)).
 */
export function classAShardOf(item, plan) {
  const wanted = executionKey(item);
  for (let i = 0; i < plan.shards.length; i += 1) {
    for (const member of plan.shards[i]) if (executionKey(member) === wanted) return i + 1;
  }
  throw new Error(`#3449 shard plan: no shard owns ${executionScript(item)} [${item?.mode}]`);
}

/** The (script, mode) key. US (0x1f) can appear in neither field, so it is unambiguous. */
export function executionKey(item) {
  return `${executionScript(item)}${String.fromCharCode(31)}${item?.mode}`;
}

/**
 * R-3.6 — resolve the requested shard. Returns
 *   { requested: false }                         nothing set: run the WHOLE class
 *   { requested: true, index, shardCount, plan } a valid slice
 * or throws a { exitCode: 2, message } shaped error for every refusal, because
 * "I could not work out what to run" must never mean "run nothing".
 */
export function resolveShardSelection({ manifest, cls, env = process.env, costs }) {
  const raw = env?.[SHARD_ENV_VAR];
  if (typeof raw !== "string" || raw.trim() === "") return { requested: false };
  const value = raw.trim();

  // A stray variable must NEVER shard class B–E.
  if (cls !== "A") {
    const error = new Error(`ORCH-1383/#3449 run-batch: ${SHARD_ENV_VAR}=${value} is set but --class is ${cls}. Only class A is sharded; a stray shard variable must never silently run a fraction of another class.`);
    error.exitCode = 2;
    throw error;
  }

  const shardCount = manifest?.[SHARD_COUNT_FIELD];
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    // Deliberately NO default. A missing or malformed count with a shard index
    // present is exit 2, never "run everything" — a silent widening would make
    // three shards each run all 1,033 rows and hide the misconfiguration.
    const error = new Error(`ORCH-1383/#3449 run-batch: ${SHARD_ENV_VAR}=${value} is set but MANIFEST.json's ${SHARD_COUNT_FIELD} is ${JSON.stringify(shardCount)} (want an integer >= 1).`);
    error.exitCode = 2;
    throw error;
  }

  if (!/^[0-9]+$/.test(value)) {
    const error = new Error(`ORCH-1383/#3449 run-batch: ${SHARD_ENV_VAR}=${JSON.stringify(raw)} is not a plain positive integer.`);
    error.exitCode = 2;
    throw error;
  }
  const index = Number(value);
  if (index < 1 || index > shardCount) {
    const error = new Error(`ORCH-1383/#3449 run-batch: ${SHARD_ENV_VAR}=${index} is outside 1..${shardCount} (${SHARD_COUNT_FIELD}).`);
    error.exitCode = 2;
    throw error;
  }

  const plan = classAShardPlan({ manifest, costs: costs ?? loadShardCosts(), shardCount });
  return { requested: true, index, shardCount, plan };
}

/** Build the exact argv for a (gate, mode). Preserves today's invocation form (R5). */
export function buildCommand(gate, mode) {
  const selfTest = mode === "self-test";
  switch (gate.invocation) {
    case "node":
      return { cmd: "node", args: [gate.script, ...(gate.extraArgs ?? []), ...(selfTest ? ["--self-test"] : [])] };
    case "node --test":
      return { cmd: "node", args: ["--test", gate.script, ...(selfTest ? ["--self-test"] : [])] };
    case "bash":
      return { cmd: "bash", args: [gate.script, ...(gate.extraArgs ?? [])] };
    case "npm run":
      return { cmd: "npm", args: ["run", gate.script, ...(gate.extraArgs ?? [])] };
    default:
      throw new Error(`ORCH-1383 run-batch: unknown invocation "${gate.invocation}" for ${gate.script}`);
  }
}

function main() {
  const idx = process.argv.indexOf("--class");
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error("usage: node run-batch.mjs --class <A|B|C|D|E>");
    process.exit(2);
  }
  const cls = process.argv[idx + 1].toUpperCase();
  if (!CLASSES.includes(cls)) {
    console.error(`ORCH-1383 run-batch: unknown class "${cls}" (expected one of ${CLASSES.join(", ")})`);
    process.exit(2);
  }

  const manifest = loadManifest();

  // issue #3449 R10/R-3.6 — resolve the shard BEFORE anything runs. Every refusal
  // is exit 2 and runs nothing; an unset variable runs the whole class exactly as
  // before, which is the local-development path and the safe fallback for a shard
  // job whose env: was dropped (slower and duplicated, never dark).
  let selection;
  try {
    selection = resolveShardSelection({ manifest, cls });
  } catch (error) {
    console.error(error.message);
    process.exit(error.exitCode ?? 2);
  }

  const wholeClass = expectedExecutions(manifest, cls);
  const shardIndex = selection.requested ? selection.index : null;
  const expected = selection.requested ? selection.plan.shards[selection.index - 1] : wholeClass;

  console.log(`ORCH-1383 run-batch — class ${cls}${shardIndex === null ? "" : ` shard ${shardIndex}/${selection.shardCount}`}`);
  console.log(`  manifest: ${path.relative(REPO_ROOT, MANIFEST_PATH)}`);
  if (cls === "A") {
    // R-1.4 — cost-table rot is visible in the log of EVERY run, not discovered
    // at a ceiling months later. `defaulted` climbing is the signal to refresh.
    let plan = selection.requested ? selection.plan : null;
    if (plan === null) {
      try {
        plan = classAShardPlan({ manifest, costs: loadShardCosts(), shardCount: manifest[SHARD_COUNT_FIELD] });
      } catch (error) {
        console.log(`  class A shard plan: unavailable (${error.message})`);
      }
    }
    if (plan) {
      console.log(`  class A shard plan: shardCount=${plan.shardCount} shard=${shardIndex ?? "all"} costed=${plan.costed} defaulted=${plan.defaulted}`);
      console.log(`  class A shard loads (planned, s): ${plan.loadsMs.map((ms) => (ms / 1000).toFixed(1)).join(" / ")}`);
    }
  }
  if (shardIndex === null) {
    console.log(`  expected executions: ${expected.length} (from ${expectedForClass(manifest, cls).length} gates)`);
  } else {
    // R11 — `expected` is the SHARD's set from here on. Per-shard R4 is not
    // completeness on its own; the class-a-shard-completeness job (R12) is.
    console.log(`  expected executions: ${expected.length} in shard ${shardIndex} (class total ${wholeClass.length} from ${expectedForClass(manifest, cls).length} gates)`);
  }
  console.log("");

  const results = [];
  let failures = 0;
  let missing = 0;

  // R2: iterate the FULL expected set. No break, no early return, no short-circuit.
  for (const { gate, mode } of expected) {
    const started = Date.now();

    // R3: a missing script file is a FAIL, never a skip.
    if (gate.kind === "file" && !fs.existsSync(path.join(REPO_ROOT, gate.script))) {
      const durationMs = Date.now() - started;
      console.log(`FAIL  ${gate.script} [${mode}] -> exit 2  (MISSING: gate file not found on disk)`);
      console.log(`      ORCH-1383: a gate file named by MANIFEST.json does not exist. This is a hard`);
      console.log(`      failure, not a skip. Either restore the file or remove its manifest entry`);
      console.log(`      with a GATE-REMOVAL: commit token.`);
      results.push({ script: gate.script, jobKeys: gate.jobKeys, mode, exit: 2, durationMs, status: "MISSING", shard: shardIndex });
      missing++;
      failures++;
      continue;
    }

    const { cmd, args } = buildCommand(gate, mode);
    const proc = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: "utf8", env: process.env });
    const durationMs = Date.now() - started;

    // R9: passthrough. A signal-killed gate has status null -> treat as 2 (not 0/1).
    const exit = proc.status === null ? 2 : proc.status;
    const status = exit === 0 ? "PASS" : "FAIL";
    if (exit !== 0) failures++;

    // R6: one line per gate, always naming the exact script.
    console.log(`${status === "PASS" ? "ok  " : "FAIL"}  ${gate.script} [${mode}] -> exit ${exit}`);

    if (exit !== 0) {
      const label = `      [${gate.script}]`;
      const dump = (s, streamName) => {
        if (!s || !s.trim()) return;
        console.log(`${label} --- ${streamName} ---`);
        for (const line of s.trimEnd().split("\n")) console.log(`${label} ${line}`);
      };
      dump(proc.stdout, "stdout");
      dump(proc.stderr, "stderr");
      if (proc.error) console.log(`${label} spawn error: ${proc.error.message}`);
    }

    // R-3.8 — `shard` is ADDITIVE and last. Every existing key, its order, and the
    // top-level array shape are unchanged, so `jq '[.[].durationMs] | add'` and
    // every other existing reader keeps working. `null` means "this run was not
    // sharded"; a null inside a sharded aggregate is a lost env: and is exit 2
    // there (R-5.3(i)).
    results.push({ script: gate.script, jobKeys: gate.jobKeys, mode, exit, durationMs, status, shard: shardIndex });
  }

  // R7: durable, auditable results.
  const outPath = path.join(REPO_ROOT, `gate-results-${cls}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");

  // R4: the core dark-gate assertion. Green-but-incomplete must be impossible.
  const executed = results.length;
  const coverageOk = executed === expected.length;

  console.log("");
  console.log(`ORCH-1383 run-batch — class ${cls}${shardIndex === null ? "" : ` shard ${shardIndex}/${selection.shardCount}`} summary`);
  console.log(`  expected : ${expected.length}`);
  console.log(`  executed : ${executed}`);
  console.log(`  passed   : ${results.filter((r) => r.status === "PASS").length}`);
  console.log(`  failed   : ${failures}`);
  console.log(`  missing  : ${missing}`);
  console.log(`  results  : ${path.relative(REPO_ROOT, outPath)}`);

  if (!coverageOk) {
    console.error("");
    console.error(`ORCH-1383 COVERAGE SHORTFALL — executed ${executed} !== expected ${expected.length}${shardIndex === null ? "" : ` in shard ${shardIndex}`}.`);
    console.error("This fails the run REGARDLESS of every gate's verdict. A green run that skipped a");
    console.error("gate is exactly the dark-gate failure this runner exists to make impossible.");
    if (shardIndex !== null) {
      console.error("#3449 R11: this is the SHARD's shortfall. Completeness across shards is proved");
      console.error("separately by the class-a-shard-completeness job (R12) — not by this line.");
    }
  }
  if (failures) {
    console.error("");
    console.error(`ORCH-1383 — ${failures} gate execution(s) failed in class ${cls}:`);
    for (const r of results.filter((x) => x.status !== "PASS")) {
      console.error(`  ${r.status}  ${r.script} [${r.mode}] -> exit ${r.exit}`);
    }
  }

  // R8
  process.exit(coverageOk && failures === 0 ? 0 : 1);
}

// Entry-point guard. MUST use pathToFileURL: a naive `file://${process.argv[1]}`
// comparison silently fails whenever the checkout path contains characters the URL
// spec percent-encodes (e.g. the `[` `]` in the per-ORCH worktree
// `ORCH-1383-[ci-strict-grep-consolidation]`) — main() never runs, the runner
// prints nothing, and it EXITS 0. That is a green run that executed zero gates:
// the exact dark-gate lie this file exists to prevent. Observed for real during
// ORCH-1383 implementation. Do not "simplify" this back.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
