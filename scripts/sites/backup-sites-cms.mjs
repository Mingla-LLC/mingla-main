#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  callCore,
  coreConfigFromEnv,
  encryptBundle,
  fail,
  getObject,
  listBucket,
  postgresEnvFromUrl,
  requiredEnv,
  requireUuid,
  safeCliFailure,
  sha256Bytes,
  SITES_BUCKETS,
  stableJson,
  storageConfigFromEnv,
  validateManagementBackupResponse,
  validateManagementProjectResponse,
  validateCmsDatabaseUrl,
  validateManifest,
  validateObjectIdentity,
  validatePilotDeactivationResponse,
  validateProtectionResponse,
  validateReadinessResponse,
  writePlainBundle,
  writeSafeResult,
  encryptionKeyFromEnv,
} from "./lib/sites-ops.mjs";

const INVENTORY_SQL = String.raw`
SELECT json_build_object(
  'tenants', COALESCE((
    SELECT json_agg(json_build_object(
      'tenant_id', id,
      'site_id', core_site_id
    ) ORDER BY id)
    FROM sites_cms.tenants
  ), '[]'::json),
  'media', COALESCE((
    SELECT json_agg(json_build_object(
      'tenant_id', tenant_id,
      'media_id', id,
      'state', state,
      'quarantine_key', quarantine_key,
      'approved_master_key', approved_master_key,
      'rendition_manifest', rendition_manifest
    ) ORDER BY id)
    FROM sites_cms.media
  ), '[]'::json),
  'publications', COALESCE((
    SELECT json_agg(json_build_object(
      'tenant_id', tenant_id,
      'status', status,
      'artifact_key', artifact_key,
      'artifact_digest', artifact_digest
    ) ORDER BY id)
    FROM sites_cms.publication_jobs
  ), '[]'::json),
  'counts', json_build_object(
    'tenants', (SELECT count(*) FROM sites_cms.tenants),
    'documents',
      (SELECT count(*) FROM sites_cms.pages) +
      (SELECT count(*) FROM sites_cms.media) +
      (SELECT count(*) FROM sites_cms.navigation) +
      (SELECT count(*) FROM sites_cms.footer) +
      (SELECT count(*) FROM sites_cms.site_settings) +
      (SELECT count(*) FROM sites_cms.publication_jobs)
  )
);`;

function runCommand(command, args, env, spawn = spawnSync) {
  const result = spawn(command, args, {
    encoding: "utf8",
    env: {
      ...postgresEnvFromUrl(env.SITES_CMS_DATABASE_URL, env),
      PGAPPNAME: "mingla-sites-backup-v1",
      PGCONNECT_TIMEOUT: "15",
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("DATABASE_COMMAND_FAILED");
  return String(result.stdout || "");
}

function verifyPostgres17(env, spawn) {
  for (const command of ["pg_dump", "psql"]) {
    const output = runCommand(command, ["--version"], env, spawn);
    if (!/\(PostgreSQL\) 17\./.test(output)) fail("POSTGRES_17_REQUIRED");
  }
}

function readDatabaseInventory(env, spawn) {
  const output = runCommand(
    "psql",
    ["-X", "--no-psqlrc", "--tuples-only", "--no-align", "--command", INVENTORY_SQL],
    env,
    spawn,
  ).trim();
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    fail("DATABASE_INVENTORY_INVALID");
  }
  if (
    !value || !Array.isArray(value.tenants) || !Array.isArray(value.media) ||
    !Array.isArray(value.publications) || !value.counts ||
    !Number.isSafeInteger(Number(value.counts.tenants)) ||
    !Number.isSafeInteger(Number(value.counts.documents))
  ) fail("DATABASE_INVENTORY_INVALID");
  value.counts.tenants = Number(value.counts.tenants);
  value.counts.documents = Number(value.counts.documents);
  return value;
}

export function buildReferenceMap(inventory, siteId) {
  if (
    inventory.tenants.length !== 1 ||
    inventory.tenants[0]?.site_id !== siteId ||
    !/^[0-9a-f-]{36}$/i.test(String(inventory.tenants[0]?.tenant_id || ""))
  ) fail("DATABASE_SITE_SCOPE_MISMATCH");
  const tenantId = String(inventory.tenants[0].tenant_id);
  const references = new Map();
  const add = (bucket, key, state, expectedDigest = null, expectedBytes = null) => {
    if (key === null || key === undefined || key === "") return;
    if (typeof key !== "string") fail("DATABASE_INVENTORY_INVALID");
    if (expectedDigest !== null && !/^[0-9a-f]{64}$/.test(expectedDigest)) {
      fail("DATABASE_INVENTORY_INVALID");
    }
    if (
      expectedBytes !== null &&
      (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1)
    ) fail("DATABASE_INVENTORY_INVALID");
    validateObjectIdentity(bucket, key, siteId, tenantId);
    const identity = `${bucket}/${key}`;
    const previous = references.get(identity);
    if (
      previous &&
      (previous.expected_digest !== expectedDigest ||
        previous.expected_bytes !== expectedBytes)
    ) fail("DATABASE_INVENTORY_CONFLICT");
    references.set(identity, {
      state: previous && previous.state !== state
        ? `${previous.state}+${state}`
        : state,
      expected_digest: expectedDigest,
      expected_bytes: expectedBytes,
    });
  };
  for (const media of inventory.media) {
    if (String(media.tenant_id) !== tenantId) fail("DATABASE_SITE_SCOPE_MISMATCH");
    const mediaId = requireUuid(String(media.media_id), "DATABASE_INVENTORY_INVALID");
    const state = String(media.state || "UNKNOWN").slice(0, 32);
    add("sites-media-quarantine", media.quarantine_key, `media:${state}`);
    const manifest = media.rendition_manifest;
    if (
      ["READY", "TOMBSTONED"].includes(state) &&
      (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    ) fail("DATABASE_INVENTORY_INVALID");
    if (manifest !== null && manifest !== undefined) {
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        fail("DATABASE_INVENTORY_INVALID");
      }
      if (
        !manifest.master || typeof manifest.master !== "object" ||
        manifest.master.key !== media.approved_master_key
      ) fail("DATABASE_INVENTORY_INVALID");
      add(
        "sites-media-approved",
        manifest.master.key,
        `media:${state}`,
        manifest.master.digest,
        manifest.master.bytes,
      );
      if (state === "TOMBSTONED") {
        add(
          "sites-media-recovery",
          `recovery/${tenantId}/${manifest.master.key.slice("approved/".length)}`,
          `media:${state}`,
          manifest.master.digest,
          manifest.master.bytes,
        );
      }
      if (manifest.renditions !== undefined && !Array.isArray(manifest.renditions)) {
        fail("DATABASE_INVENTORY_INVALID");
      }
      for (const rendition of manifest.renditions || []) {
        add(
          "sites-media-approved",
          rendition?.key,
          `media:${state}`,
          rendition?.digest,
          rendition?.bytes,
        );
        if (state === "TOMBSTONED") {
          add(
            "sites-media-recovery",
            `recovery/${tenantId}/${String(rendition?.key || "").slice("approved/".length)}`,
            `media:${state}`,
            rendition?.digest,
            rendition?.bytes,
          );
        }
      }
    } else if (media.approved_master_key) {
      fail("DATABASE_INVENTORY_INVALID");
    }
  }
  for (const publication of inventory.publications) {
    if (String(publication.tenant_id) !== tenantId) fail("DATABASE_SITE_SCOPE_MISMATCH");
    if (
      String(publication.status) === "published" &&
      (!publication.artifact_key || !publication.artifact_digest)
    ) fail("DATABASE_INVENTORY_INVALID");
    add(
      "sites-publication-artifacts",
      publication.artifact_key,
      `publication:${String(publication.status || "unknown").slice(0, 32)}`,
      publication.artifact_digest || null,
    );
  }
  return { references, tenantId };
}

export function assertReferenceIntegrity(references, downloaded) {
  for (const [identity, reference] of references) {
    const object = downloaded.get(identity);
    if (!object) fail("REFERENCED_OBJECT_MISSING");
    if (
      reference.expected_digest !== null &&
      object.sha256 !== reference.expected_digest
    ) fail("REFERENCED_OBJECT_DIGEST_MISMATCH");
    if (
      reference.expected_bytes !== null &&
      object.bytes !== reference.expected_bytes
    ) fail("REFERENCED_OBJECT_SIZE_MISMATCH");
  }
}

async function readManagementProject(env, fetchImpl, now) {
  const projectRef = requiredEnv(env, "SITES_CMS_PROJECT_REF");
  const token = requiredEnv(env, "SUPABASE_MANAGEMENT_TOKEN");
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "user-agent": "Mingla-Sites-Backup/1.0",
      },
    },
  );
  if (!response.ok) fail("PROJECT_API_FAILED");
  const value = await response.json().catch(() => null);
  return validateManagementProjectResponse(value, projectRef, now);
}

async function readManagementBackup(env, fetchImpl, now, project) {
  const projectRef = requiredEnv(env, "SITES_CMS_PROJECT_REF");
  const token = requiredEnv(env, "SUPABASE_MANAGEMENT_TOKEN");
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/database/backups`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "user-agent": "Mingla-Sites-Backup/1.0",
      },
    },
  );
  if (!response.ok) fail("DATABASE_BACKUP_API_FAILED");
  const value = await response.json().catch(() => null);
  return validateManagementBackupResponse(value, {
    now,
    projectCreatedAt: project.created_at,
  });
}

const DEACTIVATING_BACKUP_CODES = new Set([
  "DATABASE_BACKUP_CURRENT_FAILED",
  "DATABASE_BACKUP_MISSING",
  "DATABASE_BACKUP_RETENTION_UNPROVEN",
  "DATABASE_BACKUP_STALE",
  "DATABASE_BACKUP_WALG_DISABLED",
]);

export async function deactivatePilotForBackupFailure({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  error,
} = {}) {
  if (!error || !DEACTIVATING_BACKUP_CODES.has(error.code)) return false;
  return deactivatePilotForRecoveryFailure({ env, fetchImpl, now });
}

function recoveryOperationId(env) {
  const repository = requiredEnv(env, "GITHUB_REPOSITORY");
  const runId = requiredEnv(env, "GITHUB_RUN_ID");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[0-9]+$/.test(runId)) {
    fail("INVALID_RECOVERY_RUN_IDENTITY");
  }
  const bytes = Buffer.from(sha256Bytes(Buffer.from(
    `mingla-sites-recovery-deactivation\n${repository}\n${runId}`,
  )).slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function deactivatePilotForRecoveryFailure({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const siteId = requireUuid(requiredEnv(env, "SITES_PILOT_SITE_ID"));
  const coreConfig = coreConfigFromEnv(env);
  const path = `/internal/v1/sites/${siteId}/pilot-deactivation`;
  const value = await callCore(coreConfig, {
    siteId,
    operationId: recoveryOperationId(env),
    method: "POST",
    path,
    payload: {
      schema_version: 1,
      hostname: "gogi.sites.usemingla.com",
      reason_code: "BACKUP_READINESS_FAILED",
    },
    fetchImpl,
    now,
  });
  validatePilotDeactivationResponse(value, siteId);
  process.stdout.write("SITES_PILOT_DEACTIVATED reason=BACKUP_READINESS_FAILED\n");
  return true;
}

async function readProtection(coreConfig, siteId, fetchImpl, now) {
  const path = `/internal/v1/sites/${siteId}/retention-protection`;
  const value = await callCore(coreConfig, {
    siteId,
    method: "GET",
    path,
    fetchImpl,
    now,
  });
  return validateProtectionResponse(value, siteId);
}

function protectedMediaIds(protectedArtifacts, downloaded, siteId) {
  const mediaIds = new Set();
  for (const key of protectedArtifacts) {
    const object = downloaded.get(`sites-publication-artifacts/${key}`);
    if (!object) fail("PROTECTED_OBJECT_MISSING");
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(object.path, "utf8"));
    } catch {
      fail("PROTECTED_ARTIFACT_INVALID");
    }
    if (artifact?.site_id !== siteId || !Array.isArray(artifact?.media)) {
      fail("PROTECTED_ARTIFACT_INVALID");
    }
    for (const media of artifact.media) {
      const mediaId = requireUuid(String(media?.id || ""), "PROTECTED_ARTIFACT_INVALID");
      validateObjectIdentity("sites-media-approved", String(media?.object_key || ""), siteId);
      mediaIds.add(mediaId);
    }
  }
  return mediaIds;
}

function isProtected(bucket, key, protectedArtifacts, mediaIds, siteId) {
  if (bucket === "sites-publication-artifacts") return protectedArtifacts.has(key);
  if (bucket === "sites-media-recovery") return true;
  if (bucket !== "sites-media-approved") return false;
  const mediaId = key.split("/")[2];
  return key.startsWith(`approved/${siteId}/`) && mediaIds.has(mediaId);
}

function immutableBundleName(siteId, generatedAt, manifestDigest) {
  const timestamp = generatedAt.replace(/[-:.]/g, "");
  return `mingla-sites-${siteId}-${timestamp}-${manifestDigest}.msbk`;
}

export async function runBackup({
  env = process.env,
  fetchImpl = fetch,
  spawn = spawnSync,
  now = new Date(),
} = {}) {
  for (const name of [
    "SITES_CMS_DATABASE_URL",
    "SITES_CMS_PROJECT_REF",
    "SUPABASE_MANAGEMENT_TOKEN",
    "SITES_PILOT_SITE_ID",
    "SITES_BACKUP_OUTPUT_DIR",
    "SITES_BACKUP_RESULT_PATH",
  ]) requiredEnv(env, name);
  const siteId = requireUuid(env.SITES_PILOT_SITE_ID);
  validateCmsDatabaseUrl(env);
  const storageConfig = storageConfigFromEnv(env);
  const coreConfig = coreConfigFromEnv(env);
  const encryptionKey = encryptionKeyFromEnv(env);
  verifyPostgres17(env, spawn);

  const outputDirectory = resolve(env.SITES_BACKUP_OUTPUT_DIR);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  if (!statSync(outputDirectory).isDirectory()) fail("INVALID_OUTPUT_DIRECTORY");
  const resultPath = resolve(env.SITES_BACKUP_RESULT_PATH);
  if (resolve(resultPath).startsWith(`${realpathSync(outputDirectory)}/`) === false) {
    fail("RESULT_PATH_OUTSIDE_OUTPUT");
  }
  const temporary = mkdtempSync(join(tmpdir(), "mingla-sites-backup-"));
  chmodSync(temporary, 0o700);
  try {
    const managementProject = await readManagementProject(env, fetchImpl, now);
    if (managementProject.region !== "us-east-2") fail("BACKUP_REGION_MISMATCH");
    const managementBackup = await readManagementBackup(
      env,
      fetchImpl,
      now,
      managementProject,
    );
    if (managementBackup.region !== managementProject.region) fail("BACKUP_REGION_MISMATCH");
    const protection = await readProtection(coreConfig, siteId, fetchImpl, now);
    const before = readDatabaseInventory(env, spawn);
    const { references, tenantId } = buildReferenceMap(before, siteId);

    const databasePath = join(temporary, "database.dump");
    runCommand(
      "pg_dump",
      [
        "--format=custom",
        "--schema=sites_cms",
        "--no-owner",
        "--no-privileges",
        "--file",
        databasePath,
      ],
      env,
      spawn,
    );
    if (!statSync(databasePath).isFile() || statSync(databasePath).size < 1) {
      fail("DATABASE_DUMP_MISSING");
    }
    chmodSync(databasePath, 0o600);

    const firstListings = new Map();
    for (const bucket of SITES_BUCKETS) {
      firstListings.set(bucket, await listBucket(storageConfig, bucket, fetchImpl));
    }
    const downloaded = new Map();
    let index = 0;
    for (const bucket of SITES_BUCKETS) {
      for (const listed of firstListings.get(bucket)) {
        validateObjectIdentity(bucket, listed.key, siteId, tenantId);
        const bytes = await getObject(storageConfig, bucket, listed.key, fetchImpl);
        if (bytes.byteLength !== listed.bytes) fail("OBJECT_SIZE_MISMATCH");
        const path = join(temporary, `object-${String(index).padStart(8, "0")}.bin`);
        writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
        downloaded.set(`${bucket}/${listed.key}`, {
          bucket,
          key: listed.key,
          path,
          bytes: bytes.byteLength,
          sha256: sha256Bytes(bytes),
        });
        index += 1;
      }
    }
    const secondListings = new Map();
    for (const bucket of SITES_BUCKETS) {
      secondListings.set(bucket, await listBucket(storageConfig, bucket, fetchImpl));
      if (stableJson(secondListings.get(bucket)) !== stableJson(firstListings.get(bucket))) {
        fail("OBJECT_INVENTORY_CHANGED_DURING_BACKUP");
      }
    }
    const after = readDatabaseInventory(env, spawn);
    if (stableJson(before) !== stableJson(after)) fail("DATABASE_CHANGED_DURING_BACKUP");
    assertReferenceIntegrity(references, downloaded);
    const protectedMedia = protectedMediaIds(protection, downloaded, siteId);
    const generatedAt = now.toISOString();
    const databaseBackupVerifiedAt = managementBackup.state === "pending_first_backup"
      ? generatedAt
      : managementBackup.inserted_at;
    const objects = [...downloaded.values()].sort((left, right) =>
      `${left.bucket}/${left.key}`.localeCompare(`${right.bucket}/${right.key}`))
      .map((object) => ({
        bucket: object.bucket,
        key: object.key,
        bytes: object.bytes,
        sha256: object.sha256,
        site_id: siteId,
        reference_state:
          references.get(`${object.bucket}/${object.key}`)?.state || "unreferenced",
        protected: isProtected(
          object.bucket,
          object.key,
          protection,
          protectedMedia,
          siteId,
        ),
        path: object.path,
      }));
    const manifest = {
      schema_version: 1,
      site_id: siteId,
      tenant_id: tenantId,
      generated_at: generatedAt,
      database: {
        format: "pg_dump-custom",
        bytes: statSync(databasePath).size,
        sha256: sha256Bytes(readFileSync(databasePath)),
      },
      backup: {
        database_backup_verified_at: databaseBackupVerifiedAt,
        management_observed_at: now.toISOString(),
        retention_days: managementBackup.retention_days,
      },
      counts: {
        tenants: before.counts.tenants,
        documents: before.counts.documents,
        objects: objects.length,
        object_bytes: objects.reduce((total, object) => total + object.bytes, 0),
      },
      objects: objects.map(({ path, ...object }) => object),
    };
    validateManifest(manifest, new Date(generatedAt));
    const manifestDigest = sha256Bytes(Buffer.from(stableJson(manifest)));
    const plaintextPath = join(temporary, "backup.plain");
    await writePlainBundle(plaintextPath, manifest, databasePath, objects);
    const bundleName = immutableBundleName(siteId, generatedAt, manifestDigest);
    const bundlePath = join(outputDirectory, bundleName);
    const encrypted = await encryptBundle(plaintextPath, bundlePath, encryptionKey);
    const result = {
      ok: true,
      code: "SITES_BACKUP_BUNDLE_READY",
      bundle_name: basename(bundlePath),
      bundle_path: bundlePath,
      bundle_sha256: encrypted.sha256,
      manifest_digest: manifestDigest,
      database_backup_verified_at: databaseBackupVerifiedAt,
      managed_backup_state: managementBackup.state,
      object_manifest_verified_at: generatedAt,
      object_count: manifest.counts.objects,
      object_bytes: manifest.counts.object_bytes,
    };
    writeSafeResult(resultPath, result);
    process.stdout.write(
      `SITES_BACKUP_OK objects=${result.object_count} bytes=${result.object_bytes}\n`,
    );
    return result;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function recordBackupEvidence({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  for (const name of [
    "SITES_BACKUP_RESULT_PATH",
    "SITES_BACKUP_BLOB_PATHNAME",
    "SITES_BACKUP_INDEPENDENT_READBACK_SHA256",
    "SITES_BACKUP_UPLOAD_VERIFIED_AT",
    "SITES_BACKUP_RESTORE_RESULT_PATH",
    "SITES_PILOT_SITE_ID",
  ]) requiredEnv(env, name);
  let result;
  try {
    result = JSON.parse(readFileSync(resolve(env.SITES_BACKUP_RESULT_PATH), "utf8"));
  } catch {
    fail("BACKUP_RESULT_INVALID");
  }
  const siteId = requireUuid(env.SITES_PILOT_SITE_ID);
  const expectedKeys = [
    "bundle_name", "bundle_path", "bundle_sha256", "code",
    "database_backup_verified_at", "managed_backup_state", "manifest_digest", "object_bytes",
    "object_count", "object_manifest_verified_at", "ok",
  ];
  if (
    !result || JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(expectedKeys.sort()) ||
    result.ok !== true || result.code !== "SITES_BACKUP_BUNDLE_READY" ||
    !/^[0-9a-f]{64}$/.test(result.bundle_sha256) ||
    !/^[0-9a-f]{64}$/.test(result.manifest_digest) ||
    !["current", "pending_first_backup", "retention_proven"].includes(
      result.managed_backup_state,
    ) ||
    !Number.isSafeInteger(result.object_count) || result.object_count < 0 ||
    !Number.isSafeInteger(result.object_bytes) || result.object_bytes < 0
  ) fail("BACKUP_RESULT_INVALID");
  if (
    env.SITES_BACKUP_INDEPENDENT_READBACK_SHA256 !== result.bundle_sha256 ||
    env.SITES_BACKUP_BLOB_PATHNAME !== `recovery/sites/${result.bundle_name}`
  ) fail("INDEPENDENT_BACKUP_READBACK_MISMATCH");
  const verified = Date.parse(env.SITES_BACKUP_UPLOAD_VERIFIED_AT);
  if (
    !Number.isFinite(verified) || verified > now.getTime() + 5 * 60 * 1000 ||
    now.getTime() - verified > 60 * 60 * 1000
  ) fail("INDEPENDENT_BACKUP_READBACK_STALE");
  let restore;
  try {
    restore = JSON.parse(
      readFileSync(resolve(env.SITES_BACKUP_RESTORE_RESULT_PATH), "utf8"),
    );
  } catch {
    fail("RESTORE_RESULT_INVALID");
  }
  const restoreKeys = [
    "code", "document_count", "object_bytes", "object_count", "ok",
    "restore_drill_evidence_digest", "restore_drill_verified_at", "tenant_count",
  ];
  const restoredAt = Date.parse(restore?.restore_drill_verified_at);
  if (
    !restore || JSON.stringify(Object.keys(restore).sort()) !==
      JSON.stringify(restoreKeys.sort()) ||
    restore.ok !== true || restore.code !== "SITES_RESTORE_DRILL_COMPLETE" ||
    restore.object_count !== result.object_count ||
    restore.object_bytes !== result.object_bytes ||
    !Number.isSafeInteger(restore.tenant_count) || restore.tenant_count < 1 ||
    !Number.isSafeInteger(restore.document_count) || restore.document_count < 1 ||
    !/^[0-9a-f]{64}$/.test(restore.restore_drill_evidence_digest) ||
    !Number.isFinite(restoredAt) || restoredAt > now.getTime() + 5 * 60 * 1000 ||
    now.getTime() - restoredAt > 60 * 60 * 1000
  ) fail("RESTORE_RESULT_INVALID");
  const coreConfig = coreConfigFromEnv(env);
  const readinessPath = `/internal/v1/sites/${siteId}/readiness-evidence`;
  const readiness = await callCore(coreConfig, {
    siteId,
    method: "POST",
    path: readinessPath,
    payload: {
      schema_version: 1,
      evidence_kind: "nightly_backup",
      observed_at: now.toISOString(),
      backup_retention_days: 7,
      database_backup_verified_at: result.database_backup_verified_at,
      object_manifest_verified_at: result.object_manifest_verified_at,
      manifest_digest: result.manifest_digest,
      backup_bundle_digest: result.bundle_sha256,
      object_count: result.object_count,
      object_bytes: result.object_bytes,
    },
    fetchImpl,
    now,
  });
  validateReadinessResponse(readiness, siteId, "nightly_backup");
  if (
    readiness.readiness.backup_retention_days !== 7 ||
    readiness.readiness.database_backup_verified_at !== result.database_backup_verified_at ||
    readiness.readiness.object_manifest_verified_at !== result.object_manifest_verified_at
  ) fail("CORE_READINESS_READBACK_MISMATCH");
  process.stdout.write("SITES_BACKUP_EVIDENCE_OK\n");
  return readiness;
}

async function runBackupCli() {
  try {
    return await runBackup();
  } catch (error) {
    if (error && DEACTIVATING_BACKUP_CODES.has(error.code)) {
      try {
        await deactivatePilotForBackupFailure({ error });
      } catch {
        fail("PILOT_DEACTIVATION_FAILED");
      }
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] || "create";
  (action === "create"
    ? runBackupCli()
    : action === "record-evidence"
      ? recordBackupEvidence()
      : action === "deactivate"
        ? deactivatePilotForRecoveryFailure()
      : Promise.reject(new Error("unsupported")))
    .catch(safeCliFailure);
}
