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
 *   - Typechanged test files (status T)        → FAIL, no override (absolute).
 *                                                A typechange (regular file <->
 *                                                symlink <-> submodule gitlink)
 *                                                annihilates every assertion in
 *                                                the file exactly as a deletion
 *                                                does, so it carries the status-D
 *                                                disposition, not the status-M
 *                                                one. Direction-agnostic.
 *   - ANY other status                         → FAIL, no override. The dispatch
 *                                                FAILS CLOSED: a status this gate
 *                                                cannot reason about is refused,
 *                                                never waved through. Its terminal
 *                                                branch may never again be a pass.
 * Both dispositions added by issue #1505 (2026-08-03), which found the terminal
 * fall-through printing "unhandled status — treating as pass" and exiting 0 while
 * a test file's every assertion was destroyed by a typechange.
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

// #1510 — the argv boundary. `runGit` builds a SHELL command string, so any caller
// that embeds a repository path in it hands the shell that path's characters to
// interpret. `runGitArgs` passes each argument as a separate argv element via
// execFileSync, so a path is always data and never program text: it cannot change
// which command runs, and it cannot change which paths the command is scoped to.
// Same throw-on-failure shape as `runGit`, which is unchanged and keeps its other,
// path-free callers.
function runGitArgs(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : "";
    const stdout = err.stdout ? err.stdout.toString() : "";
    throw new Error(
      `git ${args.join(" ")} failed (exit ${err.status}):\n  stderr: ${stderr.trim()}\n  stdout: ${stdout.trim()}`,
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

// #1510 — the outcome of a FAILED measurement, distinct from a measured zero. Kept a
// Symbol so it can never be confused with a count, coerced to one, or compared equal
// to one by accident.
const UNDIFFABLE = Symbol("undiffable");

// #1510 — the deleted-line count is MEASURED, never inferred from an empty parse.
//
// Stage 1 (primary): `git diff --numstat` reports the deleted-line count for a path as
// a NUMBER in its second column. It is a statistic git computes about the change, not
// a rendering of it, so it is unaffected by how (or whether) the change is rendered as
// text, and it never requires interpreting a diff line's leading characters — so no
// deleted line whose own content begins with a dash can be mistaken for a file header.
//
// Stage 2 (recovery, and ONLY when stage 1 reports the count as `-`): re-read the diff
// with `--text`, which renders a real line diff for a blob git would otherwise decline
// to render, and count deletions INSIDE HUNKS ONLY — the `sawHunk` latch means the
// leading file headers are excluded structurally rather than by prefix-matching, so
// header text can never be counted as content and content can never be skipped as a
// header.
//
// Stage 3 (fail closed): if the recovery produces no hunk at all while git still
// reports the path as changed, the measurement did not succeed. Return UNDIFFABLE, not
// a number. A count that was never taken is not a count of zero.
//
// The path is passed as an argv element in both invocations (see `runGitArgs`).
function countDeletedLines(baseRef, path) {
  const numstat = runGitArgs([
    "diff",
    "--numstat",
    `${baseRef}...HEAD`,
    "--",
    path,
  ]);
  const record = numstat.split("\n").find((line) => line.trim() !== "");
  // No record at all: git reports no change for this path. Genuinely zero.
  if (!record) return 0;
  // Columns 1 and 2 ONLY. The path column is deliberately NOT parsed — how git spells
  // a path in its own output is a separate concern (issue #1511), and not depending on
  // it keeps this measurement orthogonal to it.
  const deletedField = record.split("\t")[1];
  if (/^\d+$/.test(deletedField ?? "")) return Number(deletedField);

  const rendered = runGitArgs([
    "diff",
    "--unified=0",
    "--text",
    `${baseRef}...HEAD`,
    "--",
    path,
  ]);
  let deleted = 0;
  let sawHunk = false;
  for (const line of rendered.split("\n")) {
    if (line.startsWith("@@")) {
      sawHunk = true;
      continue;
    }
    if (!sawHunk) continue; // still in the per-file header block
    if (line.startsWith("-")) deleted += 1;
  }
  return sawHunk ? deleted : UNDIFFABLE;
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
// #1510: the paths are argv elements, not text spliced into a shell command. Behaviour
// is otherwise identical — same range, same pathspec, same regex.
function fileHasToken(baseRef, paths, tokenRegex) {
  const bodies = runGitArgs([
    "log",
    `${baseRef}..HEAD`,
    "--pretty=%B",
    "--",
    ...paths,
  ]);
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
      if (deleted === UNDIFFABLE) {
        console.log(
          `❌ UNDIFFABLE ${entry.path} — git reports this test file as CHANGED but produced no line diff for it, so the number of deleted lines could not be measured. A count that was never taken is not a count of zero, so this is refused and no override token bypasses it. Restore the file to ordinary reviewable text content, or remove the attribute or diff-driver configuration that is suppressing its diff, so the gate can count the change.`,
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
    if (entry.status === "T") {
      console.log(
        `❌ TYPECHANGE ${entry.path} — this test file's git object TYPE changed (regular file <-> symlink <-> submodule gitlink). A typechange annihilates every assertion in the file exactly as a deletion does, so it is forbidden under the Pragmatic Append-Only policy (ORCH-0840 [Regression-test enforcement + append-only CI]). No override token bypasses a typechange. Restore the file as a regular file with its assertions intact.`,
      );
      failures += 1;
      continue;
    }
    console.log(
      `❌ ${entry.status.padEnd(10)} ${entry.path} — UNRECOGNISED git status for a test file. This gate fails CLOSED: a status it cannot reason about is refused rather than waved through, because an unhandled status is how a test file's assertions get emptied silently. No override token bypasses an unrecognised status. Reduce the change to an ordinary add / modify / rename, or amend this gate to handle the status explicitly and say why it is safe.`,
    );
    failures += 1;
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
//
// `extraEnv` (#1505, default `{}` — every pre-existing caller is unchanged) is
// merged LAST so a scenario can override a single variable for the child alone.
// T11 uses it to prefix PATH with a `git` shim that emits an unmodelled status.
function runCheckIn(cwd, extraEnv = {}) {
  const childEnv = { ...process.env };
  delete childEnv.GITHUB_BASE_REF;
  delete childEnv.GITHUB_EVENT_NAME;
  delete childEnv.GITHUB_HEAD_REF;
  delete childEnv.GIT_DIR;
  delete childEnv.GIT_WORK_TREE;
  const r = spawnSync(process.execPath, [__filename], {
    cwd,
    env: { ...childEnv, ...extraEnv },
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

// T5 (#1495 tester adversarial) — SC-6 ENFORCED AT RUNTIME, not just as a literal.
// G-5 only asserts that the string "[TEST-MOD-APPROVED #NNNN]" fails the regex; it
// cannot notice if someone later respells a message placeholder with real digits,
// because it never reads the messages. This runs the REAL main() through every
// operator-visible branch (DELETED / RENAMED-fail / MODIFIED-fail, then ADDED /
// RENAMED-pass / MODIFIED-pass / MODIFIED-additions-only) and asserts NOTHING the
// gate prints matches either override token. That is the actual invariant: CI output
// pasted into a commit body must never self-authorize a deletion. Newly load-bearing
// under #1495 because `#` + digits is now a valid citation, and `#` is a character
// that turns up in ordinary prose far more often than `ORCH-` ever did.
function scenarioT5() {
  const failDir = makeTempRepo();
  const passDir = makeTempRepo();
  try {
    // --- repo 1: the three FAILURE branches in one run ---
    {
      const { g, write } = failDir;
      write("gone.test.ts", "expect(g).toBe(1);\n");
      write("old.test.ts", "expect(o).toBe(1);\n");
      write("mod.test.ts", "expect(m).toBe(1);\nexpect(n).toBe(2);\n");
      g("add", "-A");
      g("commit", "-q", "-m", "base");
      g("branch", "-M", "main");
      g("checkout", "-q", "-b", "feature");
      g("rm", "-q", "gone.test.ts");
      g("mv", "old.test.ts", "new.test.ts");
      write("mod.test.ts", "expect(m).toBe(1);\n");
      g("add", "-A");
      g("commit", "-q", "-m", "delete, rename and gut — no token anywhere");
    }
    // --- repo 2: the four SUCCESS branches in one run ---
    {
      const { g, write } = passDir;
      write("ren.test.ts", "expect(r).toBe(1);\n");
      write("del.test.ts", "expect(d).toBe(1);\nexpect(e).toBe(2);\n");
      write("grow.test.ts", "expect(g).toBe(1);\n");
      g("add", "-A");
      g("commit", "-q", "-m", "base");
      g("branch", "-M", "main");
      g("checkout", "-q", "-b", "feature");
      g("mv", "ren.test.ts", "ren2.test.ts");
      g("commit", "-q", "-m", "rename", "-m", "[TEST-RENAME-APPROVED #1495] #1495 [testmod marker grammar]");
      write("del.test.ts", "expect(d).toBe(1);\n");
      g("add", "-A");
      g("commit", "-q", "-m", "sanctioned deletion", "-m", APPROVED_ISSUE_FORM);
      write("grow.test.ts", "expect(g).toBe(1);\nexpect(h).toBe(2);\n");
      write("fresh.test.ts", "expect(f).toBe(1);\n");
      g("add", "-A");
      g("commit", "-q", "-m", "additions only plus a new test file");
    }
    const a = runCheckIn(failDir.dir);
    const b = runCheckIn(passDir.dir);
    const combined = `${a.out}\n${b.out}`;
    // Sanity: the branches we care about actually fired, so this can never pass vacuously.
    const exercised =
      /❌[^\n]*DELETED/.test(a.out) &&
      /❌[^\n]*RENAMED/.test(a.out) &&
      /❌[^\n]*MODIFIED/.test(a.out) &&
      /✅[^\n]*ADDED/.test(b.out) &&
      /✅[^\n]*RENAMED/.test(b.out) &&
      /✅[^\n]*MODIFIED/.test(b.out);
    const modLeak = MOD_TOKEN.test(combined);
    const renameLeak = RENAME_TOKEN.test(combined);
    const offenders = combined
      .split("\n")
      .filter((l) => MOD_TOKEN.test(l) || RENAME_TOKEN.test(l))
      .map((l) => l.trim().slice(0, 120));
    return { exercised, modLeak, renameLeak, offenders, failStatus: a.status, passStatus: b.status };
  } finally {
    fs.rmSync(failDir.dir, { recursive: true, force: true });
    fs.rmSync(passDir.dir, { recursive: true, force: true });
  }
}

// T6 (#1495 tester adversarial) — the RENAME arm end-to-end through git. T4 proves
// the issue form only for MOD; RENAME_TOKEN had ZERO git-layer coverage before this,
// and the rename arm is the one that can move a test file out of the protected
// patterns entirely. Two renames in the SAME range: one cites the issue form WITH a
// leg suffix (must pass), the other cites a bare number (must stay blocked) — which
// also proves the valid sibling token does not launder the invalid one across files.
// Fails-on-revert: the ORCH-only RENAME_TOKEN rejects `#1495-A`, so `✅ RENAMED` on
// kept.test.ts goes RED.
function scenarioT6() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("keep.test.ts", "expect(k).toBe(1);\n");
    write("other.test.ts", "expect(o).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // commit1: sanctioned rename, issue form + leg suffix
    g("mv", "keep.test.ts", "kept.test.ts");
    g("commit", "-q", "-m", "sanctioned rename", "-m", "[TEST-RENAME-APPROVED #1495-A] #1495 [testmod marker grammar]");

    // commit2: unsanctioned rename, bare number (the '#' is required)
    g("mv", "other.test.ts", "moved.test.ts");
    g("commit", "-q", "-m", "unsanctioned rename", "-m", "[TEST-RENAME-APPROVED 1495] #1495 [testmod marker grammar]");

    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T7 (#1495 tester adversarial) — the gate's STRONGEST rule had no CI coverage at
// all. Whole-file test deletion (status D) is unconditional: no token of any grammar
// may override it. The SPEC asserts this (SC-5) but only a manual live-fire run ever
// checked it, so a future edit that hands status D the same fileHasToken() escape the
// M and R arms have would ship green. Here the deleting commit carries BOTH new-form
// tokens at once and the file must still be refused.
function scenarioT7() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("gone.test.ts", "expect(g).toBe(1);\nexpect(h).toBe(2);\nexpect(i).toBe(3);\n");
    write("keeper.test.ts", "expect(k).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    g("rm", "-q", "gone.test.ts");
    g(
      "commit",
      "-q",
      "-m",
      "remove the test file entirely",
      "-m",
      "[TEST-MOD-APPROVED #1495] [TEST-RENAME-APPROVED #1495] #1495 [testmod marker grammar]",
    );
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T8 (#1495 tester adversarial) — the token must live in a COMMIT BODY and nowhere
// else. Attribution is a human attestation attached to a reviewable commit message;
// a token that merely appears in the DIFF (a code comment in the gutted test itself,
// a string literal, a JSON fixture) is attacker-supplied content and must authorize
// nothing. This is the laundering route the `#` sigil newly invites, because `#1234`
// occurs naturally inside source and fixture text in a way `ORCH-1234` never did.
function scenarioT8() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    write("a.test.ts", "// [TEST-MOD-APPROVED #1495] #1495 [testmod marker grammar]\nexpect(a).toBe(1);\n");
    write("approvals.json", '{"ok":["[TEST-MOD-APPROVED #1495]","[TEST-RENAME-APPROVED #1495]"]}\n');
    g("add", "-A");
    g("commit", "-q", "-m", "gut a.test.ts; token lives in the diff, not the message");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- #1505 (typechange bypass + fail-closed dispatch) — T9..T13 ---------------
// T9 (#1505, the core repro) — a regular test file REPLACED BY A SYMLINK is git
// status `T`, which the dispatch used to print as "unhandled status — treating as
// pass" and exit 0 with every assertion in the file destroyed. It is the strongest
// laundering route found in the #1495 adversarial sweep. `T` now carries the
// status-D disposition: refused unconditionally. The commit here carries BOTH
// valid new-form tokens at once, so this simultaneously pins that a typechange is
// NOT MOD_TOKEN-overridable — routing it to the M arm would let a routine one-line
// -fix attestation authorize a whole-file annihilation, exactly what the D arm
// forbids. Fails-on-revert: restoring the `passes += 1` terminal branch exits 0.
function scenarioT9() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // Replace the test file with a symlink — the tree loses all three assertions.
    fs.unlinkSync(nodePath.join(dir, "a.test.ts"));
    fs.symlinkSync("/dev/null", nodePath.join(dir, "a.test.ts"));
    g("add", "-A");
    g(
      "commit",
      "-q",
      "-m",
      "replace the test file with a symlink",
      "-m",
      "[TEST-MOD-APPROVED #1495] [TEST-RENAME-APPROVED #1495] #1495 [testmod marker grammar]",
    );
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T10 (#1505) — the `T` arm is DIRECTION-AGNOSTIC. `--name-status` prints the
// letter only; it never discloses which way the type flipped, and distinguishing
// symlink→file from file→symlink would mean re-reading modes from `--raw` — new
// parsing surface on a security gate, for a case with zero occurrences in this
// repo's whole history. So symlink→regular-file is refused too, and this scenario
// exists so a future maintainer cannot silently make the arm directional without
// re-deciding that trade-off. Both tokens are present here as well.
function scenarioT10() {
  const { dir, g, write } = makeTempRepo();
  try {
    fs.symlinkSync("/dev/null", nodePath.join(dir, "a.test.ts"));
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    fs.unlinkSync(nodePath.join(dir, "a.test.ts"));
    write("a.test.ts", "expect(a).toBe(1);\n");
    g("add", "-A");
    g(
      "commit",
      "-q",
      "-m",
      "turn the symlink back into a regular test file",
      "-m",
      "[TEST-MOD-APPROVED #1495] [TEST-RENAME-APPROVED #1495] #1495 [testmod marker grammar]",
    );
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T11 (#1505) — THE DURABLE HALF. The defect class is not "`T` specifically", it is
// that the dispatch's terminal branch used to be `passes += 1`: any future git
// version, flag change (`-B` → `M100`, `-C` → `C100`) or unknown letter (`X`) would
// silently disarm the sole guard for test-file integrity. A guard whose unknown-input
// behaviour is "allow" is not a guard. Statuses that cannot be produced with today's
// flags are simulated the only honest way — a `git` shim on the child's PATH that
// answers `--name-status` with three unmodelled statuses and `exec`s the real git for
// everything else (so base-ref resolution still works). All three must be refused.
// Fails-on-revert: the old terminal branch prints "ℹ️ … treating as pass" ×3, exit 0.
function scenarioT11() {
  const repo = makeTempRepo();
  const shimDir = fs.mkdtempSync(
    nodePath.join(os.tmpdir(), "append-only-selftest-gitshim-"),
  );
  try {
    const { dir, g, write } = repo;
    // An ORDINARY additions-only repo: the fake statuses come from the shim, not
    // from anything unusual in the tree.
    write("a.test.ts", "expect(a).toBe(1);\n");
    write("src.test.ts", "expect(s).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "additions only");

    const realGit = execSync("command -v git", { encoding: "utf8" }).trim();
    const shim = [
      "#!/bin/sh",
      'for arg in "$@"; do',
      '  if [ "$arg" = "--name-status" ]; then',
      "    printf 'X\\ta.test.ts\\nM100\\ta.test.ts\\nC100\\tsrc.test.ts\\tdst.test.ts\\n'",
      "    exit 0",
      "  fi",
      "done",
      `exec ${JSON.stringify(realGit)} "$@"`,
      "",
    ].join("\n");
    const shimPath = nodePath.join(shimDir, "git");
    fs.writeFileSync(shimPath, shim);
    fs.chmodSync(shimPath, 0o755);

    return runCheckIn(dir, {
      PATH: `${shimDir}${nodePath.delimiter}${process.env.PATH || ""}`,
    });
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  }
}

// T12 (#1505) — NEGATIVE CONTROL, and the reason failing closed is safe to ship.
// Across this repo's whole history only A / M / D / R### have ever touched a test
// path; there are no symlinks, no gitlinks and no .gitmodules on `main`. This pins
// that ordinary work stays GREEN with NO token: a MODE-ONLY change (`chmod +x`, the
// one plausible near-miss for a typechange) is status `M` with 0 deleted lines, an
// additions-only edit passes, a brand-new test file passes, and a non-source fixture
// under `__tests__/` passes. The `✅ … mode.test.ts` assertion makes this non-vacuous
// — if the mode change ever stopped producing an entry, the check would go red rather
// than pass on an empty diff. Green before AND after the fix, by design.
function scenarioT12() {
  const { dir, g, write } = makeTempRepo();
  try {
    fs.mkdirSync(nodePath.join(dir, "__tests__"));
    write("mode.test.ts", "expect(m).toBe(1);\nexpect(n).toBe(2);\n");
    write("grow.test.ts", "expect(g).toBe(1);\n");
    write("__tests__/fixture.json", '{"case":1}\n');
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // Mode-only: byte-identical content, executable bit set.
    fs.chmodSync(nodePath.join(dir, "mode.test.ts"), 0o755);
    write("grow.test.ts", "expect(g).toBe(1);\nexpect(h).toBe(2);\n");
    write("fresh.test.ts", "expect(f).toBe(1);\n");
    write("__tests__/fixture.json", '{"case":1}\n{"case":2}\n');
    g("add", "-A");
    // Force the index mode regardless of core.fileMode, so the scenario is
    // deterministic on filesystems that do not honour the executable bit.
    g("update-index", "--chmod=+x", "mode.test.ts");
    g(
      "commit",
      "-q",
      "-m",
      "mode bit, additions-only edit, a new test file and a fixture append — NO token",
    );
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- #1505 TESTER ADVERSARIAL (T14..T18) -------------------------------------
// A different angle from T9..T13. T9 proves the SYMLINK leg with the two CURRENT
// token forms; T11 proves three plausible-future statuses; T12 proves one bundle of
// ordinary work stays green. These attack what those leave open: the GITLINK leg the
// docblock claims but no scenario ever produced, the LEGACY token grammars and the
// #1058 §4a cross-commit same-file attribution route (the one route that genuinely
// DOES launder M-arm deletions), the near-miss boundary immediately around the `T`
// arm, whether a refusal poisons its innocent siblings, and whether the two new
// messages keep telling the operator how to get unstuck.

// T14 (#1505 tester adversarial) — the GITLINK leg + the full laundering matrix.
// Two gaps in T9. (1) The header docblock and the T-arm message both claim the arm
// covers "regular file <-> symlink <-> submodule gitlink", but every scenario builds
// a SYMLINK; the mode-160000 half of that promise was never executed, and it is
// reached by different plumbing (`update-index --cacheinfo`) that git also refuses to
// produce via `submodule add`. (2) T9 puts both CURRENT-form tokens on the typechange
// commit itself. The stronger laundering route is the #1058 §4a residual: a token in
// a DIFFERENT PR-range commit that TOUCHED THE SAME FILE — that route really does
// bless deletions on the M arm, so if `T` were ever quietly routed through
// fileHasToken() this is the shape that would slip. Both LEGACY grammars are used
// here (ORCH- and META-ORCH- with a leg suffix), which T9/T10 never exercise, so a
// future edit cannot re-open the arm for the old forms alone.
// Fails-on-revert: the `passes += 1` terminal branch prints "ℹ️ T …" and exits 0.
function scenarioT14() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // commit1: an ordinary additions-only edit to THE SAME FILE, carrying both
    // legacy-form tokens. This is the #1058 §4a same-file attribution route.
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\nexpect(d).toBe(4);\n");
    g("add", "-A");
    g(
      "commit",
      "-q",
      "-m",
      "additions to the same file, carrying both legacy tokens",
      "-m",
      "[TEST-MOD-APPROVED ORCH-1505] [TEST-RENAME-APPROVED META-ORCH-1505-A] ORCH-1505 [typechange bypass]",
    );

    // commit2: replace the test file with a SUBMODULE GITLINK (mode 160000). Only
    // plumbing can do this at an occupied path — `submodule add` refuses and degrades
    // to a status-D delete, which the D arm already blocks.
    const head = runGitIn(dir, ["rev-parse", "HEAD"]).trim();
    fs.unlinkSync(nodePath.join(dir, "a.test.ts"));
    g("update-index", "--force-remove", "a.test.ts");
    g("update-index", "--add", "--cacheinfo", `160000,${head},a.test.ts`);
    g(
      "commit",
      "-q",
      "-m",
      "replace the test file with a submodule gitlink",
      "-m",
      "[TEST-MOD-APPROVED ORCH-1505] [TEST-RENAME-APPROVED META-ORCH-1505-A] ORCH-1505 [typechange bypass]",
    );
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T15 (#1505 tester adversarial) — the fail-closed default at the BOUNDARY OF THE `T`
// ARM ITSELF, which T11 never approaches. T11 picks three statuses that are plausible
// future git output (X / M100 / C100); it says nothing about what happens one
// character away from the arm the same commit added. `T100` (a score-suffixed
// typechange) and `t` (lowercase) are exactly the shapes a future git, a future flag,
// or a careless `.toLowerCase()` would produce, and `entry.status === "T"` is an EXACT
// match that catches none of them. `U` is real git output in a live conflict, and an
// EMPTY status is what a malformed record degrades to. All four must be REFUSED with
// zero passes — the contract is that nothing outside the four modelled arms is ever
// counted as a pass, not that any particular arm claims it. Each status is also
// asserted to be echoed VERBATIM, because an operator who cannot see the offending
// status has no way to act on the refusal.
// Fails-on-revert: all four print "ℹ️ … treating as pass" and the run exits 0.
function scenarioT15() {
  const repo = makeTempRepo();
  const shimDir = fs.mkdtempSync(
    nodePath.join(os.tmpdir(), "append-only-selftest-gitshim2-"),
  );
  try {
    const { dir, g, write } = repo;
    write("a.test.ts", "expect(a).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\n");
    g("add", "-A");
    // Both current-form tokens on the tip: even a fully attested PR cannot buy a pass
    // for a status the gate cannot reason about.
    g(
      "commit",
      "-q",
      "-m",
      "additions only",
      "-m",
      "[TEST-MOD-APPROVED #1505] [TEST-RENAME-APPROVED #1505] #1505 [typechange bypass]",
    );

    const realGit = execSync("command -v git", { encoding: "utf8" }).trim();
    // Distinct paths per status so each assertion is unambiguous.
    const shim = [
      "#!/bin/sh",
      'for arg in "$@"; do',
      '  if [ "$arg" = "--name-status" ]; then',
      "    printf 'U\\tu.test.ts\\nT100\\tt100.test.ts\\nt\\tlower.test.ts\\n\\tblank.test.ts\\n'",
      "    exit 0",
      "  fi",
      "done",
      `exec ${JSON.stringify(realGit)} "$@"`,
      "",
    ].join("\n");
    const shimPath = nodePath.join(shimDir, "git");
    fs.writeFileSync(shimPath, shim);
    fs.chmodSync(shimPath, 0o755);

    return runCheckIn(dir, {
      PATH: `${shimDir}${nodePath.delimiter}${process.env.PATH || ""}`,
    });
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  }
}

// T16 (#1505 tester adversarial) — SECOND negative control, disjoint from T12. A gate
// that fails closed is only worth shipping if it never red-lights ordinary work; if it
// does, people switch it off, which is strictly worse than the hole it closes. T12
// covers ONE direction of the mode flip (chmod +x) and a single linear commit. This
// covers the shapes T12 cannot see: the mode flip in the OTHER direction
// (100755 -> 100644), a MERGE COMMIT inside the PR range (three-dot diffs against a
// merge base are the normal CI shape and were never exercised), a CRLF rewrite under
// this repo's REAL `.gitattributes` (`* text=auto`, which normalises to LF so the
// change is additions-only), a whole `__tests__/` directory relocated under a rename
// token, and a brand-new `__tests__/` tree. Every one of these has occurred in this
// repository's history; not one may go red. Green BEFORE and AFTER the fix by design.
function scenarioT16() {
  const { dir, g, write } = makeTempRepo();
  try {
    fs.mkdirSync(nodePath.join(dir, "src"));
    fs.mkdirSync(nodePath.join(dir, "src", "__tests__"));
    write(".gitattributes", "* text=auto\n");
    write("unmode.test.ts", "expect(u).toBe(1);\n");
    write("crlf.test.ts", "expect(c).toBe(1);\nexpect(d).toBe(2);\n");
    write("merged.test.ts", "expect(m).toBe(1);\n");
    fs.writeFileSync(nodePath.join(dir, "src", "__tests__", "moved.test.ts"), "expect(v).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    // Base carries the executable bit so the PR can clear it.
    g("update-index", "--chmod=+x", "unmode.test.ts");
    g("commit", "-q", "-m", "base is executable");
    g("branch", "-M", "main");

    // A side branch that will be merged INTO the PR branch, so the range contains a
    // real merge commit.
    g("checkout", "-q", "-b", "side");
    write("side.test.ts", "expect(s).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "a new test file on a side branch");

    g("checkout", "-q", "main");
    g("checkout", "-q", "-b", "feature");
    // Mode flip in the direction T12 does not cover.
    g("update-index", "--chmod=-x", "unmode.test.ts");
    // CRLF rewrite + an appended assertion; `* text=auto` normalises to LF in the
    // object store, so this is additions-only and needs NO token.
    write("crlf.test.ts", "expect(c).toBe(1);\r\nexpect(d).toBe(2);\r\nexpect(e).toBe(3);\r\n");
    // A brand-new __tests__ tree.
    fs.mkdirSync(nodePath.join(dir, "src", "components"), { recursive: true });
    fs.mkdirSync(nodePath.join(dir, "src", "components", "__tests__"));
    fs.writeFileSync(
      nodePath.join(dir, "src", "components", "__tests__", "fresh.test.ts"),
      "expect(f).toBe(1);\n",
    );
    g("add", "-A");
    g("commit", "-q", "-m", "clear the exec bit, normalise line endings, add a __tests__ tree — NO token");

    // A whole __tests__ directory relocated, under a rename token.
    fs.mkdirSync(nodePath.join(dir, "lib"), { recursive: true });
    g("mv", "src/__tests__", "lib/__tests__");
    g(
      "commit",
      "-q",
      "-m",
      "relocate the __tests__ directory",
      "-m",
      "[TEST-RENAME-APPROVED #1505] #1505 [typechange bypass]",
    );

    g("merge", "-q", "--no-ff", "--no-edit", "-m", "merge the side branch into the PR", "side");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T17 (#1505 tester adversarial) — CONTAINMENT. Every #1505 scenario so far runs the
// refusal ALONE in its repo, so none of them can tell whether the new arms behave like
// a per-entry refusal or like a whole-run abort. That matters in both directions: a
// typechange must not swallow its innocent siblings (the operator needs to see the
// rest of the report in one CI run rather than fixing one file per red build), and it
// must not be neutralised by them either. One commit carries all three shapes at once
// — a typechange, an additions-only modification and a new file — with NO token
// anywhere, and the exact tally is pinned: 2 passed, 1 failed.
// Fails-on-revert: the typechange is counted as a pass, the tally becomes
// "3 passed, 0 failed" and the run exits 0.
function scenarioT17() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n");
    write("grow.test.ts", "expect(g).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    fs.unlinkSync(nodePath.join(dir, "a.test.ts"));
    fs.symlinkSync("/dev/null", nodePath.join(dir, "a.test.ts"));
    write("grow.test.ts", "expect(g).toBe(1);\nexpect(h).toBe(2);\n");
    write("fresh.test.ts", "expect(f).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "a typechange next to ordinary work — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- #1510 (the deleted-line count is MEASURED, not inferred) — T19..T27 --------
// T1..T18 all exercise arms that already existed and all assume the count itself was
// right. These nine attack the count: the several ways a rendered diff could come back
// with nothing to parse, the case where a path was interpreted rather than passed, the
// ordinary work that must stay green throughout, and the terminal case where the
// measurement genuinely does not succeed and the only honest answer is to refuse.

const FOUR_ASSERTIONS =
  "expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\nexpect(d).toBe(4);\n";
const ONE_ASSERTION = "expect(a).toBe(1);\n";

// The shape of the THREE REAL test files in this repository that git declines to
// render as text: ordinary TypeScript sources that carry a control byte as TEST DATA,
// early in the file. They are why the gate measures instead of refusing (T22).
// The control byte is written as an ESCAPE in this source on purpose: the gate
// script must itself stay ordinary reviewable text.
const CONTROL_BYTE_DATA_LINE =
  'const cases = [["control byte", "a\u0000b", true]];\n';

// T19 (#1510, the reported repro) — a repository configuration committed alongside the
// change suppresses git's rendered line diff for a test path while that file's
// assertions are removed. The count must still be measured and the entry refused, with
// NO token. Fails-on-revert: the inferred count reads zero and the entry prints as an
// additions-only pass, exit 0.
function scenarioT19() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    write(".gitattributes", "*.test.ts binary\n");
    write("a.test.ts", ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "suppress the rendered diff and remove three assertions — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T20 (#1510) — the SAME suppression reached three different ways in one run, because
// "review the configuration line in the PR" is not a defence for any of them: a second
// spelling of the attribute at the repository root, the attribute in a SUBDIRECTORY
// (attributes are per-directory; nothing requires the root file), and the attribute
// ALREADY PRESENT ON THE BASE BRANCH with this change never touching it — that last one
// puts nothing suspicious in the PR diff at all. All three must be measured and refused,
// zero passes. Fails-on-revert: all three flip to an additions-only pass, exit 0.
function scenarioT20() {
  const { dir, g, write } = makeTempRepo();
  try {
    fs.mkdirSync(nodePath.join(dir, "base"));
    fs.mkdirSync(nodePath.join(dir, "sub"));
    // Configured on the BASE branch. The feature branch below never touches this file.
    write("base/.gitattributes", "onbase.test.ts binary\n");
    write("base/onbase.test.ts", FOUR_ASSERTIONS);
    write("sub/nested.test.ts", FOUR_ASSERTIONS);
    write("atroot.test.ts", FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    write(".gitattributes", "atroot.test.ts -diff\n");
    write("sub/.gitattributes", "nested.test.ts binary\n");
    write("atroot.test.ts", ONE_ASSERTION);
    write("sub/nested.test.ts", ONE_ASSERTION);
    write("base/onbase.test.ts", ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "remove assertions from three test files — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T21 (#1510, the ZERO-CONFIGURATION route) — no repository configuration is involved
// anywhere. The file's own bytes are enough to make git decline to render a line diff
// for it, so there is nothing for a reviewer to notice and nothing for a policy about
// configuration files to catch. The count must still be measured and the entry refused.
// Fails-on-revert: flips to an additions-only pass, exit 0.
function scenarioT21() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", CONTROL_BYTE_DATA_LINE + FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    write("a.test.ts", CONTROL_BYTE_DATA_LINE + ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "remove three assertions — NO token, NO configuration");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T22 (#1510) — THE NEGATIVE CONTROL, and the case that decides the SHAPE of this fix.
// Three real test files in this repository are sources git declines to render as text,
// because they carry a control byte as test data. They are ordinary TypeScript and they
// get maintained. So the gate may NOT answer "cannot render" with "refuse": that would
// red-light every future edit to those files — including additions-only ones — with no
// override, and a gate that fails ordinary work gets switched off, which is strictly
// worse than the hole it closes. Measuring keeps them working: an additions-only edit
// passes with NO token, and a removal still passes on a valid override token, exactly as
// for any other test file. GREEN in BOTH directions, before and after, BY DESIGN — this
// is the scenario that forbids the simpler "refuse what cannot be rendered" fix.
function scenarioT22() {
  const growDir = makeTempRepo();
  const tokenDir = makeTempRepo();
  try {
    // --- repo 1: additions-only maintenance, NO token → must stay green ---
    {
      const { g, write } = growDir;
      write("a.test.ts", CONTROL_BYTE_DATA_LINE + FOUR_ASSERTIONS);
      g("add", "-A");
      g("commit", "-q", "-m", "base");
      g("branch", "-M", "main");
      g("checkout", "-q", "-b", "feature");
      write("a.test.ts", `${CONTROL_BYTE_DATA_LINE}${FOUR_ASSERTIONS}expect(e).toBe(5);\n`);
      g("add", "-A");
      g("commit", "-q", "-m", "append one assertion — NO token");
    }
    // --- repo 2: a sanctioned removal → the override token must still work ---
    {
      const { g, write } = tokenDir;
      write("a.test.ts", CONTROL_BYTE_DATA_LINE + FOUR_ASSERTIONS);
      g("add", "-A");
      g("commit", "-q", "-m", "base");
      g("branch", "-M", "main");
      g("checkout", "-q", "-b", "feature");
      write("a.test.ts", CONTROL_BYTE_DATA_LINE + ONE_ASSERTION);
      g("add", "-A");
      g("commit", "-q", "-m", "sanctioned assertion fix", "-m", APPROVED_ISSUE_FORM);
    }
    const grow = runCheckIn(growDir.dir);
    const token = runCheckIn(tokenDir.dir);
    return { grow, token };
  } finally {
    fs.rmSync(growDir.dir, { recursive: true, force: true });
    fs.rmSync(tokenDir.dir, { recursive: true, force: true });
  }
}

// T23 (#1510) — removed lines whose OWN CONTENT begins with a dash. A rendered diff
// marks a removal with a leading `-`, so such a line arrives looking like the file
// header that a prefix-based parser skips, and the removal is silently swallowed. This
// needs no configuration and no unusual bytes — a comment syntax, a command-line flag
// in a fixture or a decrement is enough. All three removals must be counted.
// Fails-on-revert: reinstating the prefix-based header skip reads zero, exit 0.
function scenarioT23() {
  const { dir, g, write } = makeTempRepo();
  try {
    write(
      "a.test.ts",
      "expect(a).toBe(1);\n-- seed the fixture table\n--force-flag\n--counter;\n",
    );
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    write("a.test.ts", ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "remove three dash-leading lines — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T24 (#1510, THE ARGV BOUNDARY) — a path must be DATA, never program text. When a path
// is spliced into a command string, the characters in it get interpreted before git
// ever sees them: that both runs whatever they describe on the CI runner and rewrites
// which paths the command was scoped to, so the diff comes back empty and the entry
// reads as an additions-only pass. Two spellings, one per repository. The assertion is
// on the ABSENCE OF A SIDE EFFECT (a marker file), not on output — output can be made to
// look right while something else already happened. Both entries must also be measured
// and refused with the correct count. This is the argv boundary only; how git SPELLS a
// path in its own output is a separate concern (issue #1511) and is untouched here.
// Fails-on-revert: the marker appears AND the entry prints as an additions-only pass.
function scenarioT24() {
  const substDir = makeTempRepo();
  const backtickDir = makeTempRepo();
  const substName = "a$(touch marker-a).test.ts";
  const backtickName = "b`touch marker-b`.test.ts";
  try {
    for (const [repo, name] of [
      [substDir, substName],
      [backtickDir, backtickName],
    ]) {
      const { dir, g } = repo;
      fs.writeFileSync(nodePath.join(dir, name), FOUR_ASSERTIONS);
      g("add", "-A");
      g("commit", "-q", "-m", "base");
      g("branch", "-M", "main");
      g("checkout", "-q", "-b", "feature");
      fs.writeFileSync(nodePath.join(dir, name), ONE_ASSERTION);
      g("add", "-A");
      g("commit", "-q", "-m", "remove three assertions — NO token");
    }
    const subst = runCheckIn(substDir.dir);
    const backtick = runCheckIn(backtickDir.dir);
    // The marker would land in the child's working directory, which is the repo root.
    const markerA = fs.existsSync(nodePath.join(substDir.dir, "marker-a"));
    const markerB = fs.existsSync(nodePath.join(backtickDir.dir, "marker-b"));
    return { subst, backtick, markerA, markerB, substName, backtickName };
  } finally {
    fs.rmSync(substDir.dir, { recursive: true, force: true });
    fs.rmSync(backtickDir.dir, { recursive: true, force: true });
  }
}

// T25 (#1510, CONTAINMENT) — every #1510 scenario above runs its refusal alone in its
// own repository, so none of them can tell whether a refusal behaves like a per-entry
// result or like a whole-run abort. It must not swallow its innocent siblings (the
// operator needs the whole report in one CI run) and it must not be neutralised by them
// either. One commit carries all three shapes at once — a suppressed-diff removal, an
// additions-only edit and a brand-new test file — with NO token anywhere, and the exact
// tally is pinned. Fails-on-revert: the tally becomes 3 passed / 0 failed, exit 0.
function scenarioT25() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", FOUR_ASSERTIONS);
    write("grow.test.ts", ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    write(".gitattributes", "a.test.ts binary\n");
    write("a.test.ts", ONE_ASSERTION);
    write("grow.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\n");
    write("fresh.test.ts", "expect(f).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "a suppressed-diff removal next to ordinary work — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T27 (#1510, THE DURABLE HALF) — checked after T26 because T26 reads its output.
// The defect class is not any particular route; it is answering "I could not measure
// this" with "therefore zero". Routes come and go with git versions, flags and file
// contents, so the terminal behaviour is what has to be pinned: when git reports a test
// path as CHANGED and then yields no countable line diff for it, the gate REFUSES. A
// `git` shim on the child's PATH produces exactly that state and defers to the real
// binary for everything else, so base-ref resolution and status detection still work.
// The tip carries BOTH valid override tokens, because an unmeasured count cannot be
// attested by anyone — there is nothing to attest to.
// Fails-on-revert: a terminal that returns zero prints an additions-only pass, exit 0.
function scenarioT27() {
  const repo = makeTempRepo();
  const shimDir = fs.mkdtempSync(
    nodePath.join(os.tmpdir(), "append-only-selftest-gitshim3-"),
  );
  try {
    const { dir, g, write } = repo;
    // An ORDINARY additions-only repo: the unmeasurable state comes from the shim.
    write("a.test.ts", "expect(a).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    write("a.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\n");
    g("add", "-A");
    g(
      "commit",
      "-q",
      "-m",
      "additions only",
      "-m",
      "[TEST-MOD-APPROVED #1510] [TEST-RENAME-APPROVED #1510] #1510 [append-only deletion count]",
    );

    const realGit = execSync("command -v git", { encoding: "utf8" }).trim();
    const shim = [
      "#!/bin/sh",
      "stats=0",
      "rendered=0",
      'for arg in "$@"; do',
      '  case "$arg" in',
      "    --numstat) stats=1 ;;",
      "    --text) rendered=1 ;;",
      "  esac",
      "done",
      // Report the path as changed but decline to state a count for it.
      'if [ "$stats" = 1 ]; then',
      "  printf '%b\\n' '-\\t-\\ta.test.ts'",
      "  exit 0",
      "fi",
      // Answer the recovery read with headers and no hunk at all: nothing to count.
      'if [ "$rendered" = 1 ]; then',
      "  printf '%b' 'diff --git a/a.test.ts b/a.test.ts\\nindex aaaaaaa..bbbbbbb 100644\\n--- a/a.test.ts\\n+++ b/a.test.ts\\n'",
      "  exit 0",
      "fi",
      `exec ${JSON.stringify(realGit)} "$@"`,
      "",
    ].join("\n");
    const shimPath = nodePath.join(shimDir, "git");
    fs.writeFileSync(shimPath, shim);
    fs.chmodSync(shimPath, 0o755);

    return runCheckIn(dir, {
      PATH: `${shimDir}${nodePath.delimiter}${process.env.PATH || ""}`,
    });
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  }
}

// T28 (#1510, TESTER ADVERSARIAL — the other side of T22) — T22 proves an unrenderable
// test file survives an additions-only edit and a token-authorised removal. Those are not
// the only ordinary things that happen to a test file: its METADATA can change while its
// CONTENT does not. T12 and T16 already pin that shape as ordinary work and hold it green,
// but only for files git renders as text — no case holds it for the three real unrenderable
// sources this repository actually maintains. A change that removes NOTHING must never be
// refused, and the refusal branch is unoverridable by design, so a false refusal here has no
// way out at all: not a token, not a re-run, nothing short of editing the file's test data.
// That is precisely the outcome T22 exists to forbid, reached from a direction T22 does not
// look.
function scenarioT28() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("a.test.ts", CONTROL_BYTE_DATA_LINE + FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // Metadata only: byte-identical content, executable bit set. Forced through the
    // index so the scenario is deterministic regardless of core.fileMode.
    fs.chmodSync(nodePath.join(dir, "a.test.ts"), 0o755);
    g("add", "-A");
    g("update-index", "--chmod=+x", "a.test.ts");
    g("commit", "-q", "-m", "set the executable bit, content untouched — NO token");
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
    // --- #1495 TESTER ADVERSARIAL (A-1..A-21) -------------------------------
    // A different angle from G-1..G-8: G-* proves the two forms the gate MUST
    // accept. These pin the REJECTION BOUNDARY — every near-miss an author (or a
    // future well-meaning "make the token friendlier" edit) could push the grammar
    // across. Widening the alternation, adding `\s*`, dropping the `#`, or making
    // either regex case-insensitive turns one of these RED. Measured against the
    // real regexes, not asserted from theory.
    //
    // A-1/A-2: the two tokens are NOT interchangeable. A rename attestation must
    // never authorize an assertion deletion, and vice versa (proven at the git
    // layer too — a MOD token on a rename still reddens the gate).
    { input: "[TEST-RENAME-APPROVED #1485]", expect: false, label: "regex adversarial A-1: RENAME token does NOT satisfy MOD_TOKEN" },
    { input: "[TEST-MOD-APPROVED #1485]", expect: false, re: RENAME_TOKEN, label: "regex adversarial A-2: MOD token does NOT satisfy RENAME_TOKEN" },
    // A-3..A-5: unicode lookalikes for the `#` sigil. `#` is now load-bearing —
    // a homoglyph must not be able to impersonate it.
    { input: "[TEST-MOD-APPROVED ＃1485]", expect: false, label: "regex adversarial A-3: fullwidth number sign U+FF03 is not '#'" },
    { input: "[TEST-MOD-APPROVED ♯1485]", expect: false, label: "regex adversarial A-4: music sharp U+266F is not '#'" },
    { input: "[TEST-MOD-APPROVED №1485]", expect: false, label: "regex adversarial A-5: numero sign U+2116 is not '#'" },
    // A-6..A-10: whitespace/shape variants. The grammar is EXACTLY one space and
    // a closing bracket flush against the id; nothing may be relaxed silently.
    { input: "[TEST-MOD-APPROVED  #1485]", expect: false, label: "regex adversarial A-6: double space separator rejected" },
    { input: "[TEST-MOD-APPROVED #1485 ]", expect: false, label: "regex adversarial A-7: trailing space before ']' rejected" },
    { input: "[TEST-MOD-APPROVED\t#1485]", expect: false, label: "regex adversarial A-8: tab separator rejected" },
    { input: "[TEST-MOD-APPROVED\n#1485]", expect: false, label: "regex adversarial A-9: token split across a line break rejected" },
    { input: "[ TEST-MOD-APPROVED #1485]", expect: false, label: "regex adversarial A-10: space after the opening bracket rejected" },
    // A-11: case-sensitivity is part of the contract (an /i flag would break it).
    { input: "[test-mod-approved #1485]", expect: false, label: "regex adversarial A-11: lowercase token rejected (grammar is case-sensitive)" },
    // A-12..A-14: near-miss citations that a human might reasonably write. Each
    // must be a LOUD failure, never a silent authorization.
    { input: "[TEST-MOD-APPROVED issue-1485]", expect: false, label: "regex adversarial A-12: 'issue-NNNN' spelling rejected" },
    { input: "[TEST-MOD-APPROVED #1485 because the old assertion was wrong]", expect: false, label: "regex adversarial A-13: prose inside the brackets rejected — ']' must be flush" },
    { input: "Fixes #1485 - see the append-only rules", expect: false, label: "regex adversarial A-14: an ordinary '#' issue reference in prose never authorizes" },
    // A-15/A-16: SC-6 at the literal layer for the OTHER two placeholders the
    // gate/workflow/docs print. G-5 only covers `[TEST-MOD-APPROVED #NNNN]`.
    { input: "[TEST-MOD-APPROVED ORCH-####]", expect: false, label: "regex adversarial A-15: legacy '####' placeholder is inert" },
    { input: "[TEST-RENAME-APPROVED #NNNN]", expect: false, re: RENAME_TOKEN, label: "regex adversarial A-16: rename placeholder is inert" },
    // A-17/A-18: the leg suffix is exactly one UPPERCASE letter.
    { input: "[TEST-MOD-APPROVED #1485-AB]", expect: false, label: "regex adversarial A-17: two-letter leg suffix rejected" },
    { input: "[TEST-MOD-APPROVED #1485-a]", expect: false, label: "regex adversarial A-18: lowercase leg suffix rejected" },
    // A-19..A-21: the accept side of the boundary. A-19 and A-21 go RED if either
    // regex is reverted to the ORCH-only form; A-20 goes RED if legacy support is
    // ever dropped (replayed from a token literally present in this repo's history).
    { input: "[TEST-MOD-APPROVED #12345]", expect: true, label: "regex adversarial A-19: five-digit issue number accepted (\\d{4,}, not \\d{4})" },
    { input: "[TEST-MOD-APPROVED META-ORCH-1174-F]", expect: true, label: "regex adversarial A-20: real historical META-ORCH leg token from this repo's git history still accepted" },
    { input: "[TEST-RENAME-APPROVED #1485-A]", expect: true, re: RENAME_TOKEN, label: "regex adversarial A-21: rename issue form with leg suffix accepted" },
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

  // --- #1495 TESTER ADVERSARIAL git scenarios (T5..T8) ---
  // T4 proves the new grammar WORKS. These prove it cannot be TALKED INTO working:
  // the gate cannot authorize itself (T5), the rename arm honours the same rules as
  // the mod arm (T6), whole-file deletion stays absolute under the new grammar (T7),
  // and a token in the diff is not a token in the commit body (T8).
  const t5 = scenarioT5();
  check(
    t5.exercised && !t5.modLeak && !t5.renameLeak,
    "T5 (#1495 tester adversarial, SC-6 at runtime): nothing the gate PRINTS on any operator-visible branch matches MOD_TOKEN or RENAME_TOKEN — CI output pasted into a commit body cannot self-authorize a deletion",
    `branches exercised=${t5.exercised} (fail-run exit ${t5.failStatus}, pass-run exit ${t5.passStatus}); MOD leak=${t5.modLeak}; RENAME leak=${t5.renameLeak}${t5.offenders.length ? `; offending output: ${JSON.stringify(t5.offenders)}` : ""}`,
  );

  const t6 = scenarioT6();
  const t6PassesKept = /✅[^\n]*kept\.test\.ts/.test(t6.out);
  const t6BlocksMoved = /❌[^\n]*moved\.test\.ts/.test(t6.out);
  check(
    t6.status === 1 && t6PassesKept && t6BlocksMoved,
    "T6 (#1495 tester adversarial): RENAME arm end-to-end — [TEST-RENAME-APPROVED #NNNN-A] honored through git while a bare-number rename in the same range stays blocked",
    `check exited ${t6.status} (expected 1); kept.test.ts passes=${t6PassesKept}; moved.test.ts blocked=${t6BlocksMoved}`,
  );

  const t7 = scenarioT7();
  const t7Blocks = /❌[^\n]*DELETED[^\n]*gone\.test\.ts/.test(t7.out);
  check(
    t7.status === 1 && t7Blocks,
    "T7 (#1495 tester adversarial, SC-5): whole-file test deletion stays UNCONDITIONALLY blocked even when the deleting commit carries BOTH valid new-form tokens",
    `check exited ${t7.status} (expected 1); DELETED gone.test.ts refused=${t7Blocks}`,
  );

  const t8 = scenarioT8();
  const t8Blocks = /❌[^\n]*a\.test\.ts/.test(t8.out);
  check(
    t8.status === 1 && t8Blocks,
    "T8 (#1495 tester adversarial): a token present only in the DIFF (test-file comment + JSON fixture) authorizes nothing — attribution requires a commit body",
    `check exited ${t8.status} (expected 1); a.test.ts blocked=${t8Blocks}`,
  );

  // --- #1505 git scenarios (typechange bypass + fail-closed dispatch) ---
  // T1..T8 all exercise arms that already existed. These four exercise the two
  // NEW dispositions plus the negative control that proves nothing green went red,
  // and T13 re-runs the #1495 SC-6 message-hygiene invariant over both new branches.
  const t9 = scenarioT9();
  const t9Refuses = /❌[^\n]*TYPECHANGE[^\n]*a\.test\.ts/.test(t9.out);
  check(
    t9.status === 1 && t9Refuses,
    "T9 (#1505, core repro): a test file REPLACED BY A SYMLINK (git status T) is refused unconditionally — it annihilates every assertion, and BOTH new-form override tokens on the commit bypass nothing",
    `check exited ${t9.status} (expected 1); TYPECHANGE a.test.ts refused=${t9Refuses}`,
  );

  const t10 = scenarioT10();
  const t10Refuses = /❌[^\n]*TYPECHANGE[^\n]*a\.test\.ts/.test(t10.out);
  check(
    t10.status === 1 && t10Refuses,
    "T10 (#1505): the T arm is DIRECTION-AGNOSTIC — symlink → regular test file is refused too, so the arm cannot be quietly made directional without re-deciding the --raw parsing trade-off",
    `check exited ${t10.status} (expected 1); TYPECHANGE a.test.ts refused=${t10Refuses}`,
  );

  const t11 = scenarioT11();
  const t11X = /❌[^\n]*X[^\n]*a\.test\.ts[^\n]*UNRECOGNISED/.test(t11.out);
  const t11M100 = /❌[^\n]*M100[^\n]*a\.test\.ts[^\n]*UNRECOGNISED/.test(t11.out);
  const t11C100 = /❌[^\n]*C100[^\n]*src\.test\.ts[^\n]*UNRECOGNISED/.test(t11.out);
  check(
    t11.status === 1 && t11X && t11M100 && t11C100,
    "T11 (#1505, the durable half): the dispatch FAILS CLOSED — an unknown letter (X), a score-suffixed rewrite (M100) and a copy (C100) are each REFUSED, so the terminal branch can never again be `passes += 1`",
    `check exited ${t11.status} (expected 1); X=${t11X} M100=${t11M100} C100=${t11C100}`,
  );

  const t12 = scenarioT12();
  const t12PassesMode = /✅[^\n]*mode\.test\.ts/.test(t12.out);
  check(
    t12.status === 0 && t12PassesMode,
    "T12 (#1505, blast-radius negative control): ordinary work stays GREEN with NO token — a mode-only chmod +x (status M, 0 deleted lines), an additions-only edit, a new test file and a __tests__/ fixture append all pass",
    `check exited ${t12.status} (expected 0); mode.test.ts passes=${t12PassesMode}`,
  );

  // T13 (#1505) — SC-6 message hygiene EXTENDED to the two new branches. The #1495
  // invariant is that nothing the gate PRINTS may match an override token, so CI
  // output pasted into a commit body can never self-authorize a deletion. T5 covers
  // the six pre-existing branches; it never reads these two. Reuses T9's and T11's
  // real stdout rather than re-running them.
  const t13Out = `${t9.out}\n${t11.out}`;
  const t13Exercised = /❌[^\n]*TYPECHANGE/.test(t9.out) && /❌[^\n]*UNRECOGNISED/.test(t11.out);
  const t13ModLeak = MOD_TOKEN.test(t13Out);
  const t13RenameLeak = RENAME_TOKEN.test(t13Out);
  const t13Offenders = t13Out
    .split("\n")
    .filter((l) => MOD_TOKEN.test(l) || RENAME_TOKEN.test(l))
    .map((l) => l.trim().slice(0, 120));
  check(
    t13Exercised && !t13ModLeak && !t13RenameLeak,
    "T13 (#1505, SC-6 extended): neither NEW branch (TYPECHANGE, UNRECOGNISED) prints anything matching MOD_TOKEN or RENAME_TOKEN — their placeholders stay non-digit, so pasting this gate's output into a commit body authorizes nothing",
    `branches exercised=${t13Exercised}; MOD leak=${t13ModLeak}; RENAME leak=${t13RenameLeak}${t13Offenders.length ? `; offending output: ${JSON.stringify(t13Offenders)}` : ""}`,
  );

  // --- #1505 TESTER ADVERSARIAL (T14..T18) ---
  // T9..T13 prove the two new dispositions work. These prove they cannot be talked
  // around: the gitlink leg the docblock promises (T14), the near-miss boundary of
  // the `T` arm itself (T15), ordinary work on shapes T12 cannot see (T16), the
  // refusal's blast radius on innocent siblings (T17), and whether the operator is
  // still told how to get unstuck (T18).
  const t14 = scenarioT14();
  const t14Refuses = /❌[^\n]*TYPECHANGE[^\n]*a\.test\.ts/.test(t14.out);
  const t14NoPass = /Append-only check: 0 passed, 1 failed\./.test(t14.out);
  check(
    t14.status === 1 && t14Refuses && t14NoPass,
    "T14 (#1505 tester adversarial): the SUBMODULE GITLINK leg of the T arm is refused too — and neither LEGACY token grammar on the typechange commit, nor the #1058 §4a same-file token on an earlier PR-range commit that touched this very file, buys a pass",
    `check exited ${t14.status} (expected 1); TYPECHANGE a.test.ts refused=${t14Refuses}; tally 0/1=${t14NoPass}`,
  );

  const t15 = scenarioT15();
  const t15U = /❌ U\s+u\.test\.ts[^\n]*UNRECOGNISED/.test(t15.out);
  const t15T100 = /❌ T100\s+t100\.test\.ts[^\n]*UNRECOGNISED/.test(t15.out);
  const t15Lower = /❌ t\s+lower\.test\.ts[^\n]*UNRECOGNISED/.test(t15.out);
  const t15Blank = /❌\s+blank\.test\.ts[^\n]*UNRECOGNISED/.test(t15.out);
  const t15Tally = /Append-only check: 0 passed, 4 failed\./.test(t15.out);
  check(
    t15.status === 1 && t15U && t15T100 && t15Lower && t15Blank && t15Tally,
    "T15 (#1505 tester adversarial): the fail-closed default holds at the BOUNDARY OF THE T ARM — an unmerged entry (U), a score-suffixed typechange (T100), a lowercased status (t) and an EMPTY status are each refused with the status echoed verbatim, zero passes, even with both current-form tokens on the tip",
    `check exited ${t15.status} (expected 1); U=${t15U} T100=${t15T100} lowercase-t=${t15Lower} empty=${t15Blank}; tally 0/4=${t15Tally}`,
  );

  const t16 = scenarioT16();
  const t16Unmode = /✅[^\n]*unmode\.test\.ts/.test(t16.out);
  const t16Side = /✅[^\n]*side\.test\.ts/.test(t16.out);
  const t16Moved = /✅[^\n]*RENAMED[^\n]*moved\.test\.ts/.test(t16.out);
  check(
    t16.status === 0 && t16Unmode && t16Side && t16Moved,
    "T16 (#1505 tester adversarial, negative control #2): ordinary work T12 cannot see stays GREEN — the mode flip in the OTHER direction (100755 -> 100644), a MERGE COMMIT inside the PR range, a CRLF rewrite under this repo's real `* text=auto`, a relocated __tests__/ directory and a brand-new __tests__/ tree",
    `check exited ${t16.status} (expected 0); unmode.test.ts=${t16Unmode} side.test.ts=${t16Side} relocated=${t16Moved}`,
  );

  const t17 = scenarioT17();
  const t17Refuses = /❌[^\n]*TYPECHANGE[^\n]*a\.test\.ts/.test(t17.out);
  const t17Grow = /✅[^\n]*MODIFIED[^\n]*grow\.test\.ts/.test(t17.out);
  const t17Fresh = /✅[^\n]*ADDED[^\n]*fresh\.test\.ts/.test(t17.out);
  const t17Tally = /Append-only check: 2 passed, 1 failed\./.test(t17.out);
  check(
    t17.status === 1 && t17Refuses && t17Grow && t17Fresh && t17Tally,
    "T17 (#1505 tester adversarial): the refusal is PER ENTRY, not a whole-run abort — a typechange sitting beside an additions-only edit and a new test file reddens only itself, the siblings still report green, and the tally is exactly 2 passed / 1 failed",
    `check exited ${t17.status} (expected 1); TYPECHANGE=${t17Refuses}; sibling MODIFIED=${t17Grow}; sibling ADDED=${t17Fresh}; tally 2/1=${t17Tally}`,
  );

  // T18 (#1505 tester adversarial) — extends T13 on BOTH axes. T13 checks two outputs
  // for token leakage and nothing else. A red gate an author cannot act on gets
  // switched off, so the remediation sentence is as load-bearing as the refusal: this
  // asserts each new message still names a concrete way forward, over a wider output
  // set (T14's gitlink refusal, T15's four unmodelled statuses, T17's mixed run), and
  // re-runs the SC-6 leak check across all of it. A future "tidy up the wording" edit
  // that strips the escape hatch, or that respells a placeholder with real digits,
  // turns this red.
  const t18Out = `${t14.out}\n${t15.out}\n${t17.out}`;
  const t18Exercised =
    /❌[^\n]*TYPECHANGE/.test(t14.out) &&
    /❌[^\n]*UNRECOGNISED/.test(t15.out) &&
    /❌[^\n]*TYPECHANGE/.test(t17.out);
  const t18TypechangeWayOut = /Restore the file as a regular file with its assertions intact\./.test(t18Out);
  const t18UnrecognisedWayOut = /Reduce the change to an ordinary add \/ modify \/ rename, or amend this gate to handle the status explicitly/.test(t18Out);
  const t18ModLeak = MOD_TOKEN.test(t18Out);
  const t18RenameLeak = RENAME_TOKEN.test(t18Out);
  const t18Offenders = t18Out
    .split("\n")
    .filter((l) => MOD_TOKEN.test(l) || RENAME_TOKEN.test(l))
    .map((l) => l.trim().slice(0, 120));
  check(
    t18Exercised && t18TypechangeWayOut && t18UnrecognisedWayOut && !t18ModLeak && !t18RenameLeak,
    "T18 (#1505 tester adversarial, SC-6 + remediation): across the gitlink refusal, all four unmodelled statuses and a mixed run, both new messages still hand the operator a concrete way forward AND still leak no live override token — a red gate nobody can act on is a gate somebody disables",
    `branches exercised=${t18Exercised}; TYPECHANGE remediation=${t18TypechangeWayOut}; UNRECOGNISED remediation=${t18UnrecognisedWayOut}; MOD leak=${t18ModLeak}; RENAME leak=${t18RenameLeak}${t18Offenders.length ? `; offending output: ${JSON.stringify(t18Offenders)}` : ""}`,
  );

  // --- #1510 git scenarios (the count is measured, not inferred) ---
  // T1..T18 all assume the count itself was right. T19..T27 attack the count: the
  // routes that made the parse come back empty (T19/T20/T21/T23), the path-as-program
  // boundary (T24), the ordinary work that must stay green (T22), the blast radius of a
  // refusal (T25), message hygiene over all of it (T26), and the fail-closed terminal
  // when the measurement genuinely does not succeed (T27).
  const t19 = scenarioT19();
  const t19Refuses = /❌[^\n]*MODIFIED[^\n]*a\.test\.ts[^\n]*3 deleted lines/.test(t19.out);
  const t19Tally = /Append-only check: 0 passed, 1 failed\./.test(t19.out);
  check(
    t19.status === 1 && t19Refuses && t19Tally,
    "T19 (#1510, the reported repro): a repository configuration that suppresses the rendered diff no longer suppresses the COUNT — three removed assertions are measured and the entry is refused with NO token",
    `check exited ${t19.status} (expected 1); 3 deleted lines measured=${t19Refuses}; tally 0/1=${t19Tally}`,
  );

  const t20 = scenarioT20();
  const t20Root = /❌[^\n]*MODIFIED[^\n]*atroot\.test\.ts[^\n]*3 deleted lines/.test(t20.out);
  const t20Sub = /❌[^\n]*MODIFIED[^\n]*sub\/nested\.test\.ts[^\n]*3 deleted lines/.test(t20.out);
  const t20Base = /❌[^\n]*MODIFIED[^\n]*base\/onbase\.test\.ts[^\n]*3 deleted lines/.test(t20.out);
  const t20Tally = /Append-only check: 0 passed, 3 failed\./.test(t20.out);
  check(
    t20.status === 1 && t20Root && t20Sub && t20Base && t20Tally,
    "T20 (#1510): the same suppression reached three ways in one run — a second spelling at the repository root, the same setting in a SUBDIRECTORY, and the setting ALREADY ON THE BASE BRANCH with this change never touching it (nothing suspicious appears in the diff at all) — is measured and refused in all three, zero passes",
    `check exited ${t20.status} (expected 1); root=${t20Root} subdirectory=${t20Sub} pre-existing-on-base=${t20Base}; tally 0/3=${t20Tally}`,
  );

  const t21 = scenarioT21();
  const t21Refuses = /❌[^\n]*MODIFIED[^\n]*a\.test\.ts[^\n]*3 deleted lines/.test(t21.out);
  const t21Tally = /Append-only check: 0 passed, 1 failed\./.test(t21.out);
  check(
    t21.status === 1 && t21Refuses && t21Tally,
    "T21 (#1510, the zero-configuration route): a test file whose OWN BYTES make git decline to render a line diff is still counted — three removed assertions refused with no repository configuration involved anywhere, so there is nothing for a reviewer or a configuration policy to catch",
    `check exited ${t21.status} (expected 1); 3 deleted lines measured=${t21Refuses}; tally 0/1=${t21Tally}`,
  );

  const t22 = scenarioT22();
  const t22Grows = /✅[^\n]*MODIFIED[^\n]*a\.test\.ts[^\n]*additions only, 0 deleted lines/.test(t22.grow.out);
  // Deliberately direction-neutral: both halves must be green BEFORE and AFTER this
  // fix, because the whole point of the control is that nothing here ever goes red. If
  // the override token stopped working the entry would print ❌ and the run would exit
  // 1, so this is still non-vacuous — it just does not pin WHICH passing branch fires.
  const t22Token = /✅[^\n]*MODIFIED[^\n]*a\.test\.ts/.test(t22.token.out);
  check(
    t22.grow.status === 0 && t22Grows && t22.token.status === 0 && t22Token,
    "T22 (#1510, blast-radius negative control — THE SHIP DECIDER): the three real test files in this repository that git declines to render as text are ordinary maintained TypeScript, so the gate MEASURES rather than refuses — an additions-only edit to that shape stays GREEN with NO token, and a removal still passes on a valid override token. Green in BOTH directions by design; this is what forbids the simpler refuse-what-cannot-be-rendered fix, which would red-light live files with no override and get the gate switched off",
    `additions-only run exited ${t22.grow.status} (expected 0), stayed green=${t22Grows}; token run exited ${t22.token.status} (expected 0), override honored=${t22Token}`,
  );

  const t23 = scenarioT23();
  const t23Refuses = /❌[^\n]*MODIFIED[^\n]*a\.test\.ts[^\n]*3 deleted lines/.test(t23.out);
  const t23Tally = /Append-only check: 0 passed, 1 failed\./.test(t23.out);
  check(
    t23.status === 1 && t23Refuses && t23Tally,
    "T23 (#1510): removed lines whose OWN CONTENT begins with a dash are counted, not swallowed as file headers — a comment syntax, a command-line flag in a fixture or a decrement is enough, and no configuration or unusual bytes are needed to reach it",
    `check exited ${t23.status} (expected 1); 3 deleted lines measured=${t23Refuses}; tally 0/1=${t23Tally}`,
  );

  const t24 = scenarioT24();
  const t24SubstRefused =
    t24.subst.out.includes("❌") &&
    t24.subst.out.includes(t24.substName) &&
    /3 deleted lines/.test(t24.subst.out);
  const t24BacktickRefused =
    t24.backtick.out.includes("❌") &&
    t24.backtick.out.includes(t24.backtickName) &&
    /3 deleted lines/.test(t24.backtick.out);
  check(
    t24.subst.status === 1 &&
      t24.backtick.status === 1 &&
      !t24.markerA &&
      !t24.markerB &&
      t24SubstRefused &&
      t24BacktickRefused,
    "T24 (#1510, the argv boundary): a path is DATA, never program text — two spellings of a test path built from characters a shell would interpret produce NO side effect on the runner and are each measured and refused with the correct count. Asserted on the ABSENCE OF A SIDE EFFECT, not on output, because output can be made to look right after something else has already happened",
    `runs exited ${t24.subst.status}/${t24.backtick.status} (expected 1/1); side effect observed=${t24.markerA || t24.markerB} (expected false); refused with a measured count=${t24SubstRefused}/${t24BacktickRefused}`,
  );

  const t25 = scenarioT25();
  const t25Refuses = /❌[^\n]*MODIFIED[^\n]*a\.test\.ts[^\n]*3 deleted lines/.test(t25.out);
  const t25Grow = /✅[^\n]*MODIFIED[^\n]*grow\.test\.ts/.test(t25.out);
  const t25Fresh = /✅[^\n]*ADDED[^\n]*fresh\.test\.ts/.test(t25.out);
  const t25Tally = /Append-only check: 2 passed, 1 failed\./.test(t25.out);
  check(
    t25.status === 1 && t25Refuses && t25Grow && t25Fresh && t25Tally,
    "T25 (#1510, containment): the refusal is PER ENTRY, not a whole-run abort — a suppressed-diff removal sitting beside an additions-only edit and a new test file reddens only itself, the siblings still report green, and the tally is exactly 2 passed / 1 failed",
    `check exited ${t25.status} (expected 1); refused=${t25Refuses}; sibling MODIFIED=${t25Grow}; sibling ADDED=${t25Fresh}; tally 2/1=${t25Tally}`,
  );

  // T27's scenario is run here because T26 reads its output; its own check follows.
  const t27 = scenarioT27();

  // T26 (#1510) — SC-6 message hygiene EXTENDED over the new refusals. The standing
  // invariant is that nothing the gate PRINTS may match an override token, so CI output
  // pasted into a commit body can never self-authorize a removal. T5/T13/T18 cover the
  // pre-existing branches; none of them reads these. The new message is additionally
  // held to carrying NO DIGITS AT ALL — a placeholder respelt with real digits would be
  // pasteable — while still naming a concrete way forward, because a red gate nobody can
  // act on is a gate somebody disables.
  const t26Out = `${t19.out}\n${t21.out}\n${t24.subst.out}\n${t24.backtick.out}\n${t27.out}`;
  const t26Exercised =
    /❌[^\n]*MODIFIED/.test(t19.out) &&
    /❌[^\n]*MODIFIED/.test(t21.out) &&
    t24.subst.out.includes("❌") &&
    /❌ UNDIFFABLE/.test(t27.out);
  const t26UndiffableLine = t27.out.split("\n").find((l) => l.includes("❌ UNDIFFABLE")) || "";
  const t26WayOut =
    /Restore the file to ordinary reviewable text content, or remove the attribute or diff-driver configuration that is suppressing its diff/.test(
      t26UndiffableLine,
    );
  const t26NoDigits = t26UndiffableLine !== "" && !/\d/.test(t26UndiffableLine);
  const t26ModLeak = MOD_TOKEN.test(t26Out);
  const t26RenameLeak = RENAME_TOKEN.test(t26Out);
  const t26Offenders = t26Out
    .split("\n")
    .filter((l) => MOD_TOKEN.test(l) || RENAME_TOKEN.test(l))
    .map((l) => l.trim().slice(0, 120));
  check(
    t26Exercised && t26WayOut && t26NoDigits && !t26ModLeak && !t26RenameLeak,
    "T26 (#1510, SC-6 extended): across every new refusal, nothing the gate PRINTS matches MOD_TOKEN or RENAME_TOKEN, and the unmeasurable-count message carries NO DIGITS AT ALL while still handing the operator a concrete way forward — so this gate's own output can never be pasted into a commit body to authorize the very removal it just refused",
    `branches exercised=${t26Exercised}; remediation present=${t26WayOut}; digit-free=${t26NoDigits}; MOD leak=${t26ModLeak}; RENAME leak=${t26RenameLeak}${t26Offenders.length ? `; offending output: ${JSON.stringify(t26Offenders)}` : ""}`,
  );

  const t27Refuses = /❌ UNDIFFABLE a\.test\.ts/.test(t27.out);
  const t27Tally = /Append-only check: 0 passed, 1 failed\./.test(t27.out);
  check(
    t27.status === 1 && t27Refuses && t27Tally,
    "T27 (#1510, the durable half): when git reports a test path as CHANGED and then yields no countable line diff for it, the gate REFUSES instead of assuming zero — even with BOTH valid override tokens on the tip, because an unmeasured count cannot be attested by anyone. The defect class is answering 'I could not measure this' with 'therefore zero'; individual routes come and go, this terminal cannot",
    `check exited ${t27.status} (expected 1); refused=${t27Refuses}; tally 0/1=${t27Tally}`,
  );

  const t28 = scenarioT28();
  const t28Green = /✅[^\n]*MODIFIED[^\n]*a\.test\.ts/.test(t28.out);
  const t28NoRefusal = !t28.out.includes("❌");
  check(
    t28.status === 0 && t28Green && t28NoRefusal,
    "T28 (#1510, tester adversarial — the other side of T22): a change that alters a test file's METADATA and none of its CONTENT removes nothing, so it must stay GREEN even when the file is one git declines to render as text. T12/T16 pin this shape as ordinary work but only for renderable files, and the three real unrenderable sources this repository maintains are covered by no other case. The refusal branch is unoverridable by design, so a false refusal here has no way out at all — the outcome T22 exists to forbid, reached from a direction T22 does not look",
    `check exited ${t28.status} (expected 0); stayed green=${t28Green}; no refusal printed=${t28NoRefusal}`,
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
