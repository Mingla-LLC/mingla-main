/**
 * toward #3697 Wave 7 — Blast → Ads registration + quote/error behavior.
 *
 * Source contracts only (no RN component imports — Button → reanimated breaks Jest).
 * Behavioral invoke + error-mapper coverage lives in
 * src/services/__tests__/adCreditService.issue3697.wave7.happy.test.ts.
 */

import fs from "node:fs";
import path from "node:path";

import { AdCreditAppError } from "../../../services/adCreditService";
import { mapAdCreditQuoteError } from "../../../services/adCreditQuoteErrors";

// __tests__ → marketing → components → src → mingla-business
const root = path.resolve(__dirname, "../../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("issue #3697 Wave 7 Ads credit Host surface", () => {
  it("registers Ads in MarketingSubNav and routes to /(tabs)/marketing/ads", () => {
    // #3872 round 2: the tab list moved to a pure module the sub-nav renders.
    const nav = read("src/components/marketing/marketingSubNavTabs.ts");
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
    expect(svc).toContain('action: "start_top_up"');
    expect(svc).toContain('action: "apply_top_up"');
    // Wave 7c unlocks Confirm withdraw (apply_withdraw).
    expect(svc).toContain('action: "apply_withdraw"');
  });

  // #3872 round 2: the brand page's Referrals, Creators and Ads rows became
  // one Promote row that opens Blast (Ads is a Blast tab). The pointer rule
  // this test guards is unchanged: set the current brand before the tab route.
  it("brand Promote navigation sets currentBrandId before the Blast route", () => {
    const profile = read("src/components/brand/BrandProfileView.tsx");
    expect(profile).toContain("onPromote");
    expect(profile).toContain(">Promote<");
    const brandRoute = read("app/brand/[id]/index.tsx");
    expect(brandRoute).toMatch(
      /setCurrentBrandId\(brandId\);\s*router\.push\("\/\(tabs\)\/marketing"/,
    );
  });

  it("wallet hook folds isAuthReady into enabled (ORCH-1004)", () => {
    const hook = read("src/hooks/marketing/useAdCreditWallet.ts");
    expect(hook).toContain("isAuthReady");
    expect(hook).toMatch(/const\s+enabled\s*=\s*[^;]*\bisAuthReady\b/);
  });

  it("quote sheet clears prior quotes when the amount changes", () => {
    const sheet = read("src/components/marketing/AdCreditQuoteSheet.tsx");
    expect(sheet).toContain("Editing the amount (or switching mode) invalidates any prior Preview quote");
    expect(sheet).toContain("setTopUp(null)");
    expect(sheet).toContain("[majorText, mode]");
    expect(sheet).toContain("mapAdCreditQuoteError");
  });

  it("Wave 7b: Confirm and pay + Checkout return wiring", () => {
    const sheet = read("src/components/marketing/AdCreditQuoteSheet.tsx");
    expect(sheet).toContain("ad-credit-quote-confirm-pay");
    expect(sheet).toContain("startAdCreditTopUp");
    expect(sheet).toContain("applyAdCreditTopUp");
    expect(sheet).toContain("randomId");
    expect(sheet).toContain("idempotencyKey");
    expect(sheet).toContain("topUpIdemRef");
    const route = read("app/(tabs)/marketing/ads/index.tsx");
    expect(route).toContain("checkoutSessionId");
    expect(route).toContain("ad_credit_top_up");
    const edge = read("../supabase/functions/ad-credit/index.ts");
    expect(edge).toContain("idempotency_key_required");
    expect(edge).toContain("isAllowedAdCreditReturnUrl");
    expect(edge).toContain("buildAdCreditCheckoutReturnUrls");
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
    ).toMatch(/NGN/i);
    expect(
      mapAdCreditQuoteError(
        new AdCreditAppError("validation_error", "x", "payment_not_succeeded"),
      ),
    ).toMatch(/did not complete/i);
  });

  it("never surfaces unknown machine tokens", () => {
    expect(
      mapAdCreditQuoteError(
        new AdCreditAppError("validation_error", "x", "some_new_token"),
      ),
    ).toBe("Could not complete Ads credit. Try again.");
    expect(mapAdCreditQuoteError(new Error("boom"))).toBe(
      "Could not quote. Try again.",
    );
  });
});
