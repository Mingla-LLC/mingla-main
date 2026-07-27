#!/usr/bin/env node
/**
 * ORCH-0954 strict-grep gate — I-PROPOSED-RAK-SCOPE-PINNED.
 *
 * ORCH-0953 closed onboarding helpers to STRIPE_RAK_ONBOARD only. ORCH-0954
 * extends that rule to Account Sessions so embedded onboarding does not drift
 * back to the unrestricted STRIPE_SECRET_KEY fallback.
 *
 * Rules over supabase/functions/_shared/stripeBlueprintClient.ts:
 *   (1) the file must NOT reference STRIPE_SECRET_KEY (no unrestricted fallback);
 *   (2) at least one stripeBlueprintRequest<...>({ call exists;
 *   (3) every stripeBlueprintRequest call passes
 *       envVarNames: ["STRIPE_RAK_ONBOARD"] within its request literal;
 *   (4) createAccountSession calls path: "/v1/account_sessions".
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(source, failures)` is exercised with a GOOD fixture
 * (specificity) and ≥2 DISTINCT BAD fixtures (sensitivity). The disk-reading
 * main path calls the SAME `check(...)`; the refactor is behavior-preserving
 * (identical verdict on the real tree).
 */

import { readFileSync } from "node:fs";

const TARGET = "supabase/functions/_shared/stripeBlueprintClient.ts";

/** Pure verdict over the blueprint-client source string. */
function check(source, failures) {
  if (source.includes("STRIPE_SECRET_KEY")) {
    failures.push("stripeBlueprintClient.ts must not reference STRIPE_SECRET_KEY.");
  }

  const requestPattern = /stripeBlueprintRequest<[^>]+>\(\{/g;
  const matches = [...source.matchAll(requestPattern)];
  if (matches.length === 0) {
    failures.push("No stripeBlueprintRequest calls found.");
  }

  for (const match of matches) {
    const start = match.index ?? 0;
    const following = source.slice(start, start + 650);
    if (!following.includes('envVarNames: ["STRIPE_RAK_ONBOARD"]')) {
      failures.push(
        'Every stripeBlueprintRequest call must pass envVarNames: ["STRIPE_RAK_ONBOARD"] within the request literal.',
      );
    }
  }

  if (!source.includes('path: "/v1/account_sessions"')) {
    failures.push("createAccountSession must call /v1/account_sessions.");
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  const goodSource = [
    "async function createAccountSession(accountId: string) {",
    "  return stripeBlueprintRequest<AccountSession>({",
    '    method: "POST",',
    '    path: "/v1/account_sessions",',
    '    envVarNames: ["STRIPE_RAK_ONBOARD"],',
    "    body: { account: accountId },",
    "  });",
    "}",
  ].join("\n");

  // GOOD: RAK-only, one account-session call with envVarNames + path.
  let f = [];
  check(goodSource, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): re-introduce the STRIPE_SECRET_KEY fallback → §1 fires.
  const bad1 =
    goodSource + '\nconst fallback = Deno.env.get("STRIPE_SECRET_KEY");\n';
  f = [];
  check(bad1, f);
  if (f.length === 0) self.push("BAD1 (STRIPE_SECRET_KEY fallback re-introduced) not flagged");

  // BAD2 (regression, different angle): a new account-session helper whose
  // stripeBlueprintRequest call omits envVarNames: ["STRIPE_RAK_ONBOARD"] → §3
  // fires (the new call's 650-char window has no RAK pin).
  const bad2 =
    goodSource +
    "\n" +
    [
      "async function createOtherSession(accountId: string) {",
      "  return stripeBlueprintRequest<OtherSession>({",
      '    method: "POST",',
      '    path: "/v1/account_sessions",',
      "    body: { account: accountId },",
      "  });",
      "}",
    ].join("\n");
  f = [];
  check(bad2, f);
  if (f.length === 0) self.push("BAD2 (account-session helper omits STRIPE_RAK_ONBOARD) not flagged");

  if (self.length) {
    console.error("ORCH-0954 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0954 self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const source = readFileSync(TARGET, "utf8");
const failures = [];
check(source, failures);

if (failures.length > 0) {
  console.error("ORCH-0954 RAK-scope strict-grep FAILED:");
  for (const f of failures) console.error(f);
  process.exit(1);
}

console.log(
  "ORCH-0954 RAK-scope strict-grep PASS — blueprint helpers use STRIPE_RAK_ONBOARD only.",
);
