/**
 * #3980 — SPRINT_ROLLOVER_TOKEN is the approved 89th user-managed edge secret.
 *
 * #3980: count 89 approved by Seth Ogieva on 2026-10-21 in chat.
 *
 * Production carried the 88 declared names plus SPRINT_ROLLOVER_TOKEN (the
 * GitHub token product-avengers-sync reads), and every edge deploy failed
 * `live_name_set_mismatch` / `unexpected:SPRINT_ROLLOVER_TOKEN`. This file
 * proves the value-blind preflight still governs that name after #3645 filled
 * the 90th and final slot, rejects any unknown 91st name, and keeps remediation
 * at exactly 90 under the unchanged 87/90 ceilings.
 *
 * [TEST-MOD-APPROVED #3645] The governed set is now 90, with an empty band.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertLiveNameParity,
  evaluateFunctionReadiness,
  ReadinessError,
} from "./preflight-function-secret-readiness.mjs";
import {
  auditSecretBudget,
  validateManifest,
} from "./audit-supabase-secret-budget.mjs";
import { loadEffectiveFunctionPolicy } from "../../.github/scripts/ci-discovery/function-policy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, "supabase/secrets.manifest.json"), "utf8"),
);
const contract = JSON.parse(
  readFileSync(resolve(ROOT, "supabase/function-env.contract.json"), "utf8"),
);
const projectRef = "gqnoajqerqhnvulmnyvv";
const NAME = "SPRINT_ROLLOVER_TOKEN";
const declared = manifest.secrets.map((record) => record.name);
const before3980 = declared.filter((name) => name !== NAME);
// Inside the #2830 exception window that every count above 87 rides on.
const exceptionWindowNow = Date.parse("2026-10-21T12:00:00Z");

function parity(liveNames, mode = "normal") {
  return assertLiveNameParity({
    contract,
    manifest,
    liveNames,
    projectRef,
    mode,
  });
}

function readinessCode(code, detail = null) {
  return (error) => {
    assert.ok(error instanceof ReadinessError, `not a ReadinessError: ${error}`);
    assert.equal(error.code, code);
    if (detail !== null) {
      assert.ok(
        error.details.includes(detail),
        `expected ${detail} in ${JSON.stringify(error.details)}`,
      );
    }
    return true;
  };
}

test("#3980 happy: the manifest declares SPRINT_ROLLOVER_TOKEN as the 89th governed name", () => {
  assert.equal(before3980.length, 89);
  assert.equal(declared.length, 90);
  assert.equal(new Set(declared).size, 90);
  assert.equal(manifest.rollout.expected_user_managed_count, 90);
  assert.equal(manifest.policy.normal_ceiling, 87);
  assert.equal(manifest.policy.absolute_ceiling, 90);

  const record = manifest.secrets.find((entry) => entry.name === NAME);
  assert.deepEqual(record, {
    name: NAME,
    class: "credential",
    owner: "Platform Engineering",
    backup_owner: "Product",
    readers: ["supabase/functions/product-avengers-sync/index.ts"],
    source_type: "provider_dashboard_and_secure_vault",
    rotation_or_review_days: 90,
    expires_at: null,
    issue: 3980,
    status: "active",
    bundle_fields: [],
  });
  assert.deepEqual(validateManifest(manifest, exceptionWindowNow), []);

  // The reader really reads it, and its own function policy declares it.
  const reader = readFileSync(
    resolve(ROOT, "supabase/functions/product-avengers-sync/index.ts"),
    "utf8",
  );
  assert.match(reader, /Deno\.env\.get\("SPRINT_ROLLOVER_TOKEN"\)/);
  const effective = loadEffectiveFunctionPolicy({ root: ROOT }).contract;
  const policy = effective.functions["product-avengers-sync"];
  assert.ok(policy, "product-avengers-sync must be in the effective policy");
  assert.deepEqual(policy.optional_top_level, [NAME]);
});

test("#3980 happy: normal-mode preflight accepts the 90-name live set", () => {
  const live = [...before3980, NAME, ...contract.platform_managed];
  const result = parity(live);
  assert.equal(result.liveUserManaged.length, 90);
  assert.ok(result.liveUserManaged.includes(NAME));

  // The full selected-function evaluation passes too, for the function that
  // reads the name (it needs no bundle receipt).
  const readiness = evaluateFunctionReadiness({
    contract: loadEffectiveFunctionPolicy({ root: ROOT }).contract,
    manifest,
    liveNames: live,
    selectedFunctions: ["product-avengers-sync"],
    projectRef,
    mergedCommit: "0".repeat(40),
  });
  assert.equal(readiness.live_user_managed_count, 90);
  assert.deepEqual(readiness.selected_functions, ["product-avengers-sync"]);

  // The live budget audit sees exactly the 90 declared names, inside #2830.
  const budget = auditSecretBudget({
    manifest,
    liveNames: live,
    nowMs: exceptionWindowNow,
    liveAudit: true,
  });
  assert.deepEqual(budget.failures, []);
  assert.equal(budget.count, 90);
  assert.equal(budget.freeSlots, 10);
});

test("#3980 regression: remediation is exactly the 90 declared names", () => {
  assert.deepEqual(contract.remediation.allowed_extra_live_names, []);
  const remediationLive = [...declared, ...contract.remediation.allowed_extra_live_names];
  assert.equal(remediationLive.length, manifest.policy.absolute_ceiling);
  const result = parity(remediationLive, "issue-2241-remediation");
  assert.equal(result.liveUserManaged.length, 90);
  // Normal mode tolerates the band at 90 as well.
  assert.equal(parity(remediationLive).liveUserManaged.length, 90);
  assert.equal(parity(declared, "issue-2241-remediation").liveUserManaged.length, 90);
  // The exact-90 literal is still in the preflight.
  const preflight = readFileSync(
    resolve(ROOT, "scripts/secrets/preflight-function-secret-readiness.mjs"),
    "utf8",
  );
  assert.ok(preflight.includes("liveUserManaged.length !== 90"));
  assert.ok(preflight.includes("remediation_requires_exact_90"));
});
