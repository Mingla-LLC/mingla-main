// MINGLA-INVARIANT: I-4238-BUILDER-PAY-TERMS | issue #4238 W6a | Every amount the Promote builder shows is what the Host pays (15% Mingla fee inside, one HOST_FEE_RATIO), the minimum shown is the server's *_daily_minimum_pay_cents (never the credit figure), the budget sent to the server is credit (pay x 0.85), the top-up is the plain pay-terms difference, and Launch stays off until every app's check passed, the rights are confirmed and the credit covers the hold.
/**
 * FAILS-ON-REVERT: changing HOST_AD_FEE_RATIO, sending the pay figure as the
 * delivery budget, showing the credit minimum, or letting Launch through a
 * pending / failed / unanswered check each fails a case below.
 */
import { describe, expect, test } from "@jest/globals";

import {
  HOST_AD_FEE_RATIO,
  hostAdCreativeProblem,
  hostAdCreditFromPay,
  hostAdFeeOfPay,
  hostAdLaunchBlocker,
  hostAdMarkCrossed,
  hostAdMinimumCreditCents,
  hostAdMinimumPayCents,
  hostAdPayFromCredit,
  hostAdPlanBudget,
  hostAdSliderRange,
  hostAdSnap,
  hostAdTopUpNeededCents,
  hostAdBuilderStepId,
} from "../hostAdBuilderModel";


describe("#4238 W6a money: one unit (what the Host pays)", () => {
  test("the fee ratio is 15% (the server's HOST_FEE_RATIO, executed in issue_4238_rework1.implementor.test.ts on the same table)", () => {
    expect(HOST_AD_FEE_RATIO).toBe(0.15);
  });

  test("pay → credit (what reaches the apps) and back, as the server rounds", () => {
    expect(hostAdCreditFromPay(5_000_00)).toBe(4_250_00);
    expect(hostAdFeeOfPay(5_000_00)).toBe(750_00);
    // The W1 floor lock: provider floors 100 / 500 / 2000 cents are 118 /
    // 589 / 2353 in pay terms.
    expect(hostAdPayFromCredit(100)).toBe(118);
    expect(hostAdPayFromCredit(500)).toBe(589);
    expect(hostAdPayFromCredit(2000)).toBe(2353);
    expect(hostAdCreditFromPay(0)).toBe(0);
    expect(hostAdPayFromCredit(-1)).toBe(0);
  });

  test("the budget sent is credit; the hold shown is pay", () => {
    // ₦5,000 a day for 27 days (design v9 sample).
    expect(hostAdPlanBudget({ dailyPayCents: 5_000_00, runDays: 27 })).toEqual({
      dailyCreditCents: 4_250_00,
      capCreditCents: 4_250_00 * 27,
      holdPayCents: 135_000_00,
    });
    expect(hostAdPlanBudget({ dailyPayCents: 5_000_00, runDays: null }).holdPayCents).toBe(5_000_00);
  });

  test("the minimum shown is the server's pay figure, never the credit one", () => {
    const rows = [
      { platform: "meta", sales_daily_minimum_cents: 100_000, sales_daily_minimum_pay_cents: 117_648 },
      { platform: "snapchat", visits_daily_minimum_cents: 500_000 },
    ];
    expect(hostAdMinimumPayCents(rows, "meta", "sales")).toBe(117_648);
    expect(hostAdMinimumCreditCents(rows, "meta", "sales")).toBe(100_000);
    // An older server without the pay field gets the same gross-up.
    expect(hostAdMinimumPayCents(rows, "snapchat", "visits")).toBe(588_236);
    // Unknown (no rate to the brand's money): never guessed.
    expect(hostAdMinimumPayCents(rows, "tiktok", "visits")).toBeNull();
    expect(hostAdMinimumPayCents(rows, "meta", "signups")).toBeNull();
  });

  test("the top-up is the plain difference in pay terms, rounded up to a whole unit", () => {
    // Design v9: holds ₦135,000, ₦62,500 of credit (credit 53,125) → ₦72,500.
    expect(hostAdTopUpNeededCents(135_000_00, 53_125_00)).toBe(72_500_00);
    expect(hostAdTopUpNeededCents(135_000_00, 200_000_00)).toBe(0);
    expect(hostAdTopUpNeededCents(10_001, 0)).toBe(10_100);
  });
});

describe("#4238 W6a Launch waits for every check, the rights and the credit", () => {
  const ok = {
    offline: false,
    canLaunch: true,
    canFund: true,
    askName: null,
    checks: [
      { platform: "meta", state: "ready" as const },
      { platform: "tiktok", state: "ready" as const },
    ],
    checked: true,
    rightsConfirmed: true,
    topUpNeededCents: 0,
  };
  test("all clear → Launch is on", () => {
    expect(hostAdLaunchBlocker(ok)).toBeNull();
  });
  test("a check still running, unanswered or failed blocks Launch", () => {
    expect(hostAdLaunchBlocker({ ...ok, checks: [{ platform: "meta", state: "checking" }] })).toEqual({ kind: "checking" });
    expect(
      hostAdLaunchBlocker({ ...ok, checks: [{ platform: "meta", state: "ready" }, { platform: "tiktok", state: "question" }] }),
    ).toEqual({ kind: "question", platform: "tiktok" });
    expect(hostAdLaunchBlocker({ ...ok, checks: [{ platform: "snapchat", state: "failed" }] })).toEqual({
      kind: "failed",
      platform: "snapchat",
    });
    expect(hostAdLaunchBlocker({ ...ok, checked: false })).toEqual({ kind: "not_checked" });
    expect(hostAdLaunchBlocker({ ...ok, checks: [] })).toEqual({ kind: "not_checked" });
  });
  test("then rights, then credit; access and offline come first", () => {
    expect(hostAdLaunchBlocker({ ...ok, rightsConfirmed: false })).toEqual({ kind: "rights" });
    expect(hostAdLaunchBlocker({ ...ok, topUpNeededCents: 72_500_00 })).toEqual({ kind: "top_up", amountCents: 72_500_00 });
    expect(hostAdLaunchBlocker({ ...ok, canLaunch: false, askName: "Tinoe" })).toEqual({
      kind: "no_launch_access",
      askName: "Tinoe",
    });
    expect(hostAdLaunchBlocker({ ...ok, canFund: false })).toEqual({ kind: "no_fund_access", askName: null });
    expect(hostAdLaunchBlocker({ ...ok, offline: true, rightsConfirmed: false })).toEqual({ kind: "offline" });
  });
});

describe("#4238 W6a builder rules", () => {
  test("1–5 creatives; a photo only where every app takes one", () => {
    expect(hostAdCreativeProblem({ picked: [], apps: ["meta"] })).toEqual({ kind: "none" });
    expect(hostAdCreativeProblem({ picked: Array(6).fill({ kind: "video" }), apps: ["meta"] })).toEqual({ kind: "too_many" });
    expect(hostAdCreativeProblem({ picked: [{ kind: "image" }], apps: ["meta", "snapchat"] })).toBeNull();
    expect(hostAdCreativeProblem({ picked: [{ kind: "image" }], apps: ["meta", "tiktok"] })).toEqual({
      kind: "photo_app",
      platform: "tiktok",
    });
  });
  test("the slider reaches below the minimum (to explain it) and well past the recommendation", () => {
    const range = hostAdSliderRange({ minimumPayCents: 1_883_00, recommendedPayCents: 21_450_00 });
    expect(range.min).toBeLessThan(1_883_00);
    expect(range.max).toBeGreaterThanOrEqual(21_450_00 * 3);
    expect(hostAdSnap(range.max * 2, range)).toBe(range.max);
    expect(hostAdSnap(0, range)).toBe(range.min);
    expect(hostAdMarkCrossed(1_000_00, 2_000_00, [1_883_00, 21_450_00])).toBe(1_883_00);
    expect(hostAdMarkCrossed(2_000_00, 3_000_00, [1_883_00])).toBeNull();
  });
  test("old five-step drafts open on the six-step builder", () => {
    expect(hostAdBuilderStepId("promote")).toBe("pick");
    expect(hostAdBuilderStepId("platforms")).toBe("platforms");
    expect(hostAdBuilderStepId("form")).toBeNull();
  });
});
// The screen's "no money maths of its own" rule moved to the strict-grep gate
// .github/scripts/strict-grep/issue-4238-host-ad-plain-language.mjs (section 7,
// #4238 rework 1), its home under I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN.
