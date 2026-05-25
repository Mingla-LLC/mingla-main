#!/usr/bin/env node
/**
 * Pragmatic Append-Only Test Files gate — codified by ORCH-0840
 * [Regression-test enforcement + append-only CI].
 *
 * Diffs test files between the current HEAD and a base ref. Rules:
 *   - Added test files (status A)              → ALLOWED.
 *   - Deleted test files (status D)            → FAIL, no override.
 *   - Renamed test files (status R*)           → FAIL unless latest commit
 *                                                body contains override token
 *                                                [TEST-RENAME-APPROVED ORCH-####].
 *   - Modified test files (status M):
 *       - zero deleted lines (additions only)  → ALLOWED.
 *       - any deleted line                     → FAIL unless latest commit
 *                                                body contains override token
 *                                                [TEST-MOD-APPROVED ORCH-####].
 *
 * The "latest commit body" is the commit at HEAD (i.e., the top commit of the
 * PR branch). Override tokens MUST cite a 4-digit ORCH-#### (optionally with
 * -<letter> suffix) so any approved test mutation is traceable to a follow-up
 * ORCH that explains why the prior assertion was wrong.
 *
 * Scope of test files:
 *   - **\/*.test.* (any extension — ts, tsx, js, mjs, py)
 *   - **\/*.spec.*
 *   - **\/__tests__\/** (any file under any __tests__ dir)
 *
 * Base ref resolution:
 *   - In GitHub Actions PR runs:   refs/remotes/origin/<base-branch>
 *   - In GitHub Actions push runs: HEAD~1 (single commit comparison)
 *   - Locally:                     origin/main (best effort)
 *
 * Override token grammar (case-sensitive, must appear verbatim somewhere in
 * the commit body — title or full body, both are checked):
 *   [TEST-MOD-APPROVED ORCH-NNNN]
 *   [TEST-MOD-APPROVED ORCH-NNNN-A]
 *   [TEST-RENAME-APPROVED ORCH-NNNN]
 * The ORCH cited must also have a bracketed feature/bug label somewhere in
 * the commit body (Rule 0 — ORCH citation rule), e.g.:
 *   [TEST-MOD-APPROVED ORCH-0840]
 *   ORCH-0840 [Regression-test enforcement + append-only CI]
 *
 * Exit codes:
 *   0 — append-only rules satisfied.
 *   1 — at least one violation. Output explains each one.
 *   2 — script error (cannot resolve base ref, git command failed unexpectedly).
 *
 * Established by ORCH-0840 [Regression-test enforcement + append-only CI] —
 * 2026-05-14. See `Mingla_Artifacts/specs/SPEC_ORCH-0840_*.md` (if present)
 * and the dispatch prompt at `outputs/ORCH-0840_implementor_prompt.md`.
 */

const { execSync } = require("node:child_process");

const TEST_FILE_PATTERNS = [
  /\.test\.[A-Za-z0-9]+$/,
  /\.spec\.[A-Za-z0-9]+$/,
  /(^|\/)__tests__\//,
];

const MOD_TOKEN = /\[TEST-MOD-APPROVED (?:META-)?ORCH-\d{4}(?:-[A-Z])?\]/;
const RENAME_TOKEN = /\[TEST-RENAME-APPROVED ORCH-\d{4}(?:-[A-Z])?\]/;

function isTestPath(path) {
  return TEST_FILE_PATTERNS.some((re) => re.test(path));
}

function runGit(args, opts = {}) {
  try {
    return execSync(`git ${args}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : "";
    const stdout = err.stdout ? err.stdout.toString() : "";
    throw new Error(
      `git ${args} failed (exit ${err.status}):\n  stderr: ${stderr.trim()}\n  stdout: ${stdout.trim()}`,
    );
  }
}

function resolveBaseRef() {
  if (process.env.GITHUB_BASE_REF) {
    const candidate = `origin/${process.env.GITHUB_BASE_REF}`;
    try {
      runGit(`rev-parse --verify ${candidate}`);
      return candidate;
    } catch {
      // fall through
    }
  }
  if (process.env.GITHUB_EVENT_NAME === "push") {
    try {
      runGit("rev-parse --verify HEAD~1");
      return "HEAD~1";
    } catch {
      // single-commit branch (HEAD~1 doesn't exist) — nothing to check
      return null;
    }
  }
  for (const candidate of ["origin/main", "main", "HEAD~1"]) {
    try {
      runGit(`rev-parse --verify ${candidate}`);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    "Could not resolve a base ref. Tried GITHUB_BASE_REF, HEAD~1, origin/main, main.",
  );
}

function listChangedTestFiles(baseRef) {
  // git diff --name-status detects renames as R<score> oldPath\tnewPath
  const raw = runGit(
    `diff --name-status --find-renames ${baseRef}...HEAD --`,
  );
  const lines = raw.split("\n").filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const parts = line.split("\t");
    const status = parts[0];
    if (status.startsWith("R")) {
      const [, oldPath, newPath] = parts;
      if (isTestPath(oldPath) || isTestPath(newPath)) {
        entries.push({ status: "R", oldPath, path: newPath });
      }
    } else {
      const [, path] = parts;
      if (isTestPath(path)) {
        entries.push({ status, path });
      }
    }
  }
  return entries;
}

function countDeletedLines(baseRef, path) {
  const diff = runGit(
    `diff --unified=0 ${baseRef}...HEAD -- "${path}"`,
  );
  let deleted = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("---")) continue; // file header
    if (line.startsWith("-")) deleted += 1;
  }
  return deleted;
}

function latestCommitBody() {
  const subject = runGit("log -1 --pretty=%s").trim();
  const body = runGit("log -1 --pretty=%B").trim();
  return `${subject}\n${body}`;
}

function main() {
  let baseRef;
  try {
    baseRef = resolveBaseRef();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(2);
  }

  if (!baseRef) {
    console.log(
      "ℹ️  No base ref available (single-commit push). Append-only check skipped.",
    );
    process.exit(0);
  }

  console.log(`Append-only test check — diffing against ${baseRef}`);

  let entries;
  try {
    entries = listChangedTestFiles(baseRef);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(2);
  }

  if (entries.length === 0) {
    console.log("✅ No test files changed. Append-only check: clean.");
    process.exit(0);
  }

  const commitBody = latestCommitBody();
  const hasModToken = MOD_TOKEN.test(commitBody);
  const hasRenameToken = RENAME_TOKEN.test(commitBody);

  let failures = 0;
  let passes = 0;

  for (const entry of entries) {
    if (entry.status === "A") {
      console.log(`✅ ADDED      ${entry.path}`);
      passes += 1;
      continue;
    }
    if (entry.status === "D") {
      console.log(
        `❌ DELETED    ${entry.path} — test file deletion is forbidden under the Pragmatic Append-Only policy (ORCH-0840 [Regression-test enforcement + append-only CI]). No override token bypasses deletion.`,
      );
      failures += 1;
      continue;
    }
    if (entry.status === "R") {
      if (hasRenameToken) {
        console.log(
          `✅ RENAMED    ${entry.oldPath} → ${entry.path} (override token [TEST-RENAME-APPROVED ORCH-####] present in commit body)`,
        );
        passes += 1;
      } else {
        console.log(
          `❌ RENAMED    ${entry.oldPath} → ${entry.path} — test file rename requires override token [TEST-RENAME-APPROVED ORCH-NNNN] in the latest commit body. None found.`,
        );
        failures += 1;
      }
      continue;
    }
    if (entry.status === "M") {
      let deleted;
      try {
        deleted = countDeletedLines(baseRef, entry.path);
      } catch (err) {
        console.error(
          `❌ MODIFIED  ${entry.path} — could not compute diff: ${err.message}`,
        );
        failures += 1;
        continue;
      }
      if (deleted === 0) {
        console.log(
          `✅ MODIFIED  ${entry.path} (additions only, 0 deleted lines)`,
        );
        passes += 1;
      } else if (hasModToken) {
        console.log(
          `✅ MODIFIED  ${entry.path} (${deleted} deleted lines; override token [TEST-MOD-APPROVED ORCH-####] present in commit body)`,
        );
        passes += 1;
      } else {
        console.log(
          `❌ MODIFIED  ${entry.path} — ${deleted} deleted lines detected. Test file modifications with deletions require override token [TEST-MOD-APPROVED ORCH-NNNN] in the latest commit body. None found. Either restore the deleted lines (additions are always allowed), or open a follow-up ORCH and cite it as [TEST-MOD-APPROVED ORCH-NNNN] in the commit body explaining why the prior assertion was wrong.`,
        );
        failures += 1;
      }
      continue;
    }
    console.log(
      `ℹ️  ${entry.status.padEnd(10)} ${entry.path} (unhandled status — treating as pass)`,
    );
    passes += 1;
  }

  console.log("");
  console.log(`Append-only check: ${passes} passed, ${failures} failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

function selfTest() {
  const cases = [
    { input: "[TEST-MOD-APPROVED ORCH-0840]", expect: true, label: "bare ORCH" },
    { input: "[TEST-MOD-APPROVED ORCH-0840-A]", expect: true, label: "ORCH with suffix" },
    { input: "[TEST-MOD-APPROVED META-ORCH-0952]", expect: true, label: "META-ORCH (ORCH-0959)" },
    { input: "[TEST-MOD-APPROVED META-ORCH-0001-A]", expect: true, label: "META-ORCH with suffix (ORCH-0959)" },
    { input: "[TEST-MOD-APPROVED FOO-0001]", expect: false, label: "wrong prefix" },
    { input: "TEST-MOD-APPROVED ORCH-0840", expect: false, label: "missing brackets" },
  ];
  let failures = 0;
  for (const c of cases) {
    const got = MOD_TOKEN.test(c.input);
    const ok = got === c.expect;
    console.log(`${ok ? "✅" : "❌"} ${c.label}: input=${JSON.stringify(c.input)} got=${got} expected=${c.expect}`);
    if (!ok) failures += 1;
  }
  console.log("");
  console.log(`Self-test: ${cases.length - failures} passed, ${failures} failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  main();
}
