import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  auditSecretBudget,
  DEFAULT_MANIFEST,
  validateManifest,
} from "./audit-supabase-secret-budget.mjs";

const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST, "utf8"));
const targetNames = manifest.secrets.map((record) => record.name);

test("issue #1203 HP-4: target manifest is names-only, complete, and green at 85", () => {
  assert.equal(targetNames.length, 85);
  assert.deepEqual(validateManifest(manifest, Date.parse("2026-07-24T00:00:00Z")), []);
  const result = auditSecretBudget({
    manifest,
    liveNames: targetNames,
    nowMs: Date.parse("2026-07-24T00:00:00Z"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 85);
  assert.equal(result.freeSlots, 15);
  assert.deepEqual(result.failures, []);
});

test("issue #1203: 86 requires a current approved exception and 91 always fails", () => {
  const extraName = "SYNTHETIC_TEMPORARY_NAME";
  const extraRecord = {
    name: extraName,
    class: "temporary",
    owner: "Synthetic Owner",
    backup_owner: "Synthetic Backup",
    readers: ["synthetic/reader"],
    source_type: "synthetic_fixture",
    rotation_or_review_days: 1,
    expires_at: "2026-07-26T00:00:00Z",
    issue: 1203,
    status: "temporary",
    bundle_fields: [],
  };
  const manifest86 = {
    ...manifest,
    secrets: [...manifest.secrets, extraRecord],
  };
  const withoutException = auditSecretBudget({
    manifest: manifest86,
    liveNames: [...targetNames, extraName],
    nowMs: Date.parse("2026-07-24T00:00:00Z"),
  });
  assert.equal(withoutException.ok, false);
  assert.match(withoutException.failures.join("\n"), /approved_exception_required/);

  const withException = auditSecretBudget({
    manifest: {
      ...manifest86,
      exceptions: [{
        issue: 1203,
        owner: "Synthetic Owner",
        approved_by: "Synthetic Approver",
        expires_at: "2026-07-25T00:00:00Z",
      }],
    },
    liveNames: [...targetNames, extraName],
    nowMs: Date.parse("2026-07-24T00:00:00Z"),
  });
  assert.equal(withException.ok, true);
  assert.equal(withException.warnings.length, 1);

  const names91 = [
    ...targetNames,
    ...Array.from({ length: 6 }, (_, index) => `SYNTHETIC_TEMP_${index}`),
  ];
  const manifest91 = {
    ...manifest,
    exceptions: [{
      issue: 1203,
      owner: "Synthetic Owner",
      approved_by: "Synthetic Approver",
      expires_at: "2026-07-25T00:00:00Z",
    }],
    secrets: [
      ...manifest.secrets,
      ...names91.slice(85).map((name) => ({ ...extraRecord, name })),
    ],
  };
  const hardFail = auditSecretBudget({
    manifest: manifest91,
    liveNames: names91,
    nowMs: Date.parse("2026-07-24T00:00:00Z"),
  });
  assert.equal(hardFail.ok, false);
  assert.match(hardFail.failures.join("\n"), /absolute_ceiling_exceeded/);
});
