/**
 * toward #3697 Wave 9 / closeout — Host provider create/sync.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildHostMetaAtomicInput,
  hostDefaultCountriesForCurrency,
  isSyntheticHostExternalId,
} from "../adCampaignProviderSync.ts";

Deno.test("Wave 9: Host Meta atomic input is OUTCOME_TRAFFIC / LINK_CLICKS CBO", () => {
  const input = buildHostMetaAtomicInput({
    name: "Host launch",
    destUrl: "https://example.com/b/acme/e/party",
    message: "Come say hi",
    imageHash: "abc123hash",
    budgetCents: 2500,
    countries: ["US"],
    startsAt: null,
    endsAt: null,
  });
  assertEquals(input.campaign.objective, "OUTCOME_TRAFFIC");
  assertEquals(input.campaign.dailyBudgetCents, 2500);
  assertEquals(input.campaign.bidStrategy, "LOWEST_COST_WITHOUT_CAP");
  assertEquals(input.adSet.optimizationGoal, "LINK_CLICKS");
  assertEquals(input.creative.imageHash, "abc123hash");
  assertEquals(input.creative.message, "Come say hi");
  assertEquals(
    (input.adSet.targeting as { geo_locations: { countries: string[] } })
      .geo_locations.countries,
    ["US"],
  );
});

Deno.test("Wave 9: currency → default Meta geo countries", () => {
  assertEquals(hostDefaultCountriesForCurrency("USD"), ["US"]);
  assertEquals(hostDefaultCountriesForCurrency("GBP"), ["GB"]);
  assertEquals(hostDefaultCountriesForCurrency("NGN"), ["NG"]);
});

Deno.test("Wave 9: synthetic host_* external ids are detected", () => {
  assertEquals(isSyntheticHostExternalId("host_abc_idem"), true);
  assertEquals(isSyntheticHostExternalId("120212345678901234"), false);
  assertEquals(isSyntheticHostExternalId(null), true);
});

Deno.test("Wave 9: host-ad-campaign wires Meta create + activate compensate", async () => {
  const host = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  assert(host.includes("createFullCampaignAtomic"));
  assert(host.includes("buildHostMetaAtomicInput"));
  assert(host.includes("setCampaignTreeStatus"));
  assert(host.includes("creative_library_id_required"));
  assert(host.includes("creative_not_ready"));
  assert(host.includes("platform_unsupported"));
  assert(host.includes("provider_not_synced"));
  assert(host.includes("launch_activate_fail_return:host:"));
  assert(host.includes("provider_activate_failed"));
  assert(host.includes('provider_sync: "synced"'));
  assertEquals(host.includes('provider_sync: "pending"'), false);
  assertEquals(host.includes("host_${brandCompact}"), false);
});

Deno.test("#3697 closeout: Ari reviews a required video across all five providers", async () => {
  const tools = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  assert(tools.includes("creative_library_id: UUID"));
  assert(tools.includes("HOST_AD_PLATFORMS"));
  assert(tools.includes('"google"'));
  assert(tools.includes('"tiktok"'));
  assert(tools.includes('"snapchat"'));
  assert(tools.includes('"reddit"'));
  assert(tools.includes("buildHostAdCreatePayload"));
  assert(
    tools.includes(
      "creative_library_id must be a uuid of a READY video creative",
    ),
  );
  const prompt = await Deno.readTextFile(
    new URL("../agentSystemPrompt.ts", import.meta.url),
  );
  // [TEST-MOD-APPROVED #3697] the required video is selected before the
  // immutable version is frozen, so typed LAUNCH reviews an already-bound plan.
  assert(
    prompt.includes(
      "Host attaches the required video before Ari freezes the plan",
    ),
  );
  assert(prompt.includes("already video-bound immutable plan"));
});
