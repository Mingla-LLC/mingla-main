#!/usr/bin/env node
/**
 * Post-merge baseline ratchet (issue #1509).
 *
 * Re-measures the boot payload on `main` and rewrites bundle-baseline.json to
 * match. Driven by .github/workflows/bundle-baseline-ratchet.yml, which opens a
 * pull request whenever this script reports a change.
 *
 * WHAT THE BASELINE IS: a measurement of main, not a permission. It is allowed
 * to move in both directions, because its only job is to be TRUE — it is what
 * the per-PR delta gate subtracts from.
 *
 * WHAT ACTUALLY CONSTRAINS GROWTH is the other two numbers in
 * orch-1083-initial-bundle-budget.mjs, and neither is touched here:
 *   - PR_DELTA_ALLOWANCE caps how much any ONE pull request may add.
 *   - HARD_CEILING is the product limit, and only Seth moves it.
 *
 * So the failure mode this ends is not "the baseline changed" — it is "a human
 * hand-edited the limit to make their own PR pass". A machine writes this file
 * from a measurement; nobody has to argue with a number to land their work; and
 * a reduction is captured permanently instead of being quietly re-spent by the
 * next branch that happens to need the room.
 *
 * Usage:
 *   node scripts/ci/bundle-baseline-update.mjs --check   # exit 0 = current, 2 = needs update
 *   node scripts/ci/bundle-baseline-update.mjs --write   # rewrite the file
 *
 * Env: ORCH_1083_WEB_BUILD (export dir), BASELINE_COMMIT (sha to stamp).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";
import { measureWebBuild, fmtTriple, fmtDelta } from "./bundle-budget-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, "bundle-baseline.json");
const WEB_BUILD = process.env.ORCH_1083_WEB_BUILD ?? "web-build";

// Movements smaller than this are measurement noise (the known macOS/Linux
// variance is ~150 B) and are not worth a pull request.
const NOISE_FLOOR = 2_048;

const mode = process.argv.includes("--write") ? "write" : "check";

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const measured = measureWebBuild(WEB_BUILD);

const next = {
  common: measured.common ?? baseline.common,
  eager: measured.eager,
};

const moves = [];
for (const scope of ["common", "eager"]) {
  const delta = next[scope].raw - baseline[scope].raw;
  if (Math.abs(delta) >= NOISE_FLOOR) {
    moves.push({ scope, delta });
  }
}

console.log("baseline ratchet");
console.log("─".repeat(78));
for (const scope of ["common", "eager"]) {
  console.log(`  ${scope}`);
  console.log(`    recorded   ${fmtTriple(baseline[scope])}`);
  console.log(`    measured   ${fmtTriple(next[scope])}`);
  console.log(`    delta      raw ${fmtDelta(next[scope].raw - baseline[scope].raw)}`);
}
console.log("─".repeat(78));

if (moves.length === 0) {
  console.log(`baseline is current (no scope moved by >= ${NOISE_FLOOR} B).`);
  process.exit(0);
}

const direction = moves.every((m) => m.delta < 0)
  ? "reduction"
  : moves.every((m) => m.delta > 0)
    ? "growth"
    : "mixed";
const summary = moves
  .map((m) => `${m.scope} ${fmtDelta(m.delta)} B`)
  .join(", ");

console.log(`baseline is STALE — ${direction}: ${summary}`);

if (mode === "check") {
  // Surface machine-readable facts for the workflow that decides whether to
  // open a PR and what to title it.
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    writeFileSync(
      out,
      `stale=true\ndirection=${direction}\nsummary=${summary}\n` +
        `common_raw=${next.common.raw}\ncommon_brotli=${next.common.brotli}\n` +
        `eager_raw=${next.eager.raw}\neager_brotli=${next.eager.brotli}\n`,
      { flag: "a" },
    );
  }
  process.exit(2);
}

const updated = {
  ...baseline,
  measuredOn: {
    commit: process.env.BASELINE_COMMIT ?? "unknown",
    date: new Date().toISOString().slice(0, 10),
    platform: platform(),
    note:
      `Written by scripts/ci/bundle-baseline-update.mjs from a measured export of main. ` +
      `Previous: common ${baseline.common.raw} B, eager ${baseline.eager.raw} B (${direction}: ${summary}). ` +
      `Do not hand-edit — see the header of orch-1083-initial-bundle-budget.mjs.`,
  },
  common: next.common,
  eager: next.eager,
};

writeFileSync(BASELINE_PATH, `${JSON.stringify(updated, null, 2)}\n`);
console.log(`wrote ${BASELINE_PATH}`);
