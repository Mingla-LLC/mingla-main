import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  auditSecretBudget,
  DEFAULT_MANIFEST,
  validateManifest,
} from "./audit-supabase-secret-budget.mjs";

const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST, "utf8"));
const RETIRED_DIRECT_NAMES = [
  "CONTENT_SHARE_V1_CREATE_ENABLED",
  "NOTIFICATION_RECIPIENT_HMAC_SECRET",
  "PAYOUT_HOLD_ONBOARD_FLIP",
  "PAYOUT_RELEASE_EXECUTE",
  "SOURCE_REFUNDS_POST_DISABLED",
];
const PAYMENT_FIELDS = [
  "payout_hold_onboard_flip",
  "payout_release_execute",
  "source_refunds_post_disabled",
];
// [TEST-MOD-APPROVED #1770] Written reason: Seth authorized the standalone
// offering-invite token pepper. #2830's separately founder-approved bounded
// credential envelope occupies slot 88 under the unchanged 87/90 policy.

function record(name) {
  return manifest.secrets.find((entry) => entry.name === name);
}

test("issue #1436: final manifest is exactly 88 unique names with only approved slot 88", () => {
  const names = manifest.secrets.map((entry) => entry.name);
  assert.equal(manifest.rollout.live_audit_mode, "enforced");
  assert.equal(manifest.rollout.transition_stage, "complete");
  assert.equal(manifest.rollout.expected_user_managed_count, 88);
  assert.equal(manifest.policy.normal_ceiling, 87);
  assert.equal(manifest.policy.absolute_ceiling, 90);
  assert.equal(names.length, 88);
  assert.equal(new Set(names).size, 88);
  assert.equal(manifest.exceptions.length, 1);
  assert.equal(manifest.exceptions[0].issue, 2830);
  assert.equal(manifest.exceptions[0].expires_at, "2026-11-28T03:40:33Z");
  for (const name of RETIRED_DIRECT_NAMES) {
    assert.equal(names.includes(name), false, `${name} must remain absent`);
  }
  assert.deepEqual(validateManifest(manifest), []);
});

test("issue #1770: offering invite pepper is standalone and exactly scoped", () => {
  const pepper = record("OFFERING_INVITE_TOKEN_PEPPER");
  assert.ok(pepper);
  assert.equal(pepper.class, "cryptographic_secret");
  assert.equal(pepper.owner, "Platform Security");
  assert.equal(pepper.source_type, "secure_vault");
  assert.equal(pepper.issue, 1770);
  assert.deepEqual(pepper.readers, [
    "supabase/functions/_shared/offeringInviteToken.ts",
    "supabase/functions/marketing-send/index.ts",
    "supabase/functions/offering-invite-dispatch/index.ts",
  ]);
  assert.deepEqual(pepper.bundle_fields, []);
});

test("issue #1808: content-share creation authority is bundled and the direct name is retired", () => {
  const runtime = record("MINGLA_RUNTIME_CONFIG_JSON");
  assert.ok(runtime);
  assert.equal(
    runtime.bundle_fields.some((entry) =>
      entry.name === "content_share_v1_create_enabled" &&
      entry.owner === "Platform Engineering" &&
      entry.source_type === "approved_feature_operating_record"
    ),
    true,
  );
  assert.equal(
    manifest.secrets.some((entry) =>
      entry.name === "CONTENT_SHARE_V1_CREATE_ENABLED"
    ),
    false,
  );
});

test("issue #1436: the two existing bundles own all four retired authorities", () => {
  const delivery = record("MINGLA_DELIVERY_FLAGS_JSON");
  const conversion = record("AD_CONVERSION_TOKENS");
  assert.ok(delivery);
  assert.ok(conversion);

  const deliveryFields = new Set(
    delivery.bundle_fields.map((entry) => entry.name),
  );
  for (const field of PAYMENT_FIELDS) assert.equal(deliveryFields.has(field), true);
  for (
    const reader of [
      "supabase/functions/_shared/secretBundle.ts",
      "supabase/functions/_shared/sourceRefundControlPlane.ts",
      "supabase/functions/brand-stripe-onboard/index.ts",
      "supabase/functions/payout-release-sweep/index.ts",
    ]
  ) {
    assert.equal(delivery.readers.includes(reader), true);
  }

  assert.equal(
    conversion.bundle_fields.some((entry) =>
      entry.name === "NOTIFICATION_RECIPIENT_HMAC_SECRET" &&
      entry.owner === "Messaging Engineering" &&
      entry.source_type === "secure_vault"
    ),
    true,
  );
  for (
    const reader of [
      "supabase/functions/_shared/notificationRecipientHmac.ts",
      "supabase/functions/notify-dispatch/index.ts",
    ]
  ) {
    assert.equal(conversion.readers.includes(reader), true);
  }
});

test("issue #1436: exact live-set parity passes and any retired direct-name return fails closed", () => {
  const names = manifest.secrets.map((entry) => entry.name);
  const exact = auditSecretBudget({
    manifest,
    liveNames: names,
    liveAudit: true,
    nowMs: Date.parse("2026-08-03T00:00:00Z"),
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.count, 88);

  for (const retired of RETIRED_DIRECT_NAMES) {
    const restored = auditSecretBudget({
      manifest,
      liveNames: [...names, retired],
      liveAudit: true,
      nowMs: Date.parse("2026-08-03T00:00:00Z"),
    });
    assert.equal(restored.ok, false);
    assert.match(restored.failures.join("\n"), /unexpected_live_name/);
    assert.doesNotMatch(restored.failures.join("\n"), /approved_exception_required/);
  }
});
