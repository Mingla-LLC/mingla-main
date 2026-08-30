import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  auditSecretBudget,
  DEFAULT_MANIFEST,
} from "./audit-supabase-secret-budget.mjs";

const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST, "utf8"));
const expectedNames = manifest.secrets.map((entry) => entry.name);
const RETIRED_DIRECT_NAMES = [
  "NOTIFICATION_RECIPIENT_HMAC_SECRET",
  "PAYOUT_HOLD_ONBOARD_FLIP",
  "PAYOUT_RELEASE_EXECUTE",
  "SOURCE_REFUNDS_POST_DISABLED",
];
// [TEST-MOD-APPROVED #1770] Written reason: the approved standalone invite
// pepper raised parity to 87; #2830's approved Sites envelope occupies slot 88.

test("issue #1436 adversarial: a same-count direct-name substitution cannot bypass exact-set parity", () => {
  assert.equal(expectedNames.length, 88);

  for (const retiredName of RETIRED_DIRECT_NAMES) {
    const substitutedNames = expectedNames
      .filter((name) => name !== "MAPBOX_ACCESS_TOKEN")
      .concat(retiredName);
    assert.equal(substitutedNames.length, 88);

    const result = auditSecretBudget({
      manifest,
      liveNames: substitutedNames,
      liveAudit: true,
      nowMs: Date.parse("2026-08-03T00:00:00Z"),
    });

    assert.equal(result.ok, false, `${retiredName} substitution must fail`);
    assert.match(result.failures.join("\n"), /MAPBOX_ACCESS_TOKEN:missing_live_name/);
    assert.match(
      result.failures.join("\n"),
      new RegExp(`${retiredName}:unexpected_live_name`),
    );
  }
});
