// toward #3697 — a plan-bound provider create persists exactly the columns
// the database plan guard recomputes. Production 2026-10-20: a Mingla-owned
// plan for a Host's event page created Meta objects, then the ad_campaigns
// insert carried the event's brand_id (plan brand_id NULL) and
// ad_campaign_plan_binding_guard refused it ("db_persist_failed_platform_rolled_back").
// MINGLA-INVARIANT: I-3697-BOUND-PLAN-OWNERSHIP | issue #3697 | A plan-bound ad_campaigns row takes owner_kind and brand_id from the plan alone; a Mingla-owned row has host_currency NULL and brand_id equal to the plan's.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  boundPlanCampaignCurrency,
  boundPlanMoney,
  campaignPersistBrandId,
} from "../adPlanCampaignBinding.ts";

const EVENT_BRAND = "2f1312d6-662b-43bb-9940-0921943f9242";
const HOST_BRAND = "36970000-0000-4000-8000-0000000000b1";
const allocation = {
  host_currency: "USD",
  provider_currency: "USD",
  host_budget_cents: 12000,
  provider_budget_cents: 12000,
  fx_snapshot_id: null,
};

Deno.test("Mingla plan money: host_currency NULL, every other field equals the allocation", () => {
  const money = boundPlanMoney({
    plan: { owner_kind: "mingla", brand_id: null },
    allocation,
    planVersionId: "e33f1adb-042f-40aa-a48c-6d5a81ec5504",
    planHash: "a".repeat(64),
    providerDeliveryBudgetCents: 4000,
  });
  assertEquals(money, {
    plan_version_id: "e33f1adb-042f-40aa-a48c-6d5a81ec5504",
    plan_hash: "a".repeat(64),
    host_currency: null,
    provider_currency: "USD",
    host_budget_cents: 12000,
    provider_budget_cents: 12000,
    provider_delivery_budget_cents: 4000,
    fx_snapshot_id: null,
  });
  assertEquals(
    boundPlanCampaignCurrency({ owner_kind: "mingla", brand_id: null }, {
      ...allocation,
      host_currency: "NGN",
    }),
    "USD",
  );
});

Deno.test("Host plan money keeps the Host currency and fx snapshot", () => {
  const money = boundPlanMoney({
    plan: { owner_kind: "host", brand_id: HOST_BRAND },
    allocation: { ...allocation, host_currency: "NGN", fx_snapshot_id: "fx-1" },
    planVersionId: "v",
    planHash: "b".repeat(64),
    providerDeliveryBudgetCents: 100,
  });
  assertEquals(money.host_currency, "NGN");
  assertEquals(money.fx_snapshot_id, "fx-1");
  assertEquals(
    boundPlanCampaignCurrency({ owner_kind: "host", brand_id: HOST_BRAND }, {
      ...allocation,
      host_currency: "NGN",
    }),
    "NGN",
  );
});

Deno.test("brand_id: a bound plan's brand_id is final, whatever page it promotes", async () => {
  let resolverCalls = 0;
  const eventBrand = () => {
    resolverCalls++;
    return Promise.resolve(EVENT_BRAND);
  };
  // The production case: Mingla plan (brand NULL) promoting a Host event.
  assertEquals(
    await campaignPersistBrandId(
      { owner_kind: "mingla", brand_id: null },
      "event",
      eventBrand,
    ),
    null,
  );
  assertEquals(
    await campaignPersistBrandId(
      { owner_kind: "host", brand_id: HOST_BRAND },
      "event",
      eventBrand,
    ),
    HOST_BRAND,
  );
  assertEquals(resolverCalls, 0);
  // Unbound (validate-only) keeps the destination behaviour.
  assertEquals(await campaignPersistBrandId(null, "marketing", eventBrand), null);
  assertEquals(await campaignPersistBrandId(null, "event", eventBrand), EVENT_BRAND);
  assertEquals(resolverCalls, 1);
});

Deno.test("every provider persist site routes plan money and brand through the binding", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  // google demand-gen, google, snapchat, tiktok, reddit, meta
  const sites = src.match(
    /brand_id: await campaignPersistBrandId\(\s*\n\s*boundPlanOwnership,/g,
  );
  assertEquals(sites?.length, 6);
  assertEquals(/brand_id: pageType[A-Z]* === "marketing"/.test(src), false);
  assertEquals(src.includes("host_currency: String(allocation.host_currency)"), false);
  assertEquals(src.includes("customerCurrency = String(allocation.host_currency)"), false);
  assert(src.includes("planMoney = boundPlanMoney({"));
  assert(src.includes("brand_id: typeof plan.brand_id === \"string\" ? plan.brand_id : null"));
});

Deno.test("Meta persist-failure rollback deletes the campaign before the creative", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const tail = src.slice(src.lastIndexOf("if (persistError) {"));
  const campaign = tail.indexOf("await adapter.rollbackCampaign(");
  const creative = tail.indexOf("await adapter.rollbackCreative(");
  assert(campaign > 0 && creative > 0);
  assert(
    campaign < creative,
    "the ad still references the creative until the campaign is deleted",
  );
  assert(tail.includes("campaign_rolled_back: rollbackOk"));
});

Deno.test("a plan hash reaches the provider at most once", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const guard = src.indexOf('detail: "provider_campaign_already_exists"');
  const terminal = src.indexOf("detail: `provider_attempt_${priorAttempt.state}`");
  const firstProviderCreate = src.indexOf(
    "await googleCreateDemandGenVideoCampaign(",
  );
  assert(guard > 0 && terminal > 0);
  assert(guard < firstProviderCreate && terminal < firstProviderCreate);
  assert(src.includes('.eq("idempotency_key", `${planHash}:${platform}:create`)'));
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20271122003697_issue_3697_one_campaign_per_plan_provider.sql",
      import.meta.url,
    ),
  );
  assert(migration.includes("ON public.ad_campaigns (plan_version_id, platform)"));
});
