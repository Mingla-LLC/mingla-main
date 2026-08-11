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
 *                                                [TEST-RENAME-APPROVED #ISSUE].
 *   - Modified test files (status M):
 *       - zero deleted lines (additions only)  → ALLOWED.
 *       - any deleted line                     → FAIL unless a commit in the PR
 *                                                range that modifies THIS file
 *                                                carries the override token
 *                                                [TEST-MOD-APPROVED #ISSUE].
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
 * canonical #ISSUE citation (one or more digits, first digit 1-9; Operating Model
 * V2, 2026-07-19: the issue number is the work ID), or a
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
 *   [TEST-MOD-APPROVED #ISSUE]           ← current: the canonical GitHub issue number
 *   [TEST-MOD-APPROVED ORCH-NNNN]        ← legacy lineage id (accepted forever)
 *   [TEST-MOD-APPROVED META-ORCH-NNNN]   ← legacy lineage id (accepted forever)
 *   [TEST-MOD-APPROVED ORCH-NNNN-A]      ← legacy leg suffix (accepted forever)
 *   [TEST-RENAME-APPROVED #ISSUE]        ← same alternation for renames
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

const fs = require("node:fs");
const os = require("node:os");
const nodePath = require("node:path");

const TEST_FILE_PATTERNS = [
  /\.test\.[A-Za-z0-9]+$/,
  /\.spec\.[A-Za-z0-9]+$/,
  /(^|\/)__tests__\//,
];

// #1495: the work ID is the GitHub ISSUE number under Operating Model V2 (2026-07-19).
// #1815: canonical current issue ids are any positive decimal with no leading zero
// or suffix. Legacy lineage ids retain their independent four-or-more-digit grammar.
// Both grammars are permanently accepted: `#ISSUE` (current) and the legacy
// `ORCH-NNNN` / `META-ORCH-NNNN` lineage ids embedded in historical commit bodies.
// The `#` sigil is REQUIRED on the issue form — a bare number is ambiguous because the
// ORCH and issue id spaces OVERLAP without corresponding (ORCH-1404 is accept-invite
// error-parse; issue #1404 is analytics-warning acknowledgement).
const MOD_TOKEN    = /\[TEST-MOD-APPROVED (?:#[1-9][0-9]*|(?:META-)?ORCH-[0-9]{4,}(?:-[A-Z])?)\]/;
const RENAME_TOKEN = /\[TEST-RENAME-APPROVED (?:#[1-9][0-9]*|(?:META-)?ORCH-[0-9]{4,}(?:-[A-Z])?)\]/;

function isTestPath(path) {
  return TEST_FILE_PATTERNS.some((re) => re.test(path));
}

// #1510: there is deliberately NO shell-string git runner in this file any more, and
// since #1534 there is no git runner at this scope AT ALL — see "the only door to the
// repository" below. An available runner is how the next call site quietly reacquires
// the properties this gate must not have: a path that can be interpreted, a pathspec
// that can glob-match a file other than the one being measured, and a reading of the
// repository that nothing reconciled.

// #1534 (R-3) — the gate's own output must never be a valid attestation. Any token
// literal that reaches stdout is rewritten to its non-digit placeholder form, which
// every grammar case pins as INERT. Applied to paths (which are author-controlled) and
// to the self-test stream (whose inputs are token literals by construction).
function redactTokens(text) {
  return String(text)
    .replace(
      /(\[TEST-(?:MOD|RENAME)-APPROVED )#[1-9][0-9]*(\])/g,
      "$1#ISSUE$2",
    )
    .replace(
      /(\[TEST-(?:MOD|RENAME)-APPROVED )((?:META-)?ORCH-)[0-9]{4,}(-[A-Z])?(\])/g,
      (_match, head, lineage, leg, tail) => `${head}${lineage}NNNN${leg || ""}${tail}`,
    );
}

// NUL-delimited field split. A trailing NUL yields no empty tail field.
function nulFields(buf) {
  const out = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      out.push(buf.subarray(start, i).toString("latin1"));
      start = i + 1;
    }
  }
  if (start < buf.length) out.push(buf.subarray(start).toString("latin1"));
  return out;
}

// A path recovered from git is a byte string. It can only be handed BACK to git as a
// pathspec if it survives the argv encoding — Node encodes argv as UTF-8, so a path
// whose bytes are not valid UTF-8 cannot be expressed as one at all. Answer honestly
// rather than silently sending different bytes than the ones git reported.
function pathspecFor(latin1Path) {
  const bytes = Buffer.from(latin1Path, "latin1");
  const asUtf8 = bytes.toString("utf8");
  return Buffer.from(asUtf8, "utf8").equals(bytes) ? asUtf8 : null;
}

// Display form. A path is author-controlled text that this gate prints back, so it is
// quoted whenever it carries a control character: an entry must occupy exactly ONE line
// of the report, or a crafted name can print something that reads as a verdict for a
// different file, and the per-line assertions that police this output stop seeing across
// their own subject.
function displayPath(latin1Path) {
  const spec = pathspecFor(latin1Path);
  const printable = spec !== null && !/[\u0000-\u001f\u007f]/.test(spec);
  return redactTokens(printable ? spec : JSON.stringify(latin1Path));
}

// #1510 — the argv boundary, in BOTH of the two layers that read a path as something
// other than a name.
//
// (1) `runGit` builds a SHELL command string, so any caller that embeds a repository
//     path in it hands the shell that path's characters to interpret. The argv runner
//     passes each argument as a separate argv element via execFileSync, so the shell
//     is not in the path at all.
//
// (2) argv alone is NOT enough. Everything after `--` is a PATHSPEC, and git
//     glob-matches a pathspec by default — so a path is still a pattern, and a
//     command scoped to one file can silently report on a different one. Every
//     invocation therefore runs under `--literal-pathspecs`, which is a git-level
//     option and must precede the subcommand. It is applied HERE, once, rather than at
//     each call site, so a future call site cannot forget it: partial coverage of a
//     boundary is the same as no coverage.
//
// Together these make a path DATA in every sense — it cannot change which command
// runs, and it cannot change which paths that command reports on. Same
// throw-on-failure shape as `runGit`, which is unchanged and keeps its other callers.
// #1510 — the outcome of a FAILED measurement, distinct from a measured zero. Kept a
// Symbol so it can never be confused with a count, coerced to one, or compared equal
// to one by accident.
const UNDIFFABLE = Symbol("undiffable");

// Detection is a FILTER over the single reading rather than a second parse of a second
// format. `isTestPath` is unchanged and still runs against the real bytes.
function selectTestEntries(records) {
  const entries = [];
  for (const rec of records) {
    if (rec.oldPath !== undefined) {
      if (isTestPath(rec.oldPath) || isTestPath(rec.path)) {
        entries.push({
          status: rec.status.startsWith("R") ? "R" : rec.status,
          oldPath: rec.oldPath,
          path: rec.path,
        });
      }
    } else if (isTestPath(rec.path)) {
      entries.push({ status: rec.status, path: rec.path });
    }
  }
  return entries;
}

// #1534 — EVERY disposition that can hide content loss asks THIS ONE question. It has no
// terminal that infers a count it did not take. It is pure: it is handed an already
// reconciled reading and a way to re-read, and it reaches nothing on its own.
//
// Stage 1 (primary): the reading's counts. A path the reading listed and then gave no
// record for was never measured — that is `absentMeans`, never a silent zero.
// Stage 2 (metadata): identical pre- and post-image object ids mean the bytes did not
// move, so the honest count is zero however the change is or is not rendered.
// Stage 3 (recovery): re-read and count removals, scoped to the same change the count is
// owed for — for a rename that is the renamed PAIR, not the destination alone, or every
// surviving line reads as an addition.
// Stage 4 (fail closed): anything else is a measurement that did not succeed.
//
// `absentMeans` is the honest reading of "this range has no record for that path", and it
// is NOT the same answer in both places. Over the range the ENTRY ITSELF came from,
// absence contradicts the record that produced the entry, so it is a failed measurement.
// Over the independently-asked base-branch range it is a real answer: no record means no
// difference. Conflating the two either waves through an unmeasured path or reddens an
// identical one. The DEFAULT is the fail-closed reading, so a caller that says nothing
// gets the safe answer rather than the convenient one.
// The fail-closed default lives HERE and in exactly one place, so it can be asserted
// directly rather than only through whichever arm happens to reach it today.
function measureFromIndex(entry, data, recover, absentMeans = UNDIFFABLE) {
  const miss = "\u0000\u0000no-such-key";
  const recorded = data.numstat.has(entry.path)
    ? data.numstat.get(entry.path)
    : data.numstat.get(entry.oldPath ?? miss);
  if (recorded === undefined) return absentMeans;
  if (recorded !== null) return recorded;

  const oid = data.oids.get(entry.path) ?? data.oids.get(entry.oldPath ?? miss);
  if (oid) {
    const absent = (o) => !o || /^0+$/.test(o);
    if (!absent(oid.srcOid) && !absent(oid.dstOid) && oid.srcOid === oid.dstOid) return 0;
  }

  const specs = [entry.oldPath, entry.path].filter((x) => x !== undefined).map(pathspecFor);
  if (specs.length === 0 || specs.some((x) => x === null)) return UNDIFFABLE;
  return recover(specs);
}

// =====================================================================================
// THE ONLY DOOR TO THE REPOSITORY
// =====================================================================================
// Across four rounds, every failure in this file was a CONVENTION that held until someone
// added one more caller: remember to pass the path as argv; remember the literal-pathspec
// flag; remember that these two readings must agree; remember to check whether they did.
// Each was true when written and each was broken by the next arm, because the guarantee
// lived in the caller rather than in the thing being called.
//
// So the runners are gone from this file's scope. `execFileSync` is imported HERE and
// nowhere else in the gate, and the two functions that actually invoke git are captured in
// this closure. A new arm cannot ask the repository anything except through what is
// returned below, and what is returned below cannot answer without a reconciled reading
// behind it:
//
//   - `openRange` is the ONLY way to obtain a diff, and it ALWAYS reconciles the two reads
//     it needs. There is no unreconciled variant to reach for, and no flag to skip it.
//   - When reconciliation fails it does not return a flag for the caller to test — a flag
//     is another convention, and forgetting to test it is exactly the defect this replaces.
//     It returns a DIFFERENT OBJECT whose `measure` cannot produce a number at all, whose
//     `hasRecordFor` is always false, and whose `existedBefore` always answers "assume it
//     did", so every arm that consults it is driven to a refusal without knowing why.
//   - Both readings are built by the same function, so both are reconciled and both are
//     guarded. There is no longer a first-class reading and a second-class one.
const repository = (() => {
  const { execFileSync } = require("node:child_process");

  // #1510 — the argv boundary, in BOTH of the two layers that read a path as something
  // other than a name. (1) Nothing builds a shell command string, so no caller hands the
  // shell a path's characters to interpret. (2) argv alone is NOT enough: everything after
  // `--` is a PATHSPEC and git glob-matches one by default, so a path is still a pattern
  // and a command scoped to one file can silently report on another. Every invocation runs
  // under `--literal-pathspecs`, applied HERE rather than at each call site, because
  // partial coverage of a boundary is the same as no coverage.
  function runText(args) {
    const argv = ["--literal-pathspecs", ...args];
    try {
      return execFileSync("git", argv, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : "";
      const stdout = err.stdout ? err.stdout.toString() : "";
      throw new Error(
        `git ${argv.join(" ")} failed (exit ${err.status}):\n  stderr: ${stderr.trim()}\n  stdout: ${stdout.trim()}`,
      );
    }
  }

  // #1534 (R-2) — the BYTE form of git's output. `-z` makes git emit paths raw, and
  // reading the result as a Buffer keeps bytes that are not valid UTF-8 intact.
  function runBytes(args) {
    const argv = ["--literal-pathspecs", ...args];
    try {
      return execFileSync("git", argv, { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : "";
      throw new Error(`git ${argv.join(" ")} failed (exit ${err.status}):\n  stderr: ${stderr.trim()}`);
    }
  }

  // THE SINGLE READING. The only format that puts every field behind the record
  // separator, so nothing in it has to be taken apart to recover a path. Status, both
  // object ids and both paths all come from here, and from nowhere else.
  function readRecords(range) {
    const f = nulFields(
      runBytes(["diff", "--raw", "--no-abbrev", "--find-renames", "-z", ...range, "--"]),
    );
    const records = [];
    for (let i = 0; i < f.length; ) {
      const meta = f[i++];
      if (!meta.startsWith(":")) return { records, truncated: true };
      const cols = meta.slice(1).trim().split(/\s+/);
      const status = cols[4] || "";
      const twoPaths = status.startsWith("R") || status.startsWith("C");
      const first = f[i++];
      const second = twoPaths ? f[i++] : undefined;
      if (first === undefined || (twoPaths && second === undefined)) {
        return { records, truncated: true };
      }
      records.push({
        status,
        srcOid: cols[2],
        dstOid: cols[3],
        oldPath: twoPaths ? first : undefined,
        path: twoPaths ? second : first,
      });
    }
    return { records, truncated: false };
  }

  // Counts contribute NUMBERS ONLY. Returns counts positionally matching `records`, or a
  // STRING naming the disagreement. A rename or copy record ends AT its second separator
  // and its two paths follow as their own fields; every other record continues past it and
  // everything after it is the path. A path is never empty, so "the second separator is
  // the last byte of the field" is an exact test of the record's SHAPE and not an
  // inference about its content. The path found there is COMPARED against the single
  // reading and never adopted as a key.
  function attachCounts(records, range) {
    const f = nulFields(
      runBytes(["diff", "--numstat", "--find-renames", "-z", ...range, "--"]),
    );
    const counts = [];
    let i = 0;
    for (const rec of records) {
      if (i >= f.length) return "the counting read ran out of records before the listing read did";
      const field = f[i++];
      const firstTab = field.indexOf("\t");
      const secondTab = firstTab < 0 ? -1 : field.indexOf("\t", firstTab + 1);
      if (secondTab < 0) return "a counting record did not carry both count columns";
      const pairShaped = secondTab === field.length - 1;
      const twoPaths = rec.oldPath !== undefined;
      if (pairShaped !== twoPaths) return "the two readings disagree about which changes moved a file";
      let oldPath;
      let path;
      if (pairShaped) {
        oldPath = f[i++];
        path = f[i++];
        if (path === undefined) return "a counting record was truncated";
      } else {
        path = field.slice(secondTab + 1);
      }
      if (path !== rec.path || (twoPaths && oldPath !== rec.oldPath)) {
        return "the two readings disagree about which file a record describes";
      }
      const deletedColumn = field.slice(firstTab + 1, secondTab);
      counts.push(/^\d+$/.test(deletedColumn) ? Number(deletedColumn) : null);
    }
    if (i !== f.length) return "the counting read carried more records than the listing read";
    return counts;
  }

  // Stage 3's re-read. Scoped to the change the count is owed for, never wider.
  function recoverRemovals(range, specs) {
    const rendered = runText([
      "diff",
      "--unified=0",
      "--text",
      "--find-renames",
      ...range,
      "--",
      ...specs,
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

  // The view returned when the two reads did NOT reconcile. Deliberately not "the normal
  // view with a flag set": there is no number it can produce and no question it answers
  // optimistically, so an arm written by someone who has never heard of reconciliation
  // still refuses. `existedBefore` answers "assume it did" so the added arm is driven into
  // a measurement rather than around it — that arm is the one where absence is a pass.
  function refusingView(range, records, why) {
    return {
      range,
      reconciled: false,
      desyncReason: why,
      records,
      testEntries: () => selectTestEntries(records),
      hasRecordFor: () => false,
      existedBefore: () => true,
      measure: () => UNDIFFABLE,
    };
  }

  function reconciledView(range, records, counts) {
    const numstat = new Map();
    const oids = new Map();
    for (let k = 0; k < records.length; k++) {
      const rec = records[k];
      const oid = { srcOid: rec.srcOid, dstOid: rec.dstOid };
      oids.set(rec.path, oid);
      if (rec.oldPath !== undefined && !oids.has(rec.oldPath)) oids.set(rec.oldPath, oid);
      numstat.set(rec.path, counts[k]);
      if (rec.oldPath !== undefined && !numstat.has(rec.oldPath)) numstat.set(rec.oldPath, counts[k]);
    }
    const data = { range, numstat, oids };
    return {
      range,
      reconciled: true,
      desyncReason: null,
      records,
      testEntries: () => selectTestEntries(records),
      hasRecordFor: (entry) =>
        numstat.has(entry.path) || (entry.oldPath !== undefined && numstat.has(entry.oldPath)),
      existedBefore: (path) => {
        const rec = oids.get(path);
        return rec !== undefined && !/^0*$/.test(rec.srcOid || "");
      },
      // No default here: the fail-closed default belongs to the terminal and to nothing
      // else, so there is one place to get it right and one place to assert it.
      measure: (entry, absentMeans) =>
        measureFromIndex(entry, data, (specs) => recoverRemovals(range, specs), absentMeans),
    };
  }

  return {
    verifyRef(ref) {
      runText(["rev-parse", "--verify", ref]);
    },
    openRange(range) {
      const { records, truncated } = readRecords(range);
      if (truncated) return refusingView(range, records, "the listing read was truncated");
      const counts = attachCounts(records, range);
      if (typeof counts === "string") return refusingView(range, records, counts);
      return reconciledView(range, records, counts);
    },
    bodiesTouching(rangeSpec, specs) {
      return runText(["log", rangeSpec, "--pretty=%B", "--", ...specs]);
    },
  };
})();

function resolveBaseRef() {
  if (process.env.GITHUB_BASE_REF) {
    const candidate = `origin/${process.env.GITHUB_BASE_REF}`;
    try {
      repository.verifyRef(candidate);
      return candidate;
    } catch {
      // fall through
    }
  }
  if (process.env.GITHUB_EVENT_NAME === "push") {
    try {
      repository.verifyRef("HEAD~1");
      return "HEAD~1";
    } catch {
      // single-commit branch (HEAD~1 doesn't exist) — nothing to check
      return null;
    }
  }
  for (const candidate of ["origin/main", "main", "HEAD~1"]) {
    try {
      repository.verifyRef(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    "Could not resolve a base ref. Tried GITHUB_BASE_REF, HEAD~1, origin/main, main.",
  );
}

// --- Per-file token attribution (#1058 — fixes F-1 false-red + F-2 false-green) ---
// Answers "did any commit in the PR range that touched THESE path(s) carry the token?" We
// scan `${baseRef}..HEAD` (TWO-dot: commits reachable from HEAD but not from base = exactly
// the PR commits). The pathspec limits the log to commits that actually touched the file,
// so the token is attributed to the specific change, never the whole branch.
//
// RESIDUAL (accepted, bounded, intentional — #1058 §4a): attribution is PER FILE ACROSS THE
// WHOLE RANGE — a file's deletions are blessed if ANY PR-range commit that TOUCHED that
// file carries the token. The token is a human attestation scoped to a FILE for the whole
// PR, not to an individual deletion. This is SAME-FILE ONLY — a token on one file NEVER
// launders deletions in a DIFFERENT file (see selfTest T2/T3).
// #1534: a path that cannot be expressed as a pathspec cannot scope an attribution either.
// Answering "no token" is the only honest result — never "any token".
function fileHasToken(baseRef, paths, tokenRegex) {
  const specs = paths.filter(Boolean).map(pathspecFor);
  if (specs.length === 0 || specs.some((sp) => sp === null)) return false;
  return tokenRegex.test(repository.bodiesTouching(`${baseRef}..HEAD`, specs));
}

function main() {
  let baseRef;
  try {
    baseRef = resolveBaseRef();
  } catch (err) {
    // #1534 (R-3): redaction is applied at EVERY print site, not only at the ones
    // currently believed to be reachable with author-controlled text in them. A
    // partially redacted stream is the same defect as an unredacted one — it just moves
    // the question of which site is reachable onto whoever edits this file next. On a
    // message that can never carry a token this costs nothing and asserts nothing false.
    console.error(`❌ ${redactTokens(err.message)}`);
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
  let index;
  let tipIndex;
  try {
    // ONE reading of this range. The entry list is a filter over it, so detection cannot
    // be looking at a different set of records from the one the counts were attached to.
    // Exactly TWO readings are taken in total, one per range, and each is internally
    // reconciled. Nothing else in this gate asks git a question about a path.
    index = repository.openRange([`${baseRef}...HEAD`]);
    entries = index.testEntries();
    tipIndex = repository.openRange([baseRef, "HEAD"]);
  } catch (err) {
    console.error(`❌ ${redactTokens(err.message)}`);
    process.exit(2);
  }

  const DESYNC_TAIL =
    "so the two readings of this change do not agree about it and no count for it can be trusted. A count that was never taken is not a count of zero, so this is refused and no override token bypasses it. Re-run the check; if it persists, this is a fault in how the gate reads git rather than something to work around in the pull request.";

  if (entries.length === 0) {
    // A reading that did not reconcile cannot be trusted to say there was nothing to
    // look at: "no test files changed" and "I could not agree with myself about what
    // changed" are opposite verdicts, and only one of them is safe to print.
    if (!index.reconciled) {
      console.log(
        `❌ UNDIFFABLE (whole run) — git's readings of this change do not agree with each other, ${DESYNC_TAIL}`,
      );
      console.log("");
      console.log("Append-only check: 0 passed, 1 failed.");
      process.exit(1);
    }
    console.log("✅ No test files changed. Append-only check: clean.");
    process.exit(0);
  }

  let failures = 0;
  let passes = 0;

  const UNMEASURED_TAIL =
    "so the number of deleted lines could not be measured. A count that was never taken is not a count of zero, so this is refused and no override token bypasses it. Restore the file to ordinary reviewable text content, or remove the attribute or diff-driver configuration that is suppressing its diff, so the gate can count the change.";

  for (const entry of entries) {
    const shownPath = displayPath(entry.path);
    const shownOld = entry.oldPath === undefined ? undefined : displayPath(entry.oldPath);

    // #1534 REWORK, part 2 — THE RECONCILIATION INVARIANT, checked for EVERY entry before
    // any arm gets to reason about it. The entry exists because the single reading listed
    // it; the counts were attached to that same reading; so a missing key is not a
    // property of this file, it is proof that the two readings came apart. That is a
    // parse fault, and it must fail closed in EVERY arm — including the arms where an
    // absent record is otherwise a legitimate answer meaning "no difference", which is
    // exactly where a desync would otherwise read as "nothing was removed".
    //
    // This is deliberately redundant with the accessor above, which already refuses to
    // hand back a reading that did not reconcile. The accessor makes the disagreement
    // unrepresentable; this makes it UNMISSABLE if some future reading reintroduces one.
    // Redundancy is the point: every false green this file has shipped lived in the gap
    // between two individually correct changes.
    if (!index.hasRecordFor(entry)) {
      console.log(`❌ UNDIFFABLE ${shownPath} — git listed this test file as changed but the counting read does not account for it, ${DESYNC_TAIL}`);
      failures += 1;
      continue;
    }
    // Any measurement or attribution failure is a PER-ENTRY refusal, never a whole-run
    // abort: an operator needs the rest of the report in the same CI run.
    const guard = (fn, fallback) => {
      try {
        return fn();
      } catch (err) {
        console.error(`❌ ${entry.status.padEnd(10)} ${shownPath} — could not evaluate this entry: ${redactTokens(err.message)}`);
        return fallback;
      }
    };

    if (entry.status === "A") {
      // #1527: a status of "added" is a statement about this RANGE, not about the base
      // branch. If the base branch already carries this path, the change is a rewrite of
      // an existing test file and its content loss must be measured like any other.
      // Did the BASE BRANCH already hold this path? Answered from the same reconciled
      // reading that supplies the count, not from a separate listing of the base tree: a
      // record whose PRE-image object id is present is a path that existed before. A
      // genuinely new path has an absent pre-image and nothing that can have been lost.
      // BOTH answers come from the same reading, and that reading is guarded. If it did
      // not reconcile, `existedBefore` says "assume it did" and `measure` cannot return a
      // number — so this arm is driven INTO a refusal rather than around one. That matters
      // here more than anywhere else in the file: this is the one arm where an absent
      // record legitimately means "no difference", so it is the one a disagreement could
      // otherwise imitate.
      const existedOnBase = tipIndex.existedBefore(entry.path);
      const lost = existedOnBase ? guard(() => tipIndex.measure(entry, 0), UNDIFFABLE) : 0;
      if (lost === 0) {
        console.log(`✅ ADDED      ${shownPath}`);
        passes += 1;
        continue;
      }
      if (lost === UNDIFFABLE) {
        console.log(
          tipIndex.reconciled
            ? `❌ UNDIFFABLE ${shownPath} — this test path already exists on the base branch and git produced no countable diff for it, ${UNMEASURED_TAIL}`
            : `❌ UNDIFFABLE ${shownPath} — this test path is reported as new by this range and the base-branch comparison could not be read consistently, ${DESYNC_TAIL}`,
        );
        failures += 1;
        continue;
      }
      if (guard(() => fileHasToken(baseRef, [entry.path], MOD_TOKEN), false)) {
        console.log(`✅ ADDED      ${shownPath} (introduced over an existing base-branch file; removed lines attested by an override token in a PR commit that touches this file)`);
        passes += 1;
      } else {
        console.log(
          `❌ ADDED      ${shownPath} — this test path is reported as new by this range but ALREADY EXISTS on the base branch, and the version being introduced drops lines the base branch still has. An introduced file that replaces an existing one is a modification, so it needs the same attestation: write [TEST-MOD-APPROVED #ISSUE] with this work's canonical GitHub issue number (one or more digits, first digit 1-9; no leading zero or suffix) in a commit in this PR that touches this file. Legacy ORCH-NNNN and META-ORCH-NNNN citations remain accepted for historical work. Or rebase onto the base branch and keep the existing assertions.`,
        );
        failures += 1;
      }
      continue;
    }
    if (entry.status === "D") {
      console.log(
        `❌ DELETED    ${shownPath} — test file deletion is forbidden under the Pragmatic Append-Only policy (ORCH-0840 [Regression-test enforcement + append-only CI]). No override token bypasses deletion.`,
      );
      failures += 1;
      continue;
    }
    if (entry.status === "R") {
      if (!guard(() => fileHasToken(baseRef, [entry.oldPath, entry.path], RENAME_TOKEN), false)) {
        console.log(
          `❌ RENAMED    ${shownOld} → ${shownPath} — test file rename requires [TEST-RENAME-APPROVED #ISSUE] with this work's canonical GitHub issue number (one or more digits, first digit 1-9; no leading zero or suffix). Legacy ORCH-NNNN / META-ORCH-NNNN citations remain accepted for historical work. The token must sit in a commit in this PR that renames this file. None found.`,
        );
        failures += 1;
        continue;
      }
      // #1506: the rename attestation authorises the MOVE. It says nothing about
      // content, and a rename may carry removals right up to the similarity threshold —
      // so a rename would otherwise be a CHEAPER override than a modification, for a
      // strictly more destructive change. Content loss is measured on the renamed pair
      // and carries the modification arm's disposition.
      const lost = guard(() => index.measure(entry), UNDIFFABLE);
      if (lost === UNDIFFABLE) {
        console.log(`❌ UNDIFFABLE ${shownPath} — git reports this test file as RENAMED but produced no countable line diff for the renamed pair, ${UNMEASURED_TAIL}`);
        failures += 1;
        continue;
      }
      if (lost === 0) {
        console.log(
          `✅ RENAMED    ${shownOld} → ${shownPath} (canonical current-issue or legacy lineage rename override token present in a PR commit that renames this file)`,
        );
        passes += 1;
      } else if (guard(() => fileHasToken(baseRef, [entry.oldPath, entry.path], MOD_TOKEN), false)) {
        console.log(
          `✅ RENAMED    ${shownOld} → ${shownPath} (${lost} deleted lines; rename and modification override tokens both present in PR commits that touch this file)`,
        );
        passes += 1;
      } else {
        console.log(
          `❌ RENAMED    ${shownOld} → ${shownPath} — ${lost} deleted lines detected in the renamed file. The rename token authorises the MOVE only; removing lines while renaming needs the modification token as well. Write [TEST-MOD-APPROVED #ISSUE] with this work's canonical GitHub issue number (one or more digits, first digit 1-9; no leading zero or suffix) in a commit in this PR that touches this file, alongside the rename token — or restore the removed lines and keep the rename token alone. Legacy lineage citations remain accepted for historical work.`,
        );
        failures += 1;
      }
      continue;
    }
    if (entry.status === "M") {
      const deleted = guard(() => index.measure(entry), UNDIFFABLE);
      if (deleted === UNDIFFABLE) {
        console.log(
          `❌ UNDIFFABLE ${shownPath} — git reports this test file as CHANGED but produced no line diff for it, ${UNMEASURED_TAIL}`,
        );
        failures += 1;
        continue;
      }
      if (deleted === 0) {
        console.log(
          `✅ MODIFIED  ${shownPath} (additions only, 0 deleted lines)`,
        );
        passes += 1;
      } else if (guard(() => fileHasToken(baseRef, [entry.path], MOD_TOKEN), false)) {
        console.log(
          `✅ MODIFIED  ${shownPath} (${deleted} deleted lines; override token using a canonical current-issue or legacy lineage citation is present in a PR commit that modifies this file)`,
        );
        passes += 1;
      } else {
        console.log(
          `❌ MODIFIED  ${shownPath} — ${deleted} deleted lines detected. Test file modifications with deletions require an override token in a commit in this PR that modifies this file. None found. Write [TEST-MOD-APPROVED #ISSUE] with this work's canonical GitHub issue number (one or more digits, first digit 1-9; no leading zero or suffix). Legacy ORCH-NNNN and META-ORCH-NNNN lineage citations (optional -A suffix) remain accepted forever. Either restore the deleted lines (additions are always allowed), or put the token in that commit's body and explain there why the prior assertion was wrong.`,
        );
        failures += 1;
      }
      continue;
    }
    if (entry.status === "T") {
      console.log(
        `❌ TYPECHANGE ${shownPath} — this test file's git object TYPE changed (regular file <-> symlink <-> submodule gitlink). A typechange annihilates every assertion in the file exactly as a deletion does, so it is forbidden under the Pragmatic Append-Only policy (ORCH-0840 [Regression-test enforcement + append-only CI]). No override token bypasses a typechange. Restore the file as a regular file with its assertions intact.`,
      );
      failures += 1;
      continue;
    }
    console.log(
      `❌ ${entry.status.padEnd(10)} ${shownOld === undefined ? shownPath : `${shownOld} → ${shownPath}`} — UNRECOGNISED git status for a test file. This gate fails CLOSED: a status it cannot reason about is refused rather than waved through, because an unhandled status is how a test file's assertions get emptied silently. No override token bypasses an unrecognised status. Reduce the change to an ordinary add / modify / rename, or amend this gate to handle the status explicitly and say why it is safe.`,
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
//
// #1534: the self-test BUILDS repositories and SPAWNS this script against them, so it
// genuinely needs to start processes — but it must not hand that ability back to the gate.
// The import lives in this closure, below and outside everything above, so the gate's own
// code has no process runner in scope under any name: the only way for a future arm to
// read the repository is the accessor, and the only way to reach around it is to write a
// fresh import, which is a visible and deliberate act rather than an available shortcut.
const { runGitIn, runCheckIn, whichGit, stageIndexInfo } = (() => {
  const { execSync, execFileSync, spawnSync } = require("node:child_process");

  // `input` (#1534, default undefined — every pre-existing caller is unchanged) lets a
  // scenario stage bytes that cannot be spelled as an argument.
  function runGitIn(cwd, args, input) {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      input,
      stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
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

  // The absolute path of the real git, for the scenarios that put a stand-in in front of
  // it. Named rather than open-coded so no scenario needs a general command runner.
  function whichGit() {
    return execSync("command -v git", { encoding: "utf8" }).trim();
  }

  // Stage a record straight into a temp repo's index, for names the filesystem will not
  // accept as a file. Bytes, not text, so a path that is not text in any encoding survives.
  function stageIndexInfo(cwd, input) {
    return execFileSync("git", ["update-index", "--add", "--index-info"], { cwd, input });
  }

  return { runGitIn, runCheckIn, whichGit, stageIndexInfo };
})();

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
const APPROVED_ISSUE_922 = "[TEST-MOD-APPROVED #922] #922 [canonical issue token grammar]";

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
// [TEST-MOD-APPROVED #ISSUE]; commit2 (tip) guts b.test.ts with NO token anywhere.
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

// T52 (#1815 implementor happy path): a valid three-digit current-issue token
// authorises a same-file assertion correction even when a later docs-only commit is
// the tip. This jointly pins the canonical issue grammar and #1058's per-file,
// whole-range attribution contract.
function scenarioT52() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("three-digit.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    write("three-digit.test.ts", "expect(a).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "correct stale assertion", "-m", APPROVED_ISSUE_922);

    write("NOTES.md", "later documentation\n");
    g("add", "-A");
    g("commit", "-q", "-m", "docs: explain correction");

    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T53 (#1815 implementor happy path): the rename arm accepts the same canonical
// three-digit current-issue grammar end to end.
function scenarioT53() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("before.test.ts", "expect(a).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    g("mv", "before.test.ts", "after.test.ts");
    g("commit", "-q", "-m", "rename test", "-m", "[TEST-RENAME-APPROVED #922] #922 [canonical issue token grammar]");

    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T54 (#1815 tester adversarial): canonical and padded issue spellings sit beside
// each other in the same PR range. The truthful #922 token must authorize only its
// own file; padding the same number as #0922 must remain inert.
function scenarioT54() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("canonical.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\n");
    write("padded.test.ts", "expect(a).toBe(1);\nexpect(b).toBe(2);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    write("canonical.test.ts", "expect(a).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "canonical correction", "-m", APPROVED_ISSUE_922);

    write("padded.test.ts", "expect(a).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "padded correction", "-m", "[TEST-MOD-APPROVED #0922] #922 [noncanonical padding must fail]");

    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T55 (#1815 tester adversarial): the same canonical-versus-padded boundary is
// independently enforced by the rename authority.
function scenarioT55() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("canonical-before.test.ts", "expect(a).toBe(1);\n");
    write("padded-before.test.ts", "expect(a).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    g("mv", "canonical-before.test.ts", "canonical-after.test.ts");
    g("commit", "-q", "-m", "canonical rename", "-m", "[TEST-RENAME-APPROVED #922] #922 [canonical issue token grammar]");

    g("mv", "padded-before.test.ts", "padded-after.test.ts");
    g("commit", "-q", "-m", "padded rename", "-m", "[TEST-RENAME-APPROVED #0922] #922 [noncanonical padding must fail]");

    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T5 (#1495 tester adversarial) — SC-6 ENFORCED AT RUNTIME, not just as a literal.
// G-5 only asserts that the string "[TEST-MOD-APPROVED #ISSUE]" fails the regex; it
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
// patterns entirely. Two renames in the SAME range: one cites the canonical issue
// form (must pass), the other cites a bare number (must stay blocked) — which
// also proves the valid sibling token does not launder the invalid one across files.
// Fails-on-revert: the ORCH-only RENAME_TOKEN rejects `#1495`, so `✅ RENAMED` on
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

    // commit1: sanctioned rename, canonical issue form
    g("mv", "keep.test.ts", "kept.test.ts");
    g("commit", "-q", "-m", "sanctioned rename", "-m", "[TEST-RENAME-APPROVED #1495] #1495 [testmod marker grammar]");

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

// T10 (#1505) — the `T` arm is DIRECTION-AGNOSTIC. git's record reading prints the
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
// answers the record and counting reads with three unmodelled statuses and `exec`s the real git for
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

    const realGit = whichGit();
    const shim = [
      "#!/bin/sh",
      // The gate now takes identity from the RAW reading and counts from the counting
      // read, and reconciles the two. A stand-in that answers only one of them is
      // simulating a git whose own readings disagree — which the gate is now required to
      // refuse — so it must answer BOTH, consistently, to still exercise its arm.
      "raw=0; stats=0; z=0",
      'for arg in "$@"; do',
      '  case "$arg" in --raw) raw=1 ;; --numstat) stats=1 ;; -z) z=1 ;; esac',
      "done",
      'if [ "$raw" = 1 ]; then',
      '  if [ "$z" = 1 ]; then',
      "    printf ':100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 X\\000a.test.ts\\000:100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 M100\\000a.test.ts\\000:100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 C100\\000src.test.ts\\000dst.test.ts\\000'",
      "  else",
      "    printf ':100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 X\\ta.test.ts\\n'",
      "  fi",
      "  exit 0",
      "fi",
      'if [ "$stats" = 1 ]; then',
      '  if [ "$z" = 1 ]; then',
      "    printf '1\\t0\\ta.test.ts\\0001\\t0\\ta.test.ts\\0001\\t0\\t\\000src.test.ts\\000dst.test.ts\\000'",
      "  else",
      "    printf '1\\t0\\ta.test.ts\\n'",
      "  fi",
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

    const realGit = whichGit();
    // Distinct paths per status so each assertion is unambiguous.
    const shim = [
      "#!/bin/sh",
      // As T11: the stand-in must answer BOTH readings consistently, or it is simulating
      // a git the gate is now required to refuse rather than the boundary under test.
      "raw=0; stats=0; z=0",
      'for arg in "$@"; do',
      '  case "$arg" in --raw) raw=1 ;; --numstat) stats=1 ;; -z) z=1 ;; esac',
      "done",
      'if [ "$raw" = 1 ]; then',
      '  if [ "$z" = 1 ]; then',
      "    printf ':100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 U\\000u.test.ts\\000:100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 T100\\000t100.test.ts\\000:100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 t\\000lower.test.ts\\000:100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 \\000blank.test.ts\\000'",
      "  else",
      "    printf ':100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 U\\tu.test.ts\\n'",
      "  fi",
      "  exit 0",
      "fi",
      'if [ "$stats" = 1 ]; then',
      '  if [ "$z" = 1 ]; then',
      "    printf '1\\t0\\tu.test.ts\\0001\\t0\\tt100.test.ts\\0001\\t0\\tlower.test.ts\\0001\\t0\\tblank.test.ts\\000'",
      "  else",
      "    printf '1\\t0\\tu.test.ts\\n'",
      "  fi",
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

    const realGit = whichGit();
    const shim = [
      "#!/bin/sh",
      "stats=0",
      "rendered=0",
      "zed=0",
      'for arg in "$@"; do',
      '  case "$arg" in',
      "    --numstat) stats=1 ;;",
      "    --text) rendered=1 ;;",
      "    -z) zed=1 ;;",
      "  esac",
      "done",
      // Report the path as changed but decline to state a count for it.
      'if [ "$stats" = 1 ]; then',
      '  if [ "$zed" = 1 ]; then',
      "    printf '%b' '-\\t-\\ta.test.ts\\000'",
      "  else",
      "    printf '%b\\n' '-\\t-\\ta.test.ts'",
      "  fi",
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

// --- #1510 REWORK (T29..T31) --------------------------------------------------
// Independent verification of the first pass returned FAIL on two counts, both in how
// the path reached git rather than in how the count was taken. T29/T30 pin the first:
// the argument after `--` is matched as a PATTERN unless told otherwise, so a
// measurement scoped to one file could report on a different one. T31 pins the second:
// a change that alters only a file's metadata removes nothing and must never be
// refused, while the same change carrying real removals still must be.

// A test path containing characters that are significant to pattern matching, and a
// sibling that such a pattern also selects. The sibling sorts FIRST bytewise ("A" is
// 0x41, "[" is 0x5B), which is what makes the confusion observable: git emits its
// records in path order, so the sibling's record arrives ahead of the real file's.
const PATTERNISH_PATH = "z[A-Z].test.ts";
const SIBLING_PATH = "zA.test.ts";

// T29 (#1510 rework) — THE MEASUREMENT IS SCOPED TO ONE FILE. The path handed to git
// after `--` selects files by PATTERN by default, so a test file whose name contains
// pattern-significant characters can be measured against a DIFFERENT file's change.
// Here the sibling is a brand-new file that removes nothing, and its record sorts ahead
// of the real file's, so the real file's removals read as none at all. Seventeen paths
// in this repository carry such characters today, and a purpose-made name reaches the
// same place without needing any of them. The count reported must belong to the file
// named. Fails-on-revert: dropping literal matching reads the sibling's count instead
// and the entry prints as an additions-only pass, exit 0.
function scenarioT29() {
  const { dir, g, write } = makeTempRepo();
  try {
    write(PATTERNISH_PATH, FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    write(PATTERNISH_PATH, ONE_ASSERTION);
    write(SIBLING_PATH, "expect(s).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "remove three assertions beside a new sibling test file — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T30 (#1510 rework) — THE ATTESTATION IS SCOPED TO ONE FILE TOO. The same pattern
// matching applies when the gate asks which commits touched a file in order to find an
// override token, so a token legitimately covering one file could be read as covering a
// second one whose name happens to be selected by the first one's pattern. That is the
// cross-file laundering the whole per-file attribution design (#1058 F-2) exists to
// prevent, reached through the argument rather than through the attribution logic. The
// sibling's own sanctioned edit must still pass on its own token; the untokened file
// beside it must still be refused.
function scenarioT30() {
  const { dir, g, write } = makeTempRepo();
  try {
    write(PATTERNISH_PATH, FOUR_ASSERTIONS);
    write(SIBLING_PATH, "expect(s).toBe(1);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // commit1: a genuinely sanctioned removal in the sibling, carrying a valid token.
    write(SIBLING_PATH, "expect(s).toBe(2);\n");
    g("add", "-A");
    g("commit", "-q", "-m", "sanctioned assertion fix", "-m", APPROVED_ISSUE_FORM);

    // commit2: an UNSANCTIONED removal in the other file, no token anywhere.
    write(PATTERNISH_PATH, ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "remove three assertions — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T31 (#1510 rework) — METADATA-ONLY CHANGES REMOVE NOTHING, IN BOTH DIRECTIONS, AND
// THE SHORT-CIRCUIT THAT SAYS SO MUST NOT SWALLOW REAL REMOVALS. T28 covers one
// direction of the mode flip on a file git declines to render as text. This covers the
// other direction and — the part that matters — the case where a mode flip arrives
// TOGETHER WITH real assertion removals in the same file. A short-circuit that answered
// "metadata only, therefore zero" on content that did change would be a far worse
// false green than the refusal it was added to prevent, so all three shapes run in one
// commit and the tally is pinned exactly.
// Fails-on-revert: the combined case reads zero and the tally becomes 3 passed / 0
// failed, exit 0.
function scenarioT31() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("setx.test.ts", CONTROL_BYTE_DATA_LINE + FOUR_ASSERTIONS);
    write("clearx.test.ts", CONTROL_BYTE_DATA_LINE + FOUR_ASSERTIONS);
    write("both.test.ts", CONTROL_BYTE_DATA_LINE + FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    // clearx starts executable so the feature branch can clear the bit.
    g("update-index", "--chmod=+x", "clearx.test.ts");
    g("commit", "-q", "-m", "base carries the executable bit");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // Metadata AND content: three assertions genuinely removed, so this must be counted.
    write("both.test.ts", CONTROL_BYTE_DATA_LINE + ONE_ASSERTION);
    g("add", "-A");
    // Mode flips are forced through the index AFTER staging, so they are deterministic
    // regardless of core.fileMode and are not undone by the staging step above.
    // Metadata only, in both directions — content byte-identical, so nothing is removed.
    g("update-index", "--chmod=+x", "setx.test.ts");
    g("update-index", "--chmod=-x", "clearx.test.ts");
    g("update-index", "--chmod=+x", "both.test.ts");
    g("commit", "-q", "-m", "mode flips both ways, and one file also loses assertions — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T32 (#1510 rework, TESTER ADVERSARIAL — the INTERACTION) — T29/T30 pin scoping and
// T28/T31 pin the metadata short-circuit, but each in isolation, on files the other one
// never sees. They meet inside the same measurement: the short-circuit asks git a second
// question about the same path, so it inherits whatever scoping that path is subject to.
// A file that is BOTH pattern-named AND one git declines to render as text, changed in a
// way that removes nothing, sitting beside a file the pattern would select that DOES lose
// assertions, is the one shape where a slip in either fix is observable and a slip in
// scoping is observable in the SECOND question rather than the first. Each must answer
// for itself: the metadata-only file green, the sibling refused with its OWN count.
// Fails-on-revert: dropping literal matching reads the sibling's count onto the untouched
// file, dropping the short-circuit refuses it outright — either way the tally moves.
function scenarioT32() {
  const { dir, g, write } = makeTempRepo();
  try {
    write(PATTERNISH_PATH, CONTROL_BYTE_DATA_LINE + FOUR_ASSERTIONS);
    write(SIBLING_PATH, FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");

    // The pattern-named, unrenderable file changes its METADATA ONLY — nothing removed.
    // The sibling the pattern would select loses three assertions, with NO token.
    write(SIBLING_PATH, ONE_ASSERTION);
    g("add", "-A");
    g("update-index", "--chmod=+x", PATTERNISH_PATH);
    g("commit", "-q", "-m", "metadata-only beside a sibling that loses assertions — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}


// --- #1534 (whole-file hardening) — T34..T44 ----------------------------------------
// T1..T33 examine the arms one at a time and assume the path each arm was handed is the
// path git meant. These attack the seams: how a path REACHES an arm, the arms that
// conclude without measuring anything, and the two places the gate's own output is a
// working attestation.

// Spellings git will not print raw. Each is written with an ESCAPE in this source on
// purpose: the gate script must itself stay ordinary reviewable text.
const QUOTED_PATHS = [
  "src/__tests__/accenté.ts",
  'src/__tests__/qu"ote.ts',
  "src/__tests__/back\\slash.ts",
  "src/__tests__/tab\there.ts",
  "src/__tests__/nl\nhere.ts",
];

// T34 (#1511) — A PATH IS BYTES, AND THE ARMS MUST BE HANDED THE SAME BYTES GIT MEANT.
// When git will not print a path raw it prints an ESCAPED SPELLING of it instead, and
// that spelling is a different string: it can fail the test-file patterns outright, and
// when it does not, it names no file at all, so every later question about the path is
// asked about nothing and comes back empty. An empty answer then reads as "nothing was
// removed". Four spellings lose three assertions each in one run and must all be counted.
// Fails-on-revert: reading the records in the printed form reports each of these as an
// additions-only pass while twelve assertions are destroyed.
function scenarioT34() {
  const { dir, g, write } = makeTempRepo();
  try {
    fs.mkdirSync(nodePath.join(dir, "src", "__tests__"), { recursive: true });
    for (const rel of QUOTED_PATHS) write(rel, FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    for (const rel of QUOTED_PATHS) write(rel, ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "remove three assertions from each — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T35 (#1511, the strongest rule) — WHOLE-FILE DELETION SURVIVES PATH RECOVERY. Deletion
// is the one disposition no token overrides, so it is the one that matters most if a path
// never reaches the dispatch at all. A test file whose name git will not print raw was
// simply absent from the report: not refused, not mentioned, and the run reported that no
// test file had changed. T7 pins that deletion cannot be overridden; nothing pinned that
// deletion is SEEN. A second, ordinary test file is deleted in the same commit so the
// case cannot pass merely because the run went red for some other reason.
// Fails-on-revert: only the ordinary deletion is reported and the escaped one vanishes.
function scenarioT35() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("accenté.test.ts", FOUR_ASSERTIONS);
    write("plain.test.ts", FOUR_ASSERTIONS);
    write("keep.test.ts", ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    fs.unlinkSync(nodePath.join(dir, "accenté.test.ts"));
    fs.unlinkSync(nodePath.join(dir, "plain.test.ts"));
    g("add", "-A");
    g("commit", "-q", "-m", "delete both test files — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T36 (#1511, the byte floor) — a path whose bytes are not text in ANY encoding. Recovering
// the raw bytes is necessary but not sufficient: they still cannot be handed back to git as
// an argument, because arguments are text. So the count must come from a reading that never
// needs to name the path — and where it cannot, the answer must be a refusal rather than a
// zero. Built through the index, so it does not depend on the filesystem accepting the name.
// Fails-on-revert: reported as an additions-only pass with three assertions destroyed.
function scenarioT36() {
  const { dir, g, write } = makeTempRepo();
  try {
    const rawName = Buffer.concat([
      Buffer.from("src/__tests__/raw"),
      Buffer.from([0xff]),
      Buffer.from(".ts"),
    ]);
    const blob = (content) =>
      runGitIn(dir, ["hash-object", "-w", "--stdin"], content).trim();
    const stage = (oid) =>
      stageIndexInfo(dir, Buffer.concat([Buffer.from(`100644 ${oid}\t`), rawName, Buffer.from("\n")]));
    write("seed.test.ts", ONE_ASSERTION);
    g("add", "-A");
    stage(blob(FOUR_ASSERTIONS));
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    stage(blob(ONE_ASSERTION));
    g("commit", "-q", "-m", "remove three assertions — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T37 (#1506) — A RENAME IS NOT A CHEAPER OVERRIDE THAN A MODIFICATION. The rename token
// attests to the MOVE; it says nothing about content, and git will call a change a rename
// while a large share of the file is gone. So the same author, writing the same one token,
// could destroy more by renaming than by editing — the weaker attestation buying the more
// destructive change. Content loss on a rename now carries the modification arm's
// disposition: refused with its count on the rename token alone, allowed when both tokens
// are present, so the escape hatch is a second deliberate attestation and not a dead end.
// Fails-on-revert: the untokened half passes green with six assertions destroyed.
function scenarioT37() {
  const build = (bodies) => {
    const { dir, g, write } = makeTempRepo();
    const body = Array.from({ length: 40 }, (_, i) => `expect(v${i}).toBe(${i});`).join("\n") + "\n";
    write("old.test.ts", body);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    fs.unlinkSync(nodePath.join(dir, "old.test.ts"));
    write("new.test.ts", body.split("\n").slice(6).join("\n"));
    g("add", "-A");
    g("commit", "-q", "-m", "rename the file and drop six assertions", "-m", bodies);
    const r = runCheckIn(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return r;
  };
  return {
    renameOnly: build("[TEST-RENAME-APPROVED #1506] #1506 [rename arm]"),
    bothTokens: build("[TEST-RENAME-APPROVED #1506] [TEST-MOD-APPROVED #1506] #1506 [rename arm]"),
  };
}

// T38 (#1506, NEGATIVE CONTROL — the ship half) — measuring content on the rename arm must
// not make ordinary renames harder. A pure move, a rename that only ADDS, and a whole
// relocated __tests__/ directory are the three rename shapes this repository's history
// actually contains, and every one of them must still pass on the rename token ALONE, with
// no second token and no new concept for the author. All three in one run, tally pinned.
function scenarioT38() {
  const { dir, g, write } = makeTempRepo();
  try {
    fs.mkdirSync(nodePath.join(dir, "src", "__tests__"), { recursive: true });
    write("move.test.ts", FOUR_ASSERTIONS);
    write("grow.test.ts", FOUR_ASSERTIONS);
    write("src/__tests__/tree.test.ts", ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    g("mv", "move.test.ts", "moved.test.ts");
    fs.unlinkSync(nodePath.join(dir, "grow.test.ts"));
    write("grown.test.ts", FOUR_ASSERTIONS + "expect(e).toBe(5);\n");
    fs.mkdirSync(nodePath.join(dir, "lib"), { recursive: true });
    g("add", "-A");
    g("mv", "src/__tests__", "lib/__tests__");
    g("add", "-A");
    g("commit", "-q", "-m", "pure move, additive rename and a relocated tree", "-m",
      "[TEST-RENAME-APPROVED #1506] #1506 [rename arm]");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T39 (#1506 x #1510, THE INTERACTION) — the rename arm's new measurement meets the files
// git will not render as text. Recovering a count for those files means asking git a second
// question, and a rename is the one shape where asking about the file being measured is the
// WRONG question: the destination path did not exist before, so every surviving line reads
// as an addition and the removals disappear. The pair has to be asked about together. Both
// halves in one run: a pure move of such a file stays green on the rename token, and a move
// that also removes assertions is counted and refused. Neither fix is observable here
// without the other, which is why no single-arm case reaches it.
// Fails-on-revert: scoping the recovery to the destination reports zero and passes green.
function scenarioT39() {
  const { dir, g, write } = makeTempRepo();
  try {
    const body = CONTROL_BYTE_DATA_LINE +
      Array.from({ length: 40 }, (_, i) => `expect(v${i}).toBe(${i});`).join("\n") + "\n";
    write("move.test.ts", body);
    write("cut.test.ts", body);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    g("mv", "move.test.ts", "moved.test.ts");
    fs.unlinkSync(nodePath.join(dir, "cut.test.ts"));
    write("cut2.test.ts", body.split("\n").slice(6).join("\n"));
    g("add", "-A");
    g("commit", "-q", "-m", "move one, move-and-cut the other", "-m",
      "[TEST-RENAME-APPROVED #1506] #1506 [rename arm]");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T40 (#1527) — "ADDED" IS A STATEMENT ABOUT THIS RANGE, NOT ABOUT THE BASE BRANCH. The
// range is measured from where the branches parted, so a path the base branch gained after
// that point is genuinely absent from the comparison and the change that introduces it is
// reported as an addition — and additions are never measured. The version being introduced
// can therefore drop every assertion the base branch still has, and be waved through as a
// new file. The disposition is not enough on its own; what the base branch HOLDS decides.
// The token half pins that the escape hatch is the ordinary one and not a dead end.
// Fails-on-revert: trusting the disposition prints an unconditional pass for both halves.
function scenarioT40() {
  const build = (bodies) => {
    const { dir, g, write } = makeTempRepo();
    write("seed.md", "x\n");
    g("add", "-A");
    g("commit", "-q", "-m", "root");
    g("branch", "-M", "main");
    const parted = runGitIn(dir, ["rev-parse", "HEAD"]).trim();
    write("a.test.ts", FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "the base branch gains the test file after the branches part");
    g("checkout", "-q", "-b", "feature", parted);
    write("a.test.ts", ONE_ASSERTION);
    g("add", "-A");
    bodies
      ? g("commit", "-q", "-m", "introduce the same path with one assertion", "-m", bodies)
      : g("commit", "-q", "-m", "introduce the same path with one assertion — NO token");
    const r = runCheckIn(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return r;
  };
  return {
    noToken: build(null),
    withToken: build("[TEST-MOD-APPROVED #1527] #1527 [added path]"),
  };
}

// T41 (#1527, NEGATIVE CONTROL — the ship half) — consulting the base branch on every added
// path must not make adding test files harder, and adding test files is the single most
// common thing that happens to this gate. Three shapes in one run, all with NO token: a
// genuinely brand-new file, a new file under a brand-new __tests__/ tree, and a path the
// base branch gained after the branches parted where the introduced version ADDS to it
// rather than dropping anything. A fourth shape — the introduced version being byte-
// identical to the base branch's — is the one a real merged range in this repository's
// history actually produced, and it must be a pass rather than an unmeasurable refusal.
function scenarioT41() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("seed.md", "x\n");
    g("add", "-A");
    g("commit", "-q", "-m", "root");
    g("branch", "-M", "main");
    const parted = runGitIn(dir, ["rev-parse", "HEAD"]).trim();
    write("grown.test.ts", ONE_ASSERTION);
    write("same.test.ts", FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "the base branch gains two test files after the branches part");
    g("checkout", "-q", "-b", "feature", parted);
    fs.mkdirSync(nodePath.join(dir, "pkg", "__tests__"), { recursive: true });
    write("fresh.test.ts", ONE_ASSERTION);
    write("pkg/__tests__/tree.test.ts", ONE_ASSERTION);
    write("grown.test.ts", FOUR_ASSERTIONS);
    write("same.test.ts", FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "four added test paths, none of them losing anything — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T42 (#1534, THE DURABLE HALF) — the last place a count was still INFERRED rather than
// taken. #1510 removed two of them: a rendered diff with nothing to parse, and a rendered
// diff with no hunk. A third survived in the same function and was reachable without any of
// #1510's routes: when git names a test path as changed and then does not account for it at
// all, the gate read the silence as zero. Routes to that silence come and go with git
// versions, flags and file names; the terminal is what has to be pinned. A shim reports a
// test path as changed and then omits it from the accounting, and the tip carries BOTH valid
// override tokens, because a count nobody took is a count nobody can attest to.
// Fails-on-revert: a zero terminal prints an additions-only pass, exit 0.
function scenarioT42() {
  const repo = makeTempRepo();
  const shimDir = fs.mkdtempSync(
    nodePath.join(os.tmpdir(), "append-only-selftest-gitshim4-"),
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
    g("commit", "-q", "-m", "additions only", "-m",
      "[TEST-MOD-APPROVED #1534] [TEST-RENAME-APPROVED #1534] #1534 [gate hardening]");

    const realGit = whichGit();
    const shim = [
      "#!/bin/sh",
      "stats=0",
      'for arg in "$@"; do',
      '  case "$arg" in --numstat) stats=1 ;; esac',
      "done",
      // Name nothing at all, while the status read still reports the path as changed.
      'if [ "$stats" = 1 ]; then exit 0; fi',
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

// T43 (#1514 / #1534) — THE GATE'S OWN OUTPUT IS NOT AN ATTESTATION. The override token is
// a deliberate human statement; anything this run PRINTS that satisfies the grammar is a
// working attestation nobody wrote, sitting in a CI log where it can be copied into a
// commit body by an author who only meant to quote the error. T5/T13/T18/T26 hold that line
// for the arms that existed when each was written. Two surfaces were never covered: the
// arms added here, and the PATH — author-controlled text the gate echoes into every
// message, so a file NAMED like a token puts one in the output with no commit body involved.
function scenarioT43() {
  const { dir, g, write } = makeTempRepo();
  try {
    const named = "spelled-x[TEST-MOD-APPROVED #1234]-y.test.ts";
    write(named, FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    write(named, ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "remove three assertions — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T44 (#1534, THE SHIP DECIDER, against the REAL BYTES) — T22 and T28 use a constructed
// stand-in for the three test files in this repository that git will not render as text.
// This runs the actual bytes of those three files, read from this checkout, through every
// ordinary thing that happens to a maintained test file: an additions-only edit, a
// metadata-only change, and a removal carrying a valid token — each of which must be GREEN
// with no new requirement — plus a removal with no token, which must be refused. If the real
// files ever change shape, this case changes with them, which is the point: the stand-in
// cannot notice that, and these three files are the ones a false refusal would strand.
function scenarioT44() {
  const sources = [
    "mingla-marketing/lib/__tests__/links-src.tester.test.ts",
    "supabase/functions/_shared/__tests__/orch_1200_email_pipeline_adversarial.test.ts",
    "supabase/functions/_shared/adversarial_recordApiCall.test.ts",
  ];
  // Resolved WITHOUT assuming where this script sits. A revert harness runs the gate from
  // a copy, and a copy-relative lookup turns every such run into a spurious red for this
  // case — which corrupts precisely the per-fix revert evidence the case is meant to
  // support. Look upward from the script AND from the working directory, then ask git
  // from each; the first location that actually holds all three sources wins.
  const holdsAll = (dir) => sources.every((rel) => fs.existsSync(nodePath.join(dir, rel)));
  const walkUp = (start) => {
    let dir = nodePath.resolve(start);
    for (;;) {
      if (holdsAll(dir)) return dir;
      const up = nodePath.dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  };
  const gitTop = (cwd) => {
    try {
      return runGitIn(cwd, ["rev-parse", "--show-toplevel"]).trim();
    } catch {
      return null;
    }
  };
  const starts = [__dirname, process.cwd()];
  let root = null;
  for (const start of starts) {
    root = walkUp(start);
    if (root) break;
  }
  if (!root) {
    for (const start of starts) {
      const top = gitTop(start);
      if (top && holdsAll(top)) { root = top; break; }
    }
  }
  if (!root) root = nodePath.resolve(__dirname, "..", "..");
  const bytes = sources.map((rel) => {
    try {
      return fs.readFileSync(nodePath.join(root, rel));
    } catch {
      return null;
    }
  });
  const usable = bytes.filter(Boolean);
  // A missing source is a FAILING case, never a silently skipped one: this scenario
  // exists precisely to notice when those three files change shape or move. It has to
  // fail LOUDLY though — as a red case inside the tally, carrying the count that explains
  // why. Returning a partial shape here and letting the assertion dereference the missing
  // halves aborts the WHOLE self-test on an uncaught type error: no tally, no other
  // case's verdict, and a stack trace that reads as a broken script rather than as "one
  // of the three pinned files moved". That is the same containment failure this issue
  // closes on the operator side, and it would land on the exact day someone renames one
  // of these three files — the day this case is most worth reading.
  const ABSENT = { status: null, out: "" };
  if (usable.length !== sources.length) {
    return { count: usable.length, grow: ABSENT, meta: ABSENT, gutNoToken: ABSENT, gutToken: ABSENT };
  }
  const build = (writeStep, indexStep, body) => {
    const { dir, g } = makeTempRepo();
    usable.forEach((src, i) => fs.writeFileSync(nodePath.join(dir, `real${i}.test.ts`), src));
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    if (writeStep) writeStep(dir);
    g("add", "-A");
    // Mode flips are forced through the index AFTER staging, so they are deterministic
    // regardless of core.fileMode and are not undone by the staging step above.
    if (indexStep) indexStep(g);
    body
      ? g("commit", "-q", "-m", "edit the real files", "-m", body)
      : g("commit", "-q", "-m", "edit the real files — NO token");
    const r = runCheckIn(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return r;
  };
  const append = (dir) =>
    usable.forEach((src, i) =>
      fs.writeFileSync(nodePath.join(dir, `real${i}.test.ts`), Buffer.concat([src, Buffer.from("\n// appended\n")])));
  const chmod = (g) => usable.forEach((_, i) => g("update-index", "--chmod=+x", `real${i}.test.ts`));
  const gut = (dir) =>
    usable.forEach((src, i) =>
      fs.writeFileSync(nodePath.join(dir, `real${i}.test.ts`), src.subarray(0, Math.floor(src.length / 4))));
  return {
    count: usable.length,
    grow: build(append, null, null),
    meta: build(null, chmod, null),
    gutNoToken: build(gut, null, null),
    gutToken: build(gut, null, "[TEST-MOD-APPROVED #1534] #1534 [gate hardening]"),
  };
}

// A test path whose FIRST byte is one of the separators git's own record formats use to
// divide a record's columns. Written with an escape in this source on purpose: the gate
// script must itself stay ordinary reviewable text.
const SEPARATOR_LEADING_PATH = "\tlead.test.ts";

// T45 (#1534 rework) — THE TWO READINGS MUST BE ABOUT THE SAME RECORDS. The gate asks git
// two questions about one change: what changed, and by how much. Only one of the two
// answers separates every field with the record separator; the other packs its path in
// behind the count columns, and a path may BEGIN with the separator those columns use. A
// reader that decides a record's shape by whether a cell came out empty is then testing
// the path's first byte instead of the record, mistakes an ordinary record for a paired
// one, and swallows the records that follow. From that point the two readings are
// describing different files: the arms that fail closed refuse files that are fine, and
// the arm where an absent record honestly means "no difference" passes one that has been
// gutted. This runs the destructive face — a victim the base branch holds, stripped to a
// single assertion, beside such a path — and requires that the victim is still measured.
// Fails-on-revert: the victim prints an added pass and the run exits clean.
function scenarioT45() {
  const { dir, g, write } = makeTempRepo();
  try {
    write("seed.md", "x\n");
    g("add", "-A");
    g("commit", "-q", "-m", "root");
    g("branch", "-M", "main");
    const parted = runGitIn(dir, ["rev-parse", "HEAD"]).trim();
    write("victim.test.ts", FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "the base branch gains the victim after the branches part");
    g("checkout", "-q", "-b", "feature", parted);
    write(SEPARATOR_LEADING_PATH, ONE_ASSERTION);
    write("victim.test.ts", ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "introduce both — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T46 (#1534 rework, NEGATIVE CONTROL — the other face, and the ship half) — the same
// disagreement seen from the side that costs trust rather than safety. When the two
// readings come apart, the files that lose their record are not only the one being
// attacked: every entry after the mistake loses its place too, and the arms that fail
// closed refuse ORDINARY files, telling their author to repair content that is perfectly
// fine. A guard that red-lights innocent work gets switched off, which is worse than the
// hole. Three separator-bearing names sit beside three entirely ordinary ones and every
// single file only GROWS, so the only correct report is six passes and no refusal at all.
// Fails-on-revert: bystanders are refused as unmeasurable and the run exits red.
function scenarioT46() {
  const { dir, g, write } = makeTempRepo();
  try {
    const names = [
      SEPARATOR_LEADING_PATH,
      "mid\there.test.ts",
      "nl\nhere.test.ts",
      "aaa.test.ts",
      "bbb.test.ts",
      "zzz.test.ts",
    ];
    for (const rel of names) write(rel, ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    for (const rel of names) write(rel, FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "every one of them only grows — NO token");
    return runCheckIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// T47 (#1534 rework) — THE RECONCILIATION INVARIANT IS THE SOLE GUARD ON ONE ARM, so it is
// pinned there. Once the two readings are structurally prevented from diverging, the
// invariant is unreachable in every other case — which is the design, but it also means no
// case fails when it is deleted, and an assertion nobody notices the loss of is an assertion
// that rots. The added arm measures against the BASE-BRANCH comparison and therefore never
// consults this range's counts on its own account; the invariant is the only thing that
// checks the entry resolved at all. That is precisely where the reported finding landed: an
// arm where an absent record legitimately means "no difference", so a disagreement between
// the readings reads as "nothing was removed". Here a stand-in accounts for one of two
// changed test files and stays silent about the other, and BOTH must be refused — the run
// cannot report on either when it cannot agree with itself about what it is reporting on.
// Fails-on-revert: both files print an added pass and the run exits clean.
function scenarioT47() {
  const repo = makeTempRepo();
  const shimDir = fs.mkdtempSync(
    nodePath.join(os.tmpdir(), "append-only-selftest-gitshim5-"),
  );
  try {
    const { dir, g, write } = repo;
    write("seed.md", "x\n");
    g("add", "-A");
    g("commit", "-q", "-m", "root");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    write("a.test.ts", ONE_ASSERTION);
    write("b.test.ts", ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "two ordinary added test files, nothing removed anywhere");

    const realGit = whichGit();
    const shim = [
      "#!/bin/sh",
      "stats=0; z=0",
      'for arg in "$@"; do',
      '  case "$arg" in --numstat) stats=1 ;; -z) z=1 ;; esac',
      "done",
      // Account for one of the two, and say nothing about the other.
      'if [ "$stats" = 1 ] && [ "$z" = 1 ]; then',
      "  printf '%b' '1\\t0\\ta.test.ts\\000'",
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

// T48 (#1534 retest, TESTER ADVERSARIAL — THE OTHER READING) — T47 pins the reconciliation
// check on the arm it alone guards, but it can only reach that check through the reading the
// ENTRIES came from. This gate takes TWO readings, one per range, and the added arm is
// answered from the OTHER one — the base-branch comparison. That is the reading whose absent
// record legitimately means "no difference", which is exactly the reading a disagreement must
// never be allowed to imitate. T47 and this case are the same property asked of each reading
// in turn; a guard that covers one of two readings is a guard over half the surface, and the
// half it misses here is the half where absence is a pass.
// Fails-on-revert: the file prints an added pass and the run exits clean while the base
// branch's version of it is being replaced by a shorter one.
function scenarioT48() {
  const repo = makeTempRepo();
  const shimDir = fs.mkdtempSync(
    nodePath.join(os.tmpdir(), "append-only-selftest-gitshim6-"),
  );
  try {
    const { dir, g, write } = repo;
    write("seed.md", "x\n");
    g("add", "-A");
    g("commit", "-q", "-m", "root");
    g("branch", "-M", "main");
    // Branch BEFORE the maintained file exists, so this range calls it new.
    g("checkout", "-q", "-b", "feature");
    g("checkout", "-q", "main");
    write("a.test.ts", FOUR_ASSERTIONS);
    g("add", "-A");
    g("commit", "-q", "-m", "the maintained file lands on the base branch");
    g("checkout", "-q", "feature");
    write("a.test.ts", ONE_ASSERTION);
    g("add", "-A");
    g("commit", "-q", "-m", "introduce a shorter version of that same path — NO token");

    const realGit = whichGit();
    const shim = [
      "#!/bin/sh",
      "stats=0; spanning=0",
      'for arg in "$@"; do',
      '  case "$arg" in --numstat) stats=1 ;; *...*) spanning=1 ;; esac',
      "done",
      // Disagree ONLY on the base-branch comparison — the reading the added arm is
      // answered from — and leave the one the entries came from entirely alone.
      'if [ "$stats" = 1 ] && [ "$spanning" = 0 ]; then',
      `  ${JSON.stringify(realGit)} "$@"`,
      "  printf '%b' '1\\t1\\tzz-phantom.test.ts\\000'",
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

// T50 (#1534 final, TESTER ADVERSARIAL — THE EMPTY REPORT) — T47 and T48 pin what happens
// to an ENTRY when the readings disagree, one per reading. Neither can reach the case where
// the disagreement leaves nothing to report at all: "nothing here changed" and "I could not
// agree with myself about what changed" are opposite verdicts, and a reading that did not
// reconcile has not earned the right to say the first one. Measured: with the guard removed
// this prints the clean-run pass and exits zero, and no other case notices — so the branch
// that separates those two verdicts is load-bearing and, until now, unpinned. An assertion
// nobody notices the loss of is one that rots; this is the same argument the two cases above
// are built on, applied to the one exit they do not cover.
// Fails-on-revert: the run reports that no test file changed and exits clean.
function scenarioT50() {
  const repo = makeTempRepo();
  const shimDir = fs.mkdtempSync(
    nodePath.join(os.tmpdir(), "append-only-selftest-gitshim7-"),
  );
  try {
    const { dir, g, write } = repo;
    write("app.ts", "export const x = 1;\n");
    g("add", "-A");
    g("commit", "-q", "-m", "root");
    g("branch", "-M", "main");
    g("checkout", "-q", "-b", "feature");
    // A change that touches NO test file at all, so the report would otherwise be empty.
    write("app.ts", "export const x = 2;\n");
    g("add", "-A");
    g("commit", "-q", "-m", "ordinary work, no test file involved");

    const realGit = whichGit();
    const shim = [
      "#!/bin/sh",
      "stats=0; spanning=0",
      'for arg in "$@"; do',
      '  case "$arg" in --numstat) stats=1 ;; *...*) spanning=1 ;; esac',
      "done",
      'if [ "$stats" = 1 ] && [ "$spanning" = 1 ]; then',
      `  ${JSON.stringify(realGit)} "$@"`,
      "  printf '%b' '1\\t1\\tzz-phantom.test.ts\\000'",
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

function selfTest() {
  let failures = 0;
  let total = 0;
  // #1514 / #1534 (R-3): this stream's INPUTS are override-token literals by
  // construction, so printing them verbatim publishes a working attestation into every
  // CI log — a line an author could paste into a commit body and authorise a removal
  // they never meant to attest. Every line is redacted to the non-digit placeholder form
  // that the grammar cases above pin as INERT, and the whole transcript is retained so
  // the hygiene invariant can be asserted over what was ACTUALLY printed rather than
  // over a hand-picked subset.
  const transcript = [];
  const emit = (line) => {
    const safe = redactTokens(line);
    transcript.push(safe);
    console.log(safe);
  };
  const check = (ok, label, detail) => {
    total += 1;
    emit(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
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
    { input: "[TEST-MOD-APPROVED #1]", expect: true, label: "regex: one-digit canonical issue form" },
    { input: "[TEST-MOD-APPROVED #27]", expect: true, label: "regex: two-digit canonical issue form" },
    { input: "[TEST-MOD-APPROVED #922]", expect: true, label: "regex: three-digit canonical issue form" },
    { input: "[TEST-MOD-APPROVED #1485]", expect: true, label: "regex: four-digit canonical issue form" },
    { input: "[TEST-MOD-APPROVED #1485-A]", expect: false, label: "regex: current issue form rejects leg suffix" },
    { input: "[TEST-MOD-APPROVED 1485]", expect: false, label: "regex: bare number rejected — '#' required" },
    { input: "[TEST-MOD-APPROVED #ISSUE]", expect: false, label: "regex: operator-message placeholder is inert (no self-authorization by pasting CI output)" },
    { input: "[TEST-RENAME-APPROVED #1]", expect: true, re: RENAME_TOKEN, label: "regex: rename one-digit canonical issue form" },
    { input: "[TEST-RENAME-APPROVED #922]", expect: true, re: RENAME_TOKEN, label: "regex: rename three-digit canonical issue form" },
    { input: "[TEST-RENAME-APPROVED #1485]", expect: true, re: RENAME_TOKEN, label: "regex: rename four-digit canonical issue form" },
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
    // gate/workflow/docs print. G-5 only covers `[TEST-MOD-APPROVED #ISSUE]`.
    { input: "[TEST-MOD-APPROVED ORCH-####]", expect: false, label: "regex adversarial A-15: legacy '####' placeholder is inert" },
    { input: "[TEST-RENAME-APPROVED #ISSUE]", expect: false, re: RENAME_TOKEN, label: "regex adversarial A-16: rename placeholder is inert" },
    // A-17/A-18: the leg suffix is exactly one UPPERCASE letter.
    { input: "[TEST-MOD-APPROVED #1485-AB]", expect: false, label: "regex adversarial A-17: two-letter leg suffix rejected" },
    { input: "[TEST-MOD-APPROVED #1485-a]", expect: false, label: "regex adversarial A-18: lowercase leg suffix rejected" },
    // A-19..A-21: the accept side of the boundary. A-19 and A-21 go RED if either
    // regex is reverted to the ORCH-only form; A-20 goes RED if legacy support is
    // ever dropped (replayed from a token literally present in this repo's history).
    { input: "[TEST-MOD-APPROVED #12345]", expect: true, label: "regex adversarial A-19: five-digit canonical issue number accepted" },
    { input: "[TEST-MOD-APPROVED META-ORCH-1174-F]", expect: true, label: "regex adversarial A-20: real historical META-ORCH leg token from this repo's git history still accepted" },
    { input: "[TEST-RENAME-APPROVED #1485-A]", expect: false, re: RENAME_TOKEN, label: "regex adversarial A-21: rename current issue form rejects leg suffix" },
    // --- #1815 TESTER ADVERSARIAL (B-1..B-40) -------------------------------
    // Canonical current issues are positive ASCII decimals with no leading zero.
    { input: "[TEST-MOD-APPROVED #0]", expect: false, label: "regex adversarial B-1: MOD rejects zero issue" },
    { input: "[TEST-MOD-APPROVED #00]", expect: false, label: "regex adversarial B-2: MOD rejects repeated zero issue" },
    { input: "[TEST-MOD-APPROVED #01]", expect: false, label: "regex adversarial B-3: MOD rejects leading-zero one-digit issue" },
    { input: "[TEST-MOD-APPROVED #0922]", expect: false, label: "regex adversarial B-4: MOD rejects padded three-digit issue" },
    { input: "[TEST-MOD-APPROVED #000922]", expect: false, label: "regex adversarial B-5: MOD rejects multiply padded issue" },
    { input: "[TEST-RENAME-APPROVED #0]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-6: RENAME rejects zero issue" },
    { input: "[TEST-RENAME-APPROVED #00]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-7: RENAME rejects repeated zero issue" },
    { input: "[TEST-RENAME-APPROVED #01]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-8: RENAME rejects leading-zero one-digit issue" },
    { input: "[TEST-RENAME-APPROVED #0922]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-9: RENAME rejects padded three-digit issue" },
    { input: "[TEST-RENAME-APPROVED #000922]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-10: RENAME rejects multiply padded issue" },
    // Current issue citations never inherit the legacy leg suffix.
    { input: "[TEST-MOD-APPROVED #922-A]", expect: false, label: "regex adversarial B-11: MOD rejects uppercase issue suffix" },
    { input: "[TEST-MOD-APPROVED #922-a]", expect: false, label: "regex adversarial B-12: MOD rejects lowercase issue suffix" },
    { input: "[TEST-MOD-APPROVED #922-AB]", expect: false, label: "regex adversarial B-13: MOD rejects multi-letter issue suffix" },
    { input: "[TEST-RENAME-APPROVED #922-A]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-14: RENAME rejects uppercase issue suffix" },
    { input: "[TEST-RENAME-APPROVED #922-a]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-15: RENAME rejects lowercase issue suffix" },
    { input: "[TEST-RENAME-APPROVED #922-AB]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-16: RENAME rejects multi-letter issue suffix" },
    // Only ASCII '#' and ASCII digits are accepted.
    { input: "[TEST-MOD-APPROVED ＃922]", expect: false, label: "regex adversarial B-17: MOD rejects fullwidth number sign" },
    { input: "[TEST-MOD-APPROVED #٩٢٢]", expect: false, label: "regex adversarial B-18: MOD rejects Arabic-Indic digits" },
    { input: "[TEST-MOD-APPROVED #９２２]", expect: false, label: "regex adversarial B-19: MOD rejects fullwidth digits" },
    { input: "[TEST-RENAME-APPROVED ＃922]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-20: RENAME rejects fullwidth number sign" },
    { input: "[TEST-RENAME-APPROVED #٩٢٢]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-21: RENAME rejects Arabic-Indic digits" },
    { input: "[TEST-RENAME-APPROVED #９２２]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-22: RENAME rejects fullwidth digits" },
    // Bare/wrong prefixes and relaxed token shapes remain inert.
    { input: "[TEST-MOD-APPROVED ISSUE-922]", expect: false, label: "regex adversarial B-23: MOD rejects uppercase ISSUE prefix" },
    { input: "[TEST-MOD-APPROVED issue #922]", expect: false, label: "regex adversarial B-24: MOD rejects prose issue prefix" },
    { input: "[TEST-RENAME-APPROVED ISSUE-922]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-25: RENAME rejects uppercase ISSUE prefix" },
    { input: "[TEST-RENAME-APPROVED issue #922]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-26: RENAME rejects prose issue prefix" },
    { input: "[TEST-RENAME-APPROVED  #922]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-27: RENAME rejects double separator" },
    { input: "[TEST-RENAME-APPROVED #922 ]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-28: RENAME rejects trailing whitespace" },
    { input: "[TEST-RENAME-APPROVED\n#922]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-29: RENAME rejects split-line token" },
    { input: "[TEST-RENAME-APPROVED #922 because approved]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-30: RENAME rejects prose inside token" },
    // The four-digit legacy minimum and optional uppercase leg remain byte-compatible.
    { input: "[TEST-MOD-APPROVED ORCH-0922]", expect: true, label: "regex adversarial B-31: MOD preserves four-digit legacy ORCH" },
    { input: "[TEST-MOD-APPROVED ORCH-12345]", expect: true, label: "regex adversarial B-32: MOD preserves five-digit legacy ORCH" },
    { input: "[TEST-RENAME-APPROVED ORCH-0840-A]", expect: true, re: RENAME_TOKEN, label: "regex adversarial B-33: RENAME preserves legacy uppercase leg" },
    { input: "[TEST-RENAME-APPROVED META-ORCH-0001-A]", expect: true, re: RENAME_TOKEN, label: "regex adversarial B-34: RENAME preserves legacy META-ORCH leg" },
    { input: "[TEST-MOD-APPROVED ORCH-922]", expect: false, label: "regex adversarial B-35: MOD rejects three-digit legacy ORCH" },
    { input: "[TEST-MOD-APPROVED META-ORCH-922]", expect: false, label: "regex adversarial B-36: MOD rejects three-digit legacy META-ORCH" },
    { input: "[TEST-RENAME-APPROVED ORCH-922]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-37: RENAME rejects three-digit legacy ORCH" },
    { input: "[TEST-RENAME-APPROVED META-ORCH-922]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-38: RENAME rejects three-digit legacy META-ORCH" },
    // Authority separation is pinned again at the newly admitted short boundary.
    { input: "[TEST-RENAME-APPROVED #922]", expect: false, label: "regex adversarial B-39: short RENAME token never satisfies MOD" },
    { input: "[TEST-MOD-APPROVED #922]", expect: false, re: RENAME_TOKEN, label: "regex adversarial B-40: short MOD token never satisfies RENAME" },
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
    "T4 (#1495): canonical issue-number modification token honored end-to-end while an untokened b.test.ts deletion stays blocked",
    `check exited ${t4.status} (expected 1); names b.test.ts=${t4NamesB}; a.test.ts passes=${t4PassesA}`,
  );

  const t52 = scenarioT52();
  check(
    t52.status === 0 && /✅[^\n]*three-digit\.test\.ts/.test(t52.out),
    "T52 (#1815 implementor): three-digit #922 modification token works end-to-end from a non-tip same-file commit",
    `check exited ${t52.status} (expected 0); file passed=${/✅[^\n]*three-digit\.test\.ts/.test(t52.out)}`,
  );

  const t53 = scenarioT53();
  check(
    t53.status === 0 && /✅[^\n]*after\.test\.ts/.test(t53.out),
    "T53 (#1815 implementor): three-digit #922 rename token works end-to-end",
    `check exited ${t53.status} (expected 0); renamed file passed=${/✅[^\n]*after\.test\.ts/.test(t53.out)}`,
  );

  const t54 = scenarioT54();
  const t54Canonical = /✅[^\n]*canonical\.test\.ts/.test(t54.out);
  const t54Padded = /❌[^\n]*padded\.test\.ts/.test(t54.out);
  const t54Tally = /Append-only check: 1 passed, 1 failed\./.test(t54.out);
  check(
    t54.status === 1 && t54Canonical && t54Padded && t54Tally,
    "T54 (#1815 tester adversarial): canonical #922 authorizes its own deletion while padded #0922 stays inert beside it",
    `check exited ${t54.status} (expected 1); canonical passed=${t54Canonical}; padded refused=${t54Padded}; tally 1/1=${t54Tally}`,
  );

  const t55 = scenarioT55();
  const t55Canonical = /✅[^\n]*canonical-before\.test\.ts[^\n]*canonical-after\.test\.ts/.test(t55.out);
  const t55Padded = /❌[^\n]*padded-before\.test\.ts[^\n]*padded-after\.test\.ts/.test(t55.out);
  const t55Tally = /Append-only check: 1 passed, 1 failed\./.test(t55.out);
  check(
    t55.status === 1 && t55Canonical && t55Padded && t55Tally,
    "T55 (#1815 tester adversarial): canonical #922 authorizes its own rename while padded #0922 stays inert beside it",
    `check exited ${t55.status} (expected 1); canonical passed=${t55Canonical}; padded refused=${t55Padded}; tally 1/1=${t55Tally}`,
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
    "T6 (#1495 tester adversarial): RENAME arm end-to-end — canonical current-issue token honored through git while a bare-number rename in the same range stays blocked",
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
  // The token half pins WHICH passing branch fired, not merely that the run exited 0.
  // "Exit 0" cannot tell "the override token authorised a MEASURED removal" apart from
  // "the count was silently read as zero and no token was ever consulted" — and that
  // second reading is this issue's entire defect class, so the weak form would not
  // substantively test anything. The Q3-decisive green-in-both-directions property
  // rides on the additions-only half above, which is unaffected by this.
  const t22Token = /✅[^\n]*MODIFIED[^\n]*a\.test\.ts[^\n]*3 deleted lines; override token/.test(t22.token.out);
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

  // --- #1510 REWORK (T29..T31) ---
  const t29 = scenarioT29();
  const t29Refuses = t29.out.includes(`❌ MODIFIED  ${PATTERNISH_PATH} — 3 deleted lines`);
  const t29Sibling = t29.out.includes(`✅ ADDED      ${SIBLING_PATH}`);
  const t29Tally = /Append-only check: 1 passed, 1 failed\./.test(t29.out);
  check(
    t29.status === 1 && t29Refuses && t29Sibling && t29Tally,
    "T29 (#1510 rework): the measurement is scoped to the file being measured — a test path containing pattern-significant characters is counted against ITS OWN change, not against a sibling that the same pattern selects and whose record git emits first. The sibling here removes nothing, so a substituted count reads as an additions-only pass while three assertions are destroyed",
    `check exited ${t29.status} (expected 1); own count reported=${t29Refuses}; sibling passes on its own merit=${t29Sibling}; tally 1/1=${t29Tally}`,
  );

  const t30 = scenarioT30();
  const t30Refuses = t30.out.includes(`❌ MODIFIED  ${PATTERNISH_PATH} — 3 deleted lines`);
  const t30Sibling = t30.out.includes(`✅ MODIFIED  ${SIBLING_PATH}`);
  const t30Tally = /Append-only check: 1 passed, 1 failed\./.test(t30.out);
  check(
    t30.status === 1 && t30Refuses && t30Sibling && t30Tally,
    "T30 (#1510 rework): the override attestation is scoped to the file it was written for — a valid token covering one test file does not carry over to a second file merely because the second file's name is selected by the first one's pattern. The sibling's own sanctioned edit still passes on its own token; the untokened removals beside it are still refused",
    `check exited ${t30.status} (expected 1); untokened file refused=${t30Refuses}; sanctioned sibling still passes=${t30Sibling}; tally 1/1=${t30Tally}`,
  );

  const t31 = scenarioT31();
  const t31SetX = /✅[^\n]*MODIFIED[^\n]*setx\.test\.ts[^\n]*additions only, 0 deleted lines/.test(t31.out);
  const t31ClearX = /✅[^\n]*MODIFIED[^\n]*clearx\.test\.ts[^\n]*additions only, 0 deleted lines/.test(t31.out);
  const t31Both = /❌[^\n]*MODIFIED[^\n]*both\.test\.ts[^\n]*3 deleted lines/.test(t31.out);
  const t31Tally = /Append-only check: 2 passed, 1 failed\./.test(t31.out);
  check(
    t31.status === 1 && t31SetX && t31ClearX && t31Both && t31Tally,
    "T31 (#1510 rework): on a file git declines to render as text, a metadata-only change removes nothing and stays GREEN in BOTH directions of the mode flip with no token — and the short-circuit that establishes this does NOT swallow real removals, because the same commit flips the mode on a third file that also loses three assertions and that file is still counted and refused. Exactly 2 passed / 1 failed",
    `check exited ${t31.status} (expected 1); mode set=${t31SetX}; mode cleared=${t31ClearX}; mode+removals still counted=${t31Both}; tally 2/1=${t31Tally}`,
  );

  const t32 = scenarioT32();
  const t32Quiet = /✅[^\n]*MODIFIED[^\n]*z\[A-Z\]\.test\.ts[^\n]*additions only, 0 deleted lines/.test(t32.out);
  const t32Sibling = /❌[^\n]*MODIFIED[^\n]*zA\.test\.ts[^\n]*3 deleted lines/.test(t32.out);
  const t32Tally = /Append-only check: 1 passed, 1 failed\./.test(t32.out);
  check(
    t32.status === 1 && t32Quiet && t32Sibling && t32Tally,
    "T32 (#1510 rework, tester adversarial — the interaction): scoping and the metadata short-circuit meet inside one measurement, because the short-circuit asks git a SECOND question about the same path and inherits that path's scoping. A file that is both pattern-named and one git declines to render as text, changed so that nothing is removed, beside a file the pattern would select that DOES lose assertions — each answers for itself: the metadata-only file stays green, the sibling is refused with its OWN count, tally exactly 1 passed / 1 failed",
    `check exited ${t32.status} (expected 1); metadata-only file green=${t32Quiet}; sibling refused with its own count=${t32Sibling}; tally 1/1=${t32Tally}`,
  );

  const t34 = scenarioT34();
  // Matched on the count per refused entry rather than on the printed spelling: a path
  // carrying a control character is QUOTED in the report so that one entry stays on one
  // line, so the printed form is deliberately not the raw path.
  const t34Counted = (t34.out.match(/❌[^\n]*MODIFIED[^\n]*3 deleted lines/g) || []).length === QUOTED_PATHS.length;
  const t34Tally = /Append-only check: 0 passed, 5 failed\./.test(t34.out);
  check(
    t34.status === 1 && t34Counted && t34Tally,
    "T34 (#1511): a test path git will not print raw is still measured against its own change — five spellings that git escapes in its output each lose three assertions in one run and are each refused, because the escaped spelling names no file and every question asked about it comes back empty, which reads as nothing removed",
    `check exited ${t34.status} (expected 1); all five counted=${t34Counted}; tally 0/5=${t34Tally}`,
  );

  const t35 = scenarioT35();
  const t35Escaped = /❌[^\n]*DELETED[^\n]*accent/.test(t35.out);
  const t35Plain = /❌[^\n]*DELETED[^\n]*plain\.test\.ts/.test(t35.out);
  const t35Tally = /Append-only check: 0 passed, 2 failed\./.test(t35.out);
  check(
    t35.status === 1 && t35Escaped && t35Plain && t35Tally,
    "T35 (#1511, the strongest rule): whole-file DELETION of a test path git will not print raw is SEEN and refused — T7 pins that deletion cannot be overridden, but a deletion the dispatch never receives is not overridden, it is invisible, and the run reported that no test file had changed at all",
    `check exited ${t35.status} (expected 1); escaped deletion refused=${t35Escaped}; ordinary deletion refused=${t35Plain}; tally 0/2=${t35Tally}`,
  );

  const t36 = scenarioT36();
  const t36Refused = t36.status === 1 && /3 deleted lines/.test(t36.out);
  check(
    t36Refused,
    "T36 (#1511, the byte floor): a test path whose bytes are not text in any encoding is still measured — recovering the raw bytes is necessary but not sufficient, because they cannot be handed back as an argument, so the count must come from a reading that never has to name the path",
    `check exited ${t36.status} (expected 1); measured and refused=${t36Refused}`,
  );

  const t37 = scenarioT37();
  const t37Refused = /❌[^\n]*RENAMED[^\n]*6 deleted lines detected in the renamed file/.test(t37.renameOnly.out);
  const t37Allowed = /✅[^\n]*RENAMED[^\n]*6 deleted lines; rename and modification override tokens/.test(t37.bothTokens.out);
  check(
    t37.renameOnly.status === 1 && t37Refused && t37.bothTokens.status === 0 && t37Allowed,
    "T37 (#1506): a rename is not a cheaper override than a modification — git calls a change a rename while a large share of the file is gone, so one rename token could buy more destruction than the modification token it substitutes for. Content loss on a rename now carries the modification arm's disposition, and both tokens together still authorise it",
    `rename-token-only exited ${t37.renameOnly.status} (expected 1), refused with its count=${t37Refused}; both-tokens exited ${t37.bothTokens.status} (expected 0), honoured=${t37Allowed}`,
  );

  const t38 = scenarioT38();
  const t38Move = /✅[^\n]*RENAMED[^\n]*moved\.test\.ts/.test(t38.out);
  const t38Grow = /✅[^\n]*RENAMED[^\n]*grown\.test\.ts/.test(t38.out);
  const t38Tree = /✅[^\n]*RENAMED[^\n]*lib\/__tests__\/tree\.test\.ts/.test(t38.out);
  check(
    t38.status === 0 && t38Move && t38Grow && t38Tree,
    "T38 (#1506, negative control): measuring content on the rename arm does not make ordinary renames harder — a pure move, a rename that only adds, and a relocated __tests__/ directory are the three rename shapes this repository's history contains, and all three still pass on the rename token ALONE with no second token and no new concept",
    `check exited ${t38.status} (expected 0); pure move=${t38Move}; additive rename=${t38Grow}; relocated tree=${t38Tree}`,
  );

  const t39 = scenarioT39();
  const t39Move = /✅[^\n]*RENAMED[^\n]*moved\.test\.ts/.test(t39.out);
  const t39Cut = /❌[^\n]*RENAMED[^\n]*cut2\.test\.ts[^\n]*6 deleted lines/.test(t39.out);
  const t39Tally = /Append-only check: 1 passed, 1 failed\./.test(t39.out);
  check(
    t39.status === 1 && t39Move && t39Cut && t39Tally,
    "T39 (#1506 x #1510, the interaction): the rename arm's measurement meets the files git will not render as text, and a rename is the one shape where asking about the file being measured is the wrong question — the destination did not exist before, so every surviving line reads as an addition and the removals vanish. Neither fix is observable here without the other",
    `check exited ${t39.status} (expected 1); pure move stays green=${t39Move}; move-and-cut counted=${t39Cut}; tally 1/1=${t39Tally}`,
  );

  const t40 = scenarioT40();
  const t40Refused = /❌[^\n]*ADDED[^\n]*ALREADY EXISTS on the base branch/.test(t40.noToken.out);
  const t40Allowed = /✅[^\n]*ADDED[^\n]*attested by an override token/.test(t40.withToken.out);
  check(
    t40.noToken.status === 1 && t40Refused && t40.withToken.status === 0 && t40Allowed,
    "T40 (#1527): a status of added is a statement about this range, not about the base branch — a path the base branch gained after the branches parted is genuinely absent from the comparison, so a version that drops every assertion the base branch still holds was waved through as a new file. What the base branch HOLDS decides, and the ordinary token is still the way out",
    `untokened exited ${t40.noToken.status} (expected 1), refused=${t40Refused}; tokened exited ${t40.withToken.status} (expected 0), honoured=${t40Allowed}`,
  );

  const t41 = scenarioT41();
  const t41Fresh = /✅[^\n]*ADDED[^\n]*fresh\.test\.ts/.test(t41.out);
  const t41Tree = /✅[^\n]*ADDED[^\n]*pkg\/__tests__\/tree\.test\.ts/.test(t41.out);
  const t41Grown = /✅[^\n]*ADDED[^\n]*grown\.test\.ts/.test(t41.out);
  const t41Same = /✅[^\n]*ADDED[^\n]*same\.test\.ts/.test(t41.out);
  check(
    t41.status === 0 && t41Fresh && t41Tree && t41Grown && t41Same,
    "T41 (#1527, negative control): consulting the base branch on every added path does not make ADDING test files harder, which is the most common thing that happens to this gate — a brand-new file, a brand-new __tests__/ tree, an introduced version that only adds to what the base branch holds, and one that is byte-identical to it all stay GREEN with no token. The identical case is the shape a real merged range in this repository produced",
    `check exited ${t41.status} (expected 0); brand new=${t41Fresh}; new tree=${t41Tree}; additive over upstream=${t41Grown}; identical to upstream=${t41Same}`,
  );

  const t42 = scenarioT42();
  const t42Refused = /❌ UNDIFFABLE a\.test\.ts/.test(t42.out);
  const t42Tally = /Append-only check: 0 passed, 1 failed\./.test(t42.out);
  check(
    t42.status === 1 && t42Refused && t42Tally,
    "T42 (#1534, the durable half): the LAST place a count was inferred rather than taken — when git names a test path as changed and then does not account for it at all, the silence was read as zero. #1510 removed two such inferences from this same function; this was the third, reachable without any of #1510's routes, and refused now even with BOTH valid override tokens on the tip because a count nobody took is a count nobody can attest to",
    `check exited ${t42.status} (expected 1); refused=${t42Refused}; tally 0/1=${t42Tally}`,
  );

  const t43 = scenarioT43();
  const t43Out = `${t37.renameOnly.out}\n${t40.noToken.out}\n${t42.out}\n${t43.out}`;
  const t43Exercised =
    /❌[^\n]*RENAMED[^\n]*deleted lines detected in the renamed file/.test(t37.renameOnly.out) &&
    /❌[^\n]*ADDED[^\n]*ALREADY EXISTS on the base branch/.test(t40.noToken.out) &&
    /❌ UNDIFFABLE/.test(t42.out) &&
    t43.out.includes("TEST-MOD-APPROVED");
  const t43ModLeak = MOD_TOKEN.test(t43Out);
  const t43RenameLeak = RENAME_TOKEN.test(t43Out);
  const t43Offenders = t43Out
    .split("\n")
    .filter((l) => MOD_TOKEN.test(l) || RENAME_TOKEN.test(l))
    .map((l) => l.trim().slice(0, 120));
  check(
    t43Exercised && !t43ModLeak && !t43RenameLeak,
    "T43 (#1514 / #1534, SC-6 over the surfaces no earlier case reads): neither arm added here prints a working override token, and neither does a test file whose own NAME is spelled like one — a path is author-controlled text that this gate echoes into every message, so the output can carry an attestation nobody wrote with no commit body involved at all",
    `branches exercised=${t43Exercised}; MOD leak=${t43ModLeak}; RENAME leak=${t43RenameLeak}${t43Offenders.length ? `; offending output: ${JSON.stringify(t43Offenders)}` : ""}`,
  );

  const t44 = scenarioT44();
  const t44Grow = t44.grow.status === 0 && !t44.grow.out.includes("❌");
  const t44Meta = t44.meta.status === 0 && !t44.meta.out.includes("❌");
  const t44Gut = t44.gutNoToken.status === 1;
  const t44Token = t44.gutToken.status === 0 && /override token/.test(t44.gutToken.out);
  check(
    t44.count === 3 && t44Grow && t44Meta && t44Gut && t44Token,
    "T44 (#1534, THE SHIP DECIDER against the REAL BYTES): the three test files in this repository that git will not render as text, run through every ordinary thing that happens to a maintained test file. An additions-only edit, a metadata-only change and a token-authorised removal are each GREEN with no new requirement; an untokened removal is refused. T22 and T28 use a constructed stand-in, which cannot notice if the real files change shape — these are the files a false refusal would strand with no way out",
    `real sources found=${t44.count} (expected 3); additions-only green=${t44Grow}; metadata-only green=${t44Meta}; untokened removal refused=${t44Gut}; tokened removal honoured=${t44Token}`,
  );

  const t45 = scenarioT45();
  const t45Victim = /❌[^\n]*ADDED[^\n]*victim\.test\.ts[^\n]*ALREADY EXISTS on the base branch/.test(t45.out);
  const t45BothSeen = t45.out.split("\n").filter((l) => /^(✅|❌)/.test(l)).length === 2;
  const t45Tally = /Append-only check: 1 passed, 1 failed\./.test(t45.out);
  check(
    t45.status === 1 && t45Victim && t45BothSeen && t45Tally,
    "T45 (#1534 rework): the two readings the gate takes of one change must be about the same records — only one of them separates every field with the record separator, and a test path that BEGINS with the separator the other one packs its columns behind made an ordinary record read as a paired one, swallowing the records that followed. A file the base branch holds, stripped to a single assertion beside such a path, is still measured and still refused",
    `check exited ${t45.status} (expected 1); victim measured and refused=${t45Victim}; both entries present in the report=${t45BothSeen}; tally 1/1=${t45Tally}`,
  );

  const t47 = scenarioT47();
  const t47A = /❌ UNDIFFABLE a\.test\.ts[^\n]*does not account for it/.test(t47.out);
  const t47B = /❌ UNDIFFABLE b\.test\.ts[^\n]*does not account for it/.test(t47.out);
  const t47Tally = /Append-only check: 0 passed, 2 failed\./.test(t47.out);
  check(
    t47.status === 1 && t47A && t47B && t47Tally,
    "T47 (#1534 rework): the arm where an absent record legitimately means no difference is the one arm the reconciliation check is the SOLE guard for, and it is pinned there — a run whose two readings account for one changed test file and stay silent about the other cannot report on EITHER, because it cannot agree with itself about what it is reporting on. Once divergence is structurally prevented this assertion is unreachable everywhere else, which is the design and also the reason it needs a case of its own: an assertion nobody notices the loss of is one that rots",
    `check exited ${t47.status} (expected 1); accounted-for file refused=${t47A}; unaccounted-for file refused=${t47B}; tally 0/2=${t47Tally}`,
  );

  // T49 (#1534 retest) — THE FAIL-CLOSED DEFAULT, ASSERTED DIRECTLY. Every other case
  // reaches this terminal through an arm, and each of those arms now has something in front
  // of it that gets there first: the entry range is covered by the reconciliation check, and
  // the base-branch range is answered with an explicit reading of what absence means there.
  // So no whole-gate scenario can turn this default red, and a default nothing can turn red
  // is one a future edit can quietly invert. It is asserted here on its own terms instead —
  // the terminal is a pure function of a reading, so it can simply be handed one.
  //
  // The two meanings are the point. A reading that has no record for a path it was asked
  // about has NOT measured it, and the safe answer is a refusal; a caller that knows absence
  // is legitimate over ITS range says so explicitly. Getting these the wrong way round is
  // this issue's entire subject, in both directions: silently zero waves through a gutted
  // file, silently unmeasurable red-lights an identical one.
  const t49Entry = { status: "M", path: "a.test.ts" };
  const t49Absent = { range: ["base...HEAD"], numstat: new Map(), oids: new Map() };
  const t49Present = {
    range: ["base...HEAD"],
    numstat: new Map([["a.test.ts", 7]]),
    oids: new Map(),
  };
  const t49Boom = () => {
    throw new Error("the recovery read must not be reached when there is no record at all");
  };
  const t49DefaultRefuses = measureFromIndex(t49Entry, t49Absent, t49Boom) === UNDIFFABLE;
  const t49ExplicitZero = measureFromIndex(t49Entry, t49Absent, t49Boom, 0) === 0;
  const t49CountsWhenKnown = measureFromIndex(t49Entry, t49Present, t49Boom) === 7;
  check(
    t49DefaultRefuses && t49ExplicitZero && t49CountsWhenKnown,
    "T49 (#1534 retest): the measurement terminal REFUSES by default when the reading it was handed has no record for the path, and returns a real zero only when a caller states that absence is legitimate over its own range. Asserted on the terminal itself because every arm that reaches it now has a guard in front of it, and a default that no case can turn red is one a future edit can quietly invert",
    `absent + no stated meaning refuses=${t49DefaultRefuses}; absent + stated zero returns zero=${t49ExplicitZero}; a known count is still returned=${t49CountsWhenKnown}`,
  );

  const t48 = scenarioT48();
  const t48Passed = /✅ ADDED\s+a\.test\.ts/.test(t48.out);
  const t48Refused = /❌[^\n]*a\.test\.ts/.test(t48.out);
  check(
    t48.status === 1 && t48Refused && !t48Passed,
    "T48 (#1534 retest, tester adversarial): the SAME property T47 pins, asked of the OTHER reading. This gate takes two readings, one per range, and the arm whose absent record legitimately means no difference is answered from the second one — so that is the reading a disagreement must never be able to imitate. When the two readings of the base-branch comparison do not account for the same changes, the arm must refuse rather than conclude that a path being replaced by a shorter version lost nothing",
    `check exited ${t48.status} (expected 1); refused=${t48Refused}; reported as an unmeasured pass=${t48Passed} (expected false)`,
  );

  const t50 = scenarioT50();
  const t50Refused = /❌ UNDIFFABLE \(whole run\)/.test(t50.out);
  const t50NotClean = !/✅ No test files changed/.test(t50.out);
  check(
    t50.status === 1 && t50Refused && t50NotClean,
    "T50 (#1534 final, tester adversarial): a reading that did not reconcile may not report that nothing happened. When the disagreement leaves no entry to report on, the two available verdicts are opposite — 'no test file changed' and 'I cannot agree with myself about what changed' — and only the second is safe to print. The per-entry cases cannot reach this exit because there is no entry; removing the branch turns the run clean and green and no other case notices",
    `check exited ${t50.status} (expected 1); whole-run refusal printed=${t50Refused}; clean-run pass suppressed=${t50NotClean}`,
  );

  // T51 (#1534 final, TESTER ADVERSARIAL — THE SCOPE ITSELF). The door this pass installed
  // works because the two functions that reach outside this process are captured in closures
  // and nothing else in the file can reach them. That is currently a property of how the file
  // happens to be written, and the whole thesis of this pass is that such a property must be
  // asserted rather than remembered — every failure across four rounds was a convention that
  // held until one more caller was added. A deliberate re-import still bypasses it and cannot
  // be prevented in a single file; being NOTICED is a different guarantee from being
  // prevented, and it is the one available here, at the cost of one assertion.
  // The needles are assembled from fragments so this case cannot match its own source.
  const t51Src = fs.readFileSync(__filename, "utf8").split("\n");
  const t51Needles = ["child_" + "process", "exec" + "FileSync", "exec" + "Sync", "spawn" + "Sync"];
  const t51SpanStart = t51Src.findIndex((l) => l.startsWith("const repository = (() => {"));
  const t51SpanEnd = t51Src.findIndex((l, i) => i > t51SpanStart && l === "})();");
  const t51SelfStart = t51Src.findIndex((l) => l.includes("} = (() => {") && l.includes("whichGit"));
  const t51SelfEnd = t51Src.findIndex((l, i) => i > t51SelfStart && l === "})();");
  const t51Located = t51SpanStart > 0 && t51SpanEnd > t51SpanStart && t51SelfStart > 0 && t51SelfEnd > t51SelfStart;
  const t51Escapes = !t51Located ? ["could not locate both closures"] : t51Src
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) => {
      if (/^\s*(\/\/|\*)/.test(l)) return false; // commentary, not reachable code
      if (!t51Needles.some((nd) => l.includes(nd))) return false;
      const inDoor = i > t51SpanStart && i < t51SpanEnd;
      const inHarness = i > t51SelfStart && i < t51SelfEnd;
      return !inDoor && !inHarness;
    })
    .map(({ l, i }) => `${i + 1}: ${l.trim().slice(0, 60)}`);
  check(
    t51Located && t51Escapes.length === 0,
    "T51 (#1534 final, tester adversarial): reaching outside this process is confined to the two closures that own it, asserted over the file's own source rather than left as a property of how it currently happens to be written. A new arm cannot acquire a runner by accident because there is none in scope to acquire; a deliberate re-import is still possible and is out of reach of a single-file script, but it can no longer happen QUIETLY — which is the guarantee that is actually available here",
    `both closures located=${t51Located}; references outside them=${t51Escapes.length}${t51Escapes.length ? `; offending: ${JSON.stringify(t51Escapes)}` : ""}`,
  );

  const t46 = scenarioT46();
  const t46Unmeasurable = /❌[^\n]*UNDIFFABLE/.test(t46.out);
  const t46Tally = /Append-only check: 6 passed, 0 failed\./.test(t46.out);
  check(
    t46.status === 0 && !t46Unmeasurable && t46Tally,
    "T46 (#1534 rework, negative control): the same disagreement seen from the side that costs trust instead of safety — when the two readings come apart, every entry after the mistake loses its place, and ORDINARY files get refused as unmeasurable with a remediation for content that is perfectly fine. Three separator-bearing names beside three ordinary ones, every file only growing, must be six passes and no refusal",
    `check exited ${t46.status} (expected 0); any innocent file refused as unmeasurable=${t46Unmeasurable}; tally 6/0=${t46Tally}`,
  );

  // T56 (#1815 tester adversarial): redaction explicitly covers every newly valid
  // short current form for both authorities. This is independent of operator-message
  // hygiene and catches a parser/redactor split before the transcript assertion below.
  const t56Raw = [
    "[TEST-MOD-APPROVED #1]",
    "[TEST-MOD-APPROVED #27]",
    "[TEST-MOD-APPROVED #922]",
    "[TEST-RENAME-APPROVED #1]",
    "[TEST-RENAME-APPROVED #27]",
    "[TEST-RENAME-APPROVED #922]",
  ];
  const t56Redacted = t56Raw.map(redactTokens);
  const t56NoLive = t56Redacted.every((line) => !MOD_TOKEN.test(line) && !RENAME_TOKEN.test(line));
  const t56AllInert = t56Redacted.every((line) => line.includes("#ISSUE"));
  check(
    t56NoLive && t56AllInert,
    "T56 (#1815 tester adversarial): one-, two-, and three-digit MOD and RENAME approvals are globally redacted to inert output",
    `samples=${t56Raw.length}; all inert placeholders=${t56AllInert}; live tokens after redaction=${t56Redacted.filter((line) => MOD_TOKEN.test(line) || RENAME_TOKEN.test(line)).length}`,
  );

  // T33 (#1514) — the hygiene invariant over the SELF-TEST's own stream, asserted on the
  // full transcript of everything printed above rather than on a chosen sample. T5/T13/
  // T18/T26 hold this line for the gate's operator-facing output; nothing held it for the
  // stream whose inputs ARE token literals, which is the one place the invariant was
  // actually being broken. Runs last so it sees every line.
  const t33Offenders = transcript.filter((l) => MOD_TOKEN.test(l) || RENAME_TOKEN.test(l));
  const t33Populated = transcript.length > 40 && transcript.some((l) => l.includes("TEST-MOD-APPROVED"));
  check(
    t33Populated && t33Offenders.length === 0,
    "T33 (#1514): nothing this SELF-TEST prints is a working override token — its inputs are token literals by construction, so an unredacted line in a CI log is an attestation nobody wrote. Asserted over the FULL transcript of every line printed above, and non-vacuous because that transcript demonstrably still shows the token grammar it is testing",
    `lines inspected=${transcript.length}; placeholder forms still visible=${t33Populated}; live tokens printed=${t33Offenders.length}`,
  );


  // --- #1534 whole-file hardening (T34..T44) ---
  console.log("");
  console.log(`Self-test: ${total - failures} passed, ${failures} failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  main();
}
