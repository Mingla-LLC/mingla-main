/**
 * #948 W1 implementor happy-path edge contract.
 *
 * Executes the real response builder and pins the real best-effort brand
 * projection. Removing either half breaks the client-routing contract.
 *
 * Run:
 *   deno test --allow-env --allow-net --allow-read --no-check \
 *     supabase/functions/accept-brand-invitation/__tests__/issue-948-w1-bank-hints.implementor.test.ts
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildAcceptResponse } from "../index.ts";

Deno.test("#948 W1 response includes fail-safe bank-routing hints", () => {
  const response = buildAcceptResponse(
    {
      brand_id: "2b7c2c59-b89f-4e77-a548-caa584b3466d",
      role: "brand_owner",
      transferred: true,
    },
    {
      brandSlug: "fig-and-vine",
      newOwnerFirstName: "Seth",
      countryCode: "NG",
      paymentProvider: "paystack",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: true,
      paystackSubaccountCode: "ACCT_partner_123",
    },
  );

  assertEquals(response.country_code, "NG");
  assertEquals(response.payment_provider, "paystack");
  assertEquals(response.stripe_charges_enabled, false);
  assertEquals(response.stripe_payouts_enabled, true);
  assertEquals(response.paystack_subaccount_code, "ACCT_partner_123");
});

Deno.test("#948 W1 edge reads every existing brand hint column", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );

  assertStringIncludes(
    source,
    "name, slug, partner_setup, country_code, payment_provider, stripe_charges_enabled, stripe_payouts_enabled, paystack_subaccount_code, stripe_connect_id",
  );
});
