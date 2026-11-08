#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — #4334 · I-4334-DECK-UNTOUCHED
 *
 * The Google move (#4334) must not change how the Explorer deck finds, serves
 * or labels cards. On a pull request this gate fails when any deck file below
 * differs from the merge base with main:
 *   - app-mobile/src/components/SwipeableCards.tsx
 *   - app-mobile/src/services/deckService.ts
 *   - app-mobile/src/utils/throttledGeocode.ts
 *   - app-mobile/src/hooks/useUserLocation.ts
 *   - supabase/functions/discover-cards/**
 *
 * It is a PR-scoped diff check (spec v2 §9): it needs a base ref. CI passes
 * one through GITHUB_BASE_REF; locally it uses origin/main. On main itself
 * (merge base = HEAD) or when no base can be resolved it prints why it is
 * skipping and passes — a missing base is said out loud, never read as a pass
 * of the diff. [TRANSITIONAL] Exit condition: delete this gate (and its
 * descriptor) once #4334's release record is complete; the R-DECK suites
 * keep guarding the deck after that.
 *
 * Exit codes: 0 pass · 1 fail · 2 git error. --self-test checks the matcher.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const DECK_PATHS = [
  /^app-mobile\/src\/components\/SwipeableCards\.tsx$/,
  /^app-mobile\/src\/services\/deckService\.ts$/,
  /^app-mobile\/src\/utils\/throttledGeocode\.ts$/,
  /^app-mobile\/src\/hooks\/useUserLocation\.ts$/,
  /^supabase\/functions\/discover-cards\//,
];

export function deckFilesTouched(changedPaths) {
  return changedPaths.filter((p) => DECK_PATHS.some((re) => re.test(p)));
}

if (process.argv.includes("--self-test")) {
  const cases = [
    [deckFilesTouched(["app-mobile/src/services/deckService.ts"]).length, 1],
    [deckFilesTouched(["supabase/functions/discover-cards/index.ts"]).length, 1],
    [deckFilesTouched(["app-mobile/src/utils/throttledGeocode.ts", "x.ts"]).length, 1],
    [deckFilesTouched(["app-mobile/src/services/geocodingService.ts"]).length, 0],
    [deckFilesTouched(["supabase/functions/discover-cards-v2/index.ts"]).length, 0],
    [deckFilesTouched(["app-mobile/src/components/SwipeableCards.test.tsx"]).length, 0],
  ];
  const bad = cases.filter(([got, want]) => got !== want);
  if (bad.length) {
    console.error(`SELF-TEST FAIL: I-4334-DECK-UNTOUCHED matcher (${bad.length} case(s))`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-4334-DECK-UNTOUCHED matcher behaves");
  process.exit(0);
}

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";
let mergeBase;
try {
  mergeBase = git(["merge-base", "HEAD", baseRef]);
} catch {
  console.log(`SKIP [I-4334-DECK-UNTOUCHED] no merge base with ${baseRef} in this checkout; the PR-scoped diff did not run`);
  process.exit(0);
}
let head;
try {
  head = git(["rev-parse", "HEAD"]);
} catch (error) {
  console.error(`ERROR [I-4334-DECK-UNTOUCHED] git rev-parse failed: ${error.message}`);
  process.exit(2);
}
if (mergeBase === head) {
  console.log(`SKIP [I-4334-DECK-UNTOUCHED] HEAD is the merge base with ${baseRef}; nothing to diff`);
  process.exit(0);
}

let changed;
try {
  changed = git(["diff", "--name-only", mergeBase, "--"]).split("\n").filter(Boolean);
} catch (error) {
  console.error(`ERROR [I-4334-DECK-UNTOUCHED] git diff failed: ${error.message}`);
  process.exit(2);
}
const touched = deckFilesTouched(changed);
if (touched.length) {
  for (const p of touched) console.error(`FAIL [I-4334-DECK-UNTOUCHED] ${p} changed versus ${mergeBase.slice(0, 10)}`);
  process.exit(1);
}
console.log(`OK   [I-4334-DECK-UNTOUCHED] deck files unchanged versus ${mergeBase.slice(0, 10)} (${changed.length} changed files checked)`);
