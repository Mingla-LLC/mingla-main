/**
 * #2514 happy-path regression — campaign reads are scoped to the BRAND.
 *
 * Before this, `listCampaigns` and `getMarketingOverview` filtered on
 * `account_id` and never mentioned `brand_id`. That broke in both directions:
 * standing inside Brand A you saw your own Brand B campaigns, and you could
 * not see campaigns created by a teammate on the brand you were actually in.
 * On 2026-08-24 that meant the person with authority to re-send a stalled
 * blast could not find the campaign at all.
 *
 * FAILS ON REVERT: restore `.eq("account_id", …)` and the filter assertions
 * below go red.
 */
import { readFileSync } from "fs";
import { join } from "path";

const SVC_DIR = join(__dirname, "..");
const CAMPAIGN_SVC = readFileSync(
  join(SVC_DIR, "marketingCampaignService.ts"),
  "utf8",
);
const OVERVIEW_SVC = readFileSync(
  join(SVC_DIR, "marketingOverviewService.ts"),
  "utf8",
);

/** The `listCampaigns` body only — other functions legitimately use account. */
function listCampaignsBody(): string {
  const start = CAMPAIGN_SVC.indexOf("export async function listCampaigns");
  expect(start).toBeGreaterThan(-1);
  const end = CAMPAIGN_SVC.indexOf("export async function getCampaign", start);
  return CAMPAIGN_SVC.slice(start, end);
}

describe("#2514 listCampaigns", () => {
  it("filters on brand_id", () => {
    expect(listCampaignsBody()).toContain('.eq("brand_id", input.brand_id)');
  });

  it("no longer filters on account_id — that is what hid teammates' work", () => {
    expect(listCampaignsBody()).not.toContain('.eq("account_id"');
  });

  it("validates the brand id it was given", () => {
    expect(listCampaignsBody()).toContain(
      'assertUuid(input.brand_id, "listCampaigns.brand_id")',
    );
  });
});

describe("#2514 getMarketingOverview", () => {
  it("scopes both windowed reads to the brand", () => {
    const matches = OVERVIEW_SVC.split('.eq("brand_id", input.brand_id)').length - 1;
    expect(matches).toBe(2);
  });

  it("no longer sums the funnel across every brand you belong to", () => {
    expect(OVERVIEW_SVC).not.toContain('.eq("account_id"');
  });
});

describe("#2514 cache keys", () => {
  const KEYS = readFileSync(
    join(SVC_DIR, "..", "..", "hooks", "marketing", "marketingKeys.ts"),
    "utf8",
  );

  it("keys the campaign list by brand, so switching brand cannot serve a stale list", () => {
    expect(KEYS).toContain('["marketing", "campaigns", "list", brandId');
  });

  it("keys the overview by brand", () => {
    expect(KEYS).toContain("byBrand:");
    expect(KEYS).not.toContain("byAccount:");
  });
});
