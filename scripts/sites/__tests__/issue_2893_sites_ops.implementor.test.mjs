import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { bootstrapSitesCms } from "../bootstrap-sites-cms.mjs";
import { applySitesCmsMigrations } from "../apply-sites-cms-migrations.mjs";
import {
  assertReferenceIntegrity,
  buildReferenceMap,
  deactivatePilotForBackupFailure,
  recordBackupEvidence,
} from "../backup-sites-cms.mjs";
import {
  EPHEMERAL_RESTORE_DATABASE_URL,
  runRestore,
} from "../restore-sites-cms.mjs";
import {
  retentionEnvelope,
  runSitesRetention,
} from "../run-sites-retention.mjs";
import {
  BUNDLE_MAGIC,
  BUCKET_PREFIXES,
  decryptBundle,
  encryptBundle,
  encryptionKeyFromEnv,
  extractPlainBundle,
  parseS3List,
  sha256Bytes,
  signCoreRequest,
  SITES_BUCKETS,
  stableJson,
  storageConfigFromEnv,
  validateManagementBackupResponse,
  validateManagementProjectResponse,
  validateCmsDatabaseUrl,
  validateManifest,
  validateObjectIdentity,
  writePlainBundle,
} from "../lib/sites-ops.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SITES_DIR = resolve(TEST_DIR, "..");
const REPO_ROOT = resolve(SITES_DIR, "..", "..");
const TENANT_ID = "123e4567-e89b-42d3-a456-426614173999";
const SITE_ID = "123e4567-e89b-42d3-a456-426614174000";
const MEDIA_ID = "123e4567-e89b-42d3-a456-426614174001";
const PUBLICATION_ID = "123e4567-e89b-42d3-a456-426614174002";
const DIGEST = "a".repeat(64);
const NOW = new Date("2026-09-01T08:00:00.000Z");

function postgresFixtureUrl({
  user,
  credential,
  host,
  port = "5432",
  database = "postgres",
  sslmode,
}) {
  const authority = ["postgresql", "://", user, ":", credential, "@", host, ":", port].join("");
  return `${authority}/${database}${sslmode ? `?sslmode=${sslmode}` : ""}`;
}

function completedBackup(day) {
  return {
    id: day + 1,
    is_physical_backup: true,
    status: "COMPLETED",
    inserted_at: new Date(NOW.getTime() - day * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function backupResponse(backups = Array.from({ length: 7 }, (_, day) => completedBackup(day))) {
  return {
    region: "us-east-2",
    walg_enabled: true,
    pitr_enabled: false,
    backups,
    physical_backup_data: null,
  };
}

function projectResponse(ageHours) {
  return {
    ref: "a".repeat(20),
    organization_slug: "mrcqqkovdchaltvquggd",
    name: "mingla-sites-cms-prod",
    region: "us-east-2",
    created_at: new Date(NOW.getTime() - ageHours * 60 * 60 * 1000).toISOString(),
    status: "ACTIVE_HEALTHY",
    database: {
      host: `db.${"a".repeat(20)}.supabase.co`,
      version: "17.6.1.010",
      postgres_engine: "17",
      release_channel: "ga",
    },
  };
}

function baseManifest(overrides = {}) {
  const key = `approved/${SITE_ID}/${MEDIA_ID}/${DIGEST}/640.webp`;
  return {
    schema_version: 1,
    site_id: SITE_ID,
    tenant_id: TENANT_ID,
    generated_at: NOW.toISOString(),
    database: { format: "pg_dump-custom", bytes: 4, sha256: sha256Bytes(Buffer.from("dump")) },
    backup: {
      database_backup_verified_at: NOW.toISOString(),
      management_observed_at: NOW.toISOString(),
      retention_days: 7,
    },
    counts: { tenants: 1, documents: 6, objects: 1, object_bytes: 5 },
    objects: [{
      bucket: "sites-media-approved",
      key,
      bytes: 5,
      sha256: sha256Bytes(Buffer.from("image")),
      site_id: SITE_ID,
      reference_state: "media:READY",
      protected: true,
    }],
    ...overrides,
  };
}

test("#2893 project age gates first-backup grace, freshness, and seven-day retention", () => {
  const project = validateManagementProjectResponse(
    projectResponse(8 * 24),
    "a".repeat(20),
    NOW,
  );
  assert.equal(project.region, "us-east-2");
  assert.throws(
    () => validateManagementProjectResponse(
      { ...projectResponse(1), undocumented: true },
      "a".repeat(20),
      NOW,
    ),
    /PROJECT_RESPONSE_SCHEMA_INVALID/,
  );
  for (const mutation of [
    { organization_slug: "other-org" },
    { name: "Mingla-production" },
    { region: "us-east-1" },
    { status: "COMING_UP" },
    { database: { ...projectResponse(1).database, postgres_engine: "16" } },
    { database: { ...projectResponse(1).database, version: "16.9.1" } },
    { database: { ...projectResponse(1).database, host: "db.other.supabase.co" } },
  ]) {
    assert.throws(() => validateManagementProjectResponse(
      { ...projectResponse(1), ...mutation },
      "a".repeat(20),
      NOW,
    ), /PROJECT_RESPONSE_SCHEMA_INVALID/);
  }

  const current = validateManagementBackupResponse(backupResponse(), {
    now: NOW,
    projectCreatedAt: project.created_at,
  });
  assert.equal(current.inserted_at, NOW.toISOString());
  assert.equal(current.retention_days, 7);
  assert.equal(current.region, "us-east-2");
  assert.equal(current.state, "retention_proven");

  const grace = validateManagementBackupResponse(backupResponse([]), {
    now: NOW,
    projectCreatedAt: projectResponse(25).created_at,
  });
  assert.equal(grace.state, "pending_first_backup");
  assert.equal(grace.inserted_at, null);

  assert.throws(
    () => validateManagementBackupResponse(backupResponse([]), {
      now: NOW,
      projectCreatedAt: projectResponse(26).created_at,
    }),
    /DATABASE_BACKUP_MISSING/,
  );
  assert.throws(
    () => validateManagementBackupResponse(
      backupResponse([completedBackup(2), ...Array.from({ length: 6 }, (_, day) => completedBackup(day + 3))]),
      { now: NOW, projectCreatedAt: project.created_at },
    ),
    /DATABASE_BACKUP_STALE/,
  );
  assert.throws(
    () => validateManagementBackupResponse(backupResponse(
      Array.from({ length: 6 }, (_, day) => completedBackup(day)),
    ), { now: NOW, projectCreatedAt: project.created_at }),
    /DATABASE_BACKUP_RETENTION_UNPROVEN/,
  );
  assert.throws(
    () => validateManagementBackupResponse(
      { ...backupResponse(), undocumented: true },
      { now: NOW, projectCreatedAt: project.created_at },
    ),
    /BACKUP_RESPONSE_SCHEMA_INVALID/,
  );
  assert.throws(
    () => validateManagementBackupResponse(
      { ...backupResponse(), walg_enabled: false },
      { now: NOW, projectCreatedAt: project.created_at },
    ),
    /DATABASE_BACKUP_WALG_DISABLED/,
  );
  assert.throws(
    () => validateManagementBackupResponse(
      backupResponse([{ ...completedBackup(0), status: "FAILED" }, completedBackup(1)]),
      { now: NOW, projectCreatedAt: project.created_at },
    ),
    /DATABASE_BACKUP_CURRENT_FAILED/,
  );
  assert.throws(
    () => validateManagementBackupResponse(
      { ...backupResponse(), pitr_enabled: true },
      { now: NOW, projectCreatedAt: project.created_at },
    ),
    /BACKUP_RESPONSE_SCHEMA_INVALID/,
  );

  const threeDayProject = validateManagementBackupResponse(
    backupResponse([completedBackup(0)]),
    { now: NOW, projectCreatedAt: projectResponse(3 * 24).created_at },
  );
  assert.equal(threeDayProject.state, "current");
});

test("#2893 backup database target is the exact approved Sites project", () => {
  const ref = "a".repeat(20);
  const password = "z".repeat(40);
  const valid = {
    SITES_CMS_PROJECT_REF: ref,
    SITES_CMS_DATABASE_URL: postgresFixtureUrl({
      user: "sites_cms_migrator", credential: password, host: `db.${ref}.supabase.co`, sslmode: "require",
    }),
  };
  assert.equal(validateCmsDatabaseUrl(valid), valid.SITES_CMS_DATABASE_URL);
  const sessionPooler = postgresFixtureUrl({
    user: `sites_cms_migrator.${ref}`,
    credential: password,
    host: "aws-0-us-east-2.pooler.supabase.com",
    port: "5432",
    sslmode: "require",
  });
  assert.equal(validateCmsDatabaseUrl({
    ...valid,
    SITES_CMS_DATABASE_URL: sessionPooler,
  }), sessionPooler);
  for (const databaseUrl of [
    postgresFixtureUrl({ user: "sites_cms_migrator", credential: password, host: `db.${"b".repeat(20)}.supabase.co`, sslmode: "require" }),
    postgresFixtureUrl({ user: "sites_cms_migrator", credential: password, host: "aws-0-us-east-2.pooler.supabase.com", port: "6543", sslmode: "require" }),
    postgresFixtureUrl({ user: "postgres", credential: password, host: `db.${ref}.supabase.co`, sslmode: "require" }),
    postgresFixtureUrl({ user: "sites_cms_migrator", credential: password, host: `db.${ref}.supabase.co`, database: "other", sslmode: "require" }),
    postgresFixtureUrl({ user: "sites_cms_migrator", credential: password, host: `db.${ref}.supabase.co` }),
  ]) {
    assert.throws(() => validateCmsDatabaseUrl({
      ...valid,
      SITES_CMS_DATABASE_URL: databaseUrl,
    }), /INVALID_CMS_DATABASE_URL/);
  }
});

test("#2893 storage accepts digit-bearing Supabase refs and rejects malformed refs", () => {
  const ref = "abc123def456ghi789jk";
  const valid = {
    SITES_CMS_PROJECT_REF: ref,
    SUPABASE_S3_ENDPOINT:
      `https://${ref}.storage.supabase.co/storage/v1/s3`,
    SUPABASE_S3_REGION: "us-east-2",
    SUPABASE_S3_ACCESS_KEY_ID: "fixture-access",
    SUPABASE_S3_SECRET_ACCESS_KEY: "fixture-secret",
  };
  assert.equal(storageConfigFromEnv(valid).endpoint, valid.SUPABASE_S3_ENDPOINT);
  for (const projectRef of ["ABC123def456ghi789jk", "abc123", `${ref}x`]) {
    assert.throws(() => storageConfigFromEnv({
      ...valid,
      SITES_CMS_PROJECT_REF: projectRef,
    }), /INVALID_PROJECT_REF|S3_PROJECT_MISMATCH/);
  }
});

test("#2893 manifest rejects count drift, duplicate objects, and stale provider evidence", () => {
  assert.equal(validateManifest(baseManifest(), NOW).site_id, SITE_ID);
  assert.throws(
    () => validateManifest(baseManifest({
      counts: { tenants: 1, documents: 6, objects: 1, object_bytes: 4 },
    }), NOW),
    /MANIFEST_MISMATCH/,
  );
  const object = baseManifest().objects[0];
  assert.throws(
    () => validateManifest(baseManifest({
      counts: { tenants: 1, documents: 6, objects: 2, object_bytes: 10 },
      objects: [object, object],
    }), NOW),
    /MANIFEST_MISMATCH/,
  );
  assert.throws(
    () => validateManifest(baseManifest({
      backup: {
        database_backup_verified_at: new Date(NOW.getTime() - 27 * 60 * 60 * 1000).toISOString(),
        management_observed_at: NOW.toISOString(),
        retention_days: 7,
      },
    }), NOW),
    /DATABASE_BACKUP_STALE/,
  );
});

test("#2893 backup compares approved media and publication bytes to DB-authoritative digests", () => {
  const approvedKey = `approved/${SITE_ID}/${MEDIA_ID}/${DIGEST}/master.webp`;
  const recoveryKey = `recovery/${TENANT_ID}/${SITE_ID}/${MEDIA_ID}/${DIGEST}/master.webp`;
  const renditionDigest = "d".repeat(64);
  const artifactDigest = "b".repeat(64);
  const artifactKey =
    `publications/${SITE_ID}/${PUBLICATION_ID}/${artifactDigest}.json`;
  const { references } = buildReferenceMap({
    tenants: [{ tenant_id: TENANT_ID, site_id: SITE_ID }],
    media: [{
      tenant_id: TENANT_ID,
      media_id: MEDIA_ID,
      state: "TOMBSTONED",
      quarantine_key: null,
      approved_master_key: approvedKey,
      rendition_manifest: {
        version: 1,
        master: { key: approvedKey, digest: renditionDigest, bytes: 5 },
        renditions: [],
      },
    }],
    publications: [{
      tenant_id: TENANT_ID,
      status: "published",
      artifact_key: artifactKey,
      artifact_digest: artifactDigest,
    }],
    counts: { tenants: 1, documents: 2 },
  }, SITE_ID);
  const valid = new Map([
    [`sites-media-approved/${approvedKey}`, {
      bytes: 5,
      sha256: renditionDigest,
    }],
    [`sites-media-recovery/${recoveryKey}`, {
      bytes: 5,
      sha256: renditionDigest,
    }],
    [`sites-publication-artifacts/${artifactKey}`, {
      bytes: 9,
      sha256: artifactDigest,
    }],
  ]);
  assert.doesNotThrow(() => assertReferenceIntegrity(references, valid));

  const corruptMedia = new Map(valid);
  corruptMedia.set(`sites-media-approved/${approvedKey}`, {
    bytes: 5,
    sha256: "c".repeat(64),
  });
  assert.throws(
    () => assertReferenceIntegrity(references, corruptMedia),
    /REFERENCED_OBJECT_DIGEST_MISMATCH/,
  );
  const truncatedMedia = new Map(valid);
  truncatedMedia.set(`sites-media-approved/${approvedKey}`, {
    bytes: 4,
    sha256: renditionDigest,
  });
  assert.throws(
    () => assertReferenceIntegrity(references, truncatedMedia),
    /REFERENCED_OBJECT_SIZE_MISMATCH/,
  );
  const missingRecovery = new Map(valid);
  missingRecovery.delete(`sites-media-recovery/${recoveryKey}`);
  assert.throws(
    () => assertReferenceIntegrity(references, missingRecovery),
    /REFERENCED_OBJECT_MISSING/,
  );
  const corruptRecovery = new Map(valid);
  corruptRecovery.set(`sites-media-recovery/${recoveryKey}`, {
    bytes: 5,
    sha256: "e".repeat(64),
  });
  assert.throws(
    () => assertReferenceIntegrity(references, corruptRecovery),
    /REFERENCED_OBJECT_DIGEST_MISMATCH/,
  );
});

test("#2893 every bucket is exact and wrong bucket, site, or prefix fails closed", () => {
  assert.deepEqual(SITES_BUCKETS, [
    "sites-media-quarantine",
    "sites-media-approved",
    "sites-publication-artifacts",
    "sites-media-recovery",
  ]);
  for (const bucket of SITES_BUCKETS) {
    const key = bucket === "sites-media-recovery"
      ? `recovery/${TENANT_ID}/${SITE_ID}/${MEDIA_ID}/${DIGEST}/640.webp`
      : `${BUCKET_PREFIXES[bucket]}/${SITE_ID}/object`;
    validateObjectIdentity(bucket, key, SITE_ID, TENANT_ID);
  }
  assert.throws(
    () => validateObjectIdentity(
      "sites-media-recovery",
      `recovery/223e4567-e89b-42d3-a456-426614174000/${SITE_ID}/${MEDIA_ID}/${DIGEST}/640.webp`,
      SITE_ID,
      TENANT_ID,
    ),
    /OBJECT_TENANT_SITE_PREFIX_MISMATCH/,
  );
  assert.throws(
    () => validateObjectIdentity(
      "sites-media-recovery",
      `recovery/${TENANT_ID}/223e4567-e89b-42d3-a456-426614174000/${MEDIA_ID}/${DIGEST}/640.webp`,
      SITE_ID,
      TENANT_ID,
    ),
    /OBJECT_TENANT_SITE_PREFIX_MISMATCH/,
  );
  assert.throws(
    () => validateObjectIdentity("public", `approved/${SITE_ID}/object`, SITE_ID),
    /UNEXPECTED_BUCKET/,
  );
  assert.throws(
    () => validateObjectIdentity(
      "sites-media-approved",
      `approved/223e4567-e89b-42d3-a456-426614174000/object`,
      SITE_ID,
    ),
    /OBJECT_SITE_PREFIX_MISMATCH/,
  );
  assert.throws(
    () => validateObjectIdentity(
      "sites-media-approved",
      `publications/${SITE_ID}/${PUBLICATION_ID}/${DIGEST}.json`,
      SITE_ID,
    ),
    /OBJECT_SITE_PREFIX_MISMATCH/,
  );
});

test("#2893 backup archive is AES-256-GCM, rejects plaintext, and cannot overwrite", async () => {
  const root = mkdtempSync(join(tmpdir(), "issue-2893-encryption-"));
  try {
    const database = join(root, "database.dump");
    const object = join(root, "object.bin");
    const plain = join(root, "plain.bundle");
    const encrypted = join(root, "backup.msbk");
    const decrypted = join(root, "decrypted.bundle");
    writeFileSync(database, "dump");
    writeFileSync(object, "image");
    const manifest = baseManifest();
    await writePlainBundle(plain, manifest, database, [{ path: object }]);
    const key = encryptionKeyFromEnv({
      SITES_BACKUP_ENCRYPTION_KEY_B64: Buffer.alloc(32, 7).toString("base64"),
    });
    await encryptBundle(plain, encrypted, key);
    const ciphertext = readFileSync(encrypted);
    assert.equal(ciphertext.subarray(0, BUNDLE_MAGIC.byteLength).equals(BUNDLE_MAGIC), true);
    assert.equal(ciphertext.includes(Buffer.from("image")), false);
    assert.equal(ciphertext.includes(Buffer.from(stableJson(manifest))), false);
    await decryptBundle(encrypted, decrypted, key);
    assert.deepEqual(readFileSync(decrypted), readFileSync(plain));
    await assert.rejects(() => decryptBundle(plain, join(root, "must-not-exist"), key),
      /BACKUP_ARCHIVE_PLAINTEXT_OR_INVALID/);
    await assert.rejects(() => encryptBundle(plain, encrypted, key), /EEXIST/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#2893 extraction verifies the dump and every object digest", async () => {
  const root = mkdtempSync(join(tmpdir(), "issue-2893-extract-"));
  try {
    const database = join(root, "database.dump");
    const object = join(root, "object.bin");
    const plain = join(root, "plain.bundle");
    writeFileSync(database, "dump");
    writeFileSync(object, "image");
    await writePlainBundle(plain, baseManifest(), database, [{ path: object }]);
    const extracted = extractPlainBundle(plain, join(root, "restore"), NOW);
    assert.equal(extracted.manifest.counts.tenants, 1);
    assert.equal(extracted.objects.length, 1);
    assert.equal(readFileSync(extracted.objects[0].path, "utf8"), "image");

    const corrupt = join(root, "corrupt.bundle");
    const bytes = readFileSync(plain);
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(corrupt, bytes);
    assert.throws(
      () => extractPlainBundle(corrupt, join(root, "corrupt-restore"), NOW),
      /OBJECT_DIGEST_MISMATCH/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#2893 restore drill proves counts and digests before signed Core evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "issue-2893-restore-flow-"));
  try {
    const database = join(root, "database.dump");
    const object = join(root, "object.bin");
    const plain = join(root, "plain.bundle");
    const encrypted = join(root, "backup.msbk");
    const resultPath = join(root, "result.json");
    writeFileSync(database, "dump");
    writeFileSync(object, "image");
    await writePlainBundle(plain, baseManifest(), database, [{ path: object }]);
    const keyB64 = Buffer.alloc(32, 8).toString("base64");
    await encryptBundle(
      plain,
      encrypted,
      encryptionKeyFromEnv({ SITES_BACKUP_ENCRYPTION_KEY_B64: keyB64 }),
    );
    const commands = [];
    const spawn = (command, args, options) => {
      commands.push({ command, args, env: options.env });
      if (args.includes("--version")) {
        return { status: 0, stdout: `${command} (PostgreSQL) 17.10\n`, stderr: "" };
      }
      if (command === "pg_restore") return { status: 0, stdout: "", stderr: "" };
      const sql = args.at(-1);
      if (String(sql).includes("pg_namespace")) return { status: 0, stdout: "0\n", stderr: "" };
      return {
        status: 0,
        stdout: `${JSON.stringify({ tenants: 1, documents: 6, site_ids: [SITE_ID] })}\n`,
        stderr: "",
      };
    };
    let evidenceBody;
    const fetchImpl = async (_url, init) => {
      evidenceBody = JSON.parse(init.body);
      return Response.json({
        ok: true,
        data: {
          site_id: SITE_ID,
          evidence_kind: "restore_drill",
          accepted_at: NOW.toISOString(),
          readiness: {
            backup_retention_days: 7,
            database_backup_verified_at: NOW.toISOString(),
            object_manifest_verified_at: NOW.toISOString(),
            restore_drill_verified_at: NOW.toISOString(),
            restore_drill_evidence_digest: evidenceBody.restore_drill_evidence_digest,
          },
        },
      });
    };
    const result = await runRestore({
      env: {
        SITES_BACKUP_BUNDLE_PATH: encrypted,
        SITES_BACKUP_RESTORE_RESULT_PATH: resultPath,
        SITES_RESTORE_DATABASE_URL: EPHEMERAL_RESTORE_DATABASE_URL,
        SITES_PILOT_SITE_ID: SITE_ID,
        SITES_BACKUP_ENCRYPTION_KEY_B64: keyB64,
        SITES_CORE_BASE_URL: "https://core.example.test",
        MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-key-v1",
        MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: Buffer.alloc(32, 9).toString("base64"),
      },
      fetchImpl,
      spawn,
      now: NOW,
    });
    assert.equal(result.tenant_count, 1);
    assert.equal(result.document_count, 6);
    assert.equal(result.object_count, 1);
    assert.equal(evidenceBody.evidence_kind, "restore_drill");
    assert.equal(evidenceBody.object_bytes, 5);
    assert.equal(commands.some(({ command }) => command === "pg_restore"), true);
    assert.equal(commands.every(({ args }) => !args.join(" ").includes("sites-restore-ephemeral-only")), true);
    assert.equal(commands.some(({ env }) =>
      env.PGPASSWORD === "sites-restore-ephemeral-only"), true);
    assert.equal(JSON.parse(readFileSync(resultPath, "utf8")).ok, true);

    let spawnedRemote = false;
    await assert.rejects(() => runRestore({
      env: {
        SITES_BACKUP_BUNDLE_PATH: encrypted,
        SITES_BACKUP_RESTORE_RESULT_PATH: resultPath,
        SITES_RESTORE_DATABASE_URL: postgresFixtureUrl({
          user: "postgres",
          credential: "sites-restore-ephemeral-only",
          host: "db.example.invalid",
          sslmode: "require",
        }),
        SITES_PILOT_SITE_ID: SITE_ID,
      },
      spawn() {
        spawnedRemote = true;
        return { status: 0, stdout: "", stderr: "" };
      },
    }), /INVALID_RESTORE_TARGET/);
    assert.equal(spawnedRemote, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#2893 S3 list parser requires stable object metadata", () => {
  const body = `<?xml version="1.0"?><ListBucketResult>
    <IsTruncated>false</IsTruncated>
    <Contents><Key>approved/${SITE_ID}/${MEDIA_ID}/${DIGEST}/640.webp</Key>
    <LastModified>${NOW.toISOString()}</LastModified><ETag>&quot;etag&quot;</ETag><Size>5</Size></Contents>
  </ListBucketResult>`;
  assert.deepEqual(parseS3List(body), {
    objects: [{
      key: `approved/${SITE_ID}/${MEDIA_ID}/${DIGEST}/640.webp`,
      bytes: 5,
      etag: "etag",
      last_modified: NOW.toISOString(),
    }],
    next: null,
  });
  assert.throws(
    () => parseS3List(body.replace("<IsTruncated>false", "<IsTruncated>true")),
    /S3_LIST_SCHEMA_INVALID/,
  );
});

test("#2893 Core evidence uses only the CMS-to-Core projection and exact path/body digest", () => {
  const body = stableJson({ schema_version: 1, evidence_kind: "nightly_backup" });
  const path = `/internal/v1/sites/${SITE_ID}/readiness-evidence`;
  const envelope = signCoreRequest(
    { kid: "cms-key-v1", key: Buffer.alloc(32, 9) },
    {
      siteId: SITE_ID,
      operationId: PUBLICATION_ID,
      nonce: MEDIA_ID,
      method: "POST",
      path,
      body,
      now: NOW,
    },
  );
  assert.equal(envelope.direction, "cms_to_core");
  assert.equal(envelope.issuer, "mingla-site-cms");
  assert.equal(envelope.audience, "mingla-core");
  assert.equal(envelope.path, path);
  assert.equal(envelope.body_sha256, sha256Bytes(Buffer.from(body)));
  assert.equal(Object.keys(envelope).includes("key"), false);
});

test("#2893 nightly retention is exact-site Core-to-CMS signed and validates readback", async () => {
  const env = {
    SITES_PILOT_SITE_ID: SITE_ID,
    SITES_CMS_ORIGIN: "https://studio.sites.usemingla.com",
    MINGLA_CORE_TO_CMS_CURRENT_KID: "core-key-v1",
    MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: Buffer.alloc(32, 4).toString("base64"),
  };
  const operationId = PUBLICATION_ID;
  const nonce = MEDIA_ID;
  const signed = retentionEnvelope(env, { now: NOW, operationId, nonce });
  assert.equal(signed.body, "{}");
  assert.equal(signed.envelope.issuer, "mingla-core");
  assert.equal(signed.envelope.audience, "mingla-site-cms");
  assert.equal(signed.envelope.direction, "core_to_cms");
  assert.equal(signed.envelope.site_id, SITE_ID);
  assert.equal(signed.envelope.path, "/api/internal/retention-sweep");

  let observed;
  const result = await runSitesRetention({
    env,
    now: NOW,
    operationId,
    nonce,
    fetchImpl: async (url, init) => {
      observed = { url: String(url), init };
      return Response.json({
        ok: true,
        data: {
          protected_artifacts: 1,
          protected_media: 1,
          purged_artifacts: 2,
          purged_media: 3,
        },
      });
    },
  });
  assert.equal(result.purged_media, 3);
  assert.equal(observed.url,
    "https://studio.sites.usemingla.com/api/internal/retention-sweep");
  const envelope = JSON.parse(Buffer.from(
    observed.init.headers["x-mingla-sites-envelope"],
    "base64",
  ).toString("utf8"));
  assert.equal(envelope.operation_id, operationId);
  assert.equal(envelope.nonce, nonce);
  assert.throws(
    () => retentionEnvelope({ ...env, SITES_CMS_ORIGIN: "https://evil.invalid" }),
    /CMS_ORIGIN_MISMATCH/,
  );
});

test("#2893 Core backup readiness is recorded only after exact private readback", async () => {
  const root = mkdtempSync(join(tmpdir(), "issue-2893-readback-"));
  try {
    const resultPath = join(root, "result.json");
    const restoreResultPath = join(root, "restore-result.json");
    const result = {
      ok: true,
      code: "SITES_BACKUP_BUNDLE_READY",
      bundle_name: "immutable.msbk",
      bundle_path: join(root, "immutable.msbk"),
      bundle_sha256: "b".repeat(64),
      manifest_digest: "c".repeat(64),
      database_backup_verified_at: NOW.toISOString(),
      managed_backup_state: "pending_first_backup",
      object_manifest_verified_at: NOW.toISOString(),
      object_count: 1,
      object_bytes: 5,
    };
    writeFileSync(resultPath, stableJson(result));
    writeFileSync(restoreResultPath, stableJson({
      ok: true,
      code: "SITES_RESTORE_DRILL_COMPLETE",
      restore_drill_verified_at: NOW.toISOString(),
      restore_drill_evidence_digest: "e".repeat(64),
      tenant_count: 1,
      document_count: 6,
      object_count: 1,
      object_bytes: 5,
    }));
    const env = {
      SITES_BACKUP_RESULT_PATH: resultPath,
      SITES_BACKUP_BLOB_PATHNAME: "recovery/sites/immutable.msbk",
      SITES_BACKUP_INDEPENDENT_READBACK_SHA256: result.bundle_sha256,
      SITES_BACKUP_UPLOAD_VERIFIED_AT: NOW.toISOString(),
      SITES_BACKUP_RESTORE_RESULT_PATH: restoreResultPath,
      SITES_PILOT_SITE_ID: SITE_ID,
      GITHUB_REPOSITORY: "Mingla-LLC/mingla-main",
      GITHUB_RUN_ID: "2893001",
      SITES_CORE_BASE_URL: "https://core.example.test",
      MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-key-v1",
      MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: Buffer.alloc(32, 9).toString("base64"),
    };
    let posted;
    const fetchImpl = async (url, init) => {
      posted = { url: String(url), init };
      return Response.json({
        ok: true,
        data: {
          site_id: SITE_ID,
          evidence_kind: "nightly_backup",
          accepted_at: NOW.toISOString(),
          readiness: {
            backup_retention_days: 7,
            database_backup_verified_at: NOW.toISOString(),
            object_manifest_verified_at: NOW.toISOString(),
            restore_drill_verified_at: null,
            restore_drill_evidence_digest: null,
          },
        },
      });
    };
    await recordBackupEvidence({ env, fetchImpl, now: NOW });
    assert.match(posted.url, new RegExp(`/sites/${SITE_ID}/readiness-evidence$`));
    assert.equal(JSON.parse(posted.init.body).backup_bundle_digest, result.bundle_sha256);

    let reachedCore = false;
    await assert.rejects(
      () => recordBackupEvidence({
        env: { ...env, SITES_BACKUP_INDEPENDENT_READBACK_SHA256: "d".repeat(64) },
        fetchImpl: async () => {
          reachedCore = true;
          return Response.json({ ok: true });
        },
        now: NOW,
      }),
      /INDEPENDENT_BACKUP_READBACK_MISMATCH/,
    );
    assert.equal(reachedCore, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#2893 managed-backup failure invokes only the signed pilot deactivation contract", async () => {
  let posted;
  const operationIds = [];
  const deactivationEnv = {
    SITES_PILOT_SITE_ID: SITE_ID,
    GITHUB_REPOSITORY: "Mingla-LLC/mingla-main",
    GITHUB_RUN_ID: "2893001",
    SITES_CORE_BASE_URL: "https://core.example.test",
    MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-key-v1",
    MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: Buffer.alloc(32, 9).toString("base64"),
  };
  const deactivated = await deactivatePilotForBackupFailure({
    env: deactivationEnv,
    error: { code: "DATABASE_BACKUP_STALE" },
    now: NOW,
    fetchImpl: async (url, init) => {
      posted = { url: String(url), body: JSON.parse(init.body) };
      operationIds.push(JSON.parse(Buffer.from(
        init.headers["x-mingla-sites-envelope"],
        "base64",
      ).toString("utf8")).operation_id);
      return Response.json({
        ok: true,
        data: {
          site_id: SITE_ID,
          hostname: "gogi.sites.usemingla.com",
          status: "disabled",
          deactivated_at: NOW.toISOString(),
          last_good_preserved: true,
        },
      });
    },
  });
  assert.equal(deactivated, true);
  assert.match(posted.url, new RegExp(`/sites/${SITE_ID}/pilot-deactivation$`));
  assert.deepEqual(posted.body, {
    schema_version: 1,
    hostname: "gogi.sites.usemingla.com",
    reason_code: "BACKUP_READINESS_FAILED",
  });
  await deactivatePilotForBackupFailure({
    env: deactivationEnv,
    error: { code: "DATABASE_BACKUP_STALE" },
    now: NOW,
    fetchImpl: async (_url, init) => {
      operationIds.push(JSON.parse(Buffer.from(
        init.headers["x-mingla-sites-envelope"],
        "base64",
      ).toString("utf8")).operation_id);
      return Response.json({
        ok: true,
        data: {
          site_id: SITE_ID,
          hostname: "gogi.sites.usemingla.com",
          status: "disabled",
          deactivated_at: NOW.toISOString(),
          last_good_preserved: true,
        },
      });
    },
  });
  assert.equal(operationIds.length, 2);
  assert.equal(operationIds[0], operationIds[1]);
  assert.equal(await deactivatePilotForBackupFailure({
    error: { code: "DATABASE_BACKUP_API_FAILED" },
  }), false);
});

test("#2893 CMS rollout is bootstrap, isolated-role Payload migration, reconciliation", () => {
  const secret = "m".repeat(40);
  const env = {
    SITES_CMS_PROJECT_REF: "a".repeat(20),
    SUPABASE_S3_ENDPOINT:
      `https://${"a".repeat(20)}.storage.supabase.co/storage/v1/s3`,
    SITES_CMS_MIGRATOR_DATABASE_URL: postgresFixtureUrl({
      user: "sites_cms_migrator", credential: secret, host: `db.${"a".repeat(20)}.supabase.co`, sslmode: "require",
    }),
    SITES_CMS_MIGRATOR_PASSWORD: secret,
    SITES_CMS_ADMIN_DATABASE_URL: postgresFixtureUrl({
      user: "postgres", credential: "z".repeat(40), host: `db.${"a".repeat(20)}.supabase.co`, sslmode: "require",
    }),
    SITES_CMS_APP_PASSWORD: "a".repeat(40),
    SITES_RUNTIME_READER_SUBJECT: MEDIA_ID,
    SITES_PILOT_SITE_ID: SITE_ID,
    PAYLOAD_SECRET: "payload-secret",
  };
  const order = [];
  let invocation;
  applySitesCmsMigrations({
    env,
    bootstrap({ env: received }) {
      assert.equal(received, env);
      order.push("bootstrap");
    },
    spawn(command, args, options) {
      order.push("migrate");
      invocation = { command, args, options };
      return {
        status: 0,
        stdout: "[00:00:00] \u001b[32mINFO\u001b[39m: \u001b[36mDone.\u001b[39m\n",
        stderr: "",
      };
    },
  });
  assert.deepEqual(order, ["bootstrap", "migrate", "bootstrap"]);
  assert.equal(invocation.command, "npm");
  assert.deepEqual(invocation.args, ["--prefix", "mingla-site-cms", "run", "migrate"]);
  assert.equal(invocation.options.env.NODE_ENV, "production");
  assert.equal(invocation.options.env.SITES_DATABASE_CONNECTION_MODE, "migration");
  assert.equal(invocation.options.env.DATABASE_URL, env.SITES_CMS_MIGRATOR_DATABASE_URL);
  assert.equal(invocation.options.env.SITES_CMS_MIGRATOR_DATABASE_URL, undefined);
  assert.equal(invocation.options.env.SITES_CMS_ADMIN_DATABASE_URL, undefined);

  const failedOrder = [];
  assert.throws(() => applySitesCmsMigrations({
    env,
    bootstrap() { failedOrder.push("bootstrap"); },
    spawn() {
      failedOrder.push("migrate");
      return { status: 0, stdout: "", stderr: "" };
    },
  }), /PAYLOAD_MIGRATION_RECEIPT_MISSING/);
  assert.deepEqual(failedOrder, ["bootstrap", "migrate"]);
  const sessionEnv = {
    ...env,
    SITES_CMS_MIGRATOR_DATABASE_URL: postgresFixtureUrl({
      user: `sites_cms_migrator.${"a".repeat(20)}`,
      credential: secret,
      host: "aws-0-us-east-2.pooler.supabase.com",
      port: "5432",
      sslmode: "require",
    }),
  };
  let sessionInvocation;
  applySitesCmsMigrations({
    env: sessionEnv,
    bootstrap() {},
    spawn(command, args, options) {
      sessionInvocation = { command, args, options };
      return { status: 0, stdout: "Done.\n", stderr: "" };
    },
  });
  assert.equal(
    sessionInvocation.options.env.DATABASE_URL,
    sessionEnv.SITES_CMS_MIGRATOR_DATABASE_URL,
  );
  assert.throws(() => applySitesCmsMigrations({
    env: {
      ...env,
      SITES_CMS_MIGRATOR_DATABASE_URL: postgresFixtureUrl({
        user: "sites_cms_app", credential: secret, host: "aws.pooler.supabase.com", port: "6543", sslmode: "require",
      }),
    },
    bootstrap() { throw new Error("must not reach bootstrap"); },
  }), /INVALID_MIGRATOR_DATABASE_URL/);
});

test("#2893 bootstrap is value-blind and reconciles exact private bucket policy", () => {
  const sql = readFileSync(join(SITES_DIR, "bootstrap-sites-cms.sql"), "utf8");
  for (const bucket of SITES_BUCKETS) assert.match(sql, new RegExp(`'${bucket}'`, "g"));
  assert.match(sql, /sites_cms_migrator/);
  assert.match(sql, /sites_cms_app/);
  assert.match(sql, /20971520/g);
  assert.match(sql, /public\s*=\s*false/);
  assert.match(sql, /auth\.uid\(\)\s*=\s*:'sites_runtime_reader_subject'::uuid/);
  assert.equal(
    sql.includes(String.raw`[0-9a-f]{64}\.json$`),
    true,
  );
  assert.equal(
    sql.includes(String.raw`(master|320|640|960|1440|1920)\.webp$`),
    true,
  );
  assert.equal(
    sql.includes(String.raw`[0-9a-f]{64}\\.json$`),
    false,
  );
  assert.equal(
    sql.includes(String.raw`(master|320|640|960|1440|1920)\\.webp$`),
    false,
  );
  assert.match(sql, /sites_runtime_reader_path_semantics_valid/);
  assert.match(sql, /RUNTIME_READER_PATH_SEMANTICS_INVALID/);
  assert.match(sql, /roles && ARRAY\['public', 'anon', 'authenticated'\]::name\[\]/);
  assert.match(sql, /pgrst\.db_schemas/);
  assert.match(sql, /DATA_API_EXPOSURE/);
  assert.doesNotMatch(sql, /WITH\s+LOGIN\s+NOSUPERUSER/);
  assert.match(sql, /AND NOT rolsuper/);
  assert.match(sql, /AND NOT rolcreatedb/);
  assert.match(sql, /AND NOT rolcreaterole/);
  assert.match(sql, /AND NOT rolinherit/);
  assert.match(sql, /AND NOT rolreplication/);
  assert.match(sql, /AND NOT rolbypassrls/);
  assert.match(sql, /SITES_BOOTSTRAP_ERROR code=ROLE_ATTRIBUTE_MISMATCH/);
  assert.match(sql, /member_role\.rolname = current_user/);
  assert.match(sql, /grantor_role\.rolname = 'supabase_admin'/);
  assert.match(sql, /AND NOT membership\.inherit_option/);
  assert.match(sql, /AND NOT membership\.set_option/);
  assert.match(sql, /GRANT sites_cms_migrator TO postgres WITH SET TRUE, INHERIT FALSE/);
  assert.match(sql, /SET LOCAL ROLE sites_cms_migrator/);
  assert.match(sql, /RESET ROLE;\s*REVOKE sites_cms_migrator FROM postgres GRANTED BY postgres/);
  assert.match(sql, /REVOKE sites_cms_migrator FROM postgres GRANTED BY postgres/);
  assert.match(sql, /SITES_BOOTSTRAP_ERROR code=ROLE_ADMIN_MEMBERSHIP_MISMATCH/);
  assert.doesNotMatch(sql, /\\quit\s+[0-9]/);
  assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);

  const secret = "operator-secret-must-not-be-argv";
  let invocation;
  bootstrapSitesCms({
    env: {
      SITES_CMS_PROJECT_REF: "a".repeat(20),
      SUPABASE_S3_ENDPOINT:
        `https://${"a".repeat(20)}.storage.supabase.co/storage/v1/s3`,
      SITES_CMS_ADMIN_DATABASE_URL: postgresFixtureUrl({
        user: "postgres", credential: secret.repeat(2), host: `db.${"a".repeat(20)}.supabase.co`, sslmode: "require",
      }),
      SITES_CMS_MIGRATOR_PASSWORD: `${secret}-migrator-0000000000000000`,
      SITES_CMS_APP_PASSWORD: `${secret}-app-000000000000000000000`,
      SITES_RUNTIME_READER_SUBJECT: MEDIA_ID,
      SITES_PILOT_SITE_ID: SITE_ID,
    },
    spawn(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, stdout: "SITES_BOOTSTRAP_OK roles=2\n", stderr: "" };
    },
  });
  assert.equal(invocation.command, "psql");
  assert.doesNotMatch(invocation.args.join(" "), new RegExp(secret));
  assert.equal(invocation.options.env.PGPASSWORD, secret.repeat(2));
  assert.equal(invocation.options.env.PGDATABASE, "postgres");

  const sessionAdminUrl = postgresFixtureUrl({
    user: `postgres.${"a".repeat(20)}`,
    credential: secret.repeat(2),
    host: "aws-0-us-east-2.pooler.supabase.com",
    port: "5432",
    sslmode: "require",
  });
  bootstrapSitesCms({
    env: {
      SITES_CMS_PROJECT_REF: "a".repeat(20),
      SUPABASE_S3_ENDPOINT:
        `https://${"a".repeat(20)}.storage.supabase.co/storage/v1/s3`,
      SITES_CMS_ADMIN_DATABASE_URL: sessionAdminUrl,
      SITES_CMS_MIGRATOR_PASSWORD: `${secret}-migrator-0000000000000000`,
      SITES_CMS_APP_PASSWORD: `${secret}-app-000000000000000000000`,
      SITES_RUNTIME_READER_SUBJECT: MEDIA_ID,
      SITES_PILOT_SITE_ID: SITE_ID,
    },
    spawn(_command, _args, options) {
      assert.equal(options.env.PGUSER, `postgres.${"a".repeat(20)}`);
      assert.equal(options.env.PGPORT, "5432");
      return { status: 0, stdout: "SITES_BOOTSTRAP_OK", stderr: "" };
    },
  });

  for (const adminUrl of [
    postgresFixtureUrl({ user: "postgres", credential: secret.repeat(2), host: `db.${"b".repeat(20)}.supabase.co`, sslmode: "require" }),
    postgresFixtureUrl({ user: "postgres", credential: secret.repeat(2), host: "aws-0-us-east-2.pooler.supabase.com", port: "6543", sslmode: "require" }),
    postgresFixtureUrl({ user: "sites_cms_migrator", credential: secret.repeat(2), host: `db.${"a".repeat(20)}.supabase.co`, sslmode: "require" }),
    postgresFixtureUrl({ user: "postgres", credential: secret.repeat(2), host: `db.${"a".repeat(20)}.supabase.co`, database: "other", sslmode: "require" }),
    postgresFixtureUrl({ user: "postgres", credential: secret.repeat(2), host: `db.${"a".repeat(20)}.supabase.co` }),
  ]) {
    let spawned = false;
    assert.throws(() => bootstrapSitesCms({
      env: {
        SITES_CMS_PROJECT_REF: "a".repeat(20),
        SUPABASE_S3_ENDPOINT:
          `https://${"a".repeat(20)}.storage.supabase.co/storage/v1/s3`,
        SITES_CMS_ADMIN_DATABASE_URL: adminUrl,
        SITES_CMS_MIGRATOR_PASSWORD: `${secret}-migrator-0000000000000000`,
        SITES_CMS_APP_PASSWORD: `${secret}-app-000000000000000000000`,
        SITES_RUNTIME_READER_SUBJECT: MEDIA_ID,
        SITES_PILOT_SITE_ID: SITE_ID,
      },
      spawn() {
        spawned = true;
        return { status: 0, stdout: "SITES_BOOTSTRAP_OK", stderr: "" };
      },
    }), /INVALID_ADMIN_DATABASE_URL/);
    assert.equal(spawned, false);
  }
  assert.throws(() => bootstrapSitesCms({
    env: {
      SITES_CMS_PROJECT_REF: "a".repeat(20),
      SUPABASE_S3_ENDPOINT:
        `https://${"b".repeat(20)}.storage.supabase.co/storage/v1/s3`,
      SITES_CMS_ADMIN_DATABASE_URL: postgresFixtureUrl({
        user: "postgres", credential: secret.repeat(2), host: `db.${"a".repeat(20)}.supabase.co`, sslmode: "require",
      }),
      SITES_CMS_MIGRATOR_PASSWORD: `${secret}-migrator-0000000000000000`,
      SITES_CMS_APP_PASSWORD: `${secret}-app-000000000000000000000`,
      SITES_RUNTIME_READER_SUBJECT: MEDIA_ID,
      SITES_PILOT_SITE_ID: SITE_ID,
    },
    spawn() { throw new Error("must not spawn"); },
  }), /S3_PROJECT_MISMATCH/);
});

test("#2893 workflow is nightly-main, private, immutable, isolated, and safely alerting", () => {
  const workflowPath = join(REPO_ROOT, ".github", "workflows", "sites-backup-restore.yml");
  const workflow = readFileSync(workflowPath, "utf8");
  const ops = readFileSync(join(SITES_DIR, "lib", "sites-ops.mjs"), "utf8");
  const registry = JSON.parse(readFileSync(
    join(REPO_ROOT, ".github", "ci-capability-workflows.json"),
    "utf8",
  ));
  assert.match(workflow, /cron: "23 7 \* \* \*"/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: mingla-sites-production/);
  assert.match(workflow, /image: postgres:17\.10-alpine/);
  assert.match(workflow, /SITES_BACKUP_RESTORE_RESULT_PATH/);
  assert.equal((workflow.match(/vercel@53\.2\.0/g) || []).length, 2);
  assert.equal((workflow.match(/--access private/g) || []).length, 2);
  assert.doesNotMatch(workflow, /--access public/);
  assert.match(workflow, /--allow-overwrite false/);
  assert.doesNotMatch(workflow, /--allow-overwrite true/);
  assert.doesNotMatch(workflow, /--(?:rw-)?token/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact|actions\/cache/);
  assert.match(workflow, /needs: \[contracts, backup_restore\]/);
  assert.match(workflow, /needs\.backup_restore\.result != 'success'/);
  assert.doesNotMatch(workflow, /needs\.backup_restore\.result != 'skipped'/);
  assert.match(workflow, /backup-sites-cms\.mjs deactivate/);
  assert.match(workflow, /needs: \[contracts, backup_restore, deactivate\]/);
  for (const name of [
    "SUPABASE_S3_ENDPOINT", "SUPABASE_S3_REGION",
    "SUPABASE_S3_ACCESS_KEY_ID", "SUPABASE_S3_SECRET_ACCESS_KEY",
  ]) {
    assert.match(workflow, new RegExp(name));
    assert.match(ops, new RegExp(name));
  }
  assert.doesNotMatch(`${workflow}\n${ops}`, /SITES_CMS_S3_/);
  assert.match(workflow, /issues\/2830\/comments/);
  assert.match(
    workflow,
    /SITES_BACKUP_ALERT error_code=SITES_BACKUP_OR_RESTORE_FAILED run_url=/,
  );
  assert.ok(registry.workflows.some((entry) =>
    entry.path === ".github/workflows/sites-backup-restore.yml" &&
    entry.issue === 2893 && entry.category === "production-operation"));
});

test("#2893 command failures log only allowlisted error codes, never env values", () => {
  const sentinel = "do-not-log-management-or-storage-secret";
  const result = spawnSync(process.execPath, [join(SITES_DIR, "backup-sites-cms.mjs")], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      SUPABASE_MANAGEMENT_TOKEN: sentinel,
      SUPABASE_S3_SECRET_ACCESS_KEY: sentinel,
      MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: Buffer.from(sentinel).toString("base64"),
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^SITES_OPS_ERROR code=MISSING_[A-Z0-9_]+\n$/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(sentinel));
  for (const file of [
    "backup-sites-cms.mjs",
    "restore-sites-cms.mjs",
    "bootstrap-sites-cms.mjs",
    "lib/sites-ops.mjs",
  ]) {
    const source = readFileSync(join(SITES_DIR, file), "utf8");
    assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
    assert.doesNotMatch(source, /error\.(?:message|stack)/);
  }
  assert.equal(existsSync(join(REPO_ROOT, "sites-backup-result.json")), false);
});

test("#2952 recovery database files stay inside the CI-mounted workspace", () => {
  const backupSource = readFileSync(
    join(SITES_DIR, "backup-sites-cms.mjs"),
    "utf8",
  );
  const restoreSource = readFileSync(
    join(SITES_DIR, "restore-sites-cms.mjs"),
    "utf8",
  );

  assert.match(
    backupSource,
    /mkdtempSync\(join\(outputDirectory, "\.scratch-"\)\)/,
  );
  assert.match(
    restoreSource,
    /mkdtempSync\(join\(dirname\(bundlePath\), "\.restore-"\)\)/,
  );
  assert.doesNotMatch(backupSource, /mkdtempSync\(join\(tmpdir\(\)/);
  assert.doesNotMatch(restoreSource, /mkdtempSync\(join\(tmpdir\(\)/);
});

test("#2958 pinned PostgreSQL clients preserve the non-root runner identity", () => {
  const wrapper = readFileSync(join(SITES_DIR, "pg17-client.sh"), "utf8");

  assert.match(wrapper, /runner_uid="\$\(id -u\)"/);
  assert.match(wrapper, /runner_gid="\$\(id -g\)"/);
  assert.match(wrapper, /--user "\$runner_uid:\$runner_gid"/);
  assert.match(wrapper, /INVALID_RUNNER_IDENTITY/);
  assert.doesNotMatch(wrapper, /--user (?:root|0(?::0)?)(?:\s|\\)/);
  assert.doesNotMatch(wrapper, /--privileged/);
});

test("#2962 private Blob transport emits finite codes and never provider output", async () => {
  const {
    classifyBlobFailure,
    runBlobTransport,
  } = await import("../vercel-blob-transport.mjs");

  const cases = new Map([
    ["File doesn't exist at /tmp/private", "PRIVATE_INPUT_UNREADABLE"],
    ["No Vercel Blob credentials found", "PRIVATE_CREDENTIAL_MISSING"],
    ["Vercel Blob: Access denied, please provide a valid token", "PRIVATE_AUTHORIZATION_FAILED"],
    ["Vercel Blob: This store has been suspended", "PRIVATE_STORE_SUSPENDED"],
    ["Vercel Blob: Content type mismatch", "PRIVATE_CONTENT_REJECTED"],
    ["Vercel Blob: Pathname mismatch", "PRIVATE_PATH_REJECTED"],
    ["Vercel Blob: Precondition failed", "PRIVATE_IMMUTABLE_CONFLICT"],
    ["Vercel Blob: Too many requests", "PRIVATE_RATE_LIMITED"],
    ["Vercel Blob: The blob service is currently not available", "PRIVATE_SERVICE_UNAVAILABLE"],
    ["TypeError: fetch failed", "PRIVATE_NETWORK_FAILED"],
    ["provider-private-detail", "PRIVATE_UNCLASSIFIED_FAILURE"],
  ]);
  for (const [providerOutput, code] of cases) {
    assert.equal(classifyBlobFailure(providerOutput), code);
  }

  const sentinel = "provider-private-detail-with-secret";
  assert.throws(() => runBlobTransport({
    operation: "get",
    pathname:
      `recovery/sites/mingla-sites-${SITE_ID}-20260901T000000000Z-${"a".repeat(64)}.msbk`,
    outputPath: join(tmpdir(), "issue-2962-readback-must-not-exist.msbk"),
    env: { BLOB_READ_WRITE_TOKEN: "token-value-that-is-long-enough-to-pass" },
    spawn() {
      return { status: 1, stdout: sentinel, stderr: sentinel };
    },
  }), (error) => {
    assert.equal(error.code, "PRIVATE_UNCLASSIFIED_FAILURE");
    assert.doesNotMatch(error.message, new RegExp(sentinel));
    return true;
  });

  const transport = readFileSync(
    join(SITES_DIR, "vercel-blob-transport.mjs"),
    "utf8",
  );
  assert.doesNotMatch(transport, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(transport, /process\.(?:stdout|stderr)\.write\([^\n]*result\./);
});

test("#2970 private Blob uploads are single-part when small and multipart when large", async () => {
  const {
    runBlobTransport,
    SINGLE_PART_MAX_BYTES,
  } = await import("../vercel-blob-transport.mjs");
  const invocations = [];
  const pathname =
    `recovery/sites/mingla-sites-${SITE_ID}-20260901T000000000Z-${"b".repeat(64)}.msbk`;

  for (const size of [SINGLE_PART_MAX_BYTES, SINGLE_PART_MAX_BYTES + 1]) {
    runBlobTransport({
      operation: "put",
      sourcePath: "/mounted/private-backup.msbk",
      pathname,
      env: { BLOB_READ_WRITE_TOKEN: "token-value-that-is-long-enough-to-pass" },
      exists: () => true,
      stat: () => ({ isFile: () => true, size }),
      spawn(command, args) {
        invocations.push({ command, args, size });
        return { status: 0, stdout: "private-provider-url", stderr: "" };
      },
    });
  }

  assert.equal(invocations.length, 2);
  assert.equal(invocations.every(({ command }) => command === "npx"), true);
  const multipartValue = ({ args }) => args[args.indexOf("--multipart") + 1];
  assert.equal(multipartValue(invocations[0]), "false");
  assert.equal(multipartValue(invocations[1]), "true");
  assert.equal(invocations.every(({ args }) =>
    args.includes("--access") && args.includes("private") &&
    args.includes("--allow-overwrite") && args.includes("false")), true);
});

test("#2975 direct private Blob HTTP transport validates upload and status classes", async () => {
  const {
    classifyBlobHttpStatus,
    runBlobHttpTransport,
  } = await import("../vercel-blob-http-transport.mjs");
  const pathname =
    `recovery/sites/mingla-sites-${SITE_ID}-20260901T000000000Z-${"c".repeat(64)}.msbk`;
  const storeId = "storeid123456789";
  const token = `vercel_blob_rw_${storeId}_${"s".repeat(30)}`;
  const sourcePath = join(SITES_DIR, "pg17-client.sh");
  const root = mkdtempSync(join(tmpdir(), "issue-2975-http-"));
  const metadataPath = join(root, "upload.json");
  let observed;

  try {
    const privateHost = "providerhost1234.private.blob.vercel-storage.com";
    await runBlobHttpTransport({
      operation: "put",
      sourcePath,
      pathname,
      metadataPath,
      env: { BLOB_READ_WRITE_TOKEN: token },
      async fetchImpl(url, init) {
        observed = { url: String(url), init };
        return Response.json({
          url: `https://${privateHost}/${pathname}`,
          downloadUrl: `https://${privateHost}/${pathname}?download=1`,
          pathname,
          contentType: "application/octet-stream",
          contentDisposition: "attachment",
          etag: "private-etag",
        });
      },
    });
    assert.match(observed.url, /^https:\/\/vercel\.com\/api\/blob\/\?pathname=/);
    assert.equal(observed.init.method, "PUT");
    assert.equal(observed.init.headers["x-api-version"], "12");
    assert.equal(observed.init.headers["x-vercel-blob-access"], "private");
    assert.equal(observed.init.headers["x-add-random-suffix"], "0");
    assert.equal(observed.init.headers["x-allow-overwrite"], "0");
    assert.equal(observed.init.headers.authorization, `Bearer ${token}`);
    assert.equal(Buffer.isBuffer(observed.init.body), true);
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    assert.equal(metadata.pathname, pathname);
    assert.equal(new URL(metadata.url).hostname, privateHost);
    assert.equal(metadata.etag, "private-etag");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const expected = new Map([
    [401, "PRIVATE_AUTHORIZATION_FAILED"],
    [404, "PRIVATE_STORE_OR_OBJECT_NOT_FOUND"],
    [409, "PRIVATE_IMMUTABLE_CONFLICT"],
    [413, "PRIVATE_FILE_TOO_LARGE"],
    [415, "PRIVATE_CONTENT_REJECTED"],
    [429, "PRIVATE_RATE_LIMITED"],
    [503, "PRIVATE_SERVICE_UNAVAILABLE"],
    [400, "PRIVATE_PROVIDER_HTTP_REJECTED"],
  ]);
  for (const [status, code] of expected) {
    assert.equal(classifyBlobHttpStatus(status), code);
  }

  const transport = readFileSync(
    join(SITES_DIR, "vercel-blob-http-transport.mjs"),
    "utf8",
  );
  assert.doesNotMatch(transport, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(transport, /response\.(?:text|body)\s*\(/);
});

test("#2980 restore directs the custom-format dump into the exact ephemeral database", () => {
  const restoreSource = readFileSync(
    join(SITES_DIR, "restore-sites-cms.mjs"),
    "utf8",
  );
  assert.match(
    restoreSource,
    /"pg_restore",[\s\S]*?"--dbname",\s*"postgres",[\s\S]*?extracted\.databasePath/,
  );
  assert.doesNotMatch(
    restoreSource,
    /"pg_restore",[\s\S]*?"--dbname",\s*env\./,
  );
});

test("#2985 Core readiness timestamps compare as instants while digests stay exact", async () => {
  const { timestampsRepresentSameInstant } = await import("../lib/sites-ops.mjs");
  assert.equal(
    timestampsRepresentSameInstant(
      "2026-09-01T14:40:42.133Z",
      "2026-09-01T14:40:42.133+00:00",
    ),
    true,
  );
  assert.equal(
    timestampsRepresentSameInstant(
      "2026-09-01T14:40:42.133Z",
      "2026-09-01T14:40:42.134+00:00",
    ),
    false,
  );
  assert.equal(timestampsRepresentSameInstant("invalid", "invalid"), false);

  const restoreSource = readFileSync(
    join(SITES_DIR, "restore-sites-cms.mjs"),
    "utf8",
  );
  const backupSource = readFileSync(
    join(SITES_DIR, "backup-sites-cms.mjs"),
    "utf8",
  );
  assert.match(restoreSource, /timestampsRepresentSameInstant\(/);
  assert.match(backupSource, /timestampsRepresentSameInstant\(/);
  assert.match(
    restoreSource,
    /restore_drill_evidence_digest !== evidenceDigest/,
  );
});
