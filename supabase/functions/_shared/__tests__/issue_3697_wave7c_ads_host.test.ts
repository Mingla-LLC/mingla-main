/**
 * toward #3697 Wave 7c — Paystack prefix, webhook discriminator, Ari Host Ads tools.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  AD_CREDIT_PAYSTACK_REF_PREFIX,
  AD_CREDIT_TOP_UP_PURPOSE,
  buildAdCreditPaystackReference,
  isAdCreditPaystackReference,
  isAdCreditPaystackTopUpCurrency,
  isAdCreditStripeTopUpCurrency,
} from "../adCreditStripe.ts";
import { isAdCreditTopUpStripeObject } from "../adCreditWebhook.ts";
import { AGENT_TOOLS, findTool, READ_ONLY_TOOL_NAMES } from "../agentTools.ts";
import { MONEY_CONFIRM_TOOLS } from "../agentDomainTools.ts";

Deno.test("Wave 7c: NGN is Paystack; USD/GBP remain Stripe", () => {
  assertEquals(isAdCreditPaystackTopUpCurrency("NGN"), true);
  assertEquals(isAdCreditPaystackTopUpCurrency("USD"), false);
  assertEquals(isAdCreditStripeTopUpCurrency("USD"), true);
  assertEquals(isAdCreditStripeTopUpCurrency("NGN"), false);
});

Deno.test("Wave 7c: Paystack reference prefix mingla_adc_", () => {
  const ref = buildAdCreditPaystackReference({
    brandId: "11111111-1111-4111-8111-111111111111",
    clientIdem: "abc-def-123",
  });
  assert(ref.startsWith(AD_CREDIT_PAYSTACK_REF_PREFIX));
  assertEquals(isAdCreditPaystackReference(ref), true);
  assertEquals(isAdCreditPaystackReference("ord_ticket_xyz"), false);
});

Deno.test("Wave 7c: isAdCreditTopUpStripeObject gates on mingla_purpose", () => {
  assertEquals(
    isAdCreditTopUpStripeObject({
      metadata: { mingla_purpose: AD_CREDIT_TOP_UP_PURPOSE },
    }),
    true,
  );
  assertEquals(
    isAdCreditTopUpStripeObject({
      metadata: { mingla_purpose: "ticket_checkout" },
    }),
    false,
  );
  assertEquals(isAdCreditTopUpStripeObject({ metadata: null }), false);
});

Deno.test("Wave 7c: Host Ads Ari tools registered (distinct from Blast)", () => {
  const names = new Set(AGENT_TOOLS.map((t) => t.name));
  for (
    const n of [
      "propose_ad_plan",
      "approve_ad_plan",
      "pause_ad_campaign",
      "end_ad_campaign",
      "get_ad_campaign_report",
    ]
  ) {
    assert(names.has(n), `${n} missing from AGENT_TOOLS`);
  }
  assert(READ_ONLY_TOOL_NAMES.has("propose_ad_plan"));
  assert(READ_ONLY_TOOL_NAMES.has("get_ad_campaign_report"));
  assert(MONEY_CONFIRM_TOOLS.has("approve_ad_plan"));
  assert(MONEY_CONFIRM_TOOLS.has("end_ad_campaign"));
  assertEquals(findTool("approve_ad_plan")?.name, "approve_ad_plan");
});

Deno.test("Wave 7c: host-ad-campaign edge + ad-credit withdraw surface exist", async () => {
  const host = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  assert(host.includes('owner_kind: "host"'));
  assert(host.includes('action === "launch"'));
  assert(host.includes("campaign_spend"));
  const edge = await Deno.readTextFile(
    new URL("../../ad-credit/index.ts", import.meta.url),
  );
  assert(edge.includes('action === "apply_withdraw"'));
  assert(edge.includes("refunds.create") || edge.includes("stripe.refunds"));
  assert(edge.includes("mingla_adc_") || edge.includes("Paystack"));
});
