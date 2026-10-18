import fs from "node:fs";
import path from "node:path";

import type { HostAdCampaign } from "../hostAdCampaignService";
import {
  homeAdCanPause,
  homeAdDestructiveAction,
  selectHomeAdCampaigns,
} from "../../utils/homeAdLifecycle";

const ROOT = path.resolve(__dirname, "../../..");

function campaign(
  id: string,
  lifecycle: HostAdCampaign["lifecycle"],
  spend = 0,
  overrides: Partial<HostAdCampaign> = {},
): HostAdCampaign {
  return {
    id,
    name: `Campaign ${id}`,
    status: lifecycle,
    platform: "meta",
    daily_budget_cents: 3_000,
    lifetime_budget_cents: 30_000,
    cap_cents: 30_000,
    currency: "NGN",
    starts_at: null,
    ends_at: null,
    dest_page_type: "event",
    dest_url: "https://usemingla.com/e/example",
    brand_id: "brand-1",
    owner_kind: "host",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    plan_version_id: `plan-${id}`,
    plan_state: lifecycle,
    lifecycle,
    next_action: "open_details",
    campaign_ids: [id],
    platforms: ["meta"],
    destination: {
      page_type: "event",
      url: "https://usemingla.com/e/example",
    },
    host_spend_equivalent_cents: spend,
    spend_by_currency:
      spend > 0 ? [{ currency: "NGN", spend_cents: spend }] : [],
    primary_result_label: "ticket sales",
    primary_result_count: 0,
    cost_per_result_cents: null,
    impressions: 0,
    clicks: 0,
    creative: null,
    ...overrides,
  };
}

describe("#3697 Host Home Ads lifecycle", () => {
  it("shows Cancel before provider spend and End after spend, never both", () => {
    const unspent = campaign("unspent", "live");
    const spent = campaign("spent", "live", 450);

    expect(homeAdDestructiveAction(unspent)).toBe("cancel");
    expect(homeAdDestructiveAction(spent)).toBe("end");
    expect(homeAdDestructiveAction(campaign("ended", "ended"))).toBeNull();
    expect(homeAdCanPause(unspent)).toBe(true);
    expect(homeAdCanPause(campaign("paused", "paused"))).toBe(false);
  });

  it("deduplicates immutable plans and prioritizes attention before live delivery", () => {
    const older = campaign("old", "live", 0, {
      plan_version_id: "same-plan",
      updated_at: "2026-10-01T00:00:00Z",
    });
    const newer = campaign("new", "live", 0, {
      plan_version_id: "same-plan",
      updated_at: "2026-10-02T00:00:00Z",
    });
    const attention = campaign("attention", "needs_attention");
    const ended = campaign("ended", "ended");

    expect(
      selectHomeAdCampaigns([older, newer, ended, attention]).map(
        (row) => row.id,
      ),
    ).toEqual(["attention", "new"]);
  });

  it("renders Ads immediately after live offerings on desktop and mobile", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "app/(tabs)/home.tsx"),
      "utf8",
    );
    const placements = source.match(
      /\{renderLiveSection\(\)\}\s*<HomeAdsSection brandId=\{currentBrand\.id\} \/>/g,
    );
    expect(placements).toHaveLength(2);
  });

  it("requires typed confirmation for destructive Home and detail actions", () => {
    const home = fs.readFileSync(
      path.join(ROOT, "src/components/home/HomeAdsSection.tsx"),
      "utf8",
    );
    const detail = fs.readFileSync(
      path.join(ROOT, "app/(tabs)/marketing/ads/[id].tsx"),
      "utf8",
    );
    for (const source of [home, detail]) {
      expect(source).toContain('variant="typeToConfirm"');
      expect(source).toContain('"END" : "CANCEL"');
    }
    expect(home).toContain("homeAdDestructiveAction(campaign)");
  });

  it("refreshes Home Ads through the shared query-key authority", () => {
    const home = fs.readFileSync(
      path.join(ROOT, "app/(tabs)/home.tsx"),
      "utf8",
    );
    const hook = fs.readFileSync(
      path.join(ROOT, "src/hooks/marketing/useHostAdCampaigns.ts"),
      "utf8",
    );
    expect(home).toContain("hostAdCampaignKeys.byBrand(currentBrand.id)");
    expect(hook).toContain("hostAdCampaignKeys.byBrand(brandId)");
  });
});
