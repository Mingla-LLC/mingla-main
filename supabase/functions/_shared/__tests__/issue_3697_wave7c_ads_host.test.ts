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
  const propose = findTool("propose_ad_plan");
  const proposeRequired = Array.isArray(propose?.parameters.required)
    ? propose.parameters.required as string[]
    : [];
  for (
    const field of ["rights_confirmed", "rights_basis", "ai_generated"]
  ) {
    assert(
      proposeRequired.includes(field),
      `propose_ad_plan must require ${field}`,
    );
  }
  const approve = findTool("approve_ad_plan");
  assertEquals(approve?.name, "approve_ad_plan");
  const required = Array.isArray(approve?.parameters.required)
    ? approve.parameters.required as string[]
    : [];
  assertEquals(required.includes("creative_library_id"), false);
});

Deno.test("Wave 7c: host-ad-campaign edge + ad-credit withdraw surface exist", async () => {
  const host = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  assert(host.includes('owner_kind: "host"'));
  assert(host.includes('action === "launch"'));
  assert(host.includes("campaign_spend"));
  assert(host.includes("ad_can_host_action"));
  assert(host.includes("p_action: requiredPermission"));
  assert(host.includes("campaign_never_launched"));
  assert(host.includes("campaign_not_pausable"));
  const edge = await Deno.readTextFile(
    new URL("../../ad-credit/index.ts", import.meta.url),
  );
  assert(edge.includes('action === "apply_withdraw"'));
  assert(edge.includes("refunds.create") || edge.includes("stripe.refunds"));
  assert(edge.includes("mingla_adc_") || edge.includes("Paystack"));
  assert(
    edge.includes("`top_up:${paymentRef}`") ||
      edge.includes("top_up:${paymentRef}"),
  );
  assert(
    edge.includes("markProviderRefundOrThrow") ||
      edge.includes("ad_credit_mark_provider_refund_failed"),
  );
  const tools = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  assert(tools.includes('"admin-ad-create-campaign"'));
  assert(tools.includes('owner_kind: "host"'));
  assert(tools.includes('lane: "business"'));
  assert(tools.includes("HOST_AD_PLATFORMS"));
  assert(tools.includes("requireAgentOperationId(context)"));
  const builder = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assert(builder.includes("biz_can_manage_payments_for_brand"));
  assert(builder.includes("destination_brand_mismatch"));
  assert(builder.includes("creative_brand_mismatch"));
  assert(builder.includes("host_video_creative_required"));
  assert(builder.includes('.select("id, brand_id, kind, status")'));
  assert(builder.includes("owner_kind: requestedOwnerKind"));
  const prepare = await Deno.readTextFile(
    new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
  );
  assert(prepare.includes('requestedLane !== "business"'));
  assert(prepare.includes("creative_brand_mismatch"));
  const spendSync = await Deno.readTextFile(
    new URL("../../admin-ad-spend-sync/index.ts", import.meta.url),
  );
  assert(spendSync.includes("resolveAdDestination"));
  assert(spendSync.includes("destination_unavailable"));
  assert(spendSync.includes("destination_check_failed"));
  const stripeRouter = await Deno.readTextFile(
    new URL("../stripeWebhookRouter.ts", import.meta.url),
  );
  assert(stripeRouter.includes("applyAdCreditWithdrawFromStripeRefund"));
  const paystackRouter = await Deno.readTextFile(
    new URL("../paystackRefundRouter.ts", import.meta.url),
  );
  assert(paystackRouter.includes("applyAdCreditWithdrawFromPaystackRefund"));
  const mig = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270825003697_issue_3697_wave7c_ads_host.sql",
      import.meta.url,
    ),
  );
  assert(mig.includes("ad_credit_paystack_refund_below_minimum"));
});
