#!/usr/bin/env node
/**
 * #4389 — a store (production) build is cut only from the latest main.
 *
 * EAS uploads whatever is on disk in this checkout. Nothing stopped a build from
 * an old branch, a stale anchor `main`, or a tree with uncommitted edits. This
 * guard runs before every `build-production-*` script in app-mobile and
 * mingla-business and refuses unless:
 *   1. `git fetch origin main` succeeds (no network means no proof),
 *   2. HEAD is exactly the freshly fetched origin/main commit, and
 *   3. the whole repo is clean: no staged, unstaged or untracked files, because
 *      EAS packs the repo root, not just the app folder.
 * It prints the commit it is building so the issue's release note can name it.
 *
 * Self-test: node scripts/release/store-build-guard.cjs --self-test
 */
"use strict";

const { execFileSync } = require("node:child_process");

/** Pure: may a store build start? Returns { ok, reasons }. */
function storeBuildVerdict({ headSha, mainSha, porcelain, fetchError }) {
  const reasons = [];
  if (fetchError) reasons.push(`could not fetch origin/main (${fetchError}); a store build needs proof it is the latest main`);
  const head = String(headSha || "").trim();
  const main = String(mainSha || "").trim();
  if (!head || !main) reasons.push("could not read HEAD or origin/main");
  else if (head !== main) reasons.push(`HEAD ${head.slice(0, 10)} is not origin/main ${main.slice(0, 10)}; check out the latest main first (git switch --detach origin/main in a clean worktree)`);
  const dirty = String(porcelain || "").split("\n").filter((line) => line.trim().length > 0);
  if (dirty.length > 0) reasons.push(`the checkout has ${dirty.length} uncommitted or untracked file(s), e.g. ${dirty.slice(0, 3).map((l) => l.trim()).join(", ")}`);
  return { ok: reasons.length === 0, reasons };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function main() {
  let fetchError = null;
  try {
    git(["fetch", "--quiet", "origin", "main"]);
  } catch (error) {
    fetchError = String((error && error.message) || error).split("\n")[0];
  }
  let headSha = "";
  let mainSha = "";
  let porcelain = "";
  try {
    headSha = git(["rev-parse", "HEAD"]);
    mainSha = git(["rev-parse", "origin/main"]);
    porcelain = git(["status", "--porcelain", "--untracked-files=normal"]);
  } catch (error) {
    fetchError = fetchError || String((error && error.message) || error).split("\n")[0];
  }
  const verdict = storeBuildVerdict({ headSha, mainSha, porcelain, fetchError });
  if (!verdict.ok) {
    console.error("store-build-guard: REFUSED. A store build must come from the latest main.");
    for (const reason of verdict.reasons) console.error(`  - ${reason}`);
    process.exit(1);
  }
  console.log(`store-build-guard: building from origin/main ${headSha} — ${git(["log", "-1", "--format=%s"])}`);
}

function selfTest() {
  const assert = require("node:assert/strict");
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  assert.equal(storeBuildVerdict({ headSha: A, mainSha: A, porcelain: "" }).ok, true);
  assert.equal(storeBuildVerdict({ headSha: A, mainSha: B, porcelain: "" }).ok, false);
  assert.equal(storeBuildVerdict({ headSha: A, mainSha: A, porcelain: " M app.json\n" }).ok, false);
  assert.equal(storeBuildVerdict({ headSha: A, mainSha: A, porcelain: "?? stray.png\n" }).ok, false);
  assert.equal(storeBuildVerdict({ headSha: A, mainSha: A, porcelain: "", fetchError: "offline" }).ok, false);
  assert.equal(storeBuildVerdict({ headSha: "", mainSha: A, porcelain: "" }).ok, false);
  console.log("store-build-guard self-test: 6/6 pass");
}

module.exports = { storeBuildVerdict };

if (require.main === module) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
