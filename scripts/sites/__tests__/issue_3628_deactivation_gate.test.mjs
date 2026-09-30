/**
 * Issue #3628 — the deactivation gate must act on a PROVEN readiness violation,
 * not on "the run went red".
 *
 * On 2026-09-28 at 23:51:53.713Z the backup job failed with
 * `SITES_OPS_ERROR code=S3_OBJECT_READ_FAILED` — a transport error reading one
 * object. Sixteen seconds later, at 23:52:09.943Z, the `Fail-closed pilot
 * deactivation` job signed-deactivated the live gogi pilot, and
 * `gogi.sites.usemingla.com` returned 404 on every route for 15 hours. Recovery
 * required a credentialed operator run.
 *
 * The classifier that would have declined already existed and had already
 * declined: `S3_OBJECT_READ_FAILED` is not in the deactivating set, and the
 * in-process path emitted no deactivation marker. The workflow job then ran
 * `deactivatePilotForRecoveryFailure()` directly, gated only on
 * `needs.backup_restore.result != 'success'`, consulting none of it.
 *
 * Timestamps, codes and job outcomes below are read from Actions run
 * 36500082824 and from the `brand_site_audit_log` row, not invented to fit.
 *
 * The polarity assertions are the load-bearing ones. `!= 'false'` deactivates
 * on unset; `== 'true'` would HOLD on unset, converting a crashed runner into a
 * site that silently keeps serving unproven evidence. That inversion is a
 * one-character edit and it is why it is pinned here by literal.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEACTIVATING_RECOVERY_CODES,
  SitesOpsError,
  classifyRecoveryFailure,
  recordRecoveryFailureClassification,
  safeCliFailure,
} from "../lib/sites-ops.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const WORKFLOW = readFileSync(
  join(REPO, ".github/workflows/sites-backup-restore.yml"),
  "utf8",
);
const BACKUP_CMS = readFileSync(
  join(REPO, "scripts/sites/backup-sites-cms.mjs"),
  "utf8",
);

/** The exact code that took the site down. */
const OUTAGE_CODE = "S3_OBJECT_READ_FAILED";

const READINESS_VIOLATIONS = [
  "DATABASE_BACKUP_CURRENT_FAILED",
  "DATABASE_BACKUP_MISSING",
  "DATABASE_BACKUP_RETENTION_UNPROVEN",
  "DATABASE_BACKUP_STALE",
  "DATABASE_BACKUP_WALG_DISABLED",
];

test("the outage code is classified as NOT a readiness violation", () => {
  const verdict = classifyRecoveryFailure(OUTAGE_CODE);
  assert.equal(verdict.code, OUTAGE_CODE);
  assert.equal(verdict.deactivating, false);
});

test("every proven readiness violation still deactivates", () => {
  for (const code of READINESS_VIOLATIONS) {
    assert.equal(classifyRecoveryFailure(code).deactivating, true, code);
  }
});

test("the deactivating set is exactly these five codes", () => {
  // Adding a code here takes the public site down on that failure; removing one
  // makes a real violation wait for the resolver's 26-hour budget. Either is a
  // deliberate decision, so it cannot ride along in an unrelated commit.
  assert.deepEqual([...DEACTIVATING_RECOVERY_CODES].sort(), [...READINESS_VIOLATIONS].sort());
});

test("an unrecognised code does not deactivate, matching the in-process path", () => {
  // `deactivatePilotForBackupFailure` has refused unknown codes since #2893.
  // The workflow now reaches the same verdict; that is the whole point.
  for (const code of ["", null, undefined, "SOME_FUTURE_CODE", 42]) {
    assert.equal(classifyRecoveryFailure(code).deactivating, false, String(code));
  }
  assert.equal(classifyRecoveryFailure(null).code, "UNEXPECTED_FAILURE");
});

test("backup-sites-cms no longer keeps a second copy of the set", () => {
  // Two literal lists is how the workflow and the in-process path drifted apart
  // in the first place. One definition, both consumers.
  assert.match(BACKUP_CMS, /DEACTIVATING_BACKUP_CODES = DEACTIVATING_RECOVERY_CODES/);
  assert.equal(
    /DEACTIVATING_BACKUP_CODES = new Set\(\[/.test(BACKUP_CMS),
    false,
    "a second literal allowlist reappeared in backup-sites-cms.mjs",
  );
});

test("the classification file records both fields and is readable", () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-3628-"));
  const path = join(dir, "classification.json");
  const written = recordRecoveryFailureClassification(OUTAGE_CODE, {
    SITES_RECOVERY_CLASSIFICATION_PATH: path,
  });
  assert.deepEqual(written, { code: OUTAGE_CODE, deactivating: false });
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(parsed.code, OUTAGE_CODE);
  assert.equal(parsed.deactivating, false);
});

test("no configured path writes nothing and reports nothing", () => {
  assert.equal(recordRecoveryFailureClassification(OUTAGE_CODE, {}), null);
});

test("safeCliFailure itself writes the classification the gate reads", () => {
  // Without this, deleting one line from safeCliFailure leaves no file, the
  // gate reads unset, and every failure deactivates again — the exact 2026-09-28
  // behaviour — while a suite that only tested the helper directly stayed green.
  // This is the end of the wire the workflow actually reads from.
  const dir = mkdtempSync(join(tmpdir(), "sites-3628-cli-"));
  const path = join(dir, "classification.json");
  const priorPath = process.env.SITES_RECOVERY_CLASSIFICATION_PATH;
  const priorExit = process.exitCode;
  try {
    process.env.SITES_RECOVERY_CLASSIFICATION_PATH = path;
    safeCliFailure(new SitesOpsError(OUTAGE_CODE));
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(parsed.code, OUTAGE_CODE);
    assert.equal(parsed.deactivating, false);
  } finally {
    // safeCliFailure sets process.exitCode = 1; leaving it set would fail the
    // whole test process regardless of assertions.
    process.exitCode = priorExit;
    if (priorPath === undefined) delete process.env.SITES_RECOVERY_CLASSIFICATION_PATH;
    else process.env.SITES_RECOVERY_CLASSIFICATION_PATH = priorPath;
  }
});

test("safeCliFailure marks a real readiness violation as deactivating", () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-3628-cli2-"));
  const path = join(dir, "classification.json");
  const priorPath = process.env.SITES_RECOVERY_CLASSIFICATION_PATH;
  const priorExit = process.exitCode;
  try {
    process.env.SITES_RECOVERY_CLASSIFICATION_PATH = path;
    safeCliFailure(new SitesOpsError("DATABASE_BACKUP_STALE"));
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      code: "DATABASE_BACKUP_STALE",
      deactivating: true,
    });
  } finally {
    process.exitCode = priorExit;
    if (priorPath === undefined) delete process.env.SITES_RECOVERY_CLASSIFICATION_PATH;
    else process.env.SITES_RECOVERY_CLASSIFICATION_PATH = priorPath;
  }
});

test("the deactivation gate consults the classification", () => {
  assert.match(
    WORKFLOW,
    /needs\.backup_restore\.outputs\.recovery_deactivate != 'false'/,
    "the deactivate job no longer reads the failure classification",
  );
});

test("the gate keeps EXCLUSION polarity: unset still deactivates", () => {
  // `== 'true'` would hold the site up whenever the output is missing — a
  // cancelled runner, a crashed job, a step that died before classifying.
  assert.equal(
    /recovery_deactivate == 'true'/.test(WORKFLOW),
    false,
    "inclusion polarity would hold a live site up on an unset output",
  );
});

test("the bare result-only gate is gone, not merely accompanied", () => {
  // A gate can keep the bug beside the fix: leaving the old clause as its own
  // sufficient condition would deactivate on a transient failure exactly as
  // before, while every new assertion above still passed.
  const gate = WORKFLOW.slice(
    WORKFLOW.indexOf("  deactivate:"),
    WORKFLOW.indexOf("  alert:"),
  );
  const ifBlock = gate.slice(gate.indexOf("    if: >-"));
  assert.match(ifBlock, /needs\.backup_restore\.result != 'success' &&/);
  assert.match(ifBlock, /recovery_deactivate != 'false'/);
});

test("the backup job publishes the classification as a job output", () => {
  assert.match(WORKFLOW, /recovery_deactivate: \$\{\{ steps\.classify\.outputs\.deactivate \}\}/);
  assert.match(WORKFLOW, /recovery_failure_code: \$\{\{ steps\.classify\.outputs\.code \}\}/);
});

test("the classify step runs only on failure and defaults to deactivating", () => {
  const step = WORKFLOW.slice(WORKFLOW.indexOf("        id: classify"));
  assert.match(step.slice(0, 200), /if: failure\(\)/);
  assert.match(step, /let deactivate = "true";/);
  assert.match(step, /SITES_RECOVERY_CLASSIFICATION_PATH/);
});

test("the alert distinguishes a held pilot from a deactivated one", () => {
  // An alert that reads the same either way cannot tell anyone that a live site
  // is still serving on evidence that is ageing out.
  assert.match(WORKFLOW, /PILOT_HELD_UP/);
  assert.match(WORKFLOW, /outcome=\$\{outcome\}/);
});

test("the watchdog cron exclusions on deactivate are untouched by #3628", () => {
  // #3606's routing is load-bearing in the other direction: losing it makes the
  // hourly watchdog deactivate the pilot every hour.
  const gate = WORKFLOW.slice(
    WORKFLOW.indexOf("  deactivate:"),
    WORKFLOW.indexOf("  alert:"),
  );
  assert.match(gate, /github\.event\.schedule != '37 \* \* \* \*'/);
  assert.match(gate, /github\.event\.inputs\.mode != 'freshness-check'/);
});
