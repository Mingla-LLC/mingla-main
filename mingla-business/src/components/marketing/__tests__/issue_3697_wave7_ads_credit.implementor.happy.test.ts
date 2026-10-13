/**
 * toward #3697 Wave 7 — Blast → Ads registration + ad-credit client contract.
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("issue #3697 Wave 7 Ads credit Host surface", () => {
  it("registers Ads in MarketingSubNav and routes to /(tabs)/marketing/ads", () => {
    const nav = read("src/components/marketing/MarketingSubNav.tsx");
    expect(nav).toContain('id: "ads"');
    expect(nav).toContain('label: "Ads"');
    expect(nav).toContain('path: "/(tabs)/marketing/ads"');
    expect(nav).toContain('lower.includes("/marketing/ads")');
  });

  it("ships the ads route screen wired to get_wallet / quotes", () => {
    const route = read("app/(tabs)/marketing/ads/index.tsx");
    expect(route).toContain("useAdCreditWallet");
    expect(route).toContain("AdCreditQuoteSheet");
    expect(route).toContain("ads-credit-screen");
    expect(route).toContain("ads-add-credit");
    expect(route).toContain("ads-withdraw");
  });

  it("adCreditService invokes the ad-credit edge with known actions", () => {
    const svc = read("src/services/adCreditService.ts");
    expect(svc).toContain('invoke("ad-credit"');
    expect(svc).toContain('action: "get_wallet"');
    expect(svc).toContain('action: "quote_top_up"');
    expect(svc).toContain('action: "quote_withdraw"');
    expect(svc).not.toContain("apply_top_up");
    expect(svc).not.toContain("apply_withdraw");
  });

  it("brand profile exposes a compact Ads row into Blast → Ads", () => {
    const profile = read("src/components/brand/BrandProfileView.tsx");
    expect(profile).toContain("onAds");
    expect(profile).toContain('label: "Ads"');
    const brandRoute = read("app/brand/[id]/index.tsx");
    expect(brandRoute).toContain("handleOpenAds");
    expect(brandRoute).toContain("/(tabs)/marketing/ads");
  });
});
