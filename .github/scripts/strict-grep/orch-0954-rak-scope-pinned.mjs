#!/usr/bin/env node
/**
 * ORCH-0954 strict-grep gate — I-PROPOSED-RAK-SCOPE-PINNED.
 *
 * ORCH-0953 closed onboarding helpers to STRIPE_RAK_ONBOARD only. ORCH-0954
 * extends that rule to Account Sessions so embedded onboarding does not drift
 * back to the unrestricted STRIPE_SECRET_KEY fallback.
 */

import { readFileSync } from "node:fs";

const TARGET = "supabase/functions/_shared/stripeBlueprintClient.ts";
const source = readFileSync(TARGET, "utf8");

function fail(message) {
  console.error("ORCH-0954 RAK-scope strict-grep FAILED:");
  console.error(message);
  process.exit(1);
}

if (source.includes("STRIPE_SECRET_KEY")) {
  fail("stripeBlueprintClient.ts must not reference STRIPE_SECRET_KEY.");
}

const requestPattern = /stripeBlueprintRequest<[^>]+>\(\{/g;
const matches = [...source.matchAll(requestPattern)];
if (matches.length === 0) {
  fail("No stripeBlueprintRequest calls found.");
}

for (const match of matches) {
  const start = match.index ?? 0;
  const following = source.slice(start, start + 650);
  if (!following.includes('envVarNames: ["STRIPE_RAK_ONBOARD"]')) {
    fail(
      'Every stripeBlueprintRequest call must pass envVarNames: ["STRIPE_RAK_ONBOARD"] within the request literal.',
    );
  }
}

if (!source.includes('path: "/v1/account_sessions"')) {
  fail("createAccountSession must call /v1/account_sessions.");
}

console.log(
  "ORCH-0954 RAK-scope strict-grep PASS — blueprint helpers use STRIPE_RAK_ONBOARD only.",
);
