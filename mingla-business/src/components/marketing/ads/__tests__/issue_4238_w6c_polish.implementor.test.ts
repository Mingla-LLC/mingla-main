// MINGLA-INVARIANT: I-4238-W6C-DAILY-EDIT | issue #4238 | W6c: The edit sheet steps the DAILY amount the Host pays (15% fee inside, via hostAdPlanBudget / hostAdPayFromCredit), shows the run total and the extra to hold, sends the TOTAL in credit, and never steps below the one-ad-set minimum; a notice for another brand switches to it only when the person is on that team, else says so; statements and receipts show the ad's name.
/**
 * FAILS-ON-REVERT (each fix deleted, suite failed, restored; hash in the issue comment):
 * - hostAdEditDailyMoney sending the daily pay as credit (no hostAdPlanBudget) → "daily edit" fails;
 * - hostAdEditMinDailyPay dropping the app minimum → "minimum" fails;
 * - hostAdBrandLinkDecision always "stay" → "brand link" fails;
 * - the `brand` param dropped from adTarget → "deep link carries the brand" fails.
 *
 * #4238 rework 1: the source-text pins of the sheet, the detail screen and the
 * statement server code were replaced by executed behaviour (#1047 gate): the
 * sheet and the receipts sheet are rendered in
 * issue_4238_rework1.implementor.test.tsx, the statement names are executed in
 * supabase/functions/_shared/__tests__/issue_4238_ad_names.test.ts. The edit
 * maths follow the rework: total = spent + daily × days LEFT (tester P1-2).
 */
import { describe, expect, test } from "@jest/globals";

import {
  hostAdBrandLinkDecision,
  hostAdDaysLeft,
  hostAdEditDailyMoney,
  hostAdEditMinDailyPay,
} from "../hostAdManageModel";
import { hostAdCreditFromPay, hostAdPayFromCredit, hostAdPlanBudget } from "../hostAdBuilderModel";
import { parseBusinessDeepLink, resolveBusinessNavTarget } from "../../../../services/businessNotificationRouting";

const PLAN = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const BRAND = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("W6c: edit sheet steps the daily amount", () => {
  // A 5-day ad, day 2: 8,500 credit a day (pay 10,000), cap 42,500 credit, 8,500 spent, 4 days left.
  const base = { startDailyPay: 10_000, daysLeft: 4, capCredit: 42_500, spentCredit: 8_500, walletCredit: 0, learning: false, step: 500 };

  test("daily edit: total = spent + daily credit × days left; extra to hold; the credit the server gets", () => {
    const m = hostAdEditDailyMoney({ ...base, dailyPay: 12_000 });
    expect(m.newCredit).toBe(8_500 + hostAdPlanBudget({ dailyPayCents: 12_000, runDays: 4 }).capCreditCents);
    expect(m.newCredit).toBe(8_500 + hostAdCreditFromPay(12_000) * 4);
    expect(m.newCredit).toBe(49_300);
    expect(m.runTotalPay).toBe(hostAdPayFromCredit(49_300));
    expect(m.daysLeft).toBe(4);
    expect(m.changePay).toBe(hostAdPayFromCredit(49_300 - 42_500));
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

  test("a later end date keeps the daily and adds the new days", () => {
    const m = hostAdEditDailyMoney({ ...base, dailyPay: 10_000, daysLeft: 6, endChanged: true });
    expect(m.newCredit).toBe(8_500 + hostAdCreditFromPay(10_000) * 6);
  });

  test("a lower daily amount gives money back", () => {
    const m = hostAdEditDailyMoney({ ...base, dailyPay: 8_000 });
    expect(m.changePay).toBeLessThan(0);
    expect(m.topUpPay).toBe(0);
  });

  test("minimum: never below the apps' one-ad-set minimum; unknown minimum is one step", () => {
    expect(hostAdEditMinDailyPay({ appsMinimumDailyPay: 4_000, step: 500 })).toBe(4_000);
    expect(hostAdEditMinDailyPay({ appsMinimumDailyPay: null, step: 500 })).toBe(500);
    expect(hostAdEditMinDailyPay({ appsMinimumDailyPay: 0, step: 500 })).toBe(500);
  });

  test("days left come from the end date, never from cap ÷ daily", () => {
    expect(hostAdDaysLeft("2028-07-20T00:00:00Z", "2028-07-25T00:00:00Z")).toBe(5);
    expect(hostAdDaysLeft("2028-07-20T00:00:00Z", "2028-07-20T01:00:00Z")).toBe(1);
    expect(hostAdDaysLeft("2028-07-20T00:00:00Z", null)).toBeNull();
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
});
