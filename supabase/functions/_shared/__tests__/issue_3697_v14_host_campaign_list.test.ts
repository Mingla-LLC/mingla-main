import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildHostCampaignList } from "../hostAdCampaignList.ts";

Deno.test("#3697 Host campaign list aggregates one plan without adding currencies", () => {
  const rows = buildHostCampaignList({
    campaigns: [{
      id: "campaign-meta",
      name: "Island weekend",
      status: "ACTIVE",
      platform: "meta",
      currency: "USD",
      plan_version_id: "version-1",
      starts_at: "2026-10-20T00:00:00.000Z",
      dest_page_type: "event",
      dest_url: "https://usemingla.com/e/island",
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-05T00:00:00.000Z",
    }, {
      id: "campaign-tiktok",
      name: "Island weekend",
      status: "PAUSED",
      platform: "tiktok",
      currency: "NGN",
      plan_version_id: "version-1",
      starts_at: "2026-10-20T00:00:00.000Z",
      dest_page_type: "event",
      dest_url: "https://usemingla.com/e/island",
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-05T00:00:00.000Z",
    }],
    versions: [{
      id: "version-1",
      host_currency: "NGN",
      host_budget_cents: 900_000,
      canonical_plan: {
        name: "Deserted Island 6.0",
        measurement: { result_hierarchy: ["ticket_purchase"] },
      },
    }],
    plans: [{
      id: "plan-1",
      current_version_id: "version-1",
      state: "partially_live",
      updated_at: "2026-10-06T00:00:00.000Z",
    }],
    spend: [{
      campaign_id: "campaign-meta",
      spend_cents: 500,
      currency: "USD",
      impressions: 1000,
      clicks: 50,
    }, {
      campaign_id: "campaign-tiktok",
      spend_cents: 20_000,
      currency: "NGN",
      impressions: 2000,
      clicks: 100,
    }],
    conversions: [{
      campaign_id: "campaign-meta",
      value_cents: 12_000,
      currency: "ngn",
    }, {
      campaign_id: "campaign-tiktok",
      value_cents: 8_000,
      currency: "NGN",
    }],
    adSets: [{ id: "set-meta", campaign_id: "campaign-meta" }],
    ads: [{
      id: "ad-meta",
      ad_set_id: "set-meta",
      name: "Reel",
      status: "PAUSED",
      review_status: "REJECTED",
      ad_creatives: {
        id: "creative-1",
        name: "Island reel",
        kind: "video",
        poster_url: "https://media.example/poster.jpg",
      },
    }],
    nowIso: "2026-10-17T00:00:00.000Z",
  });

  assertEquals(rows.length, 1);
  assertEquals(rows[0].campaign_ids, ["campaign-meta", "campaign-tiktok"]);
  assertEquals(rows[0].platforms, ["meta", "tiktok"]);
  assertEquals(rows[0].lifecycle, "needs_attention");
  assertEquals(rows[0].next_action, "Fix issue");
  assertEquals(rows[0].currency, "NGN");
  assertEquals(rows[0].host_spend_equivalent_cents, null);
  assertEquals(rows[0].spend_by_currency, [{
    currency: "NGN",
    spend_cents: 20_000,
  }, { currency: "USD", spend_cents: 500 }]);
  assertEquals(rows[0].primary_result_label, "ticket_purchase");
  assertEquals(rows[0].primary_result_count, 2);
  assertEquals(rows[0].results_value_cents, { NGN: 20_000 });
  assertEquals(rows[0].cost_per_result_cents, null);
  assertEquals(rows[0].impressions, 3000);
  assertEquals(rows[0].creative, {
    name: "Island reel",
    kind: "video",
    preview_url: "https://media.example/poster.jpg",
    review_status: "REJECTED",
  });
});

Deno.test("#3697 Host campaign list reports safe same-currency cost per result", () => {
  const [row] = buildHostCampaignList({
    campaigns: [{
      id: "campaign-1",
      name: "Feed ad",
      status: "PAUSED",
      platform: "meta",
      currency: "NGN",
      cap_cents: 100_000,
      starts_at: "2026-10-20T00:00:00.000Z",
      created_at: "2026-10-01T00:00:00.000Z",
    }],
    versions: [],
    plans: [],
    spend: [{
      campaign_id: "campaign-1",
      spend_cents: 30_000,
      currency: "NGN",
    }],
    conversions: [{
      campaign_id: "campaign-1",
      value_cents: 200,
      currency: "NGN",
    }, {
      campaign_id: "campaign-1",
      value_cents: 300,
      currency: null,
    }, {
      campaign_id: "campaign-1",
      value_cents: 400,
      currency: "USD",
    }],
    adSets: [],
    ads: [],
    nowIso: "2026-10-17T00:00:00.000Z",
  });

  assertEquals(row.lifecycle, "scheduled");
  assertEquals(row.host_spend_equivalent_cents, 30_000);
  assertEquals(row.cost_per_result_cents, 10_000);
  assertEquals(row.results_value_cents, { NGN: 500, USD: 400 });
});

Deno.test("#3697 Host resume is permissioned, typed and aggregate-wide", async () => {
  const endpoint = await Deno.readTextFile(
    new URL("../../admin-ad-campaign-action/index.ts", import.meta.url),
  );
  // [TEST-MOD-APPROVED #3697] v1.4 maps each Host mutation to its independent
  // action permission instead of deriving authority from one role ladder.
  assertEquals(
    endpoint.includes('action === "launch"\n      ? { p_action: "launch" }'),
    true,
  );
  assertEquals(endpoint.includes(': { p_action: "pause" }'), true);
  assertEquals(endpoint.includes("...hostPermission"), true);
  assertEquals(endpoint.includes("p_user_id: user.id"), true);
  assertEquals(endpoint.includes('if (!adminRow && action === "end")'), true);
  assertEquals(endpoint.includes("return runPlannedAction({"), true);
  assertEquals(
    endpoint.includes('detail: "confirm_phrase_must_be_LAUNCH"'),
    true,
  );
});
