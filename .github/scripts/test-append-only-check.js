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
 *                                                [TEST-RENAME-APPROVED #NNNN].
 *   - Modified test files (status M):
 *       - zero deleted lines (additions only)  → ALLOWED.
 *       - any deleted line                     → FAIL unless a commit in the PR
 *                                                range that modifies THIS file
 *                                                carries the override token
 *                                                [TEST-MOD-APPROVED #NNNN].
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
 * Override tokens MUST cite the work item — either the GitHub ISSUE number as
 * #NNNN (Operating Model V2, 2026-07-19: the issue number is the work ID), or a
 * legacy ORCH-NNNN / META-ORCH-NNNN lineage id (four or more digits, optional
 * -<letter> suffix) — so any approved test mutation is traceable to a work item
 * that explains why the prior assertion was wrong. The `#` is REQUIRED on the
 * issue form; a bare number is REJECTED, because the ORCH and issue id spaces
 * overlap without corresponding (ORCH-1404 is accept-invite error-parse; issue
 * #1404 is analytics-warning acknowledgement), so an unsigilled number cannot be
 * attributed to a work item at all.
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
 *   [TEST-MOD-APPROVED #NNNN]            ← current: the GitHub issue number
 *   [TEST-MOD-APPROVED ORCH-NNNN]        ← legacy lineage id (accepted forever)
 *   [TEST-MOD-APPROVED META-ORCH-NNNN]   ← legacy lineage id (accepted forever)
 *   [TEST-MOD-APPROVED ORCH-NNNN-A]      ← legacy leg suffix (accepted forever)
 *   [TEST-RENAME-APPROVED #NNNN]         ← same alternation for renames
 * REJECTED: a bare number — [TEST-MOD-APPROVED 1485]. The `#` is required.
 * The work item cited must also carry a bracketed feature/bug label somewhere in
 * the commit body (Rule 0 — citation rule), e.g.:
 *   [TEST-MOD-APPROVED #1495]
 *   #1495 [testmod marker grammar]
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

// #1058 (F-3 robustness): \d{4,} (not \d{4}) — ids will eventually exceed 4 digits.
// #1495: the work ID is the GitHub ISSUE number under Operating Model V2 (2026-07-19).
// Both grammars are permanently accepted: `#NNNN` (current) and the legacy
// `ORCH-NNNN` / `META-ORCH-NNNN` lineage ids embedded in historical commit bodies.
// The `#` sigil is REQUIRED on the issue form — a bare number is ambiguous because the
// ORCH and issue id spaces OVERLAP without corresponding (ORCH-1404 is accept-invite
// error-parse; issue #1404 is analytics-warning acknowledgement).
const MOD_TOKEN    = /\[TEST-MOD-APPROVED (?:(?:META-)?ORCH-|#)\d{4,}(?:-[A-Z])?\]/;
const RENAME_TOKEN = /\[TEST-RENAME-APPROVED (?:(?:META-)?ORCH-|#)\d{4,}(?:-[A-Z])?\]/;

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
// RESIDUAL (accepted, bounded, intentional — #1058 §4a): attribution is PER FILE
// ACROSS THE WHOLE RANGE — a file's deletions are blessed if ANY PR-range commit
// that TOUCHED that file carries the token, even a commit that itself deleted
// nothing (e.g. an additions-only edit to the same file, or a commit that touched
// the file alongside others). The token is a human attestation scoped to a FILE for
// the whole PR, not to an individual deletion; the reviewer sees every change to
// that file bundled in the PR diff. This is SAME-FILE ONLY — a token on one file
// NEVER launders deletions in a DIFFERENT file (that cross-file hole, F-2, is
// exactly what this gate closes; see selfTest T2/T3). Tightening even the same-file
// residual would require the token to name the exact file/line (a grammar change) —
// explicitly OUT of scope to avoid over-engineering. This fix must never do worse
// than "token attributed to a commit that touched the file."
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
          `✅ RENAMED    ${entry.oldPath} → ${entry.path} (override token [TEST-RENAME-APPROVED #NNNN] — or a legacy ORCH form — present in a PR commit that renames this file)`,
        );
        passes += 1;
      } else {
        console.log(
          `❌ RENAMED    ${entry.oldPath} → ${entry.path} — test file rename requires override token [TEST-RENAME-APPROVED #NNNN] citing this work's GitHub issue number (the '#' is REQUIRED; a bare number is rejected). Legacy [TEST-RENAME-APPROVED ORCH-NNNN] / [TEST-RENAME-APPROVED META-ORCH-NNNN] remain accepted. The token must sit in a commit in this PR that renames this file. None found.`,
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
          `✅ MODIFIED  ${entry.path} (${deleted} deleted lines; override token [TEST-MOD-APPROVED #NNNN] — or a legacy ORCH form — present in a PR commit that modifies this file)`,
        );
        passes += 1;
      } else {
        console.log(
          `❌ MODIFIED  ${entry.path} — ${deleted} deleted lines detected. Test file modifications with deletions require an override token in a commit in this PR that modifies this file. None found. Write [TEST-MOD-APPROVED #NNNN] citing this work's GitHub issue number — the '#' is REQUIRED and a bare number is rejected, because ORCH-IDs and issue numbers share the 1000-1405 band without corresponding, so an unsigilled number is not traceable. Legacy [TEST-MOD-APPROVED ORCH-NNNN] and [TEST-MOD-APPROVED META-ORCH-NNNN] (optional -A suffix) are accepted forever. Either restore the deleted lines (additions are always allowed), or put the token in that commit's body and explain there why the prior assertion was wrong.`,
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

// #1495 — the CURRENT grammar: the GitHub issue number is the work ID. Used only by
// T4. `APPROVED` above stays on the LEGACY ORCH form on purpose: T1/T2/T3 continuing
// to pass on it is the proof that legacy tokens still work at the git layer, which is
// a permanent guarantee (they are embedded in historical commit bodies).
const APPROVED_ISSUE_FORM = "[TEST-MOD-APPROVED #1495] #1495 [testmod marker grammar]";

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

// T3 (tester adversarial, #1058 CLOSE — a DIFFERENT ANGLE than T1/T2): the
// unsanctioned deletions to b.test.ts are SPLIT ACROSS TWO commits, and the ONLY
// token sits on a THIRD (tip) commit that touches a.test.ts alone. Where T2 gutted
// b in a single commit, this proves the per-file scan aggregates the WHOLE range of
// commits touching a file before deciding — a first-commit-only or tip-only
// attribution would launder b.test.ts. b must FAIL; a passes on its own token.
// Fails-on-revert: reverting fileHasToken to the tip-only global boolean flips this
// GREEN (the tip a-token re-authorizes b's deletions across the whole range).
function scenarioT3() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n");
    write("b.test.ts", "expect(w).toBe(1);\nexpect(x).toBe(2);\nexpect(y).toBe(3);\nexpect(z).toBe(4);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // commit1: strip assertions from b.test.ts (part 1), NO token
    write("b.test.ts", "expect(w).toBe(1);\nexpect(y).toBe(3);\nexpect(z).toBe(4);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "trim b assertions part 1");

    // commit2: strip more from b.test.ts (part 2), still NO token
    write("b.test.ts", "expect(w).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "trim b assertions part 2");

    // commit3 (tip): sanctioned edit to a.test.ts; token touches a.test.ts ONLY
    write("a.test.ts", "expect(a).toBe(1);\nexpect(c).toBe(3);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "sanctioned assertion fix", "-m", APPROVED);

    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T4 (#1495): the ISSUE-NUMBER token honored end-to-end through git, not merely
// against the regex. commit1 deletes a line from a.test.ts carrying
// [TEST-MOD-APPROVED #NNNN]; commit2 (tip) guts b.test.ts with NO token anywhere.
// a must PASS on the new grammar while b still FAILS — one scenario carrying the
// whole contract: the new form works through fileHasToken, and widening the grammar
// did not weaken the guard (a valid sibling token still launders nothing).
// Fails-on-revert: restoring the ORCH-only regex turns `✅ a.test.ts` RED.
function scenarioT4() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n");
    write("b.test.ts", "expect(x).toBe(1);\nexpect(y).toBe(2);\nexpect(z).toBe(3);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // commit1: sanctioned deletion in a.test.ts, token cites the GitHub ISSUE number
    write("a.test.ts", "expect(a).toBe(1);\nexpect(c).toBe(3);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "sanctioned assertion fix", "-m", APPROVED_ISSUE_FORM);

    // commit2 (tip): unsanctioned assertion gutting in b.test.ts, NO token
    write("b.test.ts", "expect(x).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "trim b assertions");

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
    // --- #1495: the issue-number grammar, alongside the legacy forms above ---
    { input: "[TEST-MOD-APPROVED #1485]", expect: true, label: "regex: #1495 issue form" },
    { input: "[TEST-MOD-APPROVED #1485-A]", expect: true, label: "regex: issue form with leg suffix" },
    { input: "[TEST-MOD-APPROVED 1485]", expect: false, label: "regex: bare number rejected — '#' required" },
    { input: "[TEST-MOD-APPROVED #148]", expect: false, label: "regex: issue form under 4 digits rejected" },
    { input: "[TEST-MOD-APPROVED #NNNN]", expect: false, label: "regex: operator-message placeholder is inert (no self-authorization by pasting CI output)" },
    { input: "[TEST-RENAME-APPROVED #1485]", expect: true, re: RENAME_TOKEN, label: "regex: rename issue form" },
    { input: "[TEST-RENAME-APPROVED 1485]", expect: false, re: RENAME_TOKEN, label: "regex: rename bare number rejected" },
    { input: "[TEST-RENAME-APPROVED META-ORCH-0991]", expect: true, re: RENAME_TOKEN, label: "regex: rename legacy META-ORCH preserved" },
  ];
  for (const c of cases) {
    const got = (c.re ?? MOD_TOKEN).test(c.input);
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

  // T3 (tester adversarial) — multi-commit attribution: b's deletions split across
  // two commits, token on a third commit touching only a. Distinct from T2 (single
  // commit) and T1 (false-red). Fails-on-revert: tip-only boolean flips this green.
  const t3 = scenarioT3();
  const t3NamesB = /❌[^\n]*b\.test\.ts/.test(t3.out);
  const t3PassesA = /✅[^\n]*a\.test\.ts/.test(t3.out);
  check(
    t3.status === 1 && t3NamesB && t3PassesA,
    "T3 (tester adversarial): b.test.ts deletions split across TWO commits, token on a THIRD commit touching only a.test.ts — b not laundered across the range",
    `check exited ${t3.status} (expected 1); names b.test.ts=${t3NamesB}; a.test.ts passes=${t3PassesA}`,
  );

  // T4 (#1495) — the issue-number grammar end-to-end through git + fileHasToken,
  // proven simultaneously with the guard's protection holding on an untokened file.
  const t4 = scenarioT4();
  const t4NamesB = /❌[^\n]*b\.test\.ts/.test(t4.out);
  const t4PassesA = /✅[^\n]*a\.test\.ts/.test(t4.out);
  check(
    t4.status === 1 && t4NamesB && t4PassesA,
    "T4 (#1495): issue-number token [TEST-MOD-APPROVED #NNNN] honored end-to-end while an untokened b.test.ts deletion stays blocked",
    `check exited ${t4.status} (expected 1); names b.test.ts=${t4NamesB}; a.test.ts passes=${t4PassesA}`,
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
