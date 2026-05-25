import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  buildStripeAccountSessionOperation,
  buildStripeOnboardCreateOperation,
  buildStripeOnboardLinkOperation,
  decideStripeCountryReplacement,
} from "../stripeCountryReplacement.ts";

Deno.test("decideStripeCountryReplacement allows incomplete no-money accounts", () => {
  assertEquals(
    decideStripeCountryReplacement({
      details_submitted: false,
      charges_enabled: false,
      payouts_enabled: false,
      hasLocalMoneyMovement: false,
    }),
    { replaceable: true, reason: null },
  );
});

Deno.test("decideStripeCountryReplacement locks submitted or money-enabled accounts", () => {
  assertEquals(
    decideStripeCountryReplacement({ details_submitted: true }),
    { replaceable: false, reason: "details_submitted" },
  );
  assertEquals(
    decideStripeCountryReplacement({ charges_enabled: true }),
    { replaceable: false, reason: "charges_enabled" },
  );
  assertEquals(
    decideStripeCountryReplacement({ payouts_enabled: true }),
    { replaceable: false, reason: "payouts_enabled" },
  );
  assertEquals(
    decideStripeCountryReplacement({ hasLocalMoneyMovement: true }),
    { replaceable: false, reason: "local_money_movement" },
  );
});

Deno.test("stripe onboarding idempotency operations include country and account context", () => {
  assertEquals(
    buildStripeOnboardCreateOperation("GB", null) ===
      buildStripeOnboardCreateOperation("US", null),
    false,
  );
  assertEquals(
    buildStripeOnboardCreateOperation("US", "acct_old"),
    "onboard_create:US:acct_old",
  );
  assertEquals(
    buildStripeOnboardLinkOperation("US", "acct_new"),
    "onboard_account_link:US:acct_new",
  );
  assertEquals(
    buildStripeAccountSessionOperation("gb", "acct_new"),
    "account_session:GB:acct_new",
  );
});
