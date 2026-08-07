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
const exceptionWindowNow = Date.parse("2026-08-01T00:00:00Z");
// [TEST-MOD-APPROVED #1615] Written reason: Seth authorized one standalone
// proxy credential, moving the exact governed live set from 85 to 86 names.

test("issue #1203 HP-4: target manifest is names-only, complete, and green at 86", () => {
  assert.equal(targetNames.length, 86);
  assert.deepEqual(validateManifest(manifest, exceptionWindowNow), []);
  const result = auditSecretBudget({
    manifest,
    liveNames: targetNames,
    nowMs: exceptionWindowNow,
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 86);
  assert.equal(result.freeSlots, 14);
  assert.deepEqual(result.failures, []);
  assert.equal(result.warnings.length, 0);
});

test("issue #1203: 90 requires a current approved exception and 91 always fails", () => {
  const extraNames = Array.from(
    { length: 5 },
    (_, index) => `SYNTHETIC_TEMPORARY_NAME_${index + 1}`,
  );
  const extraRecord = {
    name: extraNames[0],
    class: "temporary",
    owner: "Synthetic Owner",
    backup_owner: "Synthetic Backup",
    readers: ["synthetic/reader"],
    source_type: "synthetic_fixture",
    rotation_or_review_days: 1,
    expires_at: "2026-08-02T00:00:00Z",
    issue: 1203,
    status: "temporary",
    bundle_fields: [],
  };
  const manifest90 = {
    ...manifest,
    secrets: [
      ...manifest.secrets,
      ...extraNames.slice(0, 4).map((name) => ({ ...extraRecord, name })),
    ],
  };
  const withoutException = auditSecretBudget({
    manifest: { ...manifest90, exceptions: [] },
    liveNames: [...targetNames, ...extraNames.slice(0, 4)],
    nowMs: exceptionWindowNow,
  });
  assert.equal(withoutException.ok, false);
  assert.match(withoutException.failures.join("\n"), /approved_exception_required/);

  const withException = auditSecretBudget({
    manifest: {
      ...manifest90,
      exceptions: [{
        issue: 1430,
        owner: "Synthetic Owner",
        approved_by: "Synthetic Approver",
        expires_at: "2026-08-02T00:00:00Z",
      }],
    },
    liveNames: [...targetNames, ...extraNames.slice(0, 4)],
    nowMs: exceptionWindowNow,
  });
  assert.equal(withException.ok, true);
  assert.equal(withException.warnings.length, 1);

  const names91 = [
    ...targetNames,
    ...extraNames,
  ];
  const manifest91 = {
    ...manifest,
    exceptions: [{
      issue: 1203,
      owner: "Synthetic Owner",
      approved_by: "Synthetic Approver",
      expires_at: "2026-08-02T00:00:00Z",
    }],
    secrets: [
      ...manifest.secrets,
      ...extraNames.map((name) => ({
        ...extraRecord,
        name,
      })),
    ],
  };
  const hardFail = auditSecretBudget({
    manifest: manifest91,
    liveNames: names91,
    nowMs: exceptionWindowNow,
  });
  assert.equal(hardFail.ok, false);
  assert.match(hardFail.failures.join("\n"), /absolute_ceiling_exceeded/);
});
