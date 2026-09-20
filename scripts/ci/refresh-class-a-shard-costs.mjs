#!/usr/bin/env node
/**
 * issue #3449 — refresh the committed Class A shard cost table.
 *
 * WHY THIS TOOL EXISTS. Class A's shard membership is a longest-processing-time
 * bin-pack over measured per-execution costs. The class is wildly skewed — one
 * execution is 18% of the whole class while ~800 executions together are 6% — so
 * a count-based split would leave one shard roughly twice as slow as another.
 * Costs therefore have to be measured, and measurement decays as the corpus
 * changes. This is the reviewed way to refresh them.
 *
 * IT IS NOT INVOKED BY CI, and that is deliberate: an automatic refresh would
 * rebalance the plan without review, and a rebalance is exactly the kind of change
 * that should be visible in a diff. Rot is instead made visible in the log of
 * every single run — run-batch.mjs prints `costed=<k> defaulted=<m>` on each Class
 * A run — and bounded by measurement: an ENTIRELY EMPTY table still gives a worst
 * shard of 249.4 s against a 540 s ceiling.
 *
 * IT LIVES UNDER scripts/ci/ rather than .github/scripts/strict-grep/ on purpose.
 * meta-1383-manifest-parity.mjs's P1 sweeps every .mjs under the strict-grep
 * directory and demands a manifest row for each; P11 sweeps the declared
 * externalGateDirs, which are app-mobile/scripts/ci and scripts/ota, not this
 * directory. An operator tool that is not a gate should not be registered as one.
 * scripts/ci/main-health.mjs is the working precedent.
 *
 * USAGE
 *   for r in <run ids>; do
 *     gh run download "$r" -n gate-results-A-aggregate -D /tmp/costs/"$r"
 *   done
 *   node scripts/ci/refresh-class-a-shard-costs.mjs --results /tmp/costs [--top 50]
 *   # review the printed diff and the projected shard loads, then:
 *   node scripts/ci/refresh-class-a-shard-costs.mjs --results /tmp/costs --write
 *
 * Without --write it prints the key-by-key diff, the resulting planned shard
 * loads, and the worst imbalance the new table would produce, so a refresh is
 * REVIEWED before it is committed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHARD_COSTS_PATH,
  SHARD_COUNT_FIELD,
  classAShardPlan,
  executionKey,
  loadManifest,
} from "../../.github/scripts/strict-grep/run-batch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../..");

/**
 * Three samples is a FLOOR, not a preference. Single-run row timings vary by
 * about ±1.2 s on shared runners, and the #3449 sample contained two runs that
 * executed 16% and 27% faster than the rest with every row scaling
 * proportionally. A two-sample median is one of those two numbers.
 */
export const MINIMUM_SAMPLES = 3;
export const DEFAULT_TOP = 50;
export const DEFAULT_COST_MS = 100;

/** Median, not mean: one 27%-fast run must not drag every cost down. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) throw new Error("#3449 refresh: median of an empty sample");
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * Every *.json under `dir` (recursively) that parses as an array of rows carrying
 * {script, mode, durationMs}. Recursive because `gh run download -D <dir>/<run>`
 * nests one directory per run.
 */
export function collectSamples(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
    }
  };
  walk(dir);

  const samples = [];
  const skipped = [];
  for (const file of files.sort()) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      skipped.push(`${file}: unparseable (${error.message})`);
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      skipped.push(`${file}: not a non-empty result array`);
      continue;
    }
    const usable = parsed.every((row) => typeof row?.script === "string" && typeof row?.mode === "string"
      && Number.isFinite(row?.durationMs));
    if (!usable) {
      skipped.push(`${file}: rows must carry script, mode and a numeric durationMs`);
      continue;
    }
    samples.push({ file, rows: parsed });
  }
  return { samples, skipped };
}

/**
 * The top-`top` executions by median duration, as the nested
 * script -> mode -> ms shape the committed table uses. Nested, never a joined
 * composite key: it is diff-readable and cannot encode a separator ambiguity.
 */
export function buildCostTable({ samples, top = DEFAULT_TOP, defaultCostMs = DEFAULT_COST_MS, measuredOn, runIds }) {
  if (samples.length < MINIMUM_SAMPLES) {
    const error = new Error(`#3449 refresh: ${samples.length} usable sample(s); at least ${MINIMUM_SAMPLES} are required because single-run row timings vary by about ±1.2 s on shared runners.`);
    error.exitCode = 2;
    throw error;
  }

  const durations = new Map(); // "script\x1fmode" -> [ms]
  const identity = new Map(); // key -> {script, mode}
  for (const sample of samples) {
    for (const row of sample.rows) {
      const key = executionKey(row);
      if (!durations.has(key)) {
        durations.set(key, []);
        identity.set(key, { script: row.script, mode: row.mode });
      }
      durations.get(key).push(row.durationMs);
    }
  }

  const medians = [...durations].map(([key, values]) => [key, median(values)]);
  medians.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const kept = medians.slice(0, top);

  const costMs = {};
  for (const [key, ms] of kept) {
    const { script, mode } = identity.get(key);
    costMs[script] ??= {};
    costMs[script][mode] = Math.max(1, Math.round(ms));
  }
  // Sorted so a refresh produces a stable, reviewable diff rather than a reshuffle.
  const sortedCostMs = {};
  for (const script of Object.keys(costMs).sort()) {
    sortedCostMs[script] = {};
    for (const mode of Object.keys(costMs[script]).sort()) sortedCostMs[script][mode] = costMs[script][mode];
  }

  return {
    source: {
      measuredOn,
      runIds,
      sampleRuns: samples.length,
      statistic: "median",
      classAExecutions: durations.size,
      topK: top,
    },
    defaultCostMs,
    costMs: sortedCostMs,
  };
}

export function flattenCostMs(costMs) {
  const out = new Map();
  for (const [script, modes] of Object.entries(costMs ?? {})) {
    for (const [mode, ms] of Object.entries(modes ?? {})) out.set(executionKey({ script, mode }), ms);
  }
  return out;
}

const HEADER = [
  "issue #3449 — measured Class A per-execution costs. INPUT to the shard plan, not a gate.",
  "GENERATED by scripts/ci/refresh-class-a-shard-costs.mjs; hand edits are legal but pointless.",
  "Refresh recipe (operator-run, never CI): download three or more gate-results-A-aggregate",
  "artifacts, one directory each, then run the tool WITHOUT --write to review the diff and the",
  "projected shard loads, and again with --write to commit. It refuses fewer than three samples.",
  "A missing entry is costed at defaultCostMs and still runs exactly once — the plan places every",
  "execution whatever its cost, so cost rot can never drop, duplicate or skip a row. It is bounded",
  "by measurement: a 90 s untabled gate gives a 272.6 s shard and an EMPTY costMs gives 249.4 s,",
  "both under half the 540 s readiness ceiling. Rot is visible in every run's log as `defaulted=<m>`.",
  "This is NOT a field of MANIFEST.json: that file is GENERATED by YAML-parsing the workflows, and a",
  "regeneration would silently wipe these measurements and rebalance the plan with nobody noticing.",
];

function usage() {
  console.error("usage: node scripts/ci/refresh-class-a-shard-costs.mjs --results <dir> [--top 50] [--write]");
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function main() {
  const dir = arg("--results");
  if (!dir) {
    usage();
    process.exit(2);
  }
  const top = Number(arg("--top", String(DEFAULT_TOP)));
  if (!Number.isInteger(top) || top < 1) {
    console.error(`#3449 refresh: --top must be a positive integer, got ${JSON.stringify(arg("--top"))}`);
    process.exit(2);
  }
  const write = process.argv.includes("--write");

  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error(`#3449 refresh: --results ${resolved} is not a directory`);
    process.exit(2);
  }

  const { samples, skipped } = collectSamples(resolved);
  for (const note of skipped) console.error(`  skipped ${note}`);

  const existing = fs.existsSync(SHARD_COSTS_PATH) ? JSON.parse(fs.readFileSync(SHARD_COSTS_PATH, "utf8")) : null;
  let built;
  try {
    built = buildCostTable({
      samples,
      top,
      defaultCostMs: existing?.defaultCostMs ?? DEFAULT_COST_MS,
      measuredOn: new Date().toISOString().slice(0, 10),
      runIds: samples.map((sample) => path.basename(path.dirname(sample.file))),
    });
  } catch (error) {
    console.error(error.message);
    process.exit(error.exitCode ?? 1);
  }

  console.log(`#3449 refresh — ${samples.length} sample(s), ${built.source.classAExecutions} distinct executions, keeping top ${top} by median.`);

  const before = flattenCostMs(existing?.costMs);
  const after = flattenCostMs(built.costMs);
  const pretty = (key) => key.replace(String.fromCharCode(31), " [") + "]";
  const changes = [];
  for (const [key, ms] of after) {
    if (!before.has(key)) changes.push(`  + ${pretty(key)} ${ms} ms`);
    else if (before.get(key) !== ms) changes.push(`  ~ ${pretty(key)} ${before.get(key)} -> ${ms} ms`);
  }
  for (const key of before.keys()) if (!after.has(key)) changes.push(`  - ${pretty(key)} (dropped out of the top ${top})`);
  console.log(changes.length ? `key diff (${changes.length}):` : "key diff: none");
  for (const line of changes.sort()) console.log(line);

  const manifest = loadManifest();
  const shardCount = manifest[SHARD_COUNT_FIELD];
  try {
    const plan = classAShardPlan({ manifest, costs: built, shardCount });
    console.log(`planned loads (s): ${plan.loadsMs.map((ms) => (ms / 1000).toFixed(1)).join(" / ")}`);
    console.log(`planned counts   : ${plan.shards.map((shard) => shard.length).join(" / ")}`);
    console.log(`costed ${plan.costed} / defaulted ${plan.defaulted}`);
    // Worst imbalance the new table would produce, evaluated against each sample's
    // OWN row timings — projection against the table it was built from is circular.
    let worst = 0;
    let worstFile = "";
    for (const sample of samples) {
      const actual = new Map(sample.rows.map((row) => [executionKey(row), row.durationMs]));
      const loads = plan.shards.map((shard) => shard.reduce((sum, item) => sum + (actual.get(executionKey(item)) ?? 0), 0) / 1000);
      const ideal = sample.rows.reduce((sum, row) => sum + row.durationMs, 0) / 1000 / shardCount;
      const imbalance = (Math.max(...loads) - ideal) / ideal * 100;
      if (imbalance > worst) {
        worst = imbalance;
        worstFile = sample.file;
      }
    }
    console.log(`worst out-of-sample imbalance: ${worst.toFixed(1)}% (${worstFile})`);
  } catch (error) {
    console.error(`#3449 refresh: could not project shard loads — ${error.message}`);
    process.exit(1);
  }

  if (!write) {
    console.log("");
    console.log("DRY RUN — nothing written. Re-run with --write once the diff above is reviewed.");
    return;
  }

  const document = { $comment: HEADER, ...built };
  fs.writeFileSync(SHARD_COSTS_PATH, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`wrote ${path.relative(REPO_ROOT, SHARD_COSTS_PATH)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
