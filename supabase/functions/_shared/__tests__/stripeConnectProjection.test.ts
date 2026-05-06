import {
  deriveBrandStripeStatus,
  mapStripePayoutStatus,
  projectStripeAccountToConnectRow,
} from "../stripeConnectProjection.ts";

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `Expected ${expected}, got ${actual}`);
  }
}

Deno.test("deriveBrandStripeStatus — not_connected without acct id", () => {
  assertEquals(deriveBrandStripeStatus(null, false, false, {}), "not_connected");
  assertEquals(deriveBrandStripeStatus("", false, false, {}), "not_connected");
});

Deno.test("deriveBrandStripeStatus — restricted when disabled_reason set", () => {
  assertEquals(
    deriveBrandStripeStatus("acct_1", false, false, {
      disabled_reason: "requirements.past_due",
    }),
    "restricted",
  );
});

Deno.test("deriveBrandStripeStatus — active when charges_enabled", () => {
  assertEquals(deriveBrandStripeStatus("acct_1", true, false, { currently_due: [] }), "active");
});

Deno.test("deriveBrandStripeStatus — onboarding when charges off and items due", () => {
  assertEquals(
    deriveBrandStripeStatus("acct_1", false, false, { currently_due: ["individual.verification.document"] }),
    "onboarding",
  );
});

Deno.test("mapStripePayoutStatus — maps in_transit to pending", () => {
  assertEquals(mapStripePayoutStatus("in_transit"), "pending");
  assertEquals(mapStripePayoutStatus("pending"), "pending");
  assertEquals(mapStripePayoutStatus("paid"), "paid");
  assertEquals(mapStripePayoutStatus("failed"), "failed");
  assertEquals(mapStripePayoutStatus("canceled"), "failed");
});

Deno.test("projectStripeAccountToConnectRow", () => {
  const row = projectStripeAccountToConnectRow({
    id: "acct_test",
    type: "express",
    charges_enabled: true,
    payouts_enabled: false,
    requirements: { currently_due: [] },
  });
  assertEquals(row.stripe_account_id, "acct_test");
  assertEquals(row.account_type, "express");
  assertEquals(row.charges_enabled, true);
  assertEquals(row.payouts_enabled, false);
});
