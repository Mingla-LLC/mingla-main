import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditSecretBudget,
  validateManifest,
} from "./audit-supabase-secret-budget.mjs";
import {
  assertLiveNameParity,
  ReadinessError,
} from "./preflight-function-secret-readiness.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, "supabase/secrets.manifest.json"), "utf8"),
);
const contract = JSON.parse(
  readFileSync(resolve(ROOT, "supabase/function-env.contract.json"), "utf8"),
);
const NAME = "STRIPE_RAK_PAYOUT_RELEASE_LIVE";
const projectRef = "gqnoajqerqhnvulmnyvv";
const exceptionWindowNow = Date.parse("2026-10-22T12:00:00Z");

test("#3645 happy: payout release RAK is the governed 90th name", () => {
  const names = manifest.secrets.map((record) => record.name);
  assert.equal(names.length, 90);
  assert.equal(new Set(names).size, 90);
  assert.equal(manifest.rollout.expected_user_managed_count, 90);
  assert.deepEqual(manifest.secrets.find((record) => record.name === NAME), {
    name: NAME,
    class: "restricted_api_key",
    owner: "Payments Engineering",
    backup_owner: "Platform Engineering",
    readers: ["supabase/functions/_shared/stripeMode.ts"],
    source_type: "stripe_api_keys_and_secure_vault",
    rotation_or_review_days: 30,
    expires_at: null,
    issue: 3645,
    status: "active",
    bundle_fields: [],
  });
  assert.deepEqual(contract.remediation.allowed_extra_live_names, []);
  assert.ok(
    contract.shared_modules["supabase/functions/_shared/stripeMode.ts"]
      .allowed_top_level.includes(NAME),
  );
  assert.deepEqual(validateManifest(manifest, exceptionWindowNow), []);
  const budget = auditSecretBudget({
    manifest,
    liveNames: names,
    nowMs: exceptionWindowNow,
    liveAudit: true,
  });
  assert.equal(budget.ok, true);
  assert.equal(budget.count, 90);
  assert.equal(budget.freeSlots, 10);
});

test("#3645 adversarial: an undeclared or 91st live name fails closed", () => {
  const names = manifest.secrets.map((record) => record.name);
  const withoutPayout = structuredClone(manifest);
  withoutPayout.secrets = withoutPayout.secrets.filter((record) =>
    record.name !== NAME
  );
  assert.throws(
    () =>
      assertLiveNameParity({
        contract,
        manifest: withoutPayout,
        liveNames: names,
        projectRef,
      }),
    (error) =>
      error instanceof ReadinessError &&
      error.code === "live_name_set_mismatch" &&
      error.details.includes(`unexpected:${NAME}`),
  );

  assert.throws(
    () =>
      assertLiveNameParity({
        contract,
        manifest,
        liveNames: [...names, "UNAPPROVED_NINETY_FIRST_NAME"],
        projectRef,
      }),
    (error) =>
      error instanceof ReadinessError &&
      error.code === "live_name_set_mismatch" &&
      error.details.includes("unexpected:UNAPPROVED_NINETY_FIRST_NAME"),
  );
  const over = auditSecretBudget({
    manifest,
    liveNames: [...names, "UNAPPROVED_NINETY_FIRST_NAME"],
    nowMs: exceptionWindowNow,
  });
  assert.equal(over.ok, false);
  assert.match(over.failures.join("\n"), /absolute_ceiling_exceeded/);
});
