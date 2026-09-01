/**
 * Issue #2948 — the readiness readback is compared as an instant AT THE CALL
 * SITE, not only in the helper.
 *
 * #2985/#2987 fixed the comparison on `main` and proved
 * `timestampsRepresentSameInstant` directly, plus a structural check that both
 * scripts call it. This suite covers the gap those leave: it drives
 * `recordBackupEvidence` end to end with a readback in the PostgreSQL spelling
 * and asserts the wiring accepts it — and still refuses everything it should.
 *
 * That gap is worth closing because the fixture right next door is what let the
 * bug ship. The #2893 harness returns `NOW.toISOString()` as core's readback:
 * it models what JavaScript SENDS, not what the database RETURNS, so the check
 * could not fail. That is the #2113 shape. Every readback fixture below is in
 * the PostgreSQL spelling on purpose.
 *
 * Read from production on 2026-09-01, from the row the "failed" run wrote:
 *   stored + rendered by jsonb_build_object : "2026-09-01T14:40:42.133+00:00"
 *   sent by restore-sites-cms.mjs           : "2026-09-01T14:40:42.133Z"
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recordBackupEvidence } from "../backup-sites-cms.mjs";
import { stableJson } from "../lib/sites-ops.mjs";

const SITE_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = new Date("2026-09-01T08:00:00.000Z");


/** How PostgreSQL renders a `timestamptz` inside `jsonb_build_object`. */
function asPostgresRenders(iso) {
  return String(iso).replace(/Z$/, "+00:00");
}

function harness(readiness) {
  const root = mkdtempSync(join(tmpdir(), "issue-2948-readback-"));
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
    GITHUB_RUN_ID: "2948001",
    SITES_CORE_BASE_URL: "https://core.example.test",
    MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-key-v1",
    MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: Buffer.alloc(32, 9).toString("base64"),
  };
  const fetchImpl = async () =>
    Response.json({
      ok: true,
      data: {
        site_id: SITE_ID,
        evidence_kind: "nightly_backup",
        accepted_at: NOW.toISOString(),
        readiness: {
          backup_retention_days: 7,
          restore_drill_verified_at: null,
          restore_drill_evidence_digest: null,
          ...readiness,
        },
      },
    });
  return { root, env, fetchImpl };
}

test("#2948 the PostgreSQL spelling of the instant we sent is accepted", async () => {
  const { root, env, fetchImpl } = harness({
    database_backup_verified_at: asPostgresRenders(NOW.toISOString()),
    object_manifest_verified_at: asPostgresRenders(NOW.toISOString()),
  });
  try {
    const readiness = await recordBackupEvidence({ env, fetchImpl, now: NOW });
    assert.equal(readiness.readiness.backup_retention_days, 7);
    assert.match(readiness.readiness.database_backup_verified_at, /\+00:00$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#2948 a DIFFERENT instant in the same spelling is still a refusal", async () => {
  for (
    const drift of [
      { database_backup_verified_at: "2026-09-01T08:00:00.001+00:00" },
      { object_manifest_verified_at: "2026-09-01T07:59:59.999+00:00" },
      { database_backup_verified_at: "2026-09-02T08:00:00.000+00:00" },
    ]
  ) {
    const { root, env, fetchImpl } = harness({
      database_backup_verified_at: asPostgresRenders(NOW.toISOString()),
      object_manifest_verified_at: asPostgresRenders(NOW.toISOString()),
      ...drift,
    });
    try {
      await assert.rejects(
        () => recordBackupEvidence({ env, fetchImpl, now: NOW }),
        /CORE_READINESS_READBACK_MISMATCH/,
        `a drifted instant must not be accepted: ${JSON.stringify(drift)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("#2948 evidence core did not persist is still a refusal", async () => {
  for (
    const absent of [
      { database_backup_verified_at: null },
      { object_manifest_verified_at: null },
    ]
  ) {
    const { root, env, fetchImpl } = harness({
      database_backup_verified_at: asPostgresRenders(NOW.toISOString()),
      object_manifest_verified_at: asPostgresRenders(NOW.toISOString()),
      ...absent,
    });
    try {
      await assert.rejects(
        () => recordBackupEvidence({ env, fetchImpl, now: NOW }),
        /CORE_READINESS_/,
        `an unpersisted field must not be accepted: ${JSON.stringify(absent)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("#2948 the retention-day count keeps its exact comparison", async () => {
  const { root, env, fetchImpl } = harness({
    backup_retention_days: 8,
    database_backup_verified_at: asPostgresRenders(NOW.toISOString()),
    object_manifest_verified_at: asPostgresRenders(NOW.toISOString()),
  });
  try {
    await assert.rejects(
      () => recordBackupEvidence({ env, fetchImpl, now: NOW }),
      /CORE_READINESS_READBACK_MISMATCH/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
