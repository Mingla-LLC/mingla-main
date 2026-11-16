// MINGLA-INVARIANT: I-4238-W6C-DAILY-EDIT | issue #4238 W6c | The edit sheet steps the DAILY amount the Host pays (15% fee inside, via hostAdPlanBudget / hostAdPayFromCredit), shows the run total and the extra to hold, sends the TOTAL in credit, and never steps below the one-ad-set minimum; a notice for another brand switches to it only when the person is on that team, else says so; statements and receipts show the ad's name.
/**
 * FAILS-ON-REVERT (each fix deleted, suite failed, restored; hash in the issue comment):
 * - hostAdEditDailyMoney sending the daily pay as credit (no hostAdPlanBudget) → "daily edit" fails;
 * - hostAdEditMinDailyPay dropping the app minimum → "minimum" fails;
 * - hostAdBrandLinkDecision always "stay" → "brand link" fails;
 * - the `brand` param dropped from adTarget → "deep link carries the brand" fails;
 * - the statement row label back to "Ad N" → "statement names" fails.
 */
import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import {
  hostAdBrandLinkDecision,
  hostAdEditDailyMoney,
  hostAdEditMinDailyPay,
  hostAdRunDaysFromBudget,
} from "../hostAdManageModel";
import { hostAdPayFromCredit, hostAdPlanBudget } from "../hostAdBuilderModel";
import { parseBusinessDeepLink, resolveBusinessNavTarget } from "../../../../services/businessNotificationRouting";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const readRepo = (rel: string): string => fs.readFileSync(path.join(ROOT, "..", rel), "utf8");
const PLAN = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const BRAND = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("W6c: edit sheet steps the daily amount", () => {
  // A 5-day ad: 8,500 credit a day (pay 10,000), cap 42,500 credit (pay 50,000).
  const base = { startDailyPay: 10_000, runDays: 5, capCredit: 42_500, spentCredit: 8_500, walletCredit: 0, learning: false, step: 500 };

  test("daily edit: run total, extra to hold and the credit the server gets", () => {
    const m = hostAdEditDailyMoney({ ...base, dailyPay: 12_000 });
    expect(m.runTotalPay).toBe(60_000);
    expect(m.newCredit).toBe(hostAdPlanBudget({ dailyPayCents: 12_000, runDays: 5 }).capCreditCents);
    expect(m.newCredit).toBe(51_000);
    expect(m.changePay).toBe(hostAdPayFromCredit(51_000 - 42_500));
    expect(m.dailyChanged).toBe(true);
    // not enough free credit: the gap is rounded up to the step
    expect(m.topUpPay).toBeGreaterThan(0);
    expect(m.topUpPay % 500).toBe(0);
  });

  test("an untouched daily amount sends the cap as it is (no rounding edit)", () => {
    const m = hostAdEditDailyMoney({ ...base, dailyPay: 10_000 });
    expect(m.dailyChanged).toBe(false);
    expect(m.newCredit).toBe(42_500);
    expect(m.changePay).toBe(0);
  });

  test("a lower daily amount gives money back", () => {
    const m = hostAdEditDailyMoney({ ...base, dailyPay: 8_000 });
    expect(m.changePay).toBeLessThan(0);
    expect(m.topUpPay).toBe(0);
  });

  test("minimum: never below the apps' one-ad-set minimum, nor under what is spent", () => {
    expect(hostAdEditMinDailyPay({ appsMinimumDailyPay: 4_000, spentCredit: 0, runDays: 5, step: 500 })).toBe(4_000);
    expect(hostAdEditMinDailyPay({ appsMinimumDailyPay: null, spentCredit: 0, runDays: 5, step: 500 })).toBe(500);
    // 34,000 credit spent = 40,000 pay over 5 days: 8,000 a day at least
    expect(hostAdEditMinDailyPay({ appsMinimumDailyPay: 4_000, spentCredit: 34_000, runDays: 5, step: 500 })).toBe(8_000);
  });

  test("run days come from cap ÷ daily", () => {
    expect(hostAdRunDaysFromBudget(42_500, 8_500)).toBe(5);
    expect(hostAdRunDaysFromBudget(0, 8_500)).toBe(1);
  });

  test("the sheet steps the daily amount and floors at the minimum", () => {
    const sheet = read("src/components/marketing/ads/HostAdManageSheets.tsx");
    expect(sheet).toContain("setDailyPay((v) => Math.max(minDaily, v - step))");
    expect(sheet).toContain('hm("edit.runTotal"');
    expect(sheet).not.toContain("setTotalPay");
    const screen = read("src/screens/hostAds/HostAdDetailScreen.tsx");
    expect(screen).toContain("dailyCredit={dailyCredit}");
    expect(screen).toContain("minDailyPay={appsMinimumDailyPay}");
  });
});

describe("W6c: a notice for another brand", () => {
  const input = { linkBrandId: BRAND, currentBrandId: "other", listStatus: "ready" as const };

  test("brand link: member switches, non-member is told, loading waits, same brand stays", () => {
    expect(hostAdBrandLinkDecision({ ...input, memberBrandIds: [BRAND, "other"] })).toBe("switch");
    expect(hostAdBrandLinkDecision({ ...input, memberBrandIds: ["other"] })).toBe("notMember");
    expect(hostAdBrandLinkDecision({ ...input, memberBrandIds: [], listStatus: "loading" })).toBe("wait");
    expect(hostAdBrandLinkDecision({ ...input, currentBrandId: BRAND, memberBrandIds: [BRAND] })).toBe("stay");
    expect(hostAdBrandLinkDecision({ ...input, linkBrandId: null, memberBrandIds: [] })).toBe("stay");
    // a list that failed to load never claims "not on the team"
    expect(hostAdBrandLinkDecision({ ...input, memberBrandIds: [], listStatus: "error" })).toBe("stay");
  });

  test("deep link carries the brand", () => {
    expect(parseBusinessDeepLink(`mingla-business://brand/${BRAND}/ads/${PLAN}`)).toBe(`/(tabs)/marketing/ads/${PLAN}?by=plan&brand=${BRAND}`);
    expect(resolveBusinessNavTarget({ type: "business.ad_paused", planId: PLAN, brandId: BRAND })).toBe(
      `/(tabs)/marketing/ads/${PLAN}?by=plan&brand=${BRAND}`,
    );
  });

  test("the detail screen switches, shows the not-on-team state and never looks the ad up first", () => {
    const screen = read("src/screens/hostAds/HostAdDetailScreen.tsx");
    expect(screen).toContain("setCurrentBrandId(linkBrandId)");
    expect(screen).toContain('testID="ads-detail-not-on-team"');
    expect(screen).toContain('linkDecision !== "stay"');
  });
});

describe("W6c: statements name the ad", () => {
  test("statement names: the row shows the server's ad name, never Ad N", () => {
    const sheet = read("src/components/marketing/ads/HostAdManageSheets.tsx");
    expect(sheet).toContain("row.ad_name?.trim()");
    expect(sheet).not.toMatch(/detail\.title"\)\} \$\{index \+ 1\}/);
    const server = readRepo("supabase/functions/_shared/adCreditStatements.ts");
    expect(server).toContain("ad_name: input.names?.get(ad_key) ?? null");
    expect(readRepo("supabase/functions/ad-credit/index.ts")).toContain("loadAdNames(nameQuery(supabase)");
  });
});
