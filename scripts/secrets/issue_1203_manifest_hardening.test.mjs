import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  auditSecretBudget,
  DEFAULT_MANIFEST,
  validateManifest,
} from "./audit-supabase-secret-budget.mjs";

const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST, "utf8"));
const exceptionWindowNow = Date.parse("2026-08-01T00:00:00Z");
// [TEST-MOD-APPROVED #1770] Written reason: Seth authorized one standalone
// invite pepper moved final-state fixtures to 87 names. #2830's independently
// approved Sites credential envelope occupies bounded slot 88.
// [TEST-MOD-APPROVED #3980] #3980 [secret count 89 approved by Seth]: SPRINT_ROLLOVER_TOKEN joins the
// post-rollout names the historical fixture removes, and the enforced target
// is the approved 90-name manifest.
// [TEST-MOD-APPROVED #3645] The payout-release RAK fills the 90th and final
// slot; historical transition fixtures remove it with the other later names.

function clone(value) {
  return structuredClone(value);
}

test("issue #1203: manifest rejects malformed metadata and non-consumer reader paths", () => {
  const malformed = clone(manifest);
  malformed.secrets[0].class = "";
  malformed.secrets[0].owner = 42;
  malformed.secrets[0].issue = "1203";
  malformed.secrets[0].readers = ["missing/consumer.ts"];
  const bundle = malformed.secrets.find((record) =>
    record.name === "MINGLA_PAYMENT_MODES_JSON"
  );
  bundle.bundle_fields[0].owner = "";

  const failures = validateManifest(malformed);
  assert.ok(failures.includes("AD_CONVERSION_TOKENS:class_invalid"));
  assert.ok(failures.includes("AD_CONVERSION_TOKENS:owner_missing"));
  assert.ok(failures.includes("AD_CONVERSION_TOKENS:issue_invalid"));
  assert.ok(
    failures.includes("AD_CONVERSION_TOKENS:reader_path_missing:missing/consumer.ts"),
  );
  assert.ok(
    failures.includes("MINGLA_PAYMENT_MODES_JSON:bundle_field_metadata_invalid"),
  );
});

test("issue #1203: a pre-rollout live audit is exact and drift remains fail-closed", () => {
  // #1203 rollout completed → the on-disk manifest is now "enforced"; force a
  // transition clone here so this pre-rollout scenario stays valid independent of
  // the shipped mode (mirrors the enforced test's clone below).
  const transition = clone(manifest);
  transition.secrets = transition.secrets.filter((record) =>
    ![
      "OFFERING_INVITE_TOKEN_PEPPER",
      "MINGLA_SITES_SECURITY_JSON",
      "SPRINT_ROLLOVER_TOKEN",
      "STRIPE_RAK_PAYOUT_RELEASE_LIVE",
    ].includes(
      record.name,
    )
  );
  transition.rollout.pending_bundle_names =
    transition.rollout.pending_bundle_names.filter((name) =>
      name !== "MINGLA_SITES_SECURITY_JSON"
    );
  transition.rollout.live_audit_mode = "transition";
  transition.rollout.transition_stage = "pre_rollout";
  const target = transition.secrets.map((record) => record.name);
  const pending = new Set(transition.rollout.pending_bundle_names);
  assert.equal(target.length, 86);
  // [TEST-MOD-APPROVED #3720] GOOGLE_CALENDAR_KEYS now has governed field
  // ownership, so the historical transition fixture derives one more bundle
  // and one fewer direct-name-era slot without changing the enforced 88 names.
  assert.equal(pending.size, 7);
  assert.equal(transition.rollout.legacy_names.length, 20);
  const preRolloutNames = [
    ...target.filter((name) => !pending.has(name)),
    ...transition.rollout.legacy_names,
  ];
  for (const legacyName of transition.rollout.legacy_names) {
    assert.equal(
      preRolloutNames.filter((name) => name === legacyName).length,
      1,
    );
  }
  assert.equal(preRolloutNames.length, 99);
  assert.ok(preRolloutNames.length <= 99);
  transition.rollout.expected_user_managed_count = 99;
  const expected = auditSecretBudget({
    manifest: transition,
    liveNames: preRolloutNames,
    liveAudit: true,
    nowMs: exceptionWindowNow,
  });
  assert.equal(expected.ok, true);
  assert.equal(expected.count, preRolloutNames.length);
  assert.match(expected.warnings.join("\n"), /secret_budget_transition/);

  const drifted = auditSecretBudget({
    manifest: transition,
    liveNames: preRolloutNames.slice(1),
    liveAudit: true,
    nowMs: exceptionWindowNow,
  });
  assert.equal(drifted.ok, false);
  assert.match(drifted.failures.join("\n"), /missing_live_name/);
  assert.match(drifted.failures.join("\n"), /transition_count/);
});

test("issue #1203: enforced live audit uses only the approved 90-name target", () => {
  const enforced = clone(manifest);
  enforced.rollout.live_audit_mode = "enforced";
  enforced.rollout.expected_user_managed_count = 90;
  const target = enforced.secrets.map((record) => record.name);
  assert.equal(target.length, 90);
  assert.equal(
    auditSecretBudget({
      manifest: enforced,
      liveNames: target,
      liveAudit: true,
      nowMs: exceptionWindowNow,
    }).ok,
    true,
  );
  const legacyLeak = auditSecretBudget({
    manifest: enforced,
    liveNames: [...target, enforced.rollout.legacy_names[0]],
    liveAudit: true,
    nowMs: exceptionWindowNow,
  });
  assert.equal(legacyLeak.ok, false);
  assert.match(legacyLeak.failures.join("\n"), /unexpected_live_name/);
});
