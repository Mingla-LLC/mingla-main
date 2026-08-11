#!/usr/bin/env node
/**
 * #426 — Run all production-readiness audit scripts.
 *
 * Usage:
 *   node scripts/audit/run-all.mjs
 *   node scripts/audit/run-all.mjs --self-test
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// `rls-coverage.mjs` was RETIRED and deleted at issue #1860 — near-vacuous
// (dump-style patterns only) and carrying an unbounded `_archive_` prefix skip,
// while reading as a real audit of RLS coverage. Its ground is now held by
// `.github/scripts/strict-grep/issue-1860-public-tables-rls-enabled.mjs` plus the
// live catalog test. Do not re-add it here; the #1860 gate's C6 rule fails if the
// file reappears at all.
const AUDITS = [
  "secrets-scan.mjs",
  "swallowed-errors.mjs",
  "n-plus-one-heuristic.mjs",
  "rls-perf-heuristic.mjs",
  "discover-scale-contract.mjs",
];

function run(script, extraArgs = []) {
  const path = join(__dirname, script);
  const args = [path, ...extraArgs];
  console.log(`\n::group::${script}`);
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  console.log("::endgroup::");
  return result.status ?? 1;
}

function main() {
  const selfTest = process.argv.includes("--self-test");
  const extra = selfTest ? ["--self-test"] : [];

  let failed = 0;
  for (const script of AUDITS) {
    const code = run(script, extra);
    if (code !== 0) failed += 1;
  }

  if (failed > 0) {
    console.error(`\nFAIL: ${failed} audit(s) failed`);
    process.exit(1);
  }
  console.log("\nPASS: all production-readiness audits");
  process.exit(0);
}

main();
