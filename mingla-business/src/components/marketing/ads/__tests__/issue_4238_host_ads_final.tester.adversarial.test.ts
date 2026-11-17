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
// Cases marked `test.failing` reproduced defects reported in the tester verdict
// on #4238 (P1-2, P1-3). #4238 rework 1 fixed them and turned each into a
// plain `test` on the new contract (the daily comes from the server's plan
// figure in the brand's money; the total is spent + daily × days LEFT). The
// read-the-source pins were replaced by executed behaviour (#1047 gate): the
// server formulas are executed in the Deno suites, the screen and sheet are
// rendered in issue_4238_rework1.implementor.test.tsx.

import { describe, expect, test } from "@jest/globals";
import {
  hostAdCreditFromPay,
  hostAdPayFromCredit,
  hostAdPlanBudget,
} from "../hostAdBuilderModel";
import {
  hostAdDetailDailyCredit,
  hostAdEditDailyMoney,
  hostAdEditMinDailyPay,
  hostAdEditStep,
} from "../hostAdManageModel";

// The server's formulas, executed (adMoney.ts creditCentsFromPay / hostMinimumPayCents).
const serverCredit = (pay: number): number => (Number.isInteger(pay) && pay > 0 ? Math.floor(pay * (1 - 0.15)) : 0);
const serverPay = (credit: number): number =>
  Number.isSafeInteger(credit) && credit > 0 ? Math.ceil((credit * 10_000) / Math.round((1 - 0.15) * 10_000)) : 0;

describe("tester: client money is the server money, executed", () => {
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
        const common = { startDailyPay: start, daysLeft: days, capCredit, spentCredit: 0, walletCredit: 0, learning: false, step };
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
        const min = hostAdEditMinDailyPay({ appsMinimumDailyPay: 118, step });
        const m = hostAdEditDailyMoney({
          dailyPay: min,
          startDailyPay: min + step,
          daysLeft: days,
          capCredit: 50_000,
          spentCredit: spent,
          walletCredit: 0,
          learning: false,
          step,
        });
        expect(m.newCredit).toBeGreaterThanOrEqual(spent);
      }
    }
  });
});

describe("tester: what the server really sends the detail screen", () => {
  // P1-2 (fixed in rework 1): a live TikTok-only ad (budget on the ad group,
  // daily_budget_cents null) used to start the sheet at 0 a day over ONE day,
  // so the first "+" turned a 30-day, 70,000-credit ad into a one-day total.
  // The daily now comes from the server's plan figure (plan_daily_credit_cents).
  test("P1-2: stepping the daily UP on a TikTok-only live ad never cuts the ad's total", () => {
    const capCredit = 70_000;
    const dailyCredit = hostAdDetailDailyCredit(2_333); // the server's plan daily for this ad
    expect(dailyCredit).toBe(2_333);
    const start = hostAdPayFromCredit(dailyCredit ?? 0);
    const step = hostAdEditStep(start);
    const minDaily = hostAdEditMinDailyPay({ appsMinimumDailyPay: 2_353, step });
    // Day 11 of 30, on pace: 10 days spent, 20 days left.
    const m = hostAdEditDailyMoney({
      dailyPay: Math.max(minDaily, start) + step,
      startDailyPay: start,
      daysLeft: 20,
      capCredit,
      spentCredit: 23_330,
      walletCredit: 0,
      learning: false,
      step,
    });
    expect(m.dailyChanged).toBe(true);
    expect(m.newCredit).toBeGreaterThanOrEqual(capCredit);
    // never the old one-day total
    expect(m.newCredit).toBeGreaterThan(hostAdCreditFromPay(Math.max(minDaily, start) + step) * 2);
  });

  // P1-3 (fixed in rework 1): for a Naira brand on the USD Meta account the
  // screen used to show daily_budget_cents (US cents) as kobo credit.
  test("P1-3: the daily the screen shows is in the brand's money, not the ad account's", () => {
    // The server's plan daily for ₦16,000 a day; the USD account holds 1,000 US cents.
    const daily = hostAdDetailDailyCredit(1_600_000);
    expect(daily).toBe(1_600_000);
    expect(daily).not.toBe(1_000);
    expect(hostAdDetailDailyCredit(null)).toBeNull();
  });
});
