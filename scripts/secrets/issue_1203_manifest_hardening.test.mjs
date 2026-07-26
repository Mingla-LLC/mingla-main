import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  auditSecretBudget,
  DEFAULT_MANIFEST,
  validateManifest,
} from "./audit-supabase-secret-budget.mjs";

const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST, "utf8"));

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
  transition.rollout.live_audit_mode = "transition";
  transition.rollout.transition_stage = "pre_rollout";
  transition.rollout.expected_user_managed_count = 100;
  const target = transition.secrets.map((record) => record.name);
  const pending = new Set(transition.rollout.pending_bundle_names);
  const preRolloutNames = [
    ...target.filter((name) => !pending.has(name)),
    ...transition.rollout.legacy_names,
  ];
  const expected = auditSecretBudget({
    manifest: transition,
    liveNames: preRolloutNames,
    liveAudit: true,
  });
  assert.equal(expected.ok, true);
  assert.equal(expected.count, 100);
  assert.match(expected.warnings.join("\n"), /secret_budget_transition/);

  const drifted = auditSecretBudget({
    manifest: transition,
    liveNames: preRolloutNames.slice(1),
    liveAudit: true,
  });
  assert.equal(drifted.ok, false);
  assert.match(drifted.failures.join("\n"), /missing_live_name/);
  assert.match(drifted.failures.join("\n"), /transition_count/);
});

test("issue #1203: enforced live audit uses only the final 85-name target", () => {
  const enforced = clone(manifest);
  enforced.rollout.live_audit_mode = "enforced";
  enforced.rollout.expected_user_managed_count = 85;
  const target = enforced.secrets.map((record) => record.name);
  assert.equal(
    auditSecretBudget({
      manifest: enforced,
      liveNames: target,
      liveAudit: true,
    }).ok,
    true,
  );
  const legacyLeak = auditSecretBudget({
    manifest: enforced,
    liveNames: [...target, enforced.rollout.legacy_names[0]],
    liveAudit: true,
  });
  assert.equal(legacyLeak.ok, false);
  assert.match(legacyLeak.failures.join("\n"), /unexpected_live_name/);
});
