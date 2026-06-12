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

const AUDITS = [
  "rls-coverage.mjs",
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
