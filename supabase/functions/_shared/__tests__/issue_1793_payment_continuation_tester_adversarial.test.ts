// Tester-owned adversarial guard for #1793.
//
// A provider continuation is a capability to present a charge. The order row
// therefore needs a finite, future expiry; NULL or malformed data must fail
// closed instead of turning a 30-minute payment attempt into a permanent one.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveVenueOrderPaymentContinuation,
  type VenueOrderContinuationRow,
} from "../venueOrderPaymentContinuation.ts";

const baseRow: VenueOrderContinuationRow = {
  id: "11111111-1111-4111-8111-111111111111",
  brand_id: "22222222-2222-4222-8222-222222222222",
  provider: "stripe",
  payment_status: "pending",
  total_cents: 4200,
  currency: "USD",
  expires_at: "2030-01-01T00:00:00.000Z",
  stripe_payment_intent_id: "pi_same",
  stripe_checkout_session_id: "cs_same",
  stripe_account_id: "acct_same",
  paystack_reference: null,
  metadata: {},
};

Deno.test("T-1793-A2 — absent or malformed order expiry never presents a charge", async () => {
  let providerReads = 0;
  const dependencies = {
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    publishableKey: () => "pk_live_same",
    retrievePaymentIntent: async () => {
      providerReads++;
      return {
        id: "pi_same",
        amount: 4200,
        currency: "usd",
        status: "requires_payment_method",
        client_secret: "pi_same_secret_same",
        metadata: {
          mingla_venue_order_id: baseRow.id,
          mingla_brand_id: baseRow.brand_id,
        },
      };
    },
    retrieveCheckoutSession: async () => {
      providerReads++;
      return {};
    },
  };

  for (const expires_at of [null, "not-an-expiry"]) {
    assertEquals(
      await resolveVenueOrderPaymentContinuation(
        { ...baseRow, expires_at },
        "native",
        dependencies,
      ),
      null,
    );
  }
  assertEquals(providerReads, 0);
});
