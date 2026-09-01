#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  callCore,
  coreConfigFromEnv,
  decryptBundle,
  encryptionKeyFromEnv,
  extractPlainBundle,
  fail,
  postgresEnvFromUrl,
  requiredEnv,
  requireUuid,
  safeCliFailure,
  sha256Bytes,
  stableJson,
  timestampsRepresentSameInstant,
  validateReadinessResponse,
  writeSafeResult,
} from "./lib/sites-ops.mjs";

const RESTORE_COUNTS_SQL = String.raw`
SELECT json_build_object(
  'tenants', (SELECT count(*) FROM sites_cms.tenants),
  'documents',
    (SELECT count(*) FROM sites_cms.pages) +
    (SELECT count(*) FROM sites_cms.media) +
    (SELECT count(*) FROM sites_cms.navigation) +
    (SELECT count(*) FROM sites_cms.footer) +
    (SELECT count(*) FROM sites_cms.site_settings) +
    (SELECT count(*) FROM sites_cms.publication_jobs),
  'site_ids', COALESCE((
    SELECT json_agg(core_site_id ORDER BY core_site_id)
    FROM sites_cms.tenants
  ), '[]'::json)
);`;

export const EPHEMERAL_RESTORE_DATABASE_URL =
  "postgresql://postgres:sites-restore-ephemeral-only@127.0.0.1:5432/postgres?sslmode=disable";

function validateRestoreTarget(env) {
  if (env.SITES_RESTORE_DATABASE_URL !== EPHEMERAL_RESTORE_DATABASE_URL) {
    fail("INVALID_RESTORE_TARGET");
  }
}

function runCommand(command, args, env, spawn = spawnSync) {
  const result = spawn(command, args, {
    encoding: "utf8",
    env: {
      ...postgresEnvFromUrl(env.SITES_RESTORE_DATABASE_URL, env),
      PGAPPNAME: "mingla-sites-restore-drill-v1",
      PGCONNECT_TIMEOUT: "15",
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("RESTORE_DATABASE_COMMAND_FAILED");
  return String(result.stdout || "");
}

function verifyPostgres17(env, spawn) {
  for (const command of ["pg_restore", "psql"]) {
    if (!/\(PostgreSQL\) 17\./.test(runCommand(command, ["--version"], env, spawn))) {
      fail("POSTGRES_17_REQUIRED");
    }
  }
}

function assertEmptyTarget(env, spawn) {
  const output = runCommand(
    "psql",
    [
      "-X", "--no-psqlrc", "--tuples-only", "--no-align", "--command",
      "SELECT count(*) FROM pg_namespace WHERE nspname = 'sites_cms';",
    ],
    env,
    spawn,
  ).trim();
  if (output !== "0") fail("RESTORE_TARGET_NOT_EMPTY");
}

function readRestoredCounts(env, spawn) {
  const output = runCommand(
    "psql",
    ["-X", "--no-psqlrc", "--tuples-only", "--no-align", "--command", RESTORE_COUNTS_SQL],
    env,
    spawn,
  ).trim();
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    fail("RESTORE_COUNTS_INVALID");
  }
  const tenants = Number(value?.tenants);
  const documents = Number(value?.documents);
  if (
    !Number.isSafeInteger(tenants) || tenants < 0 ||
    !Number.isSafeInteger(documents) || documents < 0 ||
    !Array.isArray(value?.site_ids)
  ) fail("RESTORE_COUNTS_INVALID");
  return { tenants, documents, site_ids: value.site_ids };
}

export async function runRestore({
  env = process.env,
  fetchImpl = fetch,
  spawn = spawnSync,
  now = new Date(),
} = {}) {
  for (const name of [
    "SITES_BACKUP_BUNDLE_PATH",
    "SITES_BACKUP_RESTORE_RESULT_PATH",
    "SITES_RESTORE_DATABASE_URL",
    "SITES_PILOT_SITE_ID",
  ]) requiredEnv(env, name);
  validateRestoreTarget(env);
  const siteId = requireUuid(env.SITES_PILOT_SITE_ID);
  const bundlePath = resolve(env.SITES_BACKUP_BUNDLE_PATH);
  if (!statSync(bundlePath).isFile()) fail("BACKUP_BUNDLE_MISSING");
  const resultPath = resolve(env.SITES_BACKUP_RESTORE_RESULT_PATH);
  const key = encryptionKeyFromEnv(env);
  const coreConfig = coreConfigFromEnv(env);
  verifyPostgres17(env, spawn);
  assertEmptyTarget(env, spawn);
  const temporary = mkdtempSync(join(dirname(bundlePath), ".restore-"));
  chmodSync(temporary, 0o700);
  try {
    const plaintextPath = join(temporary, "backup.plain");
    await decryptBundle(bundlePath, plaintextPath, key);
    const extractedDirectory = join(temporary, "extracted");
    const extracted = extractPlainBundle(plaintextPath, extractedDirectory, now);
    if (extracted.manifest.site_id !== siteId) fail("RESTORE_SITE_MISMATCH");
    runCommand(
      "pg_restore",
      [
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        "postgres",
        extracted.databasePath,
      ],
      env,
      spawn,
    );
    const counts = readRestoredCounts(env, spawn);
    if (
      counts.tenants !== extracted.manifest.counts.tenants ||
      counts.documents !== extracted.manifest.counts.documents ||
      counts.site_ids.length !== 1 || counts.site_ids[0] !== siteId
    ) fail("RESTORE_DATABASE_COUNT_MISMATCH");
    if (counts.tenants < 1 || counts.documents < 1) fail("RESTORE_EMPTY_PILOT");
    if (extracted.objects.length !== extracted.manifest.counts.objects) {
      fail("RESTORE_OBJECT_COUNT_MISMATCH");
    }
    const objectBytes = extracted.objects.reduce((total, object) => {
      if (sha256Bytes(readFileSync(object.path)) !== object.sha256) {
        fail("RESTORE_OBJECT_DIGEST_MISMATCH");
      }
      return total + statSync(object.path).size;
    }, 0);
    if (objectBytes !== extracted.manifest.counts.object_bytes) {
      fail("RESTORE_OBJECT_COUNT_MISMATCH");
    }
    const verifiedAt = now.toISOString();
    const bundleDigest = sha256Bytes(readFileSync(bundlePath));
    const manifestDigest = sha256Bytes(Buffer.from(stableJson(extracted.manifest)));
    const receipt = {
      schema_version: 1,
      site_id: siteId,
      verified_at: verifiedAt,
      bundle_digest: bundleDigest,
      manifest_digest: manifestDigest,
      tenant_count: counts.tenants,
      document_count: counts.documents,
      object_count: extracted.objects.length,
      object_bytes: objectBytes,
    };
    const evidenceDigest = sha256Bytes(Buffer.from(stableJson(receipt)));
    const readinessPath = `/internal/v1/sites/${siteId}/readiness-evidence`;
    const readiness = await callCore(coreConfig, {
      siteId,
      method: "POST",
      path: readinessPath,
      payload: {
        schema_version: 1,
        evidence_kind: "restore_drill",
        observed_at: verifiedAt,
        restore_drill_verified_at: verifiedAt,
        restore_drill_evidence_digest: evidenceDigest,
        tenant_count: counts.tenants,
        document_count: counts.documents,
        object_count: extracted.objects.length,
        object_bytes: objectBytes,
      },
      fetchImpl,
      now,
    });
    validateReadinessResponse(readiness, siteId, "restore_drill");
    if (
      !timestampsRepresentSameInstant(
        readiness.readiness.restore_drill_verified_at,
        verifiedAt,
      ) ||
      readiness.readiness.restore_drill_evidence_digest !== evidenceDigest
    ) fail("CORE_READINESS_READBACK_MISMATCH");
    const result = {
      ok: true,
      code: "SITES_RESTORE_DRILL_COMPLETE",
      restore_drill_verified_at: verifiedAt,
      restore_drill_evidence_digest: evidenceDigest,
      tenant_count: counts.tenants,
      document_count: counts.documents,
      object_count: extracted.objects.length,
      object_bytes: objectBytes,
    };
    writeSafeResult(resultPath, result);
    process.stdout.write(
      `SITES_RESTORE_OK tenants=${counts.tenants} documents=${counts.documents} objects=${extracted.objects.length}\n`,
    );
    return result;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRestore().catch(safeCliFailure);
}
