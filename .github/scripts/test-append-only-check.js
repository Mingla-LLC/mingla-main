#!/usr/bin/env node
/**
 * Pragmatic Append-Only Test Files gate — codified by ORCH-0840
 * [Regression-test enforcement + append-only CI].
 *
 * Diffs test files across the whole PR range (three-dot merge-base..HEAD) and,
 * for each changed test file, attributes the override token PER FILE across that
 * same range. Rules:
 *   - Added test files (status A)              → ALLOWED.
 *   - Deleted test files (status D)            → FAIL, no override (absolute).
 *   - Renamed test files (status R*)           → FAIL unless a commit in the PR
 *                                                range that renames THIS file
 *                                                carries the override token
 *                                                [TEST-RENAME-APPROVED ORCH-####].
 *   - Modified test files (status M):
 *       - zero deleted lines (additions only)  → ALLOWED.
 *       - any deleted line                     → FAIL unless a commit in the PR
 *                                                range that modifies THIS file
 *                                                carries the override token
 *                                                [TEST-MOD-APPROVED ORCH-####].
 *
 * Per-file, whole-range attribution (#1058): the diff spans the whole PR range,
 * so the token is honored wherever its commit sits in that range — NOT only on
 * the tip (`git log -1`). A token authorizes ONLY the test file(s) touched by the
 * commit that carries it — never the whole branch. This kills two real bugs the
 * previous tip-only global-boolean scan produced:
 *   F-1 (false-red)   — a later (even docs-only) commit shifted the token off the
 *                       tip and re-red an already-approved change.
 *   F-2 (false-green) — one global boolean let a tip token sanctioning `a.test.ts`
 *                       also wave through UNSANCTIONED assertion-gutting in an
 *                       unrelated `b.test.ts` from an earlier commit. This gate is
 *                       the SOLE guard for ordinary test-file integrity.
 * See `fileHasToken` for the mechanism and the accepted, bounded residual.
 *
 * Override tokens MUST cite an ORCH-#### (four or more digits, optional META-
 * prefix, optional -<letter> suffix) so any approved test mutation is traceable to
 * a follow-up ORCH that explains why the prior assertion was wrong.
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
 * Override token grammar (case-sensitive, must appear verbatim in the body —
 * subject or full body — of a PR-range commit that touches the file):
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
 * 2026-05-14. Per-file whole-range token attribution + a git-scenario self-test
 * wired into CI added by issue #1058 (2026-07-21).
 */

const { execSync, execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const nodePath = require("node:path");

const TEST_FILE_PATTERNS = [
  /\.test\.[A-Za-z0-9]+$/,
  /\.spec\.[A-Za-z0-9]+$/,
  /(^|\/)__tests__\//,
];

// #1058 (F-3 robustness): \d{4,} (not \d{4}) — issue ids will eventually exceed 4
// digits; RENAME_TOKEN now carries the same (?:META-)? alternation as MOD_TOKEN.
const MOD_TOKEN = /\[TEST-MOD-APPROVED (?:META-)?ORCH-\d{4,}(?:-[A-Z])?\]/;
const RENAME_TOKEN = /\[TEST-RENAME-APPROVED (?:META-)?ORCH-\d{4,}(?:-[A-Z])?\]/;

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

// --- Per-file token attribution (#1058 — fixes F-1 false-red + F-2 false-green) ---
// Answers "did any commit in the PR range that touched THESE path(s) carry the
// token?" We scan `${baseRef}..HEAD` (TWO-dot: commits reachable from HEAD but not
// from base = exactly the PR commits — the range whose diff the gate already
// enforces via the three-dot merge-base). The pathspec after `--` limits the log
// to commits that actually touched the file, so the token is attributed to the
// specific change, never the whole branch. This is why the scan is per-file across
// the range and NOT a single tip-only `git log -1` global boolean.
//
// RESIDUAL (accepted, bounded, intentional — #1058 §4a): a single commit's token
// blesses every test file THAT COMMIT deletes from. The token is a human
// attestation on that commit, and the reviewer sees the bundled files together.
// Closing even this would require the token to name the exact file (a grammar
// change) — explicitly OUT of scope to avoid over-engineering. This fix must never
// do worse than "token attributed to a commit that touched the file."
function fileHasToken(baseRef, paths, tokenRegex) {
  const pathArgs = paths.map((p) => `"${p}"`).join(" ");
  const bodies = runGit(`log ${baseRef}..HEAD --pretty=%B -- ${pathArgs}`);
  return tokenRegex.test(bodies);
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
      if (fileHasToken(baseRef, [entry.oldPath, entry.path], RENAME_TOKEN)) {
        console.log(
          `✅ RENAMED    ${entry.oldPath} → ${entry.path} (override token [TEST-RENAME-APPROVED ORCH-####] present in a PR commit that renames this file)`,
        );
        passes += 1;
      } else {
        console.log(
          `❌ RENAMED    ${entry.oldPath} → ${entry.path} — test file rename requires override token [TEST-RENAME-APPROVED ORCH-NNNN] in a commit in this PR that renames this file. None found.`,
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
      } else if (fileHasToken(baseRef, [entry.path], MOD_TOKEN)) {
        console.log(
          `✅ MODIFIED  ${entry.path} (${deleted} deleted lines; override token [TEST-MOD-APPROVED ORCH-####] present in a PR commit that modifies this file)`,
        );
        passes += 1;
      } else {
        console.log(
          `❌ MODIFIED  ${entry.path} — ${deleted} deleted lines detected. Test file modifications with deletions require override token [TEST-MOD-APPROVED ORCH-NNNN] in a commit in this PR that modifies this file. None found. Either restore the deleted lines (additions are always allowed), or open a follow-up ORCH and cite it as [TEST-MOD-APPROVED ORCH-NNNN] in that commit's body explaining why the prior assertion was wrong.`,
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

// ---------------------------------------------------------------------------
// Self-test (`--self-test`) — regex grammar cases + two git-scenario cases that
// exercise the whole-range per-file attribution (#1058 T1/T2). Deterministic on
// the CI runner: it builds throwaway git repos under os.tmpdir() with a local
// `main` base and a pinned identity, and relies on no network and no Date.now().
// ---------------------------------------------------------------------------

function runGitIn(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Spawn THIS script's main() inside `cwd` (a temp repo). The GitHub env is
// stripped so resolveBaseRef() deterministically falls back to the local `main`
// branch regardless of the CI context this self-test itself runs in.
function runCheckIn(cwd) {
  const childEnv = { ...process.env };
  delete childEnv.GITHUB_BASE_REF;
  delete childEnv.GITHUB_EVENT_NAME;
  delete childEnv.GITHUB_HEAD_REF;
  delete childEnv.GIT_DIR;
  delete childEnv.GIT_WORK_TREE;
  const r = spawnSync(process.execPath, [__filename], {
    cwd,
    env: childEnv,
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "append-only-selftest-"));
  const g = (...args) => runGitIn(dir, args);
  const write = (rel, content) => fs.writeFileSync(nodePath.join(dir, rel), content);
  g("init", "-q");
  g("config", "user.email", "ci@mingla.test");
  g("config", "user.name", "ci");
  g("config", "commit.gpgsign", "false");
  return { dir, g, write };
}

const APPROVED = "[TEST-MOD-APPROVED ORCH-1058] ORCH-1058 [append-only token whole range]";

// T1 (SC-1, false-red fixed): the sanctioning commit (token + a.test.ts deletion)
// is NOT the tip — a later docs-only commit is. The token must still be honored so
// the check exits 0.
function scenarioT1() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // commit1: modify a.test.ts WITH a deletion + carry the token (this is NOT the tip)
    write("a.test.ts", "expect(a).toBe(1);\nexpect(c).toBe(3);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "sanctioned assertion fix", "-m", APPROVED);

    // commit2 (tip): docs only — no token, no test file
    write("NOTES.md", "release notes\n");
    g("add", "-A");
    g("commit", "-q", "-m", "docs: update notes");

    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T2 (SC-2, false-green closed): an EARLIER commit guts assertions from b.test.ts
// with NO token; the tip commit modifies a.test.ts and carries a token sanctioning
// ONLY a.test.ts. The unrelated b.test.ts deletion must NOT be waved through — the
// check exits 1 and names b.test.ts (a.test.ts passes on its own token).
function scenarioT2() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n");
    write("b.test.ts", "expect(x).toBe(1);\nexpect(y).toBe(2);\nexpect(z).toBe(3);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // commit1: unsanctioned assertion gutting in b.test.ts, NO token
    write("b.test.ts", "expect(x).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "trim b assertions");

    // commit2 (tip): sanctioned edit to a.test.ts, token names a.test.ts's ORCH only
    write("a.test.ts", "expect(a).toBe(1);\nexpect(c).toBe(3);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "sanctioned assertion fix", "-m", APPROVED);

    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function selfTest() {
  let failures = 0;
  let total = 0;
  const check = (ok, label, detail) => {
    total += 1;
    console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures += 1;
  };

  // --- Regex grammar cases (token format) ---
  const cases = [
    { input: "[TEST-MOD-APPROVED ORCH-0840]", expect: true, label: "regex: bare ORCH" },
    { input: "[TEST-MOD-APPROVED ORCH-0840-A]", expect: true, label: "regex: ORCH with suffix" },
    { input: "[TEST-MOD-APPROVED META-ORCH-0952]", expect: true, label: "regex: META-ORCH" },
    { input: "[TEST-MOD-APPROVED META-ORCH-0001-A]", expect: true, label: "regex: META-ORCH with suffix" },
    { input: "[TEST-MOD-APPROVED FOO-0001]", expect: false, label: "regex: wrong prefix" },
    { input: "TEST-MOD-APPROVED ORCH-0840", expect: false, label: "regex: missing brackets" },
  ];
  for (const c of cases) {
    const got = MOD_TOKEN.test(c.input);
    check(got === c.expect, c.label, `input=${JSON.stringify(c.input)} got=${got} expected=${c.expect}`);
  }

  // --- Git-scenario cases (whole-range per-file attribution — #1058 T1/T2) ---
  const t1 = scenarioT1();
  check(
    t1.status === 0,
    "T1 (SC-1 false-red fixed): token in non-tip commit, docs commit on tip",
    `check exited ${t1.status} (expected 0)`,
  );

  const t2 = scenarioT2();
  const t2NamesB = /❌[^\n]*b\.test\.ts/.test(t2.out);
  const t2PassesA = /✅[^\n]*a\.test\.ts/.test(t2.out);
  check(
    t2.status === 1 && t2NamesB && t2PassesA,
    "T2 (SC-2 false-green closed): unsanctioned b.test.ts deletion not waved through by a.test.ts's token",
    `check exited ${t2.status} (expected 1); names b.test.ts=${t2NamesB}; a.test.ts passes=${t2PassesA}`,
  );

  console.log("");
  console.log(`Self-test: ${total - failures} passed, ${failures} failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  main();
}
