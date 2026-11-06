// MINGLA-INVARIANT: I-PROPOSED-2830-MULTI-TENANT-RECOVERY | issue #2830 | The Sites backup, restore drill and retention sweep cover every tenant; adding a brand never fails them, and every object and row must still belong to exactly one known tenant.
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
import { fileURLToPath } from "node:url";

import { buildReferenceMap, recordBackupEvidence, runBackup } from "../backup-sites-cms.mjs";
import {
  DEACTIVATING_RECOVERY_CODES,
  classifyRecoveryFailure,
  decryptBundle,
  extractPlainBundle,
  isSharedObject,
  resolveObjectOwner,
  validateManifest,
} from "../lib/sites-ops.mjs";
import {
  retentionSiteIds,
  runAllSitesRetention,
} from "../run-sites-retention.mjs";
import {
  DRAFT,
  DRAFT_MEDIA,
  DRAFT_STREAM,
  EMPTY,
  PILOT,
  PILOT_MEDIA,
  PUBLICATION,
  fixtureEnv,
  fixtureFetch,
  fixtureObjects,
} from "./issue_2830_multi_tenant_fixture.mjs";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const NOW = new Date("2026-11-05T15:30:00.000Z");
const HASH = "a".repeat(64);
const SOURCE = (path) => readFileSync(join(REPO, path), "utf8");

function inventory({ tenants, media = [], publications = [] }) {
  return { tenants, media, publications, counts: { tenants: tenants.length, documents: 1 } };
}

function imageRow(tenant, mediaId, overrides = {}) {
  const key = `approved/${tenant.site_id}/${mediaId}/${HASH}/master.webp`;
  return {
    tenant_id: tenant.tenant_id,
    media_id: mediaId,
    state: "READY",
    kind: "image",
    quarantine_key: null,
    approved_master_key: key,
    rendition_manifest: {
      version: 1,
      master: { key, digest: "b".repeat(64), bytes: 5 },
      renditions: [],
    },
    ...overrides,
  };
}

test("#2830 two tenants, one a draft with no publication, are both in scope", () => {
  const { references, tenantId, tenants } = buildReferenceMap(inventory({
    tenants: [PILOT, DRAFT],
    media: [imageRow(PILOT, PILOT_MEDIA), imageRow(DRAFT, DRAFT_MEDIA)],
    publications: [{
      tenant_id: PILOT.tenant_id,
      status: "published",
      artifact_key: `publications/${PILOT.site_id}/${PUBLICATION}/${HASH}.json`,
      artifact_digest: HASH,
    }],
  }), PILOT.site_id);
  assert.equal(tenantId, PILOT.tenant_id);
  assert.equal(tenants.length, 2);
  assert.equal(
    references.has(`sites-media-approved/approved/${DRAFT.site_id}/${DRAFT_MEDIA}/${HASH}/master.webp`),
    true,
  );
});

test("#2830 three tenants and twenty-five tenants are both in scope", () => {
  assert.equal(
    buildReferenceMap(inventory({ tenants: [PILOT, DRAFT, EMPTY] }), PILOT.site_id).tenants.length,
    3,
  );
  const many = Array.from({ length: 25 }, (_, index) => {
    const suffix = String(index).padStart(12, "0");
    return {
      tenant_id: `11000000-0000-4000-8000-${suffix}`,
      site_id: `22000000-0000-4000-8000-${suffix}`,
    };
  });
  assert.equal(
    buildReferenceMap(inventory({ tenants: [PILOT, ...many] }), PILOT.site_id).tenants.length,
    26,
  );
});

test("#2830 a row whose object sits under another tenant fails closed", () => {
  const foreignKey = `approved/${PILOT.site_id}/${DRAFT_MEDIA}/${HASH}/master.webp`;
  assert.throws(() => buildReferenceMap(inventory({
    tenants: [PILOT, DRAFT],
    media: [imageRow(DRAFT, DRAFT_MEDIA, {
      approved_master_key: foreignKey,
      rendition_manifest: {
        version: 1,
        master: { key: foreignKey, digest: "b".repeat(64), bytes: 5 },
        renditions: [],
      },
    })],
  }), PILOT.site_id), /OBJECT_SITE_PREFIX_MISMATCH/);
  assert.throws(() => buildReferenceMap(inventory({
    tenants: [PILOT, DRAFT],
    publications: [{
      tenant_id: DRAFT.tenant_id,
      status: "published",
      artifact_key: `publications/${PILOT.site_id}/${PUBLICATION}/${HASH}.json`,
      artifact_digest: HASH,
    }],
  }), PILOT.site_id), /OBJECT_SITE_PREFIX_MISMATCH/);
});

test("#2830 scope stays strict: missing pilot, null site, duplicates, unknown tenant", () => {
  assert.throws(
    () => buildReferenceMap(inventory({ tenants: [DRAFT, EMPTY] }), PILOT.site_id),
    /DATABASE_PILOT_TENANT_MISSING/,
  );
  assert.throws(
    () => buildReferenceMap(inventory({ tenants: [] }), PILOT.site_id),
    /DATABASE_PILOT_TENANT_MISSING/,
  );
  assert.throws(
    () => buildReferenceMap(inventory({
      tenants: [PILOT, { tenant_id: DRAFT.tenant_id, site_id: null }],
    }), PILOT.site_id),
    /DATABASE_SITE_SCOPE_MISMATCH/,
  );
  assert.throws(
    () => buildReferenceMap(inventory({
      tenants: [PILOT, { tenant_id: DRAFT.tenant_id, site_id: PILOT.site_id }],
    }), PILOT.site_id),
    /DATABASE_SITE_SCOPE_MISMATCH/,
  );
  assert.throws(
    () => buildReferenceMap(inventory({
      tenants: [PILOT],
      media: [imageRow(DRAFT, DRAFT_MEDIA)],
    }), PILOT.site_id),
    /DATABASE_SITE_SCOPE_MISMATCH/,
  );
  assert.throws(
    () => buildReferenceMap(inventory({
      tenants: [PILOT],
      publications: [{ tenant_id: null, status: "failed" }],
    }), PILOT.site_id),
    /DATABASE_SITE_SCOPE_MISMATCH/,
  );
});

test("#2830 a stored object must name exactly one known tenant", () => {
  const tenants = [PILOT, DRAFT];
  assert.equal(
    resolveObjectOwner("sites-media-approved", `approved/${DRAFT.site_id}/x`, tenants),
    DRAFT,
  );
  assert.throws(
    () => resolveObjectOwner("sites-media-approved", `approved/${EMPTY.site_id}/x`, tenants),
    /OBJECT_UNKNOWN_TENANT/,
  );
  assert.throws(
    () => resolveObjectOwner("sites-media-approved", `quarantine/${DRAFT.site_id}/x`, tenants),
    /OBJECT_SITE_PREFIX_MISMATCH/,
  );
  assert.throws(
    () => resolveObjectOwner("sites-media-approved", "x", tenants),
    /OBJECT_UNKNOWN_TENANT/,
  );
  const recovery = (tenant, site) =>
    `recovery/${tenant.tenant_id}/${site.site_id}/${DRAFT_MEDIA}/${HASH}/master.webp`;
  assert.equal(resolveObjectOwner("sites-media-recovery", recovery(DRAFT, DRAFT), tenants), DRAFT);
  assert.throws(
    () => resolveObjectOwner("sites-media-recovery", recovery(DRAFT, PILOT), tenants),
    /OBJECT_TENANT_SITE_PREFIX_MISMATCH/,
  );
  assert.throws(
    () => resolveObjectOwner("sites-media-recovery", recovery(EMPTY, EMPTY), tenants),
    /OBJECT_UNKNOWN_TENANT/,
  );
});

test("#2830 a READY stream video holds nothing in storage and is not an invalid row", () => {
  const { references } = buildReferenceMap(inventory({
    tenants: [PILOT, DRAFT],
    media: [{
      tenant_id: DRAFT.tenant_id,
      media_id: DRAFT_STREAM,
      state: "READY",
      kind: "stream_video",
      quarantine_key: null,
      approved_master_key: null,
      rendition_manifest: null,
    }],
  }), PILOT.site_id);
  assert.equal(references.size, 0);
  // Still strict for an image, and for a stream video claiming stored bytes.
  assert.throws(() => buildReferenceMap(inventory({
    tenants: [PILOT],
    media: [imageRow(PILOT, PILOT_MEDIA, { rendition_manifest: null })],
  }), PILOT.site_id), /DATABASE_INVENTORY_INVALID/);
  assert.throws(() => buildReferenceMap(inventory({
    tenants: [PILOT, DRAFT],
    media: [{
      tenant_id: DRAFT.tenant_id,
      media_id: DRAFT_STREAM,
      state: "READY",
      kind: "stream_video",
      approved_master_key: "approved/x",
      rendition_manifest: null,
    }],
  }), PILOT.site_id), /DATABASE_INVENTORY_INVALID/);
});

test("#2830 a removed file video's recovery copy is a valid object", () => {
  const key =
    `recovery/${DRAFT.tenant_id}/${DRAFT.site_id}/${DRAFT_MEDIA}/${HASH}/master.mp4`;
  assert.equal(resolveObjectOwner("sites-media-recovery", key, [PILOT, DRAFT]), DRAFT);
  assert.throws(
    () => resolveObjectOwner("sites-media-recovery", key.replace("master.mp4", "320.mp4"), [DRAFT]),
    /OBJECT_TENANT_SITE_PREFIX_MISMATCH/,
  );
});

function manifest(overrides = {}) {
  const object = (tenant, bytes) => ({
    bucket: "sites-media-quarantine",
    key: `quarantine/${tenant.site_id}/${bytes}`,
    bytes,
    sha256: "c".repeat(64),
    site_id: tenant.site_id,
    reference_state: "unreferenced",
    protected: false,
  });
  return {
    schema_version: 2,
    site_id: PILOT.site_id,
    tenant_id: PILOT.tenant_id,
    tenants: [
      { ...PILOT, documents: 4, objects: 1, object_bytes: 5 },
      { ...DRAFT, documents: 0, objects: 1, object_bytes: 7 },
    ],
    generated_at: NOW.toISOString(),
    database: { format: "pg_dump-custom", bytes: 4, sha256: "d".repeat(64) },
    backup: {
      database_backup_verified_at: NOW.toISOString(),
      management_observed_at: NOW.toISOString(),
      retention_days: 7,
    },
    counts: { tenants: 2, documents: 4, objects: 2, object_bytes: 12 },
    objects: [object(PILOT, 5), object(DRAFT, 7)],
    ...overrides,
  };
}

test("#2830 the manifest accounts for every tenant and every object's owner", () => {
  assert.equal(validateManifest(manifest(), NOW).tenants.length, 2);
  const base = manifest();
  // The signing site is not one of the listed tenants.
  assert.throws(() => validateManifest(manifest({
    tenants: [{ ...DRAFT, documents: 4, objects: 2, object_bytes: 12 }, {
      ...EMPTY, documents: 0, objects: 0, object_bytes: 0,
    }],
  }), NOW), /MANIFEST_SCHEMA_INVALID/);
  // An object whose owner is not listed.
  assert.throws(() => validateManifest(manifest({
    objects: [base.objects[0], { ...base.objects[1], key: `quarantine/${EMPTY.site_id}/7`, site_id: EMPTY.site_id }],
  }), NOW), /OBJECT_UNKNOWN_TENANT/);
  // An object filed under the wrong tenant.
  assert.throws(() => validateManifest(manifest({
    objects: [base.objects[0], { ...base.objects[1], site_id: PILOT.site_id }],
  }), NOW), /OBJECT_SITE_PREFIX_MISMATCH/);
  // Per-tenant tallies must match, even when the totals do.
  assert.throws(() => validateManifest(manifest({
    tenants: [
      { ...PILOT, documents: 4, objects: 2, object_bytes: 12 },
      { ...DRAFT, documents: 0, objects: 0, object_bytes: 0 },
    ],
  }), NOW), /MANIFEST_MISMATCH/);
  // The tenant list and the tenant count must agree.
  assert.throws(() => validateManifest(manifest({
    counts: { ...base.counts, tenants: 3 },
  }), NOW), /MANIFEST_SCHEMA_INVALID/);
  assert.throws(() => validateManifest(manifest({ schema_version: 3 }), NOW), /MANIFEST_SCHEMA_INVALID/);
  const { tenants: _dropped, ...withoutTenants } = base;
  assert.throws(() => validateManifest(withoutTenants, NOW), /MANIFEST_SCHEMA_INVALID/);
});

test("#2830 a version 1 bundle already in the private store still validates", () => {
  const { tenants: _dropped, ...rest } = manifest();
  const object = { ...rest.objects[0] };
  assert.equal(validateManifest({
    ...rest,
    schema_version: 1,
    counts: { tenants: 1, documents: 4, objects: 1, object_bytes: 5 },
    objects: [object],
  }, NOW).schema_version, 1);
});

test("#2830 no new failure mode can trigger the deactivation path; the gate is unchanged", () => {
  for (const code of [
    "DATABASE_PILOT_TENANT_MISSING",
    "DATABASE_SITE_SCOPE_MISMATCH",
    "OBJECT_UNKNOWN_TENANT",
    "OBJECT_SITE_PREFIX_MISMATCH",
    "OBJECT_TENANT_SITE_PREFIX_MISMATCH",
    "RESTORE_DATABASE_COUNT_MISMATCH",
    "RESTORE_EMPTY_PILOT",
    "MANIFEST_MISMATCH",
    "CORE_REQUEST_FAILED",
    "RETENTION_SITE_LIST_INVALID",
  ]) assert.equal(classifyRecoveryFailure(code).deactivating, false, code);
  assert.deepEqual([...DEACTIVATING_RECOVERY_CODES].sort(), [
    "DATABASE_BACKUP_CURRENT_FAILED",
    "DATABASE_BACKUP_MISSING",
    "DATABASE_BACKUP_RETENTION_UNPROVEN",
    "DATABASE_BACKUP_STALE",
    "DATABASE_BACKUP_WALG_DISABLED",
  ]);
});

async function backupScenario({ tweak = () => {}, protection } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "issue-2830-backup-")));
  const objects = fixtureObjects();
  const databaseInventory = {
    tenants: [
      { ...PILOT, documents: 4 },
      { ...DRAFT, documents: 3 },
      { ...EMPTY, documents: 0 },
    ],
    media: [
      {
        tenant_id: PILOT.tenant_id,
        media_id: PILOT_MEDIA,
        state: "READY",
        kind: "image",
        quarantine_key: null,
        approved_master_key: objects.pilotMaster,
        rendition_manifest: objects.pilotManifest,
      },
      {
        tenant_id: DRAFT.tenant_id,
        media_id: DRAFT_MEDIA,
        state: "READY",
        kind: "image",
        quarantine_key: null,
        approved_master_key: objects.draftMaster,
        rendition_manifest: objects.draftManifest,
      },
    ],
    publications: [{
      tenant_id: PILOT.tenant_id,
      status: "published",
      artifact_key: objects.artifactKey,
      artifact_digest: objects.artifactDigest,
    }],
    counts: { tenants: 3, documents: 7 },
  };
  tweak({ objects, databaseInventory });
  const encryptionKey = Buffer.alloc(32, 31).toString("base64");
  const env = fixtureEnv({
    output: root,
    resultPath: join(root, "result.json"),
    encryptionKey,
  });
  const spawn = (command, args) => {
    if (args.includes("--version")) {
      return { status: 0, stdout: `${command} (PostgreSQL) 17.10\n`, stderr: "" };
    }
    if (command === "psql") {
      return { status: 0, stdout: `${JSON.stringify(databaseInventory)}\n`, stderr: "" };
    }
    // A real dump is exercised by the PostgreSQL 17 suite; here it is only bytes.
    writeFileSync(args[args.indexOf("--file") + 1], "database-dump");
    return { status: 0, stdout: "", stderr: "" };
  };
  const calls = { protection: [] };
  const fetchImpl = fixtureFetch({
    now: NOW,
    buckets: objects.buckets,
    protection: protection ?? {
      [PILOT.site_id]: [objects.artifactKey],
      [DRAFT.site_id]: [],
      [EMPTY.site_id]: [],
    },
    calls,
  });
  return { root, env, spawn, fetchImpl, calls, encryptionKey };
}

test("#2830 the bundle holds every tenant's objects, each attributed to its owner", async () => {
  const scenario = await backupScenario();
  const { root, env, spawn, fetchImpl, calls, encryptionKey } = scenario;
  try {
    const result = await runBackup({ env, fetchImpl, spawn, now: NOW });
    assert.deepEqual(result.site_ids, [PILOT.site_id, DRAFT.site_id, EMPTY.site_id]);
    assert.deepEqual(calls.protection, [PILOT.site_id, DRAFT.site_id, EMPTY.site_id]);
    const plain = join(root, "plain");
    await decryptBundle(result.bundle_path, plain, Buffer.from(encryptionKey, "base64"));
    const { manifest: restored } = extractPlainBundle(plain, join(root, "extracted"), NOW);
    assert.equal(restored.schema_version, 2);
    assert.equal(restored.site_id, PILOT.site_id);
    assert.deepEqual(restored.tenants.map((tenant) => [tenant.site_id, tenant.documents, tenant.objects]), [
      [PILOT.site_id, 4, 2],
      [DRAFT.site_id, 3, 1],
      [EMPTY.site_id, 0, 0],
    ]);
    const draftObject = restored.objects.find((object) => object.site_id === DRAFT.site_id);
    assert.equal(draftObject.protected, false);
    const pilotMaster = restored.objects.find((object) =>
      object.site_id === PILOT.site_id && object.bucket === "sites-media-approved");
    assert.equal(pilotMaster.protected, true, "a pilot's published media stays protected");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#2830 a stored object of an unknown tenant fails the whole backup, loudly", async () => {
  const { root, env, spawn, fetchImpl } = await backupScenario({
    tweak: ({ objects }) => {
      objects.buckets["sites-media-approved"].set(
        "approved/99999999-0000-4000-8000-000000002830/x/y.webp",
        Buffer.from("orphan"),
      );
    },
  });
  try {
    await assert.rejects(() => runBackup({ env, fetchImpl, spawn, now: NOW }), /OBJECT_UNKNOWN_TENANT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The 2026-11-06 backup failure: the font pipeline (#2829 AD-3) keeps every
// brand's font files once, at `fonts/<sha256>.woff2` in the approved bucket.
// They belong to no single site, and the first backup after a second brand
// stopped with OBJECT_UNKNOWN_TENANT.
const FONT_WOFF2 = `fonts/${"b".repeat(64)}.woff2`;
const FONT_TTF = `fonts/${"c".repeat(64)}.ttf`;

test("#2830 a shared font file belongs to no tenant; nothing else under fonts/ does", () => {
  const tenants = [PILOT, DRAFT];
  assert.equal(resolveObjectOwner("sites-media-approved", FONT_WOFF2, tenants), null);
  assert.equal(resolveObjectOwner("sites-media-approved", FONT_TTF, tenants), null);
  assert.equal(isSharedObject("sites-media-approved", FONT_WOFF2), true);
  for (const [bucket, key] of [
    ["sites-media-approved", `fonts/${"b".repeat(63)}.woff2`],
    ["sites-media-approved", `fonts/${"b".repeat(64)}.otf`],
    ["sites-media-approved", `fonts/${DRAFT.site_id}/${"b".repeat(64)}.woff2`],
    ["sites-media-approved", `fonts/../${"b".repeat(64)}.woff2`],
    ["sites-media-approved", `fonts/${"B".repeat(64)}.woff2`],
    ["sites-media-quarantine", FONT_WOFF2],
    ["sites-publication-artifacts", FONT_WOFF2],
    ["sites-media-recovery", FONT_WOFF2],
  ]) {
    assert.equal(isSharedObject(bucket, key), false, `${bucket}/${key}`);
    assert.throws(() => resolveObjectOwner(bucket, key, tenants), /OBJECT_|INVALID_TENANT_ID/, `${bucket}/${key}`);
  }
});

test("#2830 shared fonts are backed up once, with no site, kept, and outside every tenant's count", async () => {
  const fontBytes = Buffer.from("woff2-bytes");
  const ttfBytes = Buffer.from("ttf-bytes");
  const scenario = await backupScenario({
    tweak: ({ objects }) => {
      objects.buckets["sites-media-approved"].set(FONT_WOFF2, fontBytes);
      objects.buckets["sites-media-approved"].set(FONT_TTF, ttfBytes);
    },
  });
  const { root, env, spawn, fetchImpl, encryptionKey } = scenario;
  try {
    const result = await runBackup({ env, fetchImpl, spawn, now: NOW });
    const plain = join(root, "plain");
    await decryptBundle(result.bundle_path, plain, Buffer.from(encryptionKey, "base64"));
    const { manifest, objects } = extractPlainBundle(plain, join(root, "extracted"), NOW);
    const fonts = manifest.objects.filter((object) => object.key.startsWith("fonts/"));
    assert.deepEqual(fonts.map((object) => [object.key, object.site_id, object.protected]), [
      [FONT_WOFF2, null, true],
      [FONT_TTF, null, true],
    ].sort((left, right) => left[0].localeCompare(right[0])));
    assert.deepEqual(manifest.tenants.map((tenant) => [tenant.site_id, tenant.objects]), [
      [PILOT.site_id, 2],
      [DRAFT.site_id, 1],
      [EMPTY.site_id, 0],
    ]);
    assert.equal(manifest.counts.objects, 5);
    assert.equal(objects.length, 5, "the font bytes are in the bundle, not just listed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#2830 a manifest cannot pin a shared font on a site, or drop a brand object's site", async () => {
  const { root, env, spawn, fetchImpl, encryptionKey } = await backupScenario({
    tweak: ({ objects }) => {
      objects.buckets["sites-media-approved"].set(FONT_WOFF2, Buffer.from("woff2-bytes"));
    },
  });
  try {
    const result = await runBackup({ env, fetchImpl, spawn, now: NOW });
    const plain = join(root, "plain");
    await decryptBundle(result.bundle_path, plain, Buffer.from(encryptionKey, "base64"));
    const { manifest } = extractPlainBundle(plain, join(root, "extracted"), NOW);
    const pinned = structuredClone(manifest);
    pinned.objects.find((object) => object.key === FONT_WOFF2).site_id = PILOT.site_id;
    assert.throws(() => validateManifest(pinned, NOW), /OBJECT_SITE_PREFIX_MISMATCH/);
    const dropped = structuredClone(manifest);
    dropped.objects.find((object) => object.site_id === DRAFT.site_id).site_id = null;
    assert.throws(() => validateManifest(dropped, NOW), /OBJECT_SITE_PREFIX_MISMATCH/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#2830 a brand's protected artifact missing from storage fails the backup", async () => {
  const { root, env, spawn, fetchImpl } = await backupScenario({
    protection: {
      [PILOT.site_id]: [],
      [DRAFT.site_id]: [`publications/${DRAFT.site_id}/${PUBLICATION}/${HASH}.json`],
      [EMPTY.site_id]: [],
    },
  });
  try {
    await assert.rejects(() => runBackup({ env, fetchImpl, spawn, now: NOW }), /PROTECTED_OBJECT_MISSING/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#2830 evidence refuses a restore that came back with a different tenant count", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "issue-2830-evidence-")));
  try {
    const resultPath = join(root, "result.json");
    const restorePath = join(root, "restore.json");
    const write = (path, value) => writeFileSync(path, JSON.stringify(value));
    const result = {
      ok: true,
      code: "SITES_BACKUP_BUNDLE_READY",
      bundle_name: "immutable.msbk",
      bundle_path: join(root, "immutable.msbk"),
      bundle_sha256: "b".repeat(64),
      manifest_digest: "c".repeat(64),
      database_backup_verified_at: NOW.toISOString(),
      managed_backup_state: "current",
      object_manifest_verified_at: NOW.toISOString(),
      object_count: 1,
      object_bytes: 5,
      site_ids: [PILOT.site_id, DRAFT.site_id],
    };
    const restore = {
      ok: true,
      code: "SITES_RESTORE_DRILL_COMPLETE",
      restore_drill_verified_at: NOW.toISOString(),
      restore_drill_evidence_digest: "e".repeat(64),
      tenant_count: 2,
      document_count: 6,
      object_count: 1,
      object_bytes: 5,
    };
    write(resultPath, result);
    write(restorePath, { ...restore, tenant_count: 1 });
    const env = {
      SITES_BACKUP_RESULT_PATH: resultPath,
      SITES_BACKUP_BLOB_PATHNAME: "recovery/sites/immutable.msbk",
      SITES_BACKUP_INDEPENDENT_READBACK_SHA256: result.bundle_sha256,
      SITES_BACKUP_UPLOAD_VERIFIED_AT: NOW.toISOString(),
      SITES_BACKUP_RESTORE_RESULT_PATH: restorePath,
      SITES_PILOT_SITE_ID: PILOT.site_id,
      SITES_CORE_BASE_URL: "https://core.example.test",
      MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-key-v1",
      MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: Buffer.alloc(32, 9).toString("base64"),
    };
    const fetchImpl = async () => assert.fail("must not reach Core");
    await assert.rejects(() => recordBackupEvidence({ env, fetchImpl, now: NOW }), /RESTORE_RESULT_INVALID/);
    write(resultPath, { ...result, site_ids: [DRAFT.site_id] });
    write(restorePath, { ...restore, tenant_count: 1 });
    await assert.rejects(() => recordBackupEvidence({ env, fetchImpl, now: NOW }), /BACKUP_RESULT_INVALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const RETENTION_ENV = {
  SITES_PILOT_SITE_ID: PILOT.site_id,
  SITES_CMS_ORIGIN: "https://studio.sites.usemingla.com",
  MINGLA_CORE_TO_CMS_CURRENT_KID: "core-key-v1",
  MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: Buffer.alloc(32, 4).toString("base64"),
};
const SWEEP_OK = {
  ok: true,
  data: { protected_artifacts: 0, protected_media: 0, purged_artifacts: 0, purged_media: 0 },
};
const envelopeSite = (init) =>
  JSON.parse(Buffer.from(init.headers["x-mingla-sites-envelope"], "base64").toString("utf8"));

test("#2830 the retention site list is exact, pilot first, and never silently shrinks", () => {
  assert.deepEqual(retentionSiteIds(RETENTION_ENV), [PILOT.site_id]);
  assert.deepEqual(
    retentionSiteIds({
      ...RETENTION_ENV,
      SITES_RETENTION_SITE_IDS: `${DRAFT.site_id},${PILOT.site_id},${EMPTY.site_id}`,
    }),
    [PILOT.site_id, DRAFT.site_id, EMPTY.site_id],
  );
  for (const bad of [
    "",
    "not-a-uuid",
    DRAFT.site_id,
    `${PILOT.site_id},${PILOT.site_id}`,
    `${PILOT.site_id},`,
  ]) {
    assert.throws(
      () => retentionSiteIds({ ...RETENTION_ENV, SITES_RETENTION_SITE_IDS: bad }),
      /RETENTION_SITE_LIST_INVALID/,
      bad,
    );
  }
});

test("#2830 every site gets its own freshly signed sweep; one failure does not stop the rest", async () => {
  const signed = [];
  let tick = 0;
  const clock = () => new Date(NOW.getTime() + 120_000 * tick++);
  await assert.rejects(() => runAllSitesRetention({
    env: {
      ...RETENTION_ENV,
      SITES_RETENTION_SITE_IDS: `${PILOT.site_id},${DRAFT.site_id},${EMPTY.site_id}`,
    },
    clock,
    fetchImpl: async (_url, init) => {
      const envelope = envelopeSite(init);
      signed.push(envelope);
      return envelope.site_id === DRAFT.site_id
        ? Response.json({ ok: false }, { status: 500 })
        : Response.json(SWEEP_OK);
    },
  }), /RETENTION_SWEEP_FAILED/);
  assert.deepEqual(signed.map((envelope) => envelope.site_id), [
    PILOT.site_id, DRAFT.site_id, EMPTY.site_id,
  ]);
  assert.equal(new Set(signed.map((envelope) => envelope.operation_id)).size, 3);
  assert.equal(new Set(signed.map((envelope) => envelope.nonce)).size, 3);
  // Envelopes live 60 seconds: a slow first sweep must not expire the next one.
  assert.equal(new Set(signed.map((envelope) => envelope.issued_at)).size, 3);
});

test("#2830 the workflow hands the verified site list to the retention job", () => {
  const workflow = SOURCE([".github", "workflows", "sites-backup-restore.yml"].join("/"));
  assert.match(workflow, /backup_site_ids: \$\{\{ steps\.bundle\.outputs\.site_ids \}\}/);
  assert.match(
    workflow,
    /SITES_RETENTION_SITE_IDS: \$\{\{ needs\.backup_restore\.outputs\.backup_site_ids \}\}/,
  );
  assert.match(workflow, /site_ids=\$\{value\.site_ids\.join\(","\)\}/);
  for (const suite of [
    "issue_2830_multi_tenant_recovery.test.mjs",
    "issue_2830_multi_tenant_restore.pg17.test.mjs",
  ]) assert.ok(workflow.includes(`scripts/sites/__tests__/${suite}`), suite);
});

// The guard against recurrence. Behaviour above proves N tenants work today;
// this names the shapes that made the chain single-tenant, in every file of it.
const CHAIN = [
  "scripts/sites/backup-sites-cms.mjs",
  "scripts/sites/restore-sites-cms.mjs",
  "scripts/sites/run-sites-retention.mjs",
  "scripts/sites/lib/sites-ops.mjs",
  [".github", "workflows", "sites-backup-restore.yml"].join("/"),
];
const SINGLE_TENANT_SHAPES = [
  /\b(?:tenants|site_ids|tenant_rows)\.length\s*(?:!==|===|!=|==)\s*1\b/,
  /\b(?:inventory|before|after|counts|value)\.(?:tenants|site_ids|tenant_rows)\[0\]/,
  /\bsite_ids\[0\]/,
  /\bcounts\.tenants\s*(?:!==|===|!=|==)\s*1\b/,
  /\btenant_count\s*(?:!==|===|!=|==)\s*1\b/,
];

function singleTenantShapes(text) {
  return SINGLE_TENANT_SHAPES.filter((shape) => shape.test(text)).map(String);
}

test("#2830 nothing in the recovery chain requires exactly one tenant", () => {
  for (const path of CHAIN) assert.deepEqual(singleTenantShapes(SOURCE(path)), [], path);
  // Core's evidence check and its SQL set a floor on tenants, never an exact count.
  assert.match(
    SOURCE("supabase/functions/brand-site-cms-callback/index.ts"),
    /safeCount\(value\.tenant_count, 1\)/,
  );
  assert.match(
    SOURCE("supabase/migrations/20280119012829_issue_2829_sites_multi_brand_w1.sql"),
    /IF v_tenant_count < 1 OR v_document_count < 1/,
  );
});

test("#2830 the single-tenant guard sees the shapes it exists to catch", () => {
  for (const text of [
    "inventory.tenants.length !== 1",
    "inventory.tenants[0]?.site_id !== siteId",
    "counts.site_ids.length !== 1 || counts.site_ids[0] !== siteId",
  ]) assert.notDeepEqual(singleTenantShapes(text), [], text);
});
