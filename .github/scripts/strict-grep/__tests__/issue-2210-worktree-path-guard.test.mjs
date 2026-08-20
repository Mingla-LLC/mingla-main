// ISSUE-2210 [worktree-bracket-android-builds] — IMPLEMENTOR HAPPY-PATH regression.
//
// WHAT BROKE. From 2026-05-24 to 2026-08-18, `scripts/orch-worktree/spawn.sh`
// built every worktree directory as `<ORCH_ID>-[<label>]` — with literal square
// brackets. Inside such a directory CMake's `file(GLOB ...)` reads the brackets
// as a POSIX character class, matches ZERO files, prints NO warning and EXITS 0.
// Every RN/Expo native module builds its source list with that call, so every
// local Android build in a worktree got an empty source list. It died loudly only
// because `add_library` happens to reject empty sources — luck, not design. A
// glob feeding anything OPTIONAL would have built an incomplete binary and
// reported success. Measured on the real NDK CMake: plain path GLOB_MATCHED=2,
// `2210-[one-two-three]` GLOB_MATCHED=0, cmake exit 0 in BOTH cases. RN 0.81
// codegen has the same shape (COMMS-0150): 210 matches vs 0, stub artifacts, exit 0.
//
// WHAT IS GUARDED HERE. Two things, both behavioural:
//   1. `scripts/orch-worktree/assert-safe-worktree-path.sh` accepts a legitimate
//      bracket-free path and rejects — loudly, exit 2 — every hostile character
//      class. It is an ALLOWLIST (`A-Za-z0-9._/-`); a denylist is how `[`
//      survived 86 days.
//   2. `spawn.sh` is WIRED to that guard, fires it BEFORE it touches the anchor
//      checkout, and otherwise composes the directory name identically to the
//      branch name.
//
// FAILS-ON-REVERT — three independent levers, each a true line deletion:
//   * delete `bash "$PATH_GUARD" "$WT"` from spawn.sh  -> the wiring subtests fail
//     (spawn.sh sails past a hostile label into the anchor check).
//   * restore `WT="$ORCH_DIR/${ORCH_ID}-[${LABEL}]"`   -> the naming subtest fails.
//   * delete the rejection block from the guard        -> the rejection subtests fail.
//
// HERMETIC. Every spawn.sh invocation runs under a throwaway $HOME whose
// `Desktop/mingla-main` anchor does not exist, so spawn.sh can only ever reach
// its "anchor checkout not found" exit. No worktree is created, no git command
// runs, and no real worktree — this session's or anyone else's — is touched.
//
// Path resolution uses fileURLToPath, never `URL.pathname`, per the #958
// invariant I-PROPOSED-958-STRICTGREP-SPAWN-VIA-FILEURLTOPATH.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const GUARD = path.join(REPO_ROOT, "scripts", "orch-worktree", "assert-safe-worktree-path.sh");
const SPAWN = path.join(REPO_ROOT, "scripts", "orch-worktree", "spawn.sh");

/** Run the guard against one candidate path. Exit code is read DIRECTLY. */
function runGuard(candidate) {
  const r = spawnSync("bash", [GUARD, candidate], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Run spawn.sh under a throwaway $HOME with no anchor checkout, so it cannot
 * create anything. Returns exit status + merged output.
 */
function runSpawn(orchId, label) {
  const fakeHome = mkdtempSync(path.join(os.tmpdir(), "issue-2210-home-"));
  try {
    // The harness is worthless if its own scaffolding is hostile — assert the
    // throwaway HOME is clean before drawing any conclusion from what follows.
    assert.equal(
      runGuard(fakeHome).status,
      0,
      `test scaffolding is unsound: throwaway HOME ${fakeHome} is itself hostile`,
    );
    const r = spawnSync("bash", [SPAWN, orchId, label], {
      encoding: "utf8",
      env: { ...process.env, HOME: fakeHome },
    });
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, fakeHome };
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. The guard accepts what it must accept.
// ---------------------------------------------------------------------------

test("#2210: the guard ACCEPTS a legitimate bracket-free worktree path", () => {
  for (const ok of [
    "/Users/sethogieva/Desktop/mingla-orchs/2210-worktree-brackets",
    "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-buyer-web-confirm-deep-forensics",
    "/home/runner/work/mingla-main/mingla-main",
    "/Users/sethogieva/Desktop/mingla-orchs/consumer-v1.1.1",
  ]) {
    const { status, out } = runGuard(ok);
    assert.equal(status, 0, `guard rejected a legitimate path ${ok}:\n${out}`);
  }
});

// ---------------------------------------------------------------------------
// 2. The guard rejects every hostile character class — loudly.
// ---------------------------------------------------------------------------

const HOSTILE = [
  ["square brackets (the #2210 CMake glob hazard)", "/tmp/mingla-orchs/2210-[worktree-brackets]"],
  ["opening bracket alone", "/tmp/mingla-orchs/2210-[worktree"],
  ["space (URL.pathname %20; word-splits unquoted)", "/tmp/mingla-orchs/2210 worktree brackets"],
  ["tab", "/tmp/mingla-orchs/2210\tworktree"],
  ["hash (TRUNCATES URL.pathname; shell comment)", "/tmp/mingla-orchs/2210#worktree"],
  ["dollar", "/tmp/mingla-orchs/2210-$worktree"],
  ["ampersand", "/tmp/mingla-orchs/2210-work&tree"],
  ["parentheses", "/tmp/mingla-orchs/2210-(worktree)"],
  ["asterisk", "/tmp/mingla-orchs/2210-*worktree"],
  ["semicolon", "/tmp/mingla-orchs/2210;worktree"],
  ["backtick", "/tmp/mingla-orchs/2210-`worktree`"],
  ["single quote", "/tmp/mingla-orchs/2210-work'tree"],
  ["backslash", "/tmp/mingla-orchs/2210-work\\tree"],
  ["brace", "/tmp/mingla-orchs/2210-{worktree}"],
  ["non-ASCII (URL.pathname percent-encodes)", "/tmp/mingla-orchs/2210-café"],
  ["hostile PARENT directory, clean leaf", "/tmp/mingla-orchs [old]/2210-worktree-brackets"],
];

for (const [why, hostile] of HOSTILE) {
  test(`#2210: the guard REJECTS ${why}`, () => {
    const { status, out } = runGuard(hostile);
    assert.equal(
      status,
      2,
      `guard did NOT reject ${JSON.stringify(hostile)} (exit ${status}) — hostile paths must exit 2:\n${out}`,
    );
    assert.ok(
      out.includes("REFUSING TO SPAWN"),
      `guard rejected ${JSON.stringify(hostile)} but without the loud banner — a quiet failure is the bug class being fixed:\n${out}`,
    );
    assert.ok(
      out.includes("Offending:"),
      `guard message must name the offending characters for ${JSON.stringify(hostile)}:\n${out}`,
    );
    assert.ok(
      out.includes("#2210"),
      `guard message must cite the issue so the next person can find the mechanism:\n${out}`,
    );
  });
}

// ---------------------------------------------------------------------------
// 3. spawn.sh is wired to the guard, and fires it BEFORE touching the anchor.
// ---------------------------------------------------------------------------

test("#2210: spawn.sh REFUSES a hostile label and never reaches the anchor", () => {
  const { status, out } = runSpawn("2210", "worktree [brackets]");
  assert.equal(
    status,
    2,
    `spawn.sh accepted a hostile label (exit ${status}) — the guard is not wired:\n${out}`,
  );
  assert.ok(
    out.includes("REFUSING TO SPAWN"),
    `spawn.sh failed on a hostile label but not via the guard:\n${out}`,
  );
  // Ordering proof: the anchor check emits this string. Seeing it would mean the
  // guard ran too late (or not at all) and spawn.sh had already started work.
  assert.ok(
    !out.includes("anchor checkout not found"),
    `the guard fired AFTER the anchor check — it must run before spawn.sh touches anything:\n${out}`,
  );
  assert.ok(
    !out.includes("Syncing anchor"),
    `spawn.sh began syncing the anchor despite a hostile label:\n${out}`,
  );
});

test("#2210: spawn.sh lets a legitimate label THROUGH the guard to the anchor check", () => {
  // The complement of the test above: a guard that rejected everything would
  // pass the rejection subtests while breaking every spawn. Under a throwaway
  // HOME the anchor does not exist, so reaching its error IS the proof that the
  // guard passed the path along.
  const { status, out } = runSpawn("2210", "worktree-brackets");
  assert.ok(
    !out.includes("REFUSING TO SPAWN"),
    `the guard rejected a legitimate kebab-case label — it is over-broad:\n${out}`,
  );
  assert.ok(
    out.includes("anchor checkout not found"),
    `spawn.sh did not reach the anchor check with a legitimate label (exit ${status}):\n${out}`,
  );
});

// ---------------------------------------------------------------------------
// 4. The worktree directory name equals the branch name — no brackets injected.
// ---------------------------------------------------------------------------

test("#2210: spawn.sh composes the worktree directory identically to the branch", () => {
  const src = readFileSync(SPAWN, "utf8");
  const wtLines = src.split("\n").filter((l) => /^\s*WT=/.test(l));
  assert.equal(wtLines.length, 1, `expected exactly one WT= assignment in spawn.sh, got ${wtLines.length}`);
  const branchLines = src.split("\n").filter((l) => /^\s*BRANCH=/.test(l));
  assert.equal(branchLines.length, 1, `expected exactly one BRANCH= assignment in spawn.sh`);

  const wtRhs = wtLines[0].replace(/^\s*WT=/, "").trim();
  const branchRhs = branchLines[0].replace(/^\s*BRANCH=/, "").trim();

  assert.ok(
    !/[[\]]/.test(wtRhs),
    `spawn.sh is injecting square brackets into the worktree path again: ${wtLines[0]}\n` +
      `Inside a bracketed directory CMake's file(GLOB ...) matches zero files and exits 0.`,
  );
  // The leaf of the directory must be exactly the branch name.
  assert.equal(
    wtRhs,
    '"$ORCH_DIR/${ORCH_ID}-${LABEL}"',
    `worktree path must be <ORCH_DIR>/<ORCH_ID>-<LABEL>, got ${wtRhs}`,
  );
  assert.equal(
    branchRhs,
    '"${ORCH_ID}-${LABEL}"',
    `branch must be <ORCH_ID>-<LABEL>, got ${branchRhs}`,
  );
});

// ---------------------------------------------------------------------------
// 5. The premise the guard rests on, asserted rather than assumed.
// ---------------------------------------------------------------------------

test("#2210 PREMISE: a POSIX globber matches ZERO files inside a bracketed directory", () => {
  // This is the mechanism, reproduced with bash's pathname expansion — the same
  // POSIX bracket-expression semantics CMake's file(GLOB) uses, and available on
  // every runner without a toolchain. Asserted in BOTH directions so it cannot
  // pass vacuously: a harness that built no fixture would fail the plain case.
  const base = mkdtempSync(path.join(os.tmpdir(), "issue-2210-glob-"));
  try {
    const counts = {};
    for (const dir of ["2210-worktree-brackets", "2210-[worktree-brackets]"]) {
      const src = path.join(base, dir, "src");
      mkdirSync(src, { recursive: true });
      writeFileSync(path.join(src, "a.c"), "");
      writeFileSync(path.join(src, "b.c"), "");
      const script = 'shopt -s nullglob; pat="$1"/src/*.c; files=( $pat ); echo "${#files[@]}"';
      const r = spawnSync("bash", ["-c", script, "bash", path.join(base, dir)], { encoding: "utf8" });
      assert.equal(r.status, 0, `probe failed for ${dir}: ${r.stderr}`);
      counts[dir] = Number(r.stdout.trim());
    }
    assert.equal(
      counts["2210-worktree-brackets"],
      2,
      "the glob probe found no files at a PLAIN path — the fixture is broken, so the bracketed result proves nothing",
    );
    assert.equal(
      counts["2210-[worktree-brackets]"],
      0,
      "a bracketed directory no longer swallows the glob — the guard's rationale has changed and #2210 should be re-read",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
