/**
 * Issue #2830 — Supabase promises daily backups, not an exact execution time.
 *
 * The live 2026-10-16 Management API response carried seven completed backups
 * on seven consecutive UTC dates. Their timestamps spanned about 141.5 hours,
 * not exactly 144, because the daily provider job ran at different times. The
 * old wall-clock comparison therefore deactivated a healthy pilot even though
 * every required daily recovery point existed.
 */

// MINGLA-INVARIANT: I-PROPOSED-2830-SITES-BACKUP-CONSECUTIVE-UTC-DAYS | issue #2830 | Managed backup retention is proven only by seven consecutive UTC backup dates ending at the latest completed backup; normal execution-time drift within those dates cannot invalidate a complete daily set.

import assert from "node:assert/strict";
import test from "node:test";

import { validateManagementBackupResponse } from "../lib/sites-ops.mjs";

const NOW = new Date("2026-10-16T07:43:39.000Z");
const PROJECT_CREATED_AT = "2026-09-01T04:19:25.460Z";

const LIVE_COMPLETED_BACKUPS = Object.freeze([
  [1972021346, "2026-10-15T09:54:17.229Z"],
  [1963396259, "2026-10-14T13:34:50.141Z"],
  [1953613856, "2026-10-13T12:23:53.174Z"],
  [1943974767, "2026-10-12T12:29:36.456Z"],
  [1934320277, "2026-10-11T12:16:53.799Z"],
  [1924809340, "2026-10-10T12:34:03.636Z"],
  [1915185534, "2026-10-09T12:25:52.995Z"],
].map(([id, inserted_at]) => ({
  id,
  inserted_at,
  is_physical_backup: true,
  status: "COMPLETED",
})));

function response(backups = LIVE_COMPLETED_BACKUPS) {
  return {
    backups: backups.map((backup) => ({ ...backup })),
    physical_backup_data: {},
    pitr_enabled: false,
    region: "us-east-2",
    walg_enabled: true,
  };
}

function validate(backups = LIVE_COMPLETED_BACKUPS) {
  return validateManagementBackupResponse(response(backups), {
    now: NOW,
    projectCreatedAt: PROJECT_CREATED_AT,
  });
}

test("#2830 accepts the live seven-day backup set despite execution-time drift", () => {
  const result = validate();
  assert.equal(result.state, "retention_proven");
  assert.equal(result.retention_days, 7);
  assert.equal(result.inserted_at, LIVE_COMPLETED_BACKUPS[0].inserted_at);

  const newest = Date.parse(LIVE_COMPLETED_BACKUPS[0].inserted_at);
  const oldest = Date.parse(LIVE_COMPLETED_BACKUPS.at(-1).inserted_at);
  assert.ok(newest - oldest < 6 * 24 * 60 * 60 * 1000, "fixture reproduces the old false refusal");
});

test("#2830 still rejects fewer than seven daily recovery points", () => {
  assert.throws(
    () => validate(LIVE_COMPLETED_BACKUPS.slice(0, 6)),
    /DATABASE_BACKUP_RETENTION_UNPROVEN/,
  );
});

test("#2830 still rejects a gap hidden by seven distinct dates", () => {
  const withGapAndOlderPoint = [
    ...LIVE_COMPLETED_BACKUPS.slice(0, 3),
    ...LIVE_COMPLETED_BACKUPS.slice(4),
    {
      ...LIVE_COMPLETED_BACKUPS.at(-1),
      id: 1900000000,
      inserted_at: "2026-10-08T12:25:52.995Z",
    },
  ];
  assert.equal(
    new Set(withGapAndOlderPoint.map((backup) => backup.inserted_at.slice(0, 10))).size,
    7,
  );
  assert.throws(
    () => validate(withGapAndOlderPoint),
    /DATABASE_BACKUP_RETENTION_UNPROVEN/,
  );
});

test("#2830 still rejects duplicate snapshots that do not cover seven dates", () => {
  const duplicateLatest = [
    ...LIVE_COMPLETED_BACKUPS.slice(0, 6),
    {
      ...LIVE_COMPLETED_BACKUPS[0],
      id: 1972021347,
      inserted_at: "2026-10-15T10:54:17.229Z",
    },
  ];
  assert.throws(
    () => validate(duplicateLatest),
    /DATABASE_BACKUP_RETENTION_UNPROVEN/,
  );
});
