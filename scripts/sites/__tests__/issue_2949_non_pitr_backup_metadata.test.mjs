import assert from "node:assert/strict";
import test from "node:test";

import { validateManagementBackupResponse } from "../lib/sites-ops.mjs";

const NOW = new Date("2026-09-01T12:40:00.000Z");
const PROJECT_CREATED_AT = "2026-09-01T04:19:25.460203Z";

function liveBackup(overrides = {}) {
  return {
    region: "us-east-2",
    pitr_enabled: false,
    walg_enabled: true,
    backups: [
      {
        id: 2,
        inserted_at: "2026-09-01T07:00:00.000Z",
        is_physical_backup: true,
        status: "COMPLETED",
      },
      {
        id: 1,
        inserted_at: "2026-08-31T07:00:00.000Z",
        is_physical_backup: true,
        status: "COMPLETED",
      },
    ],
    physical_backup_data: {},
    ...overrides,
  };
}

test("#2949 accepts Supabase's exact empty metadata object when PITR is off", () => {
  const result = validateManagementBackupResponse(liveBackup(), {
    now: NOW,
    projectCreatedAt: PROJECT_CREATED_AT,
  });
  assert.equal(result.state, "current");
  assert.equal(result.region, "us-east-2");
});

test("#2949 keeps empty non-PITR metadata fail closed", () => {
  for (const backup of [
    liveBackup({ physical_backup_data: { undocumented: true } }),
    liveBackup({ pitr_enabled: true }),
    liveBackup({ physical_backup_data: [] }),
  ]) {
    assert.throws(
      () => validateManagementBackupResponse(backup, {
        now: NOW,
        projectCreatedAt: PROJECT_CREATED_AT,
      }),
      /BACKUP_RESPONSE_SCHEMA_INVALID/,
    );
  }
});
