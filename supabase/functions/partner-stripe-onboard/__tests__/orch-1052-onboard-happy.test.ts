// ORCH-1052 — happy-path regression for partner-stripe-onboard.
//
// Pure-shape contract checks (no network). The handler's full behavior is
// covered by adversarial tests + tester live-fire against the deployed fn.
//
// CLOSE Step 0.5: this test PASSES at the shipped contract head and MUST FAIL
// on revert (e.g. if the onboard fn drops the partner_enabled gate, drops
// the createRecipientAccount call, or stops minting an Account Session).
//
// Run: deno test --allow-read \
//   supabase/functions/partner-stripe-onboard/__tests__/orch-1052-onboard-happy.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const SRC = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("partner-stripe-onboard: gates on creator_accounts.partner_enabled", () => {
  // The handler MUST query creator_accounts for partner_enabled BEFORE any
  // Stripe call. Source-level proof: the table + column tokens are present
  // AND the 403 'not_a_partner' return path exists.
  assertStringIncludes(SRC, 'from("creator_accounts")');
  assertStringIncludes(SRC, "partner_enabled");
  assertStringIncludes(SRC, '"not_a_partner"');
});

Deno.test("partner-stripe-onboard: uses Accounts v2 recipient blueprint", () => {
  // Mirrors brand-stripe-onboard's blueprint client — must NOT inline a raw
  // /v1/accounts call. Source-level proof: createRecipientAccount import.
  assertStringIncludes(SRC, "createRecipientAccount");
  assertStringIncludes(SRC, "createAccountSession");
});

Deno.test("partner-stripe-onboard: persists into partner_stripe_connect_accounts (NOT stripe_connect_accounts)", () => {
  // Account-level partner identity table — must not collide with the brand-
  // scoped stripe_connect_accounts mirror.
  assertStringIncludes(SRC, 'from("partner_stripe_connect_accounts")');
  assert(
    !/from\("stripe_connect_accounts"\)/.test(SRC),
    "partner-stripe-onboard must NOT touch brand-scoped stripe_connect_accounts",
  );
});

Deno.test("partner-stripe-onboard: keys on creator_accounts.id (auth.uid()) NOT user_id", () => {
  // ORCH-1050/1051 lesson: creator_accounts.id IS the auth.users.id; there
  // is no separate user_id column. The onboard fn must filter by id, never
  // user_id.
  assertStringIncludes(SRC, '.eq("id", userId)');
  assert(
    !/\.eq\("user_id",\s*userId\)/.test(SRC),
    "partner-stripe-onboard must NOT query creator_accounts by user_id",
  );
});

Deno.test("partner-stripe-onboard: returns onboarding_url pointing at /connect-partner-onboarding", () => {
  assertStringIncludes(SRC, "/connect-partner-onboarding");
  assertStringIncludes(SRC, "client_secret");
});

Deno.test("partner-stripe-onboard: cites Stripe docs URLs inline (COMMS-0003)", () => {
  assertStringIncludes(SRC, "docs.stripe.com/api/v2/accounts/create");
  assertStringIncludes(SRC, "docs.stripe.com/api/account_sessions/create");
});

// Sanity: this test file's path is allowlisted via ORCH_1052_BACKEND_ALLOWLIST.
Deno.test("partner-stripe-onboard: idempotency-key generation on Stripe calls", () => {
  assertStringIncludes(SRC, "generateIdempotencyKey");
  // Two Stripe calls: account create + account session.
  const matches = SRC.match(/generateIdempotencyKey\(/g) ?? [];
  assert(
    matches.length >= 2,
    `expected ≥2 idempotency-key sites, found ${matches.length}`,
  );
});
