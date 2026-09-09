import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertReferenceIntegrity,
  buildReferenceMap,
  runBackup,
} from "../backup-sites-cms.mjs";
import {
  decryptBundle,
  extractPlainBundle,
  sha256Bytes,
} from "../lib/sites-ops.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000003154";
const SITE_ID = "20000000-0000-4000-8000-000000003154";
const UPLOAD_ID = "30000000-0000-4000-8000-000000003154";
const COMMITTED_ID = "40000000-0000-4000-8000-000000003154";
const PUBLICATION_ID = "50000000-0000-4000-8000-000000003154";
const NOW = new Date("2026-09-09T15:30:00.000Z");
const DIGEST = "a".repeat(64);

function inventory({ media, publications = [] }) {
  return {
    tenants: [{ tenant_id: TENANT_ID, site_id: SITE_ID }],
    media,
    publications,
    counts: { tenants: 1, documents: media.length + publications.length },
  };
}

function mediaRow({ id, state, quarantineKey, manifest = null }) {
  return {
    tenant_id: TENANT_ID,
    media_id: id,
    state,
    quarantine_key: quarantineKey,
    approved_master_key: manifest?.master?.key ?? null,
    rendition_manifest: manifest,
  };
}

test("#3154 optional presence is UPLOADING-only, identity-local, and mandatory-wins", () => {
  const uploadingKey = `quarantine/${SITE_ID}/${UPLOAD_ID}/pending`;
  const committedKey = `quarantine/${SITE_ID}/${COMMITTED_ID}/committed`;
  const uploadingIdentity = `sites-media-quarantine/${uploadingKey}`;
  const committedIdentity = `sites-media-quarantine/${committedKey}`;

  const mixed = buildReferenceMap(inventory({
    media: [
      mediaRow({ id: UPLOAD_ID, state: "UPLOADING", quarantineKey: uploadingKey }),
      mediaRow({ id: COMMITTED_ID, state: "PROCESSING", quarantineKey: committedKey }),
    ],
  }), SITE_ID).references;
  assert.equal(mixed.get(uploadingIdentity)?.optional_presence, true);
  assert.equal(mixed.get(committedIdentity)?.optional_presence, false);
  assert.doesNotThrow(() => assertReferenceIntegrity(
    new Map([[uploadingIdentity, mixed.get(uploadingIdentity)]]),
    new Map(),
  ));
  assert.throws(
    () => assertReferenceIntegrity(mixed, new Map()),
    /REFERENCED_OBJECT_MISSING/,
    "one optional identity must not make another quarantine identity optional",
  );

  for (const rows of [
    [
      mediaRow({ id: UPLOAD_ID, state: "UPLOADING", quarantineKey: uploadingKey }),
      mediaRow({ id: COMMITTED_ID, state: "QUARANTINED", quarantineKey: uploadingKey }),
    ],
    [
      mediaRow({ id: COMMITTED_ID, state: "QUARANTINED", quarantineKey: uploadingKey }),
      mediaRow({ id: UPLOAD_ID, state: "UPLOADING", quarantineKey: uploadingKey }),
    ],
  ]) {
    const duplicate = buildReferenceMap(inventory({ media: rows }), SITE_ID).references;
    assert.equal(
      duplicate.get(uploadingIdentity)?.optional_presence,
      false,
      "a duplicate mandatory use must win regardless of row order",
    );
    assert.throws(
      () => assertReferenceIntegrity(duplicate, new Map()),
      /REFERENCED_OBJECT_MISSING/,
    );
  }

  for (const state of [
    "QUARANTINED",
    "PROCESSING",
    "READY",
    "REJECTED",
    "RETRYABLE_FAILED",
    "TOMBSTONED",
  ]) {
    const manifest = ["READY", "TOMBSTONED"].includes(state)
      ? {
        version: 1,
        master: {
          key: `approved/${SITE_ID}/${COMMITTED_ID}/${DIGEST}/master.webp`,
          digest: DIGEST,
          bytes: 5,
        },
        renditions: [],
      }
      : null;
    const references = buildReferenceMap(inventory({
      media: [mediaRow({
        id: COMMITTED_ID,
        state,
        quarantineKey: committedKey,
        manifest,
      })],
    }), SITE_ID).references;
    const reference = references.get(committedIdentity);
    assert.equal(reference?.optional_presence, false, `${state} must stay mandatory`);
    assert.throws(
      () => assertReferenceIntegrity(
        new Map([[committedIdentity, reference]]),
        new Map(),
      ),
      /REFERENCED_OBJECT_MISSING/,
      `${state} must fail closed when its quarantine object is absent`,
    );
  }
});

test("#3154 approved, recovery, and publication references remain mandatory", () => {
  const masterKey = `approved/${SITE_ID}/${COMMITTED_ID}/${DIGEST}/master.webp`;
  const recoveryKey =
    `recovery/${TENANT_ID}/${SITE_ID}/${COMMITTED_ID}/${DIGEST}/master.webp`;
  const publicationDigest = "b".repeat(64);
  const publicationKey =
    `publications/${SITE_ID}/${PUBLICATION_ID}/${publicationDigest}.json`;
  const references = buildReferenceMap(inventory({
    media: [mediaRow({
      id: COMMITTED_ID,
      state: "TOMBSTONED",
      quarantineKey: null,
      manifest: {
        version: 1,
        master: { key: masterKey, digest: DIGEST, bytes: 5 },
        renditions: [],
      },
    })],
    publications: [{
      tenant_id: TENANT_ID,
      status: "published",
      artifact_key: publicationKey,
      artifact_digest: publicationDigest,
    }],
  }), SITE_ID).references;

  for (const identity of [
    `sites-media-approved/${masterKey}`,
    `sites-media-recovery/${recoveryKey}`,
    `sites-publication-artifacts/${publicationKey}`,
  ]) {
    const reference = references.get(identity);
    assert.equal(reference?.optional_presence, false);
    assert.throws(
      () => assertReferenceIntegrity(new Map([[identity, reference]]), new Map()),
      /REFERENCED_OBJECT_MISSING/,
    );
  }
});

test("#3154 a present UPLOADING object is downloaded into the encrypted bundle", async () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "issue-3154-present-upload-")),
  );
  try {
    const projectRef = "a1b2c3d4e5f6g7h8i9j0";
    const output = join(root, "output");
    const resultPath = join(output, "result.json");
    const plainPath = join(root, "decrypted.bundle");
    const extractPath = join(root, "extracted");
    const objectBytes = Buffer.from("unconfirmed-upload-bytes");
    const quarantineKey = `quarantine/${SITE_ID}/${UPLOAD_ID}/pending`;
    const databaseInventory = inventory({
      media: [mediaRow({
        id: UPLOAD_ID,
        state: "UPLOADING",
        quarantineKey,
      })],
    });
    const encryptionKey = Buffer.alloc(32, 31).toString("base64");
    const env = {
      SITES_CMS_DATABASE_URL:
        `postgresql://sites_cms_migrator:${"p".repeat(40)}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
      SITES_CMS_PROJECT_REF: projectRef,
      SUPABASE_MANAGEMENT_TOKEN: "management-fixture",
      SITES_PILOT_SITE_ID: SITE_ID,
      SUPABASE_S3_ENDPOINT:
        `https://${projectRef}.storage.supabase.co/storage/v1/s3`,
      SUPABASE_S3_REGION: "us-east-2",
      SUPABASE_S3_ACCESS_KEY_ID: "access-fixture",
      SUPABASE_S3_SECRET_ACCESS_KEY: "secret-fixture",
      SITES_BACKUP_ENCRYPTION_KEY_B64: encryptionKey,
      SITES_CORE_BASE_URL: "https://core.example.test",
      MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-key-v1",
      MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: Buffer.alloc(32, 32).toString("base64"),
      SITES_BACKUP_OUTPUT_DIR: output,
      SITES_BACKUP_RESULT_PATH: resultPath,
    };
    const spawn = (command, args) => {
      if (args.includes("--version")) {
        return { status: 0, stdout: `${command} (PostgreSQL) 17.10\n`, stderr: "" };
      }
      if (command === "psql") {
        return { status: 0, stdout: `${JSON.stringify(databaseInventory)}\n`, stderr: "" };
      }
      if (command === "pg_dump") {
        const path = args[args.indexOf("--file") + 1];
        writeFileSync(path, "database-dump");
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`UNEXPECTED_COMMAND:${command}`);
    };
    const fetchImpl = async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.supabase.com") {
        if (url.pathname.endsWith("/database/backups")) {
          return Response.json({
            region: "us-east-2",
            walg_enabled: true,
            pitr_enabled: false,
            backups: [{
              id: 1,
              is_physical_backup: true,
              status: "COMPLETED",
              inserted_at: NOW.toISOString(),
            }],
            physical_backup_data: null,
          });
        }
        return Response.json({
          ref: projectRef,
          organization_slug: "mrcqqkovdchaltvquggd",
          name: "mingla-sites-cms-prod",
          region: "us-east-2",
          created_at: new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString(),
          status: "ACTIVE_HEALTHY",
          database: {
            host: `db.${projectRef}.supabase.co`,
            version: "17.10.0",
            postgres_engine: "17",
            release_channel: "ga",
          },
        });
      }
      if (url.hostname === "core.example.test") {
        return Response.json({ ok: true, data: { protected_artifact_keys: [] } });
      }
      if (url.hostname === `${projectRef}.storage.supabase.co`) {
        const isList = url.searchParams.get("list-type") === "2";
        const quarantineBucket =
          url.pathname.endsWith("/sites-media-quarantine");
        if (isList) {
          const contents = quarantineBucket
            ? `<Contents><Key>${quarantineKey}</Key>` +
              `<LastModified>${NOW.toISOString()}</LastModified>` +
              `<ETag>&quot;fixture&quot;</ETag>` +
              `<Size>${objectBytes.byteLength}</Size></Contents>`
            : "";
          return new Response(
            `<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
          );
        }
        if (url.pathname.endsWith(`/${quarantineKey}`)) {
          return new Response(objectBytes);
        }
      }
      return new Response("not found", { status: 404 });
    };

    const result = await runBackup({ env, fetchImpl, spawn, now: NOW });
    assert.equal(result.object_count, 1);
    await decryptBundle(result.bundle_path, plainPath, Buffer.from(encryptionKey, "base64"));
    const extracted = extractPlainBundle(plainPath, extractPath, NOW);
    assert.deepEqual(extracted.manifest.objects, [{
      bucket: "sites-media-quarantine",
      key: quarantineKey,
      bytes: objectBytes.byteLength,
      sha256: sha256Bytes(objectBytes),
      site_id: SITE_ID,
      reference_state: "media:UPLOADING",
      protected: false,
    }]);
    assert.equal(readFileSync(extracted.objects[0].path).equals(objectBytes), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
