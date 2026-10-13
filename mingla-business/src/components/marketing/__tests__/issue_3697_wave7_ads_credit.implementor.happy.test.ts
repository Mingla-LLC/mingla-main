/**
 * toward #3697 Wave 7 — Blast → Ads registration + quote/error behavior.
 *
 * Source contracts + pure mapper tests (RTL is not a default dep here).
 */

import fs from "node:fs";
import path from "node:path";

import { AdCreditAppError } from "../../../services/adCreditService";
import { mapAdCreditQuoteError } from "../AdCreditQuoteSheet";

// __tests__ → marketing → components → src → mingla-business
const root = path.resolve(__dirname, "../../../..");

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

  it("ships the ads route with view-error before denial, and wallet wiring", () => {
    const route = read("app/(tabs)/marketing/ads/index.tsx");
    expect(route).toContain("useAdCreditWallet");
    expect(route).toContain("AdCreditQuoteSheet");
    expect(route).toContain("ads-credit-screen");
    expect(route).toContain("ads-view-error");
    const viewErrorAt = route.indexOf("walletQuery.viewError");
    const deniedAt = route.indexOf("!walletQuery.canView");
    expect(viewErrorAt).toBeGreaterThan(-1);
    expect(deniedAt).toBeGreaterThan(viewErrorAt);
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

  it("brand Ads navigation sets currentBrandId before the tab route", () => {
    const profile = read("src/components/brand/BrandProfileView.tsx");
    expect(profile).toContain("onAds");
    expect(profile).toContain('label: "Ads"');
    const brandRoute = read("app/brand/[id]/index.tsx");
    expect(brandRoute).toContain("setCurrentBrandId(brandId)");
    expect(brandRoute).toContain("/(tabs)/marketing/ads");
  });

  it("wallet hook folds isAuthReady into enabled (ORCH-1004)", () => {
    const hook = read("src/hooks/marketing/useAdCreditWallet.ts");
    expect(hook).toContain("isAuthReady");
    expect(hook).toMatch(/const\s+enabled\s*=\s*[^;]*\bisAuthReady\b/);
  });

  it("quote sheet clears prior quotes when the amount changes", () => {
    const sheet = read("src/components/marketing/AdCreditQuoteSheet.tsx");
    expect(sheet).toContain("Editing the amount invalidates any prior Preview quote");
    expect(sheet).toContain("setTopUp(null)");
    expect(sheet).toContain("[majorText]");
  });
});

describe("mapAdCreditQuoteError", () => {
  it("maps known machine details to actionable copy", () => {
    expect(
      mapAdCreditQuoteError(
        new AdCreditAppError("validation_error", "x", "pay_below_minimum"),
      ),
    ).toMatch(/minimum/i);
    expect(
      mapAdCreditQuoteError(
        new AdCreditAppError("validation_error", "x", "pay_above_maximum"),
      ),
    ).toMatch(/maximum/i);
    expect(
      mapAdCreditQuoteError(
        new AdCreditAppError("validation_error", "x", "currency_unsupported"),
      ),
    ).toMatch(/not supported/i);
  });

  it("never surfaces unknown machine tokens", () => {
    expect(
      mapAdCreditQuoteError(
        new AdCreditAppError("validation_error", "x", "some_new_token"),
      ),
    ).toBe("Could not quote. Try again.");
    expect(mapAdCreditQuoteError(new Error("boom"))).toBe(
      "Could not quote. Try again.",
    );
  });
});
