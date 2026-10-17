import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("v1.4 Host mutations cannot bypass plan funding or final settlement", async () => {
  const source = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  assertStringIncludes(source, 'error: "plan_required"');
  assertStringIncludes(source, '"ad_plan_assert_launchable"');
  assertStringIncludes(source, '"ad_request_campaign_stop"');
  assertStringIncludes(source, "final_spend_pending: true");
  assertEquals(source.includes('supabase.rpc("ad_credit_apply"'), false);
  assertEquals(source.includes("hostDefaultCountriesForCurrency("), false);
});

Deno.test("v1.4 provider create binds the executable version before a platform write", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const planGate = source.indexOf(
    "plan_version_and_hash_required_before_provider_create",
  );
  const firstProviderCreate = source.indexOf(
    "await googleCreateDemandGenVideoCampaign(",
  );
  assert(planGate > 0);
  assert(firstProviderCreate > planGate);
  for (
    const field of [
      "plan_version_id",
      "plan_hash",
      "host_currency",
      "provider_currency",
      "host_budget_cents",
      "provider_budget_cents",
      "fx_snapshot_id",
    ]
  ) assertStringIncludes(source, field);
});

Deno.test("v1.4 spend worker waits for provider stop and a finality window", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-spend-sync/index.ts", import.meta.url),
  );
  assertStringIncludes(source, "reconcileStoppedCampaign");
  assertStringIncludes(source, '"ad_confirm_campaign_stop"');
  assertStringIncludes(source, 'p_finality_delay: "24 hours"');
  assertStringIncludes(source, '"ad_finalize_campaign_settlement"');
  assertStringIncludes(source, 'providerStatus !== "PAUSED"');
});

Deno.test("v1.4 Ari never accepts currency or reconstructs an approved plan", async () => {
  const source = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  const start = source.indexOf("const proposeAdPlan");
  const end = source.indexOf("const pauseAdCampaign", start);
  const ads = source.slice(start, end);
  assert(start > 0 && end > start);
  assertEquals(ads.includes("hostAdCountries"), false);
  assertEquals(ads.includes("currency: { type:"), false);
  assertStringIncludes(ads, "plan_version_id");
  assertStringIncludes(ads, "plan_hash");
  assertStringIncludes(ads, "platforms");
  const safeValidation = ads.indexOf(
    "buildHostAdCreatePayload(aggregate, platform, operationId, true)",
  );
  const funding = ads.indexOf('action: "fund"');
  assert(safeValidation > 0 && funding > safeValidation);
});
