#!/usr/bin/env node

import { createHash, createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  SitesOpsError,
  fail,
  recordRecoveryFailureClassification,
  requiredEnv,
  requireUuid,
} from "./lib/sites-ops.mjs";

const CMS_ORIGIN = "https://studio.sites.usemingla.com";
const PATH = "/api/internal/retention-sweep";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  return [
    value.schema_version,
    value.issuer,
    value.audience,
    value.direction,
    value.site_id,
    value.operation_id,
    value.issued_at,
    value.expires_at,
    value.nonce,
    value.method,
    value.path,
    value.body_sha256,
    value.kid,
  ].join("\n");
}

export function retentionEnvelope(env, {
  now = new Date(),
  operationId = randomUUID(),
  nonce = randomUUID(),
} = {}) {
  const siteId = requireUuid(requiredEnv(env, "SITES_PILOT_SITE_ID"));
  const origin = requiredEnv(env, "SITES_CMS_ORIGIN");
  if (origin !== CMS_ORIGIN) fail("CMS_ORIGIN_MISMATCH");
  const kid = requiredEnv(env, "MINGLA_CORE_TO_CMS_CURRENT_KID");
  if (!/^[A-Za-z0-9._-]{8,64}$/.test(kid)) fail("INVALID_CORE_TO_CMS_KID");
  const key = Buffer.from(
    requiredEnv(env, "MINGLA_CORE_TO_CMS_CURRENT_KEY_B64"),
    "base64",
  );
  if (key.byteLength !== 32) fail("INVALID_CORE_TO_CMS_KEY");
  const body = "{}";
  const unsigned = {
    schema_version: 1,
    issuer: "mingla-core",
    audience: "mingla-site-cms",
    direction: "core_to_cms",
    site_id: siteId,
    operation_id: requireUuid(operationId, "INVALID_OPERATION_ID"),
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    nonce: requireUuid(nonce, "INVALID_NONCE"),
    method: "POST",
    path: PATH,
    body_sha256: sha256(body),
    kid,
  };
  return {
    body,
    envelope: {
      ...unsigned,
      signature_b64: createHmac("sha256", key)
        .update(canonical(unsigned))
        .digest("base64"),
    },
  };
}

export const RETENTION_STUCK_HOURS = 72;
const REPORT_KEYS = [
  "attempted", "failed", "failure_classes", "oldest_overdue_hours",
  "scanned_jobs", "scanned_media", "stages", "truncated", "verdict", "version",
];
const STAGE_KEYS = [
  "artifact_purge", "failed_output_cleanup", "media_purge", "quarantine_cleanup",
];
const STAGE_COUNT_KEYS = ["attempted", "failed", "succeeded"];

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

/**
 * Strict shape of the version-2 sweep report. Anything else is an invalid
 * read-back, never a success: an unknown key, a `DEGRADED` verdict on a 200, a
 * verdict that contradicts its own failure count.
 */
export function isRetentionReport(report) {
  if (!hasExactKeys(report, REPORT_KEYS)) return false;
  if (report.version !== 2) return false;
  if (report.verdict !== "CLEAN" && report.verdict !== "PARTIAL") return false;
  if (typeof report.truncated !== "boolean") return false;
  for (const key of ["attempted", "failed", "scanned_jobs", "scanned_media"]) {
    if (!isCount(report[key])) return false;
  }
  if (report.failed > report.attempted) return false;
  if ((report.verdict === "CLEAN") !== (report.failed === 0)) return false;
  if (
    typeof report.oldest_overdue_hours !== "number" ||
    !Number.isFinite(report.oldest_overdue_hours) ||
    report.oldest_overdue_hours < 0
  ) return false;
  if (!hasExactKeys(report.stages, STAGE_KEYS)) return false;
  for (const stage of STAGE_KEYS) {
    const counts = report.stages[stage];
    if (!hasExactKeys(counts, STAGE_COUNT_KEYS)) return false;
    if (STAGE_COUNT_KEYS.some((key) => !isCount(counts[key]))) return false;
  }
  if (!isPlainObject(report.failure_classes)) return false;
  for (const [name, count] of Object.entries(report.failure_classes)) {
    // Classes only: an upper-case token, never an id, a key or free text.
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) return false;
    if (!Number.isSafeInteger(count) || count < 1) return false;
  }
  return true;
}

/**
 * The code this failure is recorded under. Only a code this script raised
 * itself is trusted; anything else (a transport error, a thrown string) is
 * `RETENTION_SWEEP_FAILED`, so no free text reaches the classification file or
 * a workflow output.
 */
export function retentionFailureCode(error) {
  return error instanceof SitesOpsError && /^[A-Z][A-Z0-9_]{2,95}$/.test(error.code)
    ? error.code
    : "RETENTION_SWEEP_FAILED";
}

export async function runSitesRetention({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  operationId = randomUUID(),
  nonce = randomUUID(),
} = {}) {
  const { body, envelope } = retentionEnvelope(env, {
    now,
    operationId,
    nonce,
  });
  const response = await fetchImpl(`${CMS_ORIGIN}${PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mingla-sites-envelope": Buffer.from(JSON.stringify(envelope))
        .toString("base64"),
    },
    body,
    cache: "no-store",
    redirect: "error",
  });
  const value = await response.json().catch(() => null);
  const data = value?.data;
  if (
    !response.ok || value?.ok !== true ||
    !data || typeof data !== "object" || Array.isArray(data)
  ) fail("RETENTION_SWEEP_FAILED");
  const legacyKeys = [
    "protected_artifacts", "protected_media", "purged_artifacts", "purged_media",
  ];
  // #2830 — exactly two shapes are accepted: the four legacy counts, or those
  // four plus `report`. This script ships BEFORE the CMS starts sending
  // `report`, so the old script never meets the new shape and reads a healthy
  // sweep as a failed one.
  const hasReport = Object.hasOwn(data, "report");
  const expectedKeys = hasReport ? [...legacyKeys, "report"] : legacyKeys;
  if (
    JSON.stringify(Object.keys(data).sort()) !== JSON.stringify([...expectedKeys].sort()) ||
    legacyKeys.some((key) => !isCount(data[key])) ||
    (hasReport && !isRetentionReport(data.report))
  ) fail("RETENTION_SWEEP_READBACK_INVALID");
  const report = hasReport ? data.report : null;
  if (report?.truncated) process.stdout.write("SITES_RETENTION_TRUNCATED\n");
  if (report?.verdict === "PARTIAL") {
    const classes = Object.keys(report.failure_classes).sort()
      .map((name) => `${name}:${report.failure_classes[name]}`).join(",") || "none";
    process.stdout.write(
      `SITES_RETENTION_PARTIAL failed=${report.failed} attempted=${report.attempted} classes=${classes}\n`,
    );
  }
  // One bad item is tolerated; the same item failing for three days is not.
  if (report && report.oldest_overdue_hours > RETENTION_STUCK_HOURS) {
    fail("RETENTION_ITEM_STUCK");
  }
  if (report?.verdict !== "PARTIAL") {
    process.stdout.write(
      `SITES_RETENTION_OK purged_media=${data.purged_media} purged_artifacts=${data.purged_artifacts}\n`,
    );
  }
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSitesRetention().catch((error) => {
    const code = error?.code || error?.message || "RETENTION_SWEEP_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    // #2830 — this entrypoint used to exit 1 having written no classification,
    // and "no classification" is read as "deactivate the pilot". From
    // 2026-10-07 that took a live site down for four days over a clean-up
    // fault. Retention is housekeeping: none of its codes is a readiness
    // violation, so the file always says `deactivating: false`. It is written
    // here even though retention now runs in its own job, so that moving the
    // step back beside the backup still cannot deactivate anything.
    const safeCode = retentionFailureCode(error);
    recordRecoveryFailureClassification(safeCode);
    process.stderr.write(`SITES_RETENTION_FAILED code=${safeCode}\n`);
    process.exitCode = 1;
  });
}
