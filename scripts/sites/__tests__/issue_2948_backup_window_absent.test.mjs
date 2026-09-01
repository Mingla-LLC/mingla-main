/**
 * Issue #2948 — `Private backup and isolated restore` was red on `main` and
 * had never been green, and the backup itself was fine.
 *
 * `validateManagementBackupResponse` recognised exactly one shape for "this
 * project has no PITR window": `physical_backup_data: null`. The Supabase
 * Management API returns `{}` for the Sites CMS project, which is neither
 * `null` nor a populated window, so it fell into the populated branch and
 * `exactKeys` rejected it with `BACKUP_RESPONSE_SCHEMA_INVALID`. Every
 * scheduled run therefore failed and signed-deactivated the Gogi pilot.
 *
 * The fixture below is the VERBATIM live response read from
 * `GET /v1/projects/jwwlbmwxmuljrxkrnxry/database/backups` on 2026-09-01, not a
 * shape invented to match the fix. That is the point: the assertion is pinned
 * to what the third party actually sends.
 *
 * Same bug class as #2944, one function above, and the reason the negative
 * cases below matter more than the positive one — this is a validator, and a
 * validator that stops refusing is worse than one that refuses too much.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { validateManagementBackupResponse } from "../lib/sites-ops.mjs";

/**
 * Captured live. `id` is a number, `inserted_at` an ISO string, and
 * `physical_backup_data` an EMPTY OBJECT alongside `pitr_enabled: false`.
 */
const LIVE_RESPONSE = Object.freeze({
  backups: [
    {
      id: 1545826964,
      inserted_at: "2026-09-01T11:42:20.730Z",
      is_physical_backup: true,
      status: "COMPLETED",
    },
    {
      id: 1541409241,
      inserted_at: "2026-09-01T04:25:10.748Z",
      is_physical_backup: true,
      status: "COMPLETED",
    },
  ],
  physical_backup_data: {},
  pitr_enabled: false,
  region: "us-east-2",
  walg_enabled: true,
});

const NOW = new Date("2026-09-01T12:30:00.000Z");
const PROJECT_CREATED_AT = "2026-09-01T04:19:25.460203Z";

function live(overrides = {}) {
  return JSON.parse(JSON.stringify({ ...LIVE_RESPONSE, ...overrides }));
}

test("#2948 the live Sites CMS backup response is accepted", () => {
  const result = validateManagementBackupResponse(live(), {
    now: NOW,
    projectCreatedAt: PROJECT_CREATED_AT,
  });
  assert.equal(result.state, "current");
  assert.equal(result.inserted_at, "2026-09-01T11:42:20.730Z");
  assert.equal(result.region, "us-east-2");
});

test("#2948 an empty window and a null window mean the same thing", () => {
  const empty = validateManagementBackupResponse(live(), {
    now: NOW,
    projectCreatedAt: PROJECT_CREATED_AT,
  });
  const nulled = validateManagementBackupResponse(
    live({ physical_backup_data: null }),
    { now: NOW, projectCreatedAt: PROJECT_CREATED_AT },
  );
  assert.deepEqual(empty, nulled);
});

test("#2948 an absent window still contradicts pitr_enabled: true", () => {
  for (const window of [{}, null]) {
    assert.throws(
      () =>
        validateManagementBackupResponse(
          live({ physical_backup_data: window, pitr_enabled: true }),
          { now: NOW, projectCreatedAt: PROJECT_CREATED_AT },
        ),
      /BACKUP_RESPONSE_SCHEMA_INVALID/,
      `pitr_enabled: true with ${JSON.stringify(window)} must stay a refusal`,
    );
  }
});

test("#2948 a populated window is still held to the exact documented keys", () => {
  const valid = {
    earliest_physical_backup_date_unix: 1756000000,
    latest_physical_backup_date_unix: 1756700000,
  };
  assert.equal(
    validateManagementBackupResponse(
      live({ physical_backup_data: valid, pitr_enabled: true }),
      { now: NOW, projectCreatedAt: PROJECT_CREATED_AT },
    ).state,
    "current",
  );
  for (
    const [label, window] of [
      ["missing a key", { earliest_physical_backup_date_unix: 1756000000 }],
      ["an extra key", { ...valid, undocumented: 1 }],
      ["a non-integer bound", { ...valid, latest_physical_backup_date_unix: 1.5 }],
      ["a string bound", { ...valid, earliest_physical_backup_date_unix: "1756000000" }],
    ]
  ) {
    assert.throws(
      () =>
        validateManagementBackupResponse(
          live({ physical_backup_data: window, pitr_enabled: true }),
          { now: NOW, projectCreatedAt: PROJECT_CREATED_AT },
        ),
      /BACKUP_RESPONSE_SCHEMA_INVALID/,
      `a window with ${label} must stay a refusal`,
    );
  }
});

test("#2948 emptiness is not a licence to accept any falsy-looking value", () => {
  for (const window of [[], "", 0, false, "{}", [1]]) {
    assert.throws(
      () =>
        validateManagementBackupResponse(
          live({ physical_backup_data: window }),
          { now: NOW, projectCreatedAt: PROJECT_CREATED_AT },
        ),
      /BACKUP_RESPONSE_SCHEMA_INVALID/,
      `${JSON.stringify(window)} is not an absent window`,
    );
  }
});

test("#2948 the rest of the backup contract is untouched by the window fix", () => {
  assert.throws(
    () =>
      validateManagementBackupResponse(live({ walg_enabled: false }), {
        now: NOW,
        projectCreatedAt: PROJECT_CREATED_AT,
      }),
    /DATABASE_BACKUP_WALG_DISABLED/,
  );
  assert.throws(
    () =>
      validateManagementBackupResponse({ ...live(), undocumented: true }, {
        now: NOW,
        projectCreatedAt: PROJECT_CREATED_AT,
      }),
    /BACKUP_RESPONSE_SCHEMA_INVALID/,
  );
  assert.throws(
    () =>
      validateManagementBackupResponse(
        live({
          backups: [
            { ...LIVE_RESPONSE.backups[0], status: "FAILED" },
            LIVE_RESPONSE.backups[1],
          ],
        }),
        { now: NOW, projectCreatedAt: PROJECT_CREATED_AT },
      ),
    /DATABASE_BACKUP_CURRENT_FAILED/,
  );
  assert.throws(
    () =>
      validateManagementBackupResponse(live(), {
        now: new Date("2026-09-05T12:30:00.000Z"),
        projectCreatedAt: PROJECT_CREATED_AT,
      }),
    /DATABASE_BACKUP_STALE/,
  );
});
