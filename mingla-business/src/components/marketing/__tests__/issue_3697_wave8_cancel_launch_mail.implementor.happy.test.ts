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
    // [TEST-MOD-APPROVED #3697] filters now cover the complete v1.4 lifecycle
    // and generate stable IDs from the canonical filter keys.
    expect(route).toContain('{ key: "all", label: "All" }');
    expect(route).toContain('{ key: "live", label: "Live" }');
    expect(route).toContain('{ key: "paused", label: "Paused" }');
    expect(route).toContain('{ key: "ended", label: "Ended" }');
    expect(route).toContain(
      'testID={`ads-filter-${key.replaceAll("_", "-")}`}',
    );
    expect(route).toContain("hostAdMatchesFilter");
  });
});
