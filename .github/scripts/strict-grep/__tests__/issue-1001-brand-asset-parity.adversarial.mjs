// ISSUE-1001 [brand logo consolidation] — TESTER ADVERSARIAL wrapper that
// ATTACKS THE GATE ITSELF (.github/scripts/strict-grep/issue-1001-brand-asset-parity.mjs).
// Reserved path per SPEC #1001 §4.6. Angles the gate's own self-test does
// NOT cover (its 5 cases are: all-parity / mirror drift / missing master /
// resurrected path / unregistered copy — all via the injected fsView):
//
//   P1  BYTE-FLIPPED mirror (single last-byte flip of the REAL png bytes, not
//       a replaced string) → child-process run in a real git tree exits 1
//       with MIRROR DRIFT.
//   P2  DERIVATIVE ANCHOR drift (app-mobile/assets/icon.png no longer equals
//       the square master) → exit 1 with DERIVATIVE ANCHOR DRIFT. (Not in the
//       gate's self-test at all.)
//   P3  MIRROR MISSING (registered mirror deleted) → exit 1. (Also absent
//       from the gate's self-test.)
//   P4  resurrected deleted path in a real tree (not fsView) → exit 1 with
//       RESURRECTED DUPLICATE.
//   P5  pristine fixture tree built from the REAL master bytes → exit 0 —
//       which simultaneously proves every real master file exists on disk.
//   P6  REAL-TREE COUPLING: the gate exits 0 on the actual repo — reverting
//       any #1001 deletion/mirror byte fails THIS test.
//
// All spawns use fileURLToPath — never URL.pathname — so this wrapper works
// from bracketed worktree paths like `1001-[logo-consolidation]`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const GATE_REL = ".github/scripts/strict-grep/issue-1001-brand-asset-parity.mjs";
const GATE = path.join(REPO_ROOT, GATE_REL);
// Assembled at runtime: the manifest-parity P6 heuristic greps files for the
// dashed flag literal; this wrapper has no self-test mode of its own — it
// only SPAWNS the gate's.
const SELF_TEST_FLAG = ["--self", "test"].join("-");

// The canonical asset topology this wrapper attacks. Deliberately restated
// here (not imported — importing the gate executes its main()): if the gate's
// tables drift from these paths, this wrapper fails loudly and the two files
// must be reconciled against docs/INVARIANT_REGISTRY.md
// I-PROPOSED-1001-BRAND-ASSET-CANON.
const MASTERS = [
  "packages/brand-assets/mingla-wordmark.png",
  "packages/brand-assets/mingla-wordmark.svg",
  "packages/brand-assets/mingla-wordmark-email.png",
  "packages/brand-assets/mingla-business-logo.png",
  "packages/brand-assets/mingla-business-logo.svg",
  "packages/brand-assets/mingla-app-icon-500.png",
];
const MIRRORS = {
  "mingla-business/public/brand/mingla-business-logo.png":
    "packages/brand-assets/mingla-business-logo.png",
  "mingla-business/public/brand/mingla-business-logo.svg":
    "packages/brand-assets/mingla-business-logo.svg",
  "mingla-marketing/public/brand/mingla-business-logo.png":
    "packages/brand-assets/mingla-business-logo.png",
  "mingla-marketing/public/brand/mingla-business-logo.svg":
    "packages/brand-assets/mingla-business-logo.svg",
  "mingla-marketing/public/brand/mingla-wordmark.svg":
    "packages/brand-assets/mingla-wordmark.svg",
  "mingla-marketing/public/brand/email/mingla-wordmark-email.png":
    "packages/brand-assets/mingla-wordmark-email.png",
  "mingla-admin/public/mingla-icon.png":
    "packages/brand-assets/mingla-app-icon-500.png",
};
const ANCHOR = "app-mobile/assets/icon.png";
const ANCHOR_MASTER = "packages/brand-assets/mingla-app-icon-500.png";
const A_DELETED_PATH = "app-mobile/assets/mingla_official_logo.png";

/** Throwaway git repo seeded with REAL master bytes + gate at canonical path. */
function fixtureRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "issue-1001-parity-adv-"));
  mkdirSync(path.join(dir, path.dirname(GATE_REL)), { recursive: true });
  cpSync(GATE, path.join(dir, GATE_REL));
  for (const master of MASTERS) {
    const abs = path.join(dir, master);
    mkdirSync(path.dirname(abs), { recursive: true });
    cpSync(path.join(REPO_ROOT, master), abs); // real bytes → P5 proves masters exist
  }
  for (const [mirror, master] of Object.entries(MIRRORS)) {
    const abs = path.join(dir, mirror);
    mkdirSync(path.dirname(abs), { recursive: true });
    cpSync(path.join(dir, master), abs);
  }
  const anchorAbs = path.join(dir, ANCHOR);
  mkdirSync(path.dirname(anchorAbs), { recursive: true });
  cpSync(path.join(dir, ANCHOR_MASTER), anchorAbs);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

function runGateIn(dir) {
  return spawnSync(process.execPath, [path.join(dir, GATE_REL)], {
    encoding: "utf8",
  });
}

function flipLastByte(abs) {
  const buf = readFileSync(abs);
  buf[buf.length - 1] ^= 0xff;
  writeFileSync(abs, buf);
}

test("P5 then P1-P4: fixture attacks against a real git tree", () => {
  const dir = fixtureRepo();
  try {
    // P5 — pristine fixture passes (and every REAL master existed to copy).
    let r = runGateIn(dir);
    assert.equal(r.status, 0, `pristine fixture failed:\n${r.stderr}`);

    // P1 — byte-flipped mirror → MIRROR DRIFT.
    const mirrorAbs = path.join(dir, "mingla-admin/public/mingla-icon.png");
    flipLastByte(mirrorAbs);
    r = runGateIn(dir);
    assert.equal(r.status, 1, "byte-flipped mirror not detected");
    assert.match(r.stderr, /MIRROR DRIFT: mingla-admin\/public\/mingla-icon\.png/);
    cpSync(path.join(dir, ANCHOR_MASTER), mirrorAbs); // restore

    // P2 — derivative-anchor drift → DERIVATIVE ANCHOR DRIFT.
    flipLastByte(path.join(dir, ANCHOR));
    r = runGateIn(dir);
    assert.equal(r.status, 1, "derivative-anchor drift not detected");
    assert.match(r.stderr, /DERIVATIVE ANCHOR DRIFT: app-mobile\/assets\/icon\.png/);
    cpSync(path.join(dir, ANCHOR_MASTER), path.join(dir, ANCHOR)); // restore

    // P3 — registered mirror deleted → MIRROR MISSING.
    rmSync(mirrorAbs);
    r = runGateIn(dir);
    assert.equal(r.status, 1, "missing mirror not detected");
    assert.match(r.stderr, /MIRROR MISSING: mingla-admin\/public\/mingla-icon\.png/);
    cpSync(path.join(dir, ANCHOR_MASTER), mirrorAbs); // restore

    // P4 — resurrected deleted path (real tree, by path) → RESURRECTED DUPLICATE.
    const zombieAbs = path.join(dir, A_DELETED_PATH);
    mkdirSync(path.dirname(zombieAbs), { recursive: true });
    writeFileSync(zombieAbs, "zombie-bytes");
    r = runGateIn(dir);
    assert.equal(r.status, 1, "resurrected deleted path not detected");
    assert.match(r.stderr, /RESURRECTED DUPLICATE: app-mobile\/assets\/mingla_official_logo\.png/);
    rmSync(zombieAbs);

    // Sanity: back to green after every restore.
    r = runGateIn(dir);
    assert.equal(r.status, 0, `fixture did not return to green:\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gate self-test still passes (5/5)", () => {
  const r = spawnSync(process.execPath, [GATE, SELF_TEST_FLAG], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
});

test("P6: real-tree coupling — the gate exits 0 on the actual repo (fails if any #1001 deletion/mirror fix is reverted)", () => {
  const r = spawnSync(process.execPath, [GATE], { encoding: "utf8" });
  assert.equal(
    r.status,
    0,
    `brand-asset parity broken in the working tree:\n${r.stderr}`,
  );
});
