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
const exceptionWindowNow = Date.parse("2026-08-30T04:00:00Z");
// [TEST-MOD-APPROVED #1770] Written reason: Seth authorized one standalone
// invite pepper, moving the exact governed live set from 86 to 87 names.
// [TEST-MOD-APPROVED #2830] Founder-approved slot 88 is now the bounded Sites
// credential envelope, with one current exception through 2026-11-28.
// [TEST-MOD-APPROVED #3645] Seth approved STRIPE_RAK_PAYOUT_RELEASE_LIVE as
// the 90th and final absolute-ceiling name; the 91st-name fixture stays fatal.
// [TEST-MOD-APPROVED #4276] #4276 [secret count 91 approved by Seth]: GOOGLE_SEEDING_API_KEY is the
// 91st name and the absolute ceiling is 91; the 92nd-name fixture stays fatal.

test("issue #1203 HP-4: target manifest is names-only, complete, and green at 91", () => {
  assert.equal(targetNames.length, 91);
  assert.deepEqual(validateManifest(manifest, exceptionWindowNow), []);
  const result = auditSecretBudget({
    manifest,
    liveNames: targetNames,
    nowMs: exceptionWindowNow,
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 91);
  assert.equal(result.freeSlots, 9);
  assert.deepEqual(result.failures, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /issue=2830/);
});

test("issue #1203: 91 requires a current approved exception and 92 always fails", () => {
  const extraNames = Array.from(
    { length: 2 },
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
    expires_at: "2026-08-31T00:00:00Z",
    issue: 1203,
    status: "temporary",
    bundle_fields: [],
  };
  const manifest91 = manifest;
  const withoutException = auditSecretBudget({
    manifest: { ...manifest91, exceptions: [] },
    liveNames: targetNames,
    nowMs: exceptionWindowNow,
  });
  assert.equal(withoutException.ok, false);
  assert.match(withoutException.failures.join("\n"), /approved_exception_required/);

  const withException = auditSecretBudget({
    manifest: {
      ...manifest91,
      exceptions: [{
        issue: 1430,
        owner: "Synthetic Owner",
        approved_by: "Synthetic Approver",
        expires_at: "2026-08-31T00:00:00Z",
      }],
    },
    liveNames: targetNames,
    nowMs: exceptionWindowNow,
  });
  assert.equal(withException.ok, true);
  assert.equal(withException.warnings.length, 1);

  const names92 = [
    ...targetNames,
    extraNames[0],
  ];
  const manifest92 = {
    ...manifest,
    exceptions: [{
      issue: 1203,
      owner: "Synthetic Owner",
      approved_by: "Synthetic Approver",
      expires_at: "2026-08-31T00:00:00Z",
    }],
    secrets: [
      ...manifest.secrets,
      { ...extraRecord, name: extraNames[0] },
    ],
  };
  const hardFail = auditSecretBudget({
    manifest: manifest92,
    liveNames: names92,
    nowMs: exceptionWindowNow,
  });
  assert.equal(hardFail.ok, false);
  assert.match(hardFail.failures.join("\n"), /absolute_ceiling_exceeded/);
});
