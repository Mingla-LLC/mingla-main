// ISSUE-957 [nul-fixture-grep-invisible] — TESTER ADVERSARIAL wrapper that
// ATTACKS THE GATE ITSELF (.github/scripts/strict-grep/issue-957-nul-hidden-orch-id-consistency.mjs).
// Wired into CI as a batch:A `node --test` entry (MANIFEST.json), so
// run-batch.mjs --class A executes it — this is real, running regression
// protection, not an orphaned script.
//
// DIFFERENT ANGLE from the gate's own self-test mode: that self-test only calls
// the pure `scan()` with four in-memory strings. It NEVER exercises the gate's
// real-mode disk walk (`collectFiles` + `fs.readFileSync(f,"utf8")`), and never
// proves — against a real `grep` — that the walk is binary-aware repo-wide
// rather than hardcoded to the one known fixture. This wrapper attacks exactly
// that gap:
//
//   A  CLEAN synthetic mingla-marketing/ tree (a normal ORCH-1399 links-src
//      line) → the copied gate exits 0. Proves the disk walk runs end-to-end.
//   B  PLANTED file with a REAL raw NUL byte beside a stale `ORCH-1382 links-src`
//      token, at an ARBITRARY non-fixture path → a plain `grep` cannot surface
//      the file's line content (the #957 blindness) while `grep -a` can, and the
//      gate's real disk walk CATCHES it and names the planted file. Proves the
//      gate scans binary-aware repo-wide. A grep-based (NUL-blind) gate would
//      MISS it — so this is the fails-on-broken guard.
//   C  REAL-TREE COUPLING: the REAL gate exits 0 on the ACTUAL repo. Reverting
//      any of the 3 ORCH-1399→ORCH-1382 retitles in the fixture makes the real
//      gate exit 1 → THIS test turns red in CI (direct fails-on-revert).
//
// All paths use fileURLToPath (never URL.pathname) so the wrapper works from
// bracketed worktree paths like `957-[nul-fixture-grep-invisible]`.
//
// FAILS-ON-BROKEN is also directly reproducible: set ISSUE957_GATE_OVERRIDE to a
// deliberately NUL-blind (grep-based) gate; it is copied into the fixture in
// place of the real gate, so case B's CATCH assertion trips (it misses the plant).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// This file lives at .github/scripts/strict-grep/__tests__/ → repo root is up 4.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const GATE_REL =
  ".github/scripts/strict-grep/issue-957-nul-hidden-orch-id-consistency.mjs";
const REAL_GATE = path.join(REPO_ROOT, GATE_REL);
// The gate SOURCE copied into each throwaway fixture. Default = the real gate.
// ISSUE957_GATE_OVERRIDE lets a tester point this at a NUL-blind grep-based gate
// to PROVE fails-on-broken (case B's CATCH assertion then trips).
const GATE_SOURCE = process.env.ISSUE957_GATE_OVERRIDE || REAL_GATE;

// A synthetic mingla-marketing/ file: a REAL NUL byte beside a stale
// `ORCH-1382 links-src` token on ONE line, at a NON-fixture path the gate's
// recursive walk reaches. Buffer guarantees the raw 0x00 survives to disk.
const PLANT_REL =
  "mingla-marketing/lib/__tests__/__957_planted__/nul_stale.ts";
const PLANT_BYTES = Buffer.concat([
  Buffer.from("// synthetic adversarial fixture — issue #957 tester\n"),
  Buffer.from("const trap = 'p"),
  Buffer.from([0x00]), // the raw NUL that hides the whole file from plain grep
  Buffer.from("q ORCH-1382 links-src planted-stale' // must be caught\n"),
]);
const MARKER = "planted-stale";
const CLEAN_REL = "mingla-marketing/lib/__957_clean__/ok.ts";
const CLEAN_BYTES = "// ORCH-1399 [links-src-tracking-getapp-stack] fine\n";

/**
 * Build a throwaway repo containing ONLY the gate at its canonical relative path
 * (so the gate resolves root = the temp dir and scans the temp mingla-marketing/)
 * plus the given synthetic files. `files` maps repo-relative path → Buffer|string.
 */
function fixtureRepo(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "issue-957-nul-walk-"));
  const gateAbs = path.join(dir, GATE_REL);
  mkdirSync(path.dirname(gateAbs), { recursive: true });
  cpSync(GATE_SOURCE, gateAbs); // binary copy preserves the gate's own NUL byte
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { dir, gateAbs };
}

function runGate(gateAbs) {
  const r = spawnSync(process.execPath, [gateAbs], { encoding: "utf8" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

test("A: the gate's disk walk exits 0 on a clean synthetic mingla-marketing/ tree", () => {
  const f = fixtureRepo({ [CLEAN_REL]: CLEAN_BYTES });
  try {
    const r = runGate(f.gateAbs);
    assert.equal(r.status, 0, `clean synthetic tree should pass:\n${r.out}`);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("B: real-mode walk CATCHES a NUL-hidden stale ORCH-1382 links-src token at an arbitrary path (grep is blind to it)", () => {
  const f = fixtureRepo({ [CLEAN_REL]: CLEAN_BYTES, [PLANT_REL]: PLANT_BYTES });
  try {
    const plantAbs = path.join(f.dir, PLANT_REL);

    // Plain grep is BLIND to the NUL file's line content — the exact failure
    // that let 3 stale tokens survive the 1383→1399 sweep.
    const plain = spawnSync("grep", ["-rn", "ORCH-1382", plantAbs], {
      encoding: "utf8",
    });
    const plainOut = (plain.stdout || "") + (plain.stderr || "");
    assert.ok(
      !plainOut.includes(MARKER),
      `plain grep surfaced the NUL file's line content ("${MARKER}") — the NUL-hidden premise is void: ${JSON.stringify(plainOut)}`,
    );

    // Binary-aware `grep -a` recovers the line — proving the token IS there and
    // only the NUL-blindness hid it.
    const aware = spawnSync("grep", ["-a", "-rn", "ORCH-1382", plantAbs], {
      encoding: "utf8",
    });
    assert.equal(aware.status, 0, "grep -a should match the planted token");
    assert.ok(
      (aware.stdout || "").includes(MARKER),
      "grep -a should recover the planted line content",
    );

    // The gate's real disk walk must catch what plain grep missed, repo-wide.
    const r = runGate(f.gateAbs);
    assert.equal(
      r.status,
      1,
      `the gate MISSED the planted NUL-hidden stale token — a grep-based (NUL-blind) gate would (the #957 regression this test guards):\n${r.out}`,
    );
    assert.match(
      r.out,
      /nul_stale\.ts/,
      `the gate exited 1 but did not name the planted file:\n${r.out}`,
    );
    assert.match(
      r.out,
      /ORCH-1382/,
      `the gate's violation did not cite the stale ORCH-1382 token:\n${r.out}`,
    );
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("C: real-tree coupling — the real gate exits 0 on the actual repo (reverting any of the 3 retitles turns this red)", () => {
  const r = spawnSync(process.execPath, [REAL_GATE], { encoding: "utf8" });
  assert.equal(
    r.status,
    0,
    `a stale links-src ORCH id is present in the working tree:\n${(r.stdout || "") + (r.stderr || "")}`,
  );
});
