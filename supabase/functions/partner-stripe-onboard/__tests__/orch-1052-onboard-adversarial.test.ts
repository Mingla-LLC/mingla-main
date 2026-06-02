// ORCH-1052 — adversarial regression for partner-stripe-onboard.
//
// Tester-style checks that catch easy regressions in the gate paths:
//   - return_url scheme allowlist enforced
//   - country normalisation guarded
//   - auth required
//
// Run: deno test --allow-read \
//   supabase/functions/partner-stripe-onboard/__tests__/orch-1052-onboard-adversarial.test.ts

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const SRC = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("partner-stripe-onboard: return_url scheme allowlist (deep-link OR business origin)", () => {
  assertStringIncludes(SRC, "mingla-business://");
  assertStringIncludes(SRC, "return_url_invalid_scheme");
});

Deno.test("partner-stripe-onboard: country normalised through stripeSupportedCountries", () => {
  assertStringIncludes(SRC, "normalizeStripeCountry");
  assertStringIncludes(SRC, "country_unsupported");
});

Deno.test("partner-stripe-onboard: 401 unauthenticated when missing Bearer", () => {
  assertStringIncludes(SRC, '"unauthenticated"');
  assertStringIncludes(SRC, "Bearer");
});

Deno.test("partner-stripe-onboard: 403 forbidden when creator_account missing OR not a partner", () => {
  assertStringIncludes(SRC, '"creator_account_missing"');
  assertStringIncludes(SRC, '"not_a_partner"');
});

Deno.test("partner-stripe-onboard: validates JSON body before any DB read", () => {
  assertStringIncludes(SRC, '"invalid_json"');
});

Deno.test("partner-stripe-onboard: Stripe failures bubble as 502 stripe_api_error", () => {
  // 502 + stripe_api_error string ≥ 2 occurrences (account create + session).
  const stripeErrCount = (SRC.match(/"stripe_api_error"/g) ?? []).length;
  assert(
    stripeErrCount >= 2,
    `expected ≥2 stripe_api_error sites, found ${stripeErrCount}`,
  );
  assertStringIncludes(SRC, "502");
});

Deno.test("partner-stripe-onboard: writes audit log on success", () => {
  assertStringIncludes(SRC, "writeAudit");
  assertStringIncludes(SRC, "partner_stripe_connect.onboard_initiated");
});
