// ISSUE-1001 [brand logo consolidation] — TESTER ADVERSARIAL wrapper that
// ATTACKS THE GATE ITSELF (.github/scripts/strict-grep/issue-1001-dead-logo-urls.mjs).
// Reserved path per SPEC #1001 §4.6. Angles the gate's own self-test does
// NOT cover:
//
//   G1  planted dead literal in a DEEPLY NESTED dir of a real git tree → the
//       gate (spawned as a child process, real `git ls-files` path) exits 1
//       and names the file.
//   G2  planted literal in a .md doc → still caught (SKIP_EXT must only skip
//       binaries, never docs).
//   G3  literal present ONLY inside a .png-named file → exit 0 (binary skip).
//   G4  SELF-EXCLUSION IS EXACTLY ONE PATH: a *different* .mjs inside
//       .github/scripts/strict-grep/ carrying the literal still fails (the
//       gate must never over-exclude its own directory).
//   G5  clean fixture tree → exit 0; the gate's self-test → exit 0.
//   G6  REAL-TREE COUPLING: the gate exits 0 on the actual repo — reverting
//       any #1001 dead-URL fix (e.g. marketingEmailRender.ts) fails THIS
//       test, not just the standalone gate.
//
// All spawns use fileURLToPath — never URL.pathname — so this wrapper works
// from bracketed worktree paths like `1001-[logo-consolidation]` (the
// percent-encoding spawn bug proven on the orch-09xx wrappers).
//
// The dead literals below are ASSEMBLED FROM PARTS at runtime: this file is
// itself scanned by the gate and must never carry them verbatim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const GATE = path.join(
  REPO_ROOT,
  ".github/scripts/strict-grep/issue-1001-dead-logo-urls.mjs",
);
// Assembled at runtime: the manifest-parity P6 heuristic greps files for the
// dashed flag literal; this wrapper has no self-test mode of its own — it
// only SPAWNS the gate's.
const SELF_TEST_FLAG = ["--self", "test"].join("-");

const DEAD_EMAIL_ASSETS = ["usemingla.com", "email-assets", "mingla-logo.png"]
  .join("/");
const DEAD_ROOT_LOGO = ["usemingla.com", "logo.png"].join("/");

/** Build a throwaway git repo containing the gate at its canonical path. */
function fixtureRepo(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "issue-1001-deadurl-adv-"));
  mkdirSync(path.join(dir, ".github/scripts/strict-grep"), { recursive: true });
  cpSync(GATE, path.join(dir, ".github/scripts/strict-grep/issue-1001-dead-logo-urls.mjs"));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

function runGateIn(dir, args = []) {
  return spawnSync(
    process.execPath,
    [path.join(dir, ".github/scripts/strict-grep/issue-1001-dead-logo-urls.mjs"), ...args],
    { encoding: "utf8" },
  );
}

test("G1: planted dead literal in a deeply nested dir → exit 1 naming the file", () => {
  const dir = fixtureRepo({
    "supabase/functions/deep/nested/dir/config.ts":
      `export const LOGO = "https://${DEAD_EMAIL_ASSETS}";\n`,
    "docs/clean.md": "nothing here\n",
  });
  try {
    const r = runGateIn(dir);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /deep\/nested\/dir\/config\.ts:1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G2: planted literal in a .md doc is still caught", () => {
  const dir = fixtureRepo({
    "docs/runbook.md": `old logo lived at https://${DEAD_ROOT_LOGO}\n`,
  });
  try {
    const r = runGateIn(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /docs\/runbook\.md:1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G3: literal only inside a .png-named file → exit 0 (binary skip)", () => {
  const dir = fixtureRepo({
    "app-mobile/assets/notes.png": `https://${DEAD_EMAIL_ASSETS}`,
  });
  try {
    const r = runGateIn(dir);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G4: self-exclusion is exactly one path — a sibling strict-grep .mjs with the literal still fails", () => {
  const dir = fixtureRepo({
    ".github/scripts/strict-grep/some-other-gate.mjs":
      `const BAD = "https://${DEAD_EMAIL_ASSETS}";\n`,
  });
  try {
    const r = runGateIn(dir);
    assert.equal(r.status, 1, "gate over-excluded its own directory");
    assert.match(r.stderr, /some-other-gate\.mjs:1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G5: clean fixture tree exits 0; gate self-test exits 0", () => {
  const dir = fixtureRepo({ "src/ok.ts": "export const fine = true;\n" });
  try {
    assert.equal(runGateIn(dir).status, 0);
    assert.equal(runGateIn(dir, [SELF_TEST_FLAG]).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G6: real-tree coupling — the gate exits 0 on the actual repo (fails if any #1001 dead-URL fix is reverted)", () => {
  const r = spawnSync(process.execPath, [GATE], { encoding: "utf8" });
  assert.equal(
    r.status,
    0,
    `dead logo URL reintroduced somewhere in the tree:\n${r.stderr}`,
  );
});
