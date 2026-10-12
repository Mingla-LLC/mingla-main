/**
 * Issue #2830 — T-6.4: what the retention runner accepts from the CMS.
 *
 * The CMS is about to start answering the retention sweep with a `report`
 * beside the four counts it returns today, so that one bad item no longer
 * aborts the whole sweep. The runner in CI must understand that answer BEFORE
 * the CMS sends it: a runner that only knows the four-key shape would read a
 * healthy tolerant sweep as `RETENTION_SWEEP_READBACK_INVALID`.
 *
 * So the runner accepts exactly two shapes — the four legacy keys, or those
 * four plus `report` — and rejects everything else. Every case below runs the
 * shipped CLI as a child process; only `fetch` is replaced, by a preload
 * module, so nothing touches the network.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  RETENTION_STUCK_HOURS,
  isRetentionReport,
  retentionFailureCode,
  runSitesRetention,
} from "../run-sites-retention.mjs";
import { SitesOpsError } from "../lib/sites-ops.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RETENTION_CLI = join(HERE, "..", "run-sites-retention.mjs");
const SITE_ID = "11111111-1111-4111-8111-111111111111";

const ENV = Object.freeze({
  SITES_PILOT_SITE_ID: SITE_ID,
  SITES_CMS_ORIGIN: "https://studio.sites.usemingla.com",
  MINGLA_CORE_TO_CMS_CURRENT_KID: "core-key-v1",
  MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: Buffer.alloc(32, 4).toString("base64"),
});

const LEGACY = Object.freeze({
  protected_artifacts: 4,
  protected_media: 7,
  purged_artifacts: 2,
  purged_media: 3,
});

function report(overrides = {}) {
  return {
    version: 2,
    verdict: "CLEAN",
    scanned_media: 12,
    scanned_jobs: 9,
    truncated: false,
    attempted: 5,
    failed: 0,
    stages: {
      quarantine_cleanup: { attempted: 1, succeeded: 1, failed: 0 },
      failed_output_cleanup: { attempted: 0, succeeded: 0, failed: 0 },
      media_purge: { attempted: 3, succeeded: 3, failed: 0 },
      artifact_purge: { attempted: 2, succeeded: 2, failed: 0 },
    },
    failure_classes: {},
    oldest_overdue_hours: 0,
    ...overrides,
  };
}

function partial(overrides = {}) {
  return report({
    verdict: "PARTIAL",
    attempted: 10,
    failed: 2,
    failure_classes: { STORAGE_UNAVAILABLE: 1, DB_SCHEMA_MISMATCH: 1 },
    oldest_overdue_hours: 6.5,
    ...overrides,
  });
}

function runCli(payload, { status = 200 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sites-2830-contract-"));
  const classificationPath = join(dir, "classification.json");
  const preload = join(dir, "preload.mjs");
  writeFileSync(preload, [
    "globalThis.fetch = async () => new Response(process.env.FIXTURE_BODY, {",
    "  status: Number(process.env.FIXTURE_STATUS),",
    "  headers: { 'content-type': 'application/json' },",
    "});",
    "",
  ].join("\n"));
  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(preload).href, RETENTION_CLI],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        ...ENV,
        SITES_RECOVERY_CLASSIFICATION_PATH: classificationPath,
        FIXTURE_STATUS: String(status),
        FIXTURE_BODY: typeof payload === "string" ? payload : JSON.stringify(payload),
      },
    },
  );
  return {
    ...result,
    classification: existsSync(classificationPath)
      ? JSON.parse(readFileSync(classificationPath, "utf8"))
      : null,
  };
}

function assertRejected(result, code, label) {
  assert.equal(result.status, 1, `${label}: exit ${result.status}, stdout ${result.stdout}`);
  assert.match(result.stderr, new RegExp(`^SITES_RETENTION_FAILED code=${code}$`, "m"), label);
  assert.deepEqual(result.classification, { code, deactivating: false }, label);
  assert.equal(/SITES_RETENTION_OK/.test(result.stdout), false, label);
}

test("#2830 T-6.4 the legacy four-key response is still accepted, unchanged", () => {
  const result = runCli({ ok: true, data: LEGACY });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "SITES_RETENTION_OK purged_media=3 purged_artifacts=2\n");
  assert.equal(result.stderr, "");
  assert.equal(result.classification, null);
});

test("#2830 T-6.4 the four keys plus a CLEAN version-2 report are accepted", async () => {
  const result = runCli({ ok: true, data: { ...LEGACY, report: report() } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "SITES_RETENTION_OK purged_media=3 purged_artifacts=2\n");
  assert.equal(result.classification, null);

  // The function returns what the CMS sent, report included.
  const data = await runSitesRetention({
    env: ENV,
    fetchImpl: async () => Response.json({ ok: true, data: { ...LEGACY, report: report() } }),
  });
  assert.deepEqual(data, { ...LEGACY, report: report() });
});

test("#2830 T-6.4 a PARTIAL sweep exits 0 and says what failed, by class only", () => {
  const result = runCli({ ok: true, data: { ...LEGACY, report: partial() } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "SITES_RETENTION_PARTIAL failed=2 attempted=10 classes=DB_SCHEMA_MISMATCH:1,STORAGE_UNAVAILABLE:1\n",
  );
  assert.equal(result.classification, null, "a tolerated partial sweep is not a failure");
});

test("#2830 T-6.4 a truncated scan is a warning, not a failure", () => {
  const result = runCli({ ok: true, data: { ...LEGACY, report: report({ truncated: true }) } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "SITES_RETENTION_TRUNCATED\nSITES_RETENTION_OK purged_media=3 purged_artifacts=2\n",
  );
});

test("#2830 T-6.4 an item stuck for more than 72 hours fails the sweep", () => {
  assert.equal(RETENTION_STUCK_HOURS, 72);
  const stuck = runCli({
    ok: true,
    data: { ...LEGACY, report: partial({ oldest_overdue_hours: 72.01 }) },
  });
  assertRejected(stuck, "RETENTION_ITEM_STUCK", "72.01 hours overdue");
  // The partial line is still printed, so the log says what is stuck.
  assert.match(stuck.stdout, /^SITES_RETENTION_PARTIAL failed=2 attempted=10 /m);

  // The boundary is strictly greater than 72: exactly 72 is tolerated.
  const boundary = runCli({
    ok: true,
    data: { ...LEGACY, report: partial({ oldest_overdue_hours: 72 }) },
  });
  assert.equal(boundary.status, 0, boundary.stderr);
  assert.equal(boundary.classification, null);
});

test("#2830 T-6.4 any other top-level shape is rejected", () => {
  const cases = [
    ["extra key", { ...LEGACY, surprise: 1 }],
    ["extra key beside a valid report", { ...LEGACY, report: report(), surprise: 1 }],
    ["missing legacy key", { protected_artifacts: 1, protected_media: 1, purged_media: 1 }],
    ["report without the legacy keys", { report: report() }],
    ["negative count", { ...LEGACY, purged_media: -1 }],
    ["fractional count", { ...LEGACY, purged_media: 1.5 }],
    ["string count", { ...LEGACY, purged_media: "3" }],
    ["report null", { ...LEGACY, report: null }],
    ["report array", { ...LEGACY, report: [] }],
    ["report string", { ...LEGACY, report: "CLEAN" }],
  ];
  for (const [label, data] of cases) {
    assertRejected(runCli({ ok: true, data }), "RETENTION_SWEEP_READBACK_INVALID", label);
  }
});

test("#2830 T-6.4 a malformed report is rejected, field by field", () => {
  const stages = report().stages;
  const cases = [
    ["unknown report key", report({ item_ids: ["x"] })],
    ["version 1", report({ version: 1 })],
    ["version as string", report({ version: "2" })],
    ["DEGRADED on a 200", report({ verdict: "DEGRADED", failed: 5 })],
    ["unknown verdict", report({ verdict: "OK" })],
    ["CLEAN with failures", report({ failed: 1 })],
    ["PARTIAL with no failures", partial({ failed: 0 })],
    ["failed exceeds attempted", partial({ failed: 11 })],
    ["truncated not boolean", report({ truncated: "false" })],
    ["negative scanned_media", report({ scanned_media: -1 })],
    ["scanned_jobs missing", (() => { const value = report(); delete value.scanned_jobs; return value; })()],
    ["oldest_overdue_hours negative", report({ oldest_overdue_hours: -1 })],
    ["oldest_overdue_hours string", report({ oldest_overdue_hours: "80" })],
    ["oldest_overdue_hours null", report({ oldest_overdue_hours: null })],
    ["stage missing", report({ stages: { ...stages, artifact_purge: undefined } })],
    ["unknown stage", report({ stages: { ...stages, extra: { attempted: 0, succeeded: 0, failed: 0 } } })],
    ["stage count extra key", report({ stages: { ...stages, media_purge: { attempted: 1, succeeded: 1, failed: 0, ids: 1 } } })],
    ["stage count negative", report({ stages: { ...stages, media_purge: { attempted: 1, succeeded: -1, failed: 0 } } })],
    ["failure_classes array", partial({ failure_classes: ["STORAGE_UNAVAILABLE"] })],
    ["failure class is free text", partial({ failure_classes: { "column \"x\" does not exist": 1 } })],
    ["failure class is an object key", partial({ failure_classes: { "tenants/abc/media/1.jpg": 1 } })],
    ["failure class count zero", partial({ failure_classes: { STORAGE_UNAVAILABLE: 0 } })],
  ];
  for (const [label, value] of cases) {
    assert.equal(isRetentionReport(value), false, label);
    assertRejected(
      runCli({ ok: true, data: { ...LEGACY, report: value } }),
      "RETENTION_SWEEP_READBACK_INVALID",
      label,
    );
  }
  assert.equal(isRetentionReport(report()), true);
  assert.equal(isRetentionReport(partial()), true);
});

test("#2830 T-6.4 a failed sweep stays a failed sweep whatever body comes with it", () => {
  for (const [label, payload, status] of [
    ["503 as today", { ok: false, error: { code: "SERVICE_TEMPORARILY_UNAVAILABLE" } }, 503],
    ["503 carrying a well-formed body", { ok: true, data: { ...LEGACY, report: report() } }, 503],
    ["200 with ok:false", { ok: false, data: LEGACY }, 200],
    ["200 with no data", { ok: true }, 200],
    ["200 with array data", { ok: true, data: [] }, 200],
    ["200 not json", "<html>", 200],
  ]) {
    assertRejected(runCli(payload, { status }), "RETENTION_SWEEP_FAILED", label);
  }
});

test("#2830 the recorded failure code is a code this script raised, or the generic one", () => {
  assert.equal(retentionFailureCode(new SitesOpsError("RETENTION_ITEM_STUCK")), "RETENTION_ITEM_STUCK");
  assert.equal(retentionFailureCode(new SitesOpsError("MISSING_SITES_PILOT_SITE_ID")), "MISSING_SITES_PILOT_SITE_ID");
  for (const error of [
    new TypeError("fetch failed"),
    Object.assign(new Error("boom"), { code: "ECONNRESET" }),
    new SitesOpsError("lower case text"),
    new SitesOpsError("X\ndeactivate=true"),
    "a thrown string",
    null,
    undefined,
  ]) assert.equal(retentionFailureCode(error), "RETENTION_SWEEP_FAILED");
});
