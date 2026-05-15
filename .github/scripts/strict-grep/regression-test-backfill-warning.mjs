#!/usr/bin/env node
/**
 * I-REGRESSION-TEST-BACKFILL-WARN — opportunistic-backfill warning gate.
 *
 * Codified by ORCH-0840 [Regression-test enforcement + append-only CI].
 *
 * For every MODIFIED (not newly added) source file in the PR diff under the
 * scoped product-code directories, check whether a sibling test file exists.
 * If not, append the path to a WARNING list. Print the list to stdout. ALWAYS
 * exits 0 — this is a warning-only gate, never blocks the build.
 *
 * Drives the operator-approved "Forward + opportunistic backfill" rollout:
 * touching legacy untested code surfaces the gap so it can be backfilled
 * incrementally without forcing a big-bang backfill.
 *
 * Scope (modified files only — additions are exempt because newly-added
 * code should be paired with a test under ORCH-0840 Step 0.5; this gate
 * catches the MODIFY-without-test case):
 *   - app-mobile/src/**
 *   - mingla-business/src/**
 *   - mingla-admin/src/**
 *   - supabase/functions/<name>/**  (excluding test files themselves)
 *   - packages/**\/src/**
 *
 * Test file detection (sibling-search heuristic):
 *   For a source file at <dir>/<base>.<ext>, a sibling test exists if ANY of:
 *     - <dir>/<base>.test.<ext>
 *     - <dir>/<base>.spec.<ext>
 *     - <dir>/__tests__/<base>.test.<ext>
 *     - <dir>/__tests__/<base>.test.<*>
 *     - For supabase/functions/<name>/*: any <name>/*.test.ts
 *
 * Exit codes:
 *   0 — always. This is warning-only.
 *
 * Established by ORCH-0840 [Regression-test enforcement + append-only CI] —
 * 2026-05-14. Strict-grep registry pattern per DEC-101 D-17b-5.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, basename, extname, join } from "node:path";

const SCOPED_PREFIXES = [
  "app-mobile/src/",
  "mingla-business/src/",
  "mingla-admin/src/",
  "supabase/functions/",
  "packages/",
];

const TEST_FILE_PATTERNS = [
  /\.test\.[A-Za-z0-9]+$/,
  /\.spec\.[A-Za-z0-9]+$/,
  /(^|\/)__tests__\//,
];

function isTestFile(path) {
  return TEST_FILE_PATTERNS.some((re) => re.test(path));
}

function isInScope(path) {
  if (isTestFile(path)) return false;
  return SCOPED_PREFIXES.some((p) => path.startsWith(p));
}

function runGit(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8" });
  } catch (err) {
    // be defensive — warning gate should never crash the workflow
    return "";
  }
}

function resolveBaseRef() {
  if (process.env.GITHUB_BASE_REF) {
    const candidate = `origin/${process.env.GITHUB_BASE_REF}`;
    if (runGit(`rev-parse --verify ${candidate}`).trim()) return candidate;
  }
  for (const c of ["origin/main", "main", "HEAD~1"]) {
    if (runGit(`rev-parse --verify ${c}`).trim()) return c;
  }
  return null;
}

function listModifiedFiles(baseRef) {
  const raw = runGit(`diff --name-status ${baseRef}...HEAD --`);
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0];
    const path = parts[parts.length - 1];
    if (status === "M" && isInScope(path)) out.push(path);
  }
  return out;
}

function siblingTestExists(srcPath) {
  const ext = extname(srcPath);
  const base = basename(srcPath, ext);
  const dir = dirname(srcPath);

  const candidateExts = [ext, ".ts", ".tsx", ".js", ".jsx", ".mjs"];

  for (const e of candidateExts) {
    if (existsSync(join(dir, `${base}.test${e}`))) return true;
    if (existsSync(join(dir, `${base}.spec${e}`))) return true;
    if (existsSync(join(dir, "__tests__", `${base}.test${e}`))) return true;
    if (existsSync(join(dir, "__tests__", `${base}.spec${e}`))) return true;
  }

  // supabase/functions/<name>/<file>.ts — any *.test.ts under the function dir counts
  if (srcPath.startsWith("supabase/functions/")) {
    const parts = srcPath.split("/");
    if (parts.length >= 3) {
      const fnDir = parts.slice(0, 3).join("/"); // supabase/functions/<name>
      const indexTest = join(fnDir, "index.test.ts");
      if (existsSync(indexTest)) return true;
      // any sibling test file in fnDir
      try {
        const out = runGit(`ls-tree -r --name-only HEAD ${fnDir}`);
        for (const line of out.split("\n")) {
          if (line.trim().match(/\.test\.[A-Za-z0-9]+$/)) return true;
        }
      } catch {
        // ignore
      }
    }
  }

  return false;
}

function main() {
  const baseRef = resolveBaseRef();
  if (!baseRef) {
    console.log(
      "ℹ️  No base ref available. Backfill-warning gate has nothing to check.",
    );
    process.exit(0);
  }

  console.log(
    `Regression-test backfill warning — scanning modified files vs ${baseRef}`,
  );

  const modified = listModifiedFiles(baseRef);
  if (modified.length === 0) {
    console.log("✅ No in-scope source files were modified.");
    process.exit(0);
  }

  const untested = [];
  for (const path of modified) {
    if (!siblingTestExists(path)) untested.push(path);
  }

  if (untested.length === 0) {
    console.log(
      `✅ All ${modified.length} modified source files have a sibling test.`,
    );
    process.exit(0);
  }

  console.log("");
  console.log(
    `⚠️  WARNING (informational) — ${untested.length} of ${modified.length} modified source files have NO sibling regression test:`,
  );
  for (const p of untested) {
    console.log(`   - ${p}`);
  }
  console.log("");
  console.log(
    "Per ORCH-0840 [Regression-test enforcement + append-only CI] Forward + Opportunistic Backfill policy:",
  );
  console.log(
    "  - This is INFORMATIONAL only. The build does NOT fail.",
  );
  console.log(
    "  - If you touched a legacy untested file, consider adding a regression test in this PR.",
  );
  console.log(
    "  - Otherwise the file stays grandfathered until the next time it is touched.",
  );

  // Warning-only — always exit 0.
  process.exit(0);
}

main();
