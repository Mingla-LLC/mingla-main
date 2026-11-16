// Issue #4238 — independent tester, final gate (branch 4238-host-ads-excellent).
//
// Angles the implementor suites do not take:
//  1. Executable client/server money parity over a whole range (the
//     implementor parity test compares the two files' text).
//  2. The edit sheet fed what the server REALLY sends: ad_campaigns rows whose
//     daily_budget_cents is null (TikTok ad group / Snapchat ad squad budgets,
//     Reddit, Meta with a reminder ad set, run totals) or in the ad account's
//     money (USD) for a Naira brand.
//
// Cases marked `test.failing` reproduce defects reported in the tester verdict
// on #4238 (P1-2, P1-3). They pass while the defect is present. When the fix
// lands they start failing: turn each into a plain `test` then.

import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import {
  hostAdCreditFromPay,
  hostAdPayFromCredit,
  hostAdPlanBudget,
} from "../hostAdBuilderModel";
import {
  hostAdEditDailyMoney,
  hostAdEditMinDailyPay,
  hostAdEditStep,
  hostAdRunDaysFromBudget,
} from "../hostAdManageModel";

const REPO = path.resolve(__dirname, "../../../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

// The server's formulas, executed (adMoney.ts creditCentsFromPay / hostMinimumPayCents).
const serverCredit = (pay: number): number => (Number.isInteger(pay) && pay > 0 ? Math.floor(pay * (1 - 0.15)) : 0);
const serverPay = (credit: number): number =>
  Number.isSafeInteger(credit) && credit > 0 ? Math.ceil((credit * 10_000) / Math.round((1 - 0.15) * 10_000)) : 0;

describe("tester: client money is the server money, executed", () => {
  test("the server still uses these exact formulas", () => {
    const src = read("supabase/functions/_shared/adMoney.ts");
    expect(src).toContain("export const HOST_FEE_RATIO = 0.15;");
    expect(src).toContain("return Math.floor(payCents * (1 - HOST_FEE_RATIO));");
    expect(src).toContain("return Math.ceil((creditCents * 10_000) / keep);");
  });

  test("pay->credit and credit->pay agree with the server for every amount up to 300,000", () => {
    for (let cents = 1; cents <= 300_000; cents++) {
      if (hostAdCreditFromPay(cents) !== serverCredit(cents)) throw new Error(`credit(${cents})`);
      if (hostAdPayFromCredit(cents) !== serverPay(cents)) throw new Error(`pay(${cents})`);
    }
  });

  test("a launch never holds less credit than the sum the apps were told they get", () => {
    for (const daily of [118, 589, 2353, 3060, 10_000, 192_000]) {
      for (const days of [1, 3, 7, 30, 90]) {
        const plan = hostAdPlanBudget({ dailyPayCents: daily, runDays: days });
        expect(plan.capCreditCents).toBe(plan.dailyCreditCents * days);
        expect(hostAdCreditFromPay(plan.holdPayCents)).toBeGreaterThanOrEqual(plan.capCreditCents);
      }
    }
  });
});

describe("tester: edit sheet with a consistent daily/cap (the case the build assumes)", () => {
  test("raising the daily never lowers the run total; lowering never raises it", () => {
    for (const dailyCredit of [100, 500, 2_000, 85_000]) {
      for (const days of [2, 5, 14]) {
        const capCredit = dailyCredit * days;
        const start = hostAdPayFromCredit(dailyCredit);
        const step = hostAdEditStep(start);
        const runDays = hostAdRunDaysFromBudget(capCredit, dailyCredit);
        expect(runDays).toBe(days);
        const common = { startDailyPay: start, runDays, capCredit, spentCredit: 0, walletCredit: 0, learning: false, step };
        const up = hostAdEditDailyMoney({ ...common, dailyPay: start + step });
        const down = hostAdEditDailyMoney({ ...common, dailyPay: Math.max(step, start - step) });
        expect(up.newCredit).toBeGreaterThanOrEqual(capCredit);
        if (start - step >= step) expect(down.newCredit).toBeLessThanOrEqual(capCredit);
        // An untouched daily sends the cap exactly as it is.
        expect(hostAdEditDailyMoney({ ...common, dailyPay: start }).newCredit).toBe(capCredit);
      }
    }
  });

  test("the lowest daily never lets the new total fall under what is spent", () => {
    for (const spent of [0, 1, 999, 41_999]) {
      for (const days of [1, 3, 10]) {
        const step = 100;
        const min = hostAdEditMinDailyPay({ appsMinimumDailyPay: 118, spentCredit: spent, runDays: days, step });
        const total = hostAdPlanBudget({ dailyPayCents: min, runDays: days }).capCreditCents;
        expect(total).toBeGreaterThanOrEqual(spent);
      }
    }
  });
});

describe("tester: what the server really sends the detail screen", () => {
  test("the create path stores daily_budget_cents = null when the budget sits on the ad group / ad squad, and for Reddit", () => {
    const create = read("supabase/functions/admin-ad-create-campaign/index.ts");
    // Snapchat: ad squad budget (the default) -> null on the campaign row.
    expect(create).toMatch(/daily_budget_cents: !snapStages && budgetLevelS === "campaign"\s*\?\s*dailyBudgetForPersist\s*:\s*null/);
    // TikTok: ad group budget (the default) -> null.
    expect(create).toMatch(/daily_budget_cents: !tiktokStages && budgetLevelT === "campaign"/);
    // Reddit: always on the ad group.
    expect(create).toContain("daily_budget_cents: null, // non-CBO: the budget lives on the ad group");
    // Run totals (lifetime) persist no daily either.
    expect(create).toMatch(/dailyBudgetForPersist = budgetType === "lifetime"\s*\?\s*null/);
    // Host Snapchat / TikTok default to ad set level (D-1).
    expect(create).toContain('const budgetLevelS = budget.level === "campaign" ? "campaign" : "adset";');
    expect(create).toContain('const budgetLevelT = budget.level === "campaign" ? "campaign" : "adset";');
  });

  test("the detail screen feeds the edit sheet the SUM of raw ad_campaigns.daily_budget_cents", () => {
    const screen = read("mingla-business/src/screens/hostAds/HostAdDetailScreen.tsx");
    expect(screen).toContain(
      "const dailyCredit = payload.plan_campaigns.reduce((sum, row) => sum + Number(row.daily_budget_cents ?? 0), 0);",
    );
  });

  // P1-2: a live TikTok-only (or Snapchat / Reddit / run-total) ad has
  // dailyCredit 0. The sheet then starts at 0 a day over ONE day, so the first
  // "+" turns a 30-day, 70,000-credit ad into a one-day total.
  test.failing("P1-2: stepping the daily UP on a TikTok-only live ad never cuts the ad's total", () => {
    const capCredit = 70_000;
    const dailyCredit = 0; // what HostAdDetailScreen computes for this ad
    const start = hostAdPayFromCredit(dailyCredit);
    const step = hostAdEditStep(start);
    const runDays = hostAdRunDaysFromBudget(capCredit, dailyCredit);
    const minDaily = hostAdEditMinDailyPay({ appsMinimumDailyPay: 2_353, spentCredit: 10_000, runDays, step });
    const m = hostAdEditDailyMoney({
      dailyPay: minDaily + step,
      startDailyPay: start,
      runDays,
      capCredit,
      spentCredit: 10_000,
      walletCredit: 0,
      learning: false,
      step,
    });
    expect(m.dailyChanged).toBe(true);
    expect(m.newCredit).toBeGreaterThanOrEqual(capCredit);
  });

  // P1-3: for a Naira brand on the USD Meta account, daily_budget_cents is in
  // US cents (the ad account's money), but the screen shows and steps it as
  // kobo credit. 1,000 US cents a day (≈ ₦16,000) reads as ₦11.77.
  test.failing("P1-3: the daily the screen shows is in the brand's money, not the ad account's", () => {
    const screen = read("mingla-business/src/screens/hostAds/HostAdDetailScreen.tsx");
    expect(screen).not.toMatch(/sum \+ Number\(row\.daily_budget_cents \?\? 0\)/);
  });
});
