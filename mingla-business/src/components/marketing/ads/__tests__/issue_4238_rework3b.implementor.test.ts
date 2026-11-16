// MINGLA-INVARIANT: I-4238-HOME-TOTAL-PAY-TERMS | issue #4238 rework 3b | The Home Ads card total covers every active ad (not only the tiles shown) and is what the Host pays (hostAdPayFromCredit, as Promote); the detail "Day by day" card carries its terms line in all 29 Host locales.
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

import { hostAdPayFromCredit } from "../hostAdBuilderModel";
import { homeAdPayTotals } from "../../../../utils/homeAdLifecycle";
import type { HostAdCampaign } from "../../../../services/hostAdCampaignService";

const ad = (id: string, spent: number, cap: number): HostAdCampaign =>
  ({
    id,
    plan_version_id: id,
    lifecycle: "live",
    currency: "USD",
    cap_cents: cap,
    lifetime_budget_cents: null,
    host_spend_equivalent_cents: spent,
    spend_by_currency: [],
  }) as unknown as HostAdCampaign;

describe("#4238 rework 3b: Home ads total", () => {
  const six = [1, 2, 3, 4, 5, 6].map((n) => ad(`a${n}`, n * 10_000, n * 50_000));

  test("covers all ads, not the first four", () => {
    const total = homeAdPayTotals(six).get("USD");
    const credit = { spent: 210_000, budget: 1_050_000 };
    expect(total?.spent).toBe(hostAdPayFromCredit(credit.spent));
    expect(total?.budget).toBe(hostAdPayFromCredit(credit.budget));
    const four = homeAdPayTotals(six.slice(0, 4)).get("USD");
    expect(total?.spent).toBeGreaterThan(four?.spent ?? 0);
  });

  test("is in pay terms (15% fee inside), summed in credit then converted once", () => {
    const total = homeAdPayTotals([ad("x", 85_000, 170_000)]).get("USD");
    expect(total).toEqual({ spent: 100_000, budget: 200_000 });
  });

  test("the section uses the shared helper on all active ads", () => {
    const src = readFileSync(join(__dirname, "../../../home/HomeAdsSection.tsx"), "utf8");
    expect(src).toMatch(/homeAdPayTotals\(activeCampaigns\)/);
    expect(src).not.toMatch(/summaryTotals\(campaigns\)/);
  });
});

describe("#4238 rework 3b: Day by day terms label", () => {
  const dir = join(__dirname, "../../../../i18n/locales");
  const locales = readdirSync(dir).filter((l) => !l.startsWith("."));
  const read = (l: string): { manage?: { detail?: Record<string, string> } } | Record<string, unknown> =>
    JSON.parse(readFileSync(join(dir, l, "hostAds.json"), "utf8")) as Record<string, unknown>;
  const find = (obj: unknown): string | undefined => {
    if (obj === null || typeof obj !== "object") return undefined;
    const rec = obj as Record<string, unknown>;
    if (typeof rec.dayByDayTerms === "string") return rec.dayByDayTerms;
    for (const v of Object.values(rec)) {
      const hit = find(v);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };

  test("29 locales each have a non-empty dayByDayTerms", () => {
    expect(locales).toHaveLength(29);
    for (const l of locales) expect((find(read(l)) ?? "").length).toBeGreaterThan(10);
  });

  test("the detail screen renders it under the Day by day label", () => {
    const src = readFileSync(join(__dirname, "../../../../screens/hostAds/HostAdDetailScreen.tsx"), "utf8");
    expect(src).toMatch(/hm\("detail\.dayByDayTerms"\)/);
  });
});
