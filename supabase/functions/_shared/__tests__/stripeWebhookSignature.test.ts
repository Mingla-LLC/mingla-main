/**
 * Locks Stripe webhook signature verification on Web Crypto (generateTestHeaderStringAsync + constructEventAsync).
 * Matches stripe-connect-webhook (constructEventAsync on Deno).
 *
 * Run: cd repo-root && deno test --allow-all supabase/functions/_shared/__tests__/stripeWebhookSignature.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import Stripe from "npm:stripe@17.4.0";

// Deno uses SubtleCryptoProvider — sync generateTestHeaderString / constructEvent throw.
Deno.test("Stripe constructEventAsync accepts generateTestHeaderStringAsync payload", async () => {
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
  const header = await stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
  });
  const event = await stripe.webhooks.constructEventAsync(payload, header, secret);
  assertEquals((event as { id?: string }).id, "evt_contract_1");
});
