/**
 * ORCH-0891 M3 — tester-adversarial regression on the bundle-size CI
 * gate (`orch-0891-marketing-performance-budget.mjs`).
 *
 * # Why adversarial
 * This test does NOT verify the composer chunk is under budget — that's
 * the gate's runtime job. Instead, it attacks the *gate itself*: does
 * the budget detector actually detect a violation when one is fed in?
 * If the gate's threshold logic regresses (e.g., off-by-one, wrong
 * conversion factor, the comparison flips from `>` to `<`), this test
 * goes RED.
 *
 * # Strategy
 * The gate ships a `--self-test` mode that exercises both an
 * over-budget composer fixture (350 KB random bytes) and an under-
 * budget composer fixture (~40 bytes of trivial JS), and exits 0 only
 * when both behave correctly. We invoke the gate as a subprocess
 * because the gate uses native ESM `.mjs` syntax that Jest's CommonJS
 * loader rejects.
 *
 * We then additionally tamper with the gate by writing a "broken" copy
 * to a tmp path (composer cap raised to 100 MB) and verify the
 * self-test in that copy FAILS — confirming the detector is the active
 * load-bearing piece, not a no-op.
 *
 * # Fails-on-revert
 * If `COMPOSER_LIMIT_BYTES_GZ` in the gate is changed to a huge value
 * (e.g. `2800 * 1024`), the gate's --self-test stops detecting the
 * over-budget fixture and exits non-zero with the "expected a violation"
 * message — both of which this test cross-validates via the tampered
 * copy. Verified at commit hash recorded in the M3 report.
 *
 * Append-only post-merge per `.github/workflows/tests-append-only.yml`.
 */

import { describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GATE_PATH = path.join(
  REPO_ROOT,
  ".github",
  "scripts",
  "strict-grep",
  "orch-0891-marketing-performance-budget.mjs",
);

function runNode(scriptPath: string, args: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [scriptPath, ...args], {
    encoding: "utf8",
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("ORCH-0891 bundle-size gate — adversarial subprocess attack", () => {
  test("gate file exists at the canonical path", () => {
    expect(fs.existsSync(GATE_PATH)).toBe(true);
  });

  test("gate --self-test exits 0 on the pristine implementation", () => {
    const r = runNode(GATE_PATH, ["--self-test"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/self-test PASSED/);
  });

  test("gate detects over-budget composer in --self-test output", () => {
    const r = runNode(GATE_PATH, ["--self-test"]);
    expect(r.code).toBe(0);
    // The success message documents that the over-budget fixture was
    // detected. If the detection regresses, the gate throws and exits
    // non-zero (re-checked by the broken-copy test below).
    expect(r.stdout).toMatch(/over-budget detected, under-budget cleared/);
  });

  test("tampered gate copy (composer cap inflated 10x) FAILS its own --self-test", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-0891-tampered-"));
    try {
      const tamperedPath = path.join(tmpDir, "gate-broken.mjs");
      const original = fs.readFileSync(GATE_PATH, "utf8");
      // Inflate composer cap from 280 KB to 28 MB — over-budget fixture
      // no longer triggers; gate's self-test throws.
      const broken = original.replace(
        /const COMPOSER_LIMIT_BYTES_GZ = 280 \* 1024;/,
        "const COMPOSER_LIMIT_BYTES_GZ = 28 * 1024 * 1024;",
      );
      expect(broken).not.toBe(original); // sanity: replacement landed
      fs.writeFileSync(tamperedPath, broken);
      const r = runNode(tamperedPath, ["--self-test"]);
      expect(r.code).not.toBe(0);
      const combined = r.stdout + r.stderr;
      expect(combined).toMatch(/expected a violation/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("tampered gate copy (under-budget assertion flipped) FAILS its own --self-test", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-0891-tampered2-"));
    try {
      const tamperedPath = path.join(tmpDir, "gate-broken2.mjs");
      const original = fs.readFileSync(GATE_PATH, "utf8");
      // Disable the composer-cap check entirely so the over-budget
      // fixture slips through — gate self-test throws.
      const broken = original.replace(
        /if \(composer\.size > COMPOSER_LIMIT_BYTES_GZ\) \{/,
        "if (false && composer.size > COMPOSER_LIMIT_BYTES_GZ) {",
      );
      expect(broken).not.toBe(original);
      fs.writeFileSync(tamperedPath, broken);
      const r = runNode(tamperedPath, ["--self-test"]);
      expect(r.code).not.toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
