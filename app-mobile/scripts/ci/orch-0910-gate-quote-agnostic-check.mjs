#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Issue #965 happy-path regression test for the quote-agnostic ORCH-0910 gate.
 *
 * PR #173 ran a formatter over collabSaveCard.ts, flipping string-literal quotes
 * single -> double. That flip did NOT change runtime behavior (curated cards still
 * synthesize top-level image/images from stops), but it turned the strict-grep gate
 * `.github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs` RED because
 * check #4 pinned the single-quote-only literal `c.cardType === 'curated'`.
 *
 * #965 broadened those pins to be quote-agnostic (`['"]curated['"]`). This test locks
 * that fix in place WITHOUT spawning a subprocess for the assertions:
 *   1. the broadened pin MUST match the current (double-quoted) source;
 *   2. [FAILS-ON-REVERT KEY] the OLD single-quote-only pin MUST NOT match the current
 *      source — the source is double-quoted post-reformat, so only the broadened pin
 *      passes. If this assertion ever flips true, either the source drifted back to
 *      single quotes or someone narrowed the pin — both re-break the original bug.
 * Finally it spawn-runs the real gate and asserts exit 0.
 *
 * Kept a plain `node script.mjs` (NOT run under `node --test`); per issue #958 a nested
 * NODE_TEST_CONTEXT can mask a child process's non-zero exit, so we also strip it from
 * the spawned gate's env defensively.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

const collab = read("app-mobile/src/components/helpers/collabSaveCard.ts");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

// 1. Broadened quote-agnostic pin matches the current (double-quoted) source.
check(
  "quote-agnostic pin matches current collabSaveCard source",
  /c\.cardType === ['"]curated['"]/.test(collab) === true,
  "Broadened /c\\.cardType === ['\"]curated['\"]/ must match c.cardType === \"curated\".",
);

// 2. [FAILS-ON-REVERT KEY] the old single-quote-only pin must NOT match the current
//    (double-quoted) source. This is the load-bearing proof that the broadening is
//    real: if the single-quote regex matched, the reformat never happened / was
//    reverted and #965 would be a no-op.
check(
  "old single-quote-only pin does NOT match current source (load-bearing)",
  /c\.cardType === 'curated'/.test(collab) === false,
  "The single-quote-only regex matched — source is not double-quoted; broadening would be vacuous.",
);

// 3. The wired gate must pass end-to-end (exit 0).
const gateRel =
  ".github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs";
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT; // #958: never let a nested node --test mask the child exit.
const gate = spawnSync(process.execPath, [path.join(repoRoot, gateRel)], {
  cwd: repoRoot,
  env,
  encoding: "utf8",
});
check(
  "orch-0910 curated-aware gate exits 0",
  gate.status === 0,
  `Gate exited ${gate.status}.\nstdout:\n${gate.stdout ?? ""}\nstderr:\n${gate.stderr ?? ""}`,
);

console.log("\n[#965 gate quote-agnostic check]");
let ok = true;
for (const c of checks) {
  const mark = c.pass ? "PASS" : "FAIL";
  console.log(`${mark} ${c.name}`);
  if (!c.pass) {
    ok = false;
    console.log(`  ${c.detail}`);
  }
}

if (!ok) process.exit(1);
console.log(
  "\n#965 gate quote-agnostic check PASS — broadened pin matches, old pin rejected, gate green.",
);
