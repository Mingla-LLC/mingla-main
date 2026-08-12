// Issue #1793 rework — cancelling a provider UI must reopen the SAME unpaid
// provider object. These tests fail if the resolver stops validating ownership,
// amount, currency, state, expiry, or the stored Paystack checkout host.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveVenueOrderPaymentContinuation,
  type VenueOrderContinuationRow,
} from "../venueOrderPaymentContinuation.ts";

const row = (
  overrides: Partial<VenueOrderContinuationRow> = {},
): VenueOrderContinuationRow => ({
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
  ...overrides,
});

const deps = (overrides: Record<string, unknown> = {}) => ({
  now: () => Date.parse("2029-01-01T00:00:00.000Z"),
  publishableKey: () => "pk_live_same",
  retrievePaymentIntent: async () => ({
    id: "pi_same",
    amount: 4200,
    currency: "usd",
    status: "requires_payment_method",
    client_secret: "pi_same_secret_same",
    metadata: {
      mingla_venue_order_id: "11111111-1111-4111-8111-111111111111",
      mingla_brand_id: "22222222-2222-4222-8222-222222222222",
    },
    ...overrides,
  }),
  retrieveCheckoutSession: async () => ({
    id: "cs_same",
    amount_total: 4200,
    currency: "usd",
    status: "open",
    payment_status: "unpaid",
    url: "https://checkout.stripe.com/c/pay/cs_same",
    metadata: {
      mingla_venue_order_id: "11111111-1111-4111-8111-111111111111",
      mingla_brand_id: "22222222-2222-4222-8222-222222222222",
    },
    ...overrides,
  }),
});

Deno.test("T-1793-R1 — native cancel retrieves the same PaymentIntent and never creates one", async () => {
  let retrieves = 0;
  const dependencies = deps();
  dependencies.retrievePaymentIntent = async (...args) => {
    retrieves++;
    assertEquals(args, ["pi_same", "acct_same"]);
    return await deps().retrievePaymentIntent();
  };
  const continuation = await resolveVenueOrderPaymentContinuation(
    row(),
    "native",
    dependencies,
  );
  assertEquals(retrieves, 1);
  assertEquals(continuation, {
    kind: "requires_payment",
    paymentIntentId: "pi_same",
    clientSecret: "pi_same_secret_same",
    publishableKey: "pk_live_same",
    stripeAccountId: "acct_same",
    totalCents: 4200,
    currency: "USD",
  });
});

Deno.test("T-1793-R2 — hosted Stripe cancel reopens the same open unpaid Checkout Session", async () => {
  const continuation = await resolveVenueOrderPaymentContinuation(
    row(),
    "web",
    deps(),
  );
  assertEquals(continuation, {
    kind: "requires_web_redirect",
    url: "https://checkout.stripe.com/c/pay/cs_same",
  });
});

Deno.test("T-1793-R3 — terminal or mismatched Stripe objects are never resumed", async () => {
  assertEquals(
    await resolveVenueOrderPaymentContinuation(
      row(),
      "native",
      deps({ status: "succeeded" }),
    ),
    null,
  );
  assertEquals(
    await resolveVenueOrderPaymentContinuation(
      row(),
      "web",
      deps({ amount_total: 4300 }),
    ),
    null,
  );
});

Deno.test("T-1793-R4 — Paystack retries only the persisted checkout.paystack.com URL", async () => {
  const paystack = row({
    provider: "paystack",
    stripe_payment_intent_id: null,
    stripe_checkout_session_id: null,
    stripe_account_id: null,
    paystack_reference: "mingla_venue_same",
    metadata: {
      payment_continuation: {
        authorization_url: "https://checkout.paystack.com/same-transaction",
        reference: "mingla_venue_same",
      },
    },
  });
  assertEquals(
    await resolveVenueOrderPaymentContinuation(paystack, "web", deps()),
    {
      kind: "requires_paystack_redirect",
      authorizationUrl: "https://checkout.paystack.com/same-transaction",
    },
  );
  assertEquals(
    await resolveVenueOrderPaymentContinuation(
      row({
        ...paystack,
        metadata: {
          payment_continuation: {
            authorization_url: "https://checkout.paystack.com.evil.test/same",
            reference: "mingla_venue_same",
          },
        },
      }),
      "web",
      deps(),
    ),
    null,
  );
  assertEquals(
    await resolveVenueOrderPaymentContinuation(
      row({
        ...paystack,
        metadata: {
          payment_continuation: {
            authorization_url: "https://checkout.paystack.com/same-transaction",
            reference: "a_different_transaction",
          },
        },
      }),
      "web",
      deps(),
    ),
    null,
  );
});

Deno.test("T-1793-R5 — resolver has no create dependency or mutation escape hatch", async () => {
  const source = await Deno.readTextFile(
    new URL("../venueOrderPaymentContinuation.ts", import.meta.url),
  );
  assertEquals(
    /\.create\s*\(|initializeTransaction|insert\s*\(/.test(source),
    false,
  );
});

Deno.test("T-1793-R10 — create replay and possession-token status share the one continuation owner", async () => {
  const create = await Deno.readTextFile(
    new URL("../../venue-order-create/index.ts", import.meta.url),
  );
  const status = await Deno.readTextFile(
    new URL("../../venue-order-status/index.ts", import.meta.url),
  );
  assertEquals(create.includes("resolveVenueOrderPaymentContinuation("), true);
  assertEquals(status.includes("resolveVenueOrderPaymentContinuation("), true);
  assertEquals(create.includes("payment=cancelled"), true);
  assertEquals(
    create.includes("authorization_url: init.authorization_url"),
    true,
  );
  assertEquals(
    create.includes("...persistedMetadata"),
    true,
  );
  assertEquals(status.includes("includePaymentContinuation"), true);
});

Deno.test("T-1793-R12 — null, malformed, and expired order bounds fail before every provider read", async () => {
  let providerReads = 0;
  const dependencies = {
    now: () => Date.parse("2029-01-01T00:00:00.000Z"),
    publishableKey: () => "pk_live_same",
    retrievePaymentIntent: async () => {
      providerReads++;
      return {};
    },
    retrieveCheckoutSession: async () => {
      providerReads++;
      return {};
    },
  };
  const invalidExpiries = [
    null,
    "not-an-expiry",
    "2029-01-01T00:00:00.000Z",
    "2028-12-31T23:59:59.999Z",
  ];
  for (const expires_at of invalidExpiries) {
    assertEquals(
      await resolveVenueOrderPaymentContinuation(
        row({ expires_at }),
        "native",
        dependencies,
      ),
      null,
    );
    assertEquals(
      await resolveVenueOrderPaymentContinuation(
        row({
          provider: "paystack",
          expires_at,
          stripe_payment_intent_id: null,
          stripe_checkout_session_id: null,
          stripe_account_id: null,
          paystack_reference: "mingla_venue_same",
          metadata: {
            payment_continuation: {
              authorization_url:
                "https://checkout.paystack.com/same-transaction",
              reference: "mingla_venue_same",
            },
          },
        }),
        "web",
        dependencies,
      ),
      null,
    );
  }
  assertEquals(providerReads, 0);
});
