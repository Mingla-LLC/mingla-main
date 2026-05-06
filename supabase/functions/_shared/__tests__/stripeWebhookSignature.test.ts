/**
 * Locks Stripe webhook signature verification (same path as stripe-connect-webhook).
 *
 * Run: cd repo-root && deno test --allow-all supabase/functions/_shared/__tests__/stripeWebhookSignature.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import Stripe from "npm:stripe@17.4.0";

Deno.test("Stripe constructEvent accepts generateTestHeaderString payload", () => {
  const secret = "whsec_test_contract_secret";
  const stripe = new Stripe("sk_test_contract_dummy", {
    apiVersion: "2024-11-20.acacia",
    typescript: true,
  });
  const payload = JSON.stringify({
    id: "evt_contract_1",
    object: "event",
    api_version: "2024-11-20.acacia",
    type: "billing_portal.configuration.created",
    data: { object: {} },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
  const event = stripe.webhooks.constructEvent(payload, header, secret);
  assertEquals(event.id, "evt_contract_1");
});
