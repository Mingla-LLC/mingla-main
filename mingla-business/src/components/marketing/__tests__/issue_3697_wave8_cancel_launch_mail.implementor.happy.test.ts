/**
 * toward #3697 Wave 8 — Cancel vs End mutual exclusion + Ads list filters.
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("issue #3697 Wave 8 Cancel / End / filters", () => {
  it("detail shows Cancel or End never both (spend-gated)", () => {
    const detail = read("app/(tabs)/marketing/ads/[id].tsx");
    expect(detail).toContain("ads-detail-cancel");
    expect(detail).toContain("ads-detail-end");
    expect(detail).toContain("canCancel");
    expect(detail).toContain("canEnd");
    // [TEST-MOD-APPROVED #3697] v1.4 uses provider-account spend as the
    // cancellation authority; Host-currency conversion may be unavailable.
    expect(detail).toContain("hasProviderSpend");
    expect(detail).toContain("Number(row.spend_cents) > 0");
    expect(detail).toContain("!isEnded && !hasProviderSpend");
    expect(detail).toContain("!isEnded && hasProviderSpend");
    expect(detail).toContain("cancelHostAdCampaign");
  });

  it("service exposes cancel action", () => {
    const svc = read("src/services/hostAdCampaignService.ts");
    expect(svc).toContain("cancelHostAdCampaign");
    expect(svc).toContain('action: "cancel"');
  });

  it("Ads list has status filters", () => {
    const route = read("app/(tabs)/marketing/ads/index.tsx");
    expect(route).toContain("ads-campaign-filters");
    expect(route).toContain("ads-filter-all");
    expect(route).toContain("ads-filter-live");
    expect(route).toContain("ads-filter-paused");
    expect(route).toContain("ads-filter-ended");
    expect(route).toContain("campaignMatchesFilter");
  });
});
