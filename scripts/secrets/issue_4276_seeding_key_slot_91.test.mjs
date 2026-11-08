/**
 * #4276 — GOOGLE_SEEDING_API_KEY is the approved 91st user-managed edge secret.
 *
 * #4276: count 91 approved by Seth Ogieva on 2026-11-07 in chat, together with
 * raising the absolute ceiling from 90 to 91. The normal ceiling stays 87 and
 * the #2830 exception stays the sole exception. City seeding and photo
 * downloads read the key only through supabase/functions/_shared/seedingGoogleKey.ts
 * and fall back to GOOGLE_MAPS_API_KEY when it is unset, so it is optional in
 * both functions' contract entries. Names only: no value appears here.
 */

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
const NAME = "GOOGLE_SEEDING_API_KEY";
const READER = "supabase/functions/_shared/seedingGoogleKey.ts";
const projectRef = "gqnoajqerqhnvulmnyvv";
const exceptionWindowNow = Date.parse("2026-11-07T12:00:00Z");

test("#4276 happy: the seeding key is the governed 91st name under 87/91 ceilings", () => {
  const names = manifest.secrets.map((record) => record.name);
  assert.equal(names.length, 91);
  assert.equal(new Set(names).size, 91);
  assert.equal(manifest.rollout.expected_user_managed_count, 91);
  assert.equal(manifest.policy.normal_ceiling, 87);
  assert.equal(manifest.policy.absolute_ceiling, 91);
  assert.ok(names.includes("STRIPE_RAK_PAYOUT_RELEASE_LIVE"));
  assert.deepEqual(manifest.secrets.find((record) => record.name === NAME), {
    name: NAME,
    class: "credential",
    owner: "Location Engineering",
    backup_owner: "Platform Engineering",
    readers: [READER],
    source_type: "provider_dashboard_and_secure_vault",
    rotation_or_review_days: 30,
    expires_at: null,
    issue: 4276,
    status: "active",
    bundle_fields: [],
  });
  // The #2830 record stays the sole exception, unchanged.
  assert.equal(manifest.exceptions.length, 1);
  assert.equal(manifest.exceptions[0].issue, 2830);
  assert.equal(manifest.exceptions[0].expires_at, "2026-11-28T03:40:33Z");
  assert.deepEqual(contract.remediation.allowed_extra_live_names, []);

  for (const fn of ["admin-seed-places", "backfill-place-photos"]) {
    const policy = contract.functions[fn];
    assert.deepEqual(policy.optional_top_level, [NAME], fn);
    assert.deepEqual(policy.required_top_level, ["GOOGLE_MAPS_API_KEY"], fn);
    assert.deepEqual(policy.required_bundle_fields, {}, fn);
  }
  const reader = readFileSync(resolve(ROOT, READER), "utf8");
  assert.ok(reader.includes(`Deno.env.get("${NAME}")`));
  assert.ok(reader.includes('Deno.env.get("GOOGLE_MAPS_API_KEY")'));

  assert.deepEqual(validateManifest(manifest, exceptionWindowNow), []);
  const budget = auditSecretBudget({
    manifest,
    liveNames: names,
    nowMs: exceptionWindowNow,
    liveAudit: true,
  });
  assert.equal(budget.ok, true);
  assert.equal(budget.count, 91);
  assert.equal(budget.freeSlots, 9);
  assert.match(budget.warnings.join("\n"), /issue=2830/);

  const parity = assertLiveNameParity({
    contract,
    manifest,
    liveNames: names,
    projectRef,
  });
  assert.equal(parity.liveUserManaged.length, 91);
  const remediation = assertLiveNameParity({
    contract,
    manifest,
    liveNames: names,
    projectRef,
    mode: "issue-2241-remediation",
  });
  assert.equal(remediation.liveUserManaged.length, 91);
});

test("#4276 adversarial: an undeclared seeding key or a 92nd live name fails closed", () => {
  const names = manifest.secrets.map((record) => record.name);
  const withoutSeeding = structuredClone(manifest);
  withoutSeeding.secrets = withoutSeeding.secrets.filter((record) =>
    record.name !== NAME
  );
  assert.throws(
    () =>
      assertLiveNameParity({
        contract,
        manifest: withoutSeeding,
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
        liveNames: [...names, "UNAPPROVED_NINETY_SECOND_NAME"],
        projectRef,
      }),
    (error) =>
      error instanceof ReadinessError &&
      error.code === "live_name_set_mismatch" &&
      error.details.includes("unexpected:UNAPPROVED_NINETY_SECOND_NAME"),
  );

  const over = auditSecretBudget({
    manifest,
    liveNames: [...names, "UNAPPROVED_NINETY_SECOND_NAME"],
    nowMs: exceptionWindowNow,
  });
  assert.equal(over.ok, false);
  assert.match(over.failures.join("\n"), /absolute_ceiling_exceeded/);

  // Without the #2830 exception, 91 is still a breach above the normal ceiling.
  const noException = auditSecretBudget({
    manifest: { ...manifest, exceptions: [] },
    liveNames: names,
    nowMs: exceptionWindowNow,
  });
  assert.equal(noException.ok, false);
  assert.match(noException.failures.join("\n"), /approved_exception_required/);

  // Raising the manifest's own ceiling past 91 is refused.
  const raised = structuredClone(manifest);
  raised.policy.absolute_ceiling = 92;
  assert.ok(
    validateManifest(raised, exceptionWindowNow).includes(
      "manifest:absolute_ceiling",
    ),
  );
});
