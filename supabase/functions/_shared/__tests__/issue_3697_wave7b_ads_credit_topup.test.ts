/**
 * toward #3697 Wave 7b — Ads credit Stripe top-up verify + edge contracts.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  AD_CREDIT_TOP_UP_PURPOSE,
  adCreditTopUpMetadata,
  isAdCreditStripeTopUpCurrency,
  verifyAdCreditTopUpPaymentIntent,
} from "../adCreditStripe.ts";

const brandId = "11111111-1111-4111-8111-111111111111";

Deno.test("Wave 7b: USD/GBP Stripe top-up currencies; NGN deferred", () => {
  assertEquals(isAdCreditStripeTopUpCurrency("USD"), true);
  assertEquals(isAdCreditStripeTopUpCurrency("gbp"), true);
  assertEquals(isAdCreditStripeTopUpCurrency("NGN"), false);
});

Deno.test("Wave 7b: verify accepts a matching succeeded platform PI", () => {
  const meta = adCreditTopUpMetadata({
    brandId,
    payCents: 2500,
    currency: "USD",
    actorId: "user-1",
  });
  assertEquals(meta.mingla_purpose, AD_CREDIT_TOP_UP_PURPOSE);
  const v = verifyAdCreditTopUpPaymentIntent(
    {
      id: "pi_test_ok",
      status: "succeeded",
      amount: 2500,
      currency: "usd",
      metadata: meta,
    },
    { brandId, payCents: 2500, currency: "USD" },
  );
  assertEquals(v.ok, true);
});

Deno.test("Wave 7b: verify rejects fabricated / wrong-status / mismatch / brand", () => {
  const meta = adCreditTopUpMetadata({
    brandId,
    payCents: 2500,
    currency: "USD",
    actorId: "user-1",
  });
  const expectDetail = (
    pi: Parameters<typeof verifyAdCreditTopUpPaymentIntent>[0],
    detail: string,
  ) => {
    const v = verifyAdCreditTopUpPaymentIntent(pi, {
      brandId,
      payCents: 2500,
      currency: "USD",
    });
    assertEquals(v.ok, false);
    if (!v.ok) assertEquals(v.detail, detail);
  };
  expectDetail(null, "payment_not_found");
  expectDetail(
    { id: "ch_not_pi", status: "succeeded", amount: 2500, currency: "usd", metadata: meta },
    "payment_ref_invalid",
  );
  expectDetail(
    {
      id: "pi_x",
      status: "requires_payment_method",
      amount: 2500,
      currency: "usd",
      metadata: meta,
    },
    "payment_not_succeeded",
  );
  expectDetail(
    { id: "pi_x", status: "succeeded", amount: 9999, currency: "usd", metadata: meta },
    "payment_mismatch",
  );
  expectDetail(
    {
      id: "pi_x",
      status: "succeeded",
      amount: 2500,
      currency: "usd",
      metadata: { ...meta, brand_id: "22222222-2222-4222-8222-222222222222" },
    },
    "payment_brand_mismatch",
  );
  expectDetail(
    {
      id: "pi_x",
      status: "succeeded",
      amount: 2500,
      currency: "usd",
      metadata: { ...meta, mingla_purpose: "other" },
    },
    "payment_purpose_mismatch",
  );
});

Deno.test("Wave 7b: ad-credit edge wires start_top_up + PI verify", async () => {
  const edge = await Deno.readTextFile(
    new URL("../../ad-credit/index.ts", import.meta.url),
  );
  assertEquals(edge.includes('action === "start_top_up"'), true);
  assertEquals(edge.includes("verifyAdCreditTopUpPaymentIntent"), true);
  assertEquals(edge.includes("stripeTicketCheckout"), true);
  assertEquals(edge.includes("paymentIntents.create"), true);
  assertEquals(edge.includes("checkout.sessions.create"), true);
  assertEquals(edge.includes("paymentIntents.retrieve"), true);
  assertEquals(edge.includes("idempotency_key_required"), true);
  assertEquals(edge.includes("isAllowedAdCreditReturnUrl"), true);
  assertEquals(edge.includes("buildAdCreditCheckoutReturnUrls"), true);
  assertEquals(edge.includes("resolveBusinessWebOrigin"), true);
  assertEquals(
    edge.includes("orch-strict-grep-allow stripe-no-idempotency-key"),
    true,
  );
  // Platform charge — never Connect request-option / application fee on create.
  assertEquals(edge.includes("stripeAccount:"), false);
  assertEquals(edge.includes("application_fee_amount"), false);
});
