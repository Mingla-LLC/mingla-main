/**
 * #3980 adversarial — approving SPRINT_ROLLOVER_TOKEN as the 89th name opens no
 * door for any other name.
 *
 * #3980: count 89 approved by Seth Ogieva on 2026-10-21 in chat.
 *
 * Production carried the 88 declared names plus SPRINT_ROLLOVER_TOKEN (the
 * GitHub token product-avengers-sync reads), and every edge deploy failed
 * `live_name_set_mismatch` / `unexpected:SPRINT_ROLLOVER_TOKEN`. This file
 * proves the value-blind preflight now accepts the #3645-expanded 90-name set,
 * still rejects any unknown 91st name, and keeps remediation at exactly 90.
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

test("#3980 adversarial: without the manifest record the same live set is still refused", () => {
  // This is exactly the failure on run 39565969471: a live name nobody declared.
  const pre = structuredClone(manifest);
  pre.secrets = pre.secrets.filter((record) => record.name !== NAME);
  assert.throws(
    () =>
      assertLiveNameParity({
        contract,
        manifest: pre,
        liveNames: [...before3980, NAME],
        projectRef,
      }),
    readinessCode("live_name_set_mismatch", `unexpected:${NAME}`),
  );
  // And once declared, its absence from live is a `missing:` failure.
  assert.throws(
    () => parity(before3980),
    readinessCode("live_name_set_mismatch", `missing:${NAME}`),
  );
});

test("#3980 adversarial: the preflight rejects an unknown 91st name", () => {
  const live = [...before3980, NAME];
  assert.throws(
    () => parity([...live, "UNKNOWN_NINETIETH_NAME"]),
    readinessCode("live_name_set_mismatch", "unexpected:UNKNOWN_NINETIETH_NAME"),
  );
  // A swap that keeps the count at 90 is refused in both directions.
  assert.throws(
    () => parity([...before3980, "UNKNOWN_NINETIETH_NAME"]),
    (error) =>
      readinessCode("live_name_set_mismatch", `missing:${NAME}`)(error) &&
      error.details.includes("unexpected:UNKNOWN_NINETIETH_NAME"),
  );
  // The retired band name is no longer tolerated in normal mode.
  assert.throws(
    () => parity([...live, "ATTENDANCE_CLAIM_PEPPER"]),
    readinessCode("live_name_set_mismatch", "unexpected:ATTENDANCE_CLAIM_PEPPER"),
  );
  // An unknown name is refused even alongside the whole one-name band.
  assert.throws(
    () =>
      parity([
        ...live,
        ...contract.remediation.allowed_extra_live_names,
        "UNKNOWN_NINETY_FIRST_NAME",
      ]),
    readinessCode("live_name_set_mismatch", "unexpected:UNKNOWN_NINETY_FIRST_NAME"),
  );
  // And the budget audit refuses a 91st name outright.
  const over = auditSecretBudget({
    manifest,
    liveNames: [
      ...live,
      ...contract.remediation.allowed_extra_live_names,
      "UNKNOWN_NINETY_FIRST_NAME",
    ],
    nowMs: exceptionWindowNow,
  });
  assert.equal(over.ok, false);
  assert.match(over.failures.join("\n"), /absolute_ceiling_exceeded/);
});
