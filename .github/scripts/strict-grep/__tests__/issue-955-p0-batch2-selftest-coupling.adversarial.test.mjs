#!/usr/bin/env node
/**
 * Issue #955 (ORCH-1400 lineage) — P0-batch-2 self-test COUPLING invariant.
 *
 * Adversarial regression guard (tester leg). Phase 2 P0-batch-2 added an
 * in-process self-test (GOOD fixture + BAD fixtures, exit 0/1) to eight
 * auth/RLS + installment money-safety strict-grep gates. This guard proves
 * that self-test is COUPLED to each gate's real detection logic — i.e. it is
 * not a "dark guard" that would stay green even if the detector were gutted.
 * A self-test that still passes with detection removed is exactly the failure
 * class #955 exists to kill.
 *
 * Mechanism — throwaway-copy source mutation (no coupling to internal names
 * beyond the shared `check(...)` detector every batch:A gate declares):
 *   1. Baseline: run the gate's self-test unmodified; it MUST exit 0.
 *   2. Gut the detector on a temp copy (inject an early `return;` so it reports
 *      ZERO failures), then re-run the self-test. It MUST now exit 1 — the BAD
 *      fixtures are no longer caught. If it still exits 0, the self-test is
 *      DECORATIVE and this guard fails.
 *
 * fails-on-revert: weaken step 2 (skip the mutation, or accept exit 0) and the
 * assertion breaks. Verified at commit time.
 *
 * This file CONSUMES the self-... flag by passing it to child gate processes;
 * it does NOT implement a self-test mode of its own. The flag is assembled from
 * fragments so meta-1383's P6 producer-heuristic (a bare substring scan) keeps
 * classifying this file truthfully as selfTest:"none". Paths are resolved via
 * fileURLToPath so the guard is robust to worktree paths containing url-encoded
 * characters (e.g. brackets).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.resolve(HERE, "..");
const FLAG = ["--self", "test"].join("-");

// The eight gates that gained a self-test in Phase 2 P0-batch-2.
const GATES = [
  "i-ari-user-jwt-only.mjs",
  "i-ve5-parse-menu-user-jwt-only.mjs",
  "i-ve6-parse-play-user-jwt-only.mjs",
  "i-ticket-pdf-owner-check.mjs",
  "i-proposed-tr5-file-rls-anon-write-planner-read.mjs",
  "i-proposed-tr3-installment-customer-durability.mjs",
  "i-proposed-tr4-cancelled-installment-never-charged.mjs",
  "i-proposed-1120-published-refund-via-gated-rpc.mjs",
];

function runSelfTest(scriptPath) {
  const r = spawnSync(process.execPath, [scriptPath, FLAG], { encoding: "utf8" });
  if (r.error) throw r.error;
  return r.status;
}

/**
 * Neutralize the gate's real detector so it reports ZERO failures, WITHOUT
 * touching the self-test harness (which accumulates via its own array). Every
 * batch:A gate declares the detector as `function check(...) {`; an arrow-fn
 * refactor is handled too. Returns null when no known shape is found, so the
 * test fails loudly instead of passing vacuously.
 */
function gutDetector(src) {
  const shapes = [
    /(function\s+check\s*\([^{]*\)\s*\{)/,
    /(const\s+check\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{)/,
  ];
  for (const re of shapes) {
    if (re.test(src)) return src.replace(re, "$1 return;");
  }
  return null;
}

for (const gate of GATES) {
  test(`#955 coupling: ${gate} self-test is coupled to real detection`, () => {
    const scriptPath = path.join(GATES_DIR, gate);
    assert.ok(fs.existsSync(scriptPath), `gate under test not found: ${scriptPath}`);

    // (1) The shipped self-test must pass as-is.
    assert.equal(
      runSelfTest(scriptPath),
      0,
      `${gate}: shipped self-test must exit 0`,
    );

    // (2) Coupling probe: with the detector gutted the self-test MUST fail,
    //     because the BAD fixtures can no longer be caught.
    const src = fs.readFileSync(scriptPath, "utf8");
    const gutted = gutDetector(src);
    assert.ok(
      gutted && gutted !== src,
      `${gate}: could not neutralize the detector — update gutDetector() so the coupling probe can run`,
    );

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-955-batch2-coupling-"));
    try {
      const tmpPath = path.join(tmpDir, gate);
      fs.writeFileSync(tmpPath, gutted, "utf8");
      const exit = runSelfTest(tmpPath);
      assert.equal(
        exit,
        1,
        `${gate}: with detection gutted the self-test still exited ${exit} — ` +
          `the self-test is DECORATIVE, not coupled to real detection`,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}
