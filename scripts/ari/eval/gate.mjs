#!/usr/bin/env node
/**
 * #3355 Wave F (F1) — Ari's release gate for live evals.
 *
 *   node scripts/ari/eval/gate.mjs --run=<run json from run-live.mjs> \
 *     [--baseline=docs/contracts/ari-live-eval-baseline.json]
 *
 * Exits 1 when any suite (replay, flows, route_table) or the overall score
 * drops by 2 points or more against the stored baseline, or when a suite the
 * baseline scored is missing from the run. Exits 0 otherwise, and prints
 * every suite's before / after either way. Reads files only: no network.
 *
 * MINGLA-INVARIANT: I-ARI-EVAL-NO-REGRESSION | issue #3355 | A live Ari eval run that drops 2+ points on any suite or overall against docs/contracts/ari-live-eval-baseline.json fails the release gate.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareToBaseline } from "./replay/grade.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(
    prefix.length,
  ) ?? fallback;
}

export function runGate(baselinePath, runPath) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const run = JSON.parse(readFileSync(runPath, "utf8"));
  const verdict = compareToBaseline(baseline, run);
  const lines = Object.keys({ ...baseline.scores, ...run.scores }).map((
    suite,
  ) =>
    `${suite}: baseline ${baseline.scores?.[suite] ?? "-"} → run ${
      run.scores?.[suite] ?? "missing"
    }`
  );
  return { verdict, lines, baselineRun: baseline.run_id, runId: run.run_id };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runPath = option("run");
  if (!runPath) {
    console.error("usage: gate.mjs --run=<run.json> [--baseline=<path>]");
    process.exit(2);
  }
  const baselinePath = option(
    "baseline",
    join(ROOT, "docs/contracts/ari-live-eval-baseline.json"),
  );
  const { verdict, lines, baselineRun, runId } = runGate(baselinePath, runPath);
  console.log(`Ari eval gate: run ${runId} vs baseline ${baselineRun}`);
  for (const line of lines) console.log(`  ${line}`);
  if (!verdict.ok) {
    for (const drop of verdict.drops) {
      console.log(
        `  FAIL ${drop.suite}: ${
          drop.reason === "missing"
            ? "missing from the run"
            : `dropped ${drop.drop} points`
        }`,
      );
    }
    process.exit(1);
  }
  console.log("  PASS: no suite dropped 2 or more points");
}
