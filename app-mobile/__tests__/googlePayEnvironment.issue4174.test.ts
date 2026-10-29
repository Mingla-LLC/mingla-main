// @ts-nocheck — Deno-runtime release contract.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { isStripeGooglePayTestEnv } from "../../packages/payments-native/googlePayEnvironment.ts";

Deno.test("#4174 — Google Pay uses test mode only for Stripe test keys", () => {
  assertEquals(isStripeGooglePayTestEnv("pk_test_example"), true);
  assertEquals(isStripeGooglePayTestEnv("  pk_test_example  "), true);
});

Deno.test("#4174 — live, missing and unknown keys fail closed to live mode", () => {
  assertEquals(isStripeGooglePayTestEnv("pk_live_example"), false);
  assertEquals(isStripeGooglePayTestEnv(null), false);
  assertEquals(isStripeGooglePayTestEnv(undefined), false);
  assertEquals(isStripeGooglePayTestEnv("not-a-stripe-key"), false);
});
