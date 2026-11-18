// Issue #4238 — independent tester, retest 6 (dispatched as "Retest 3") of rework 2 (head a1c5958958).
//
// Angles the implementor's rework-2 suites do not take:
// 1. The 20% line walked STEP BY STEP through the sheet's real stepper
//    (hostAdEditStep), for a multi-app plan (Meta lifetime/CBO + TikTok daily)
//    on a Naira brand paying a USD ad account, with the start daily the detail
//    page serves (hostLiveDailyNowCents). The client must warn EXACTLY when the
//    server asks: zero disagreements (the implementor tolerates two).
// 2. A constructed exact-20% pick and the next credit cent above it, through
//    the 15% fee rounding (pay -> credit floors).
// 3. End-date-only moves in and out of the learning week, both sides, and the
//    daily the server then pushes never drifts by more than one credit cent.
// 4. Stale spend: a spend sync lands between the sheet opening and Save. The
//    server's verdict must still come back as the learning-reset code (the one
//    the detail screen turns into the confirm), never a silent pass of a cut
//    over 20%.
// 5. An OVER-spent Meta lifetime ad (spend ahead of plan): the sheet starts at
//    the lower pace and a Lower step is judged on that pace on both sides.

import { describe, expect, test } from "@jest/globals";
import { hostAdCreditFromPay, hostAdPayFromCredit } from "../hostAdBuilderModel";
import { hostAdDaysLeft, hostAdEditDailyMoney, hostAdEditStep } from "../hostAdManageModel";
import {
  hostLiveDailyNowCents,
  planHostLiveEdit,
  type HostLiveCampaign,
} from "../../../../../../supabase/functions/_shared/adHostLiveEdit";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T10:00:00.000Z");
const ENDS = new Date(NOW + 6 * DAY + 3 * 3_600_000).toISOString(); // 7 whole days left

type Edit = {
  lines: HostLiveCampaign[];
  cap: number;
  /** What the sheet saw as spent (credit). */
  sheetSpent: number;
  /** What the server sees as spent at Save (credit); defaults to sheetSpent. */
  serverSpent?: number;
  pickedDailyPay: number;
  learning: boolean;
  newEndsAt?: string;
};

function run(edit: Edit) {
  const startCredit = hostLiveDailyNowCents(edit.lines, NOW, Date.parse(ENDS));
  if (startCredit === null) throw new Error("start daily unreadable");
  const startPay = hostAdPayFromCredit(startCredit);
  const endIso = edit.newEndsAt ?? ENDS;
  const m = hostAdEditDailyMoney({
    dailyPay: edit.pickedDailyPay,
    startDailyPay: startPay,
    startDailyCredit: startCredit,
    daysLeft: hostAdDaysLeft(new Date(NOW).toISOString(), endIso) ?? 1,
    endChanged: edit.newEndsAt !== undefined,
    capCredit: edit.cap,
    spentCredit: edit.sheetSpent,
    walletCredit: 1_000_000_000,
    learning: edit.learning,
    step: hostAdEditStep(startPay),
  });
  const budgetChanged = m.newCredit !== edit.cap;
  const plan = planHostLiveEdit({
    planState: "live",
    lastEditAt: null,
    nowMs: NOW,
    newHostBudgetCents: budgetChanged ? m.newCredit : null,
    newEndsAt: edit.newEndsAt ?? null,
    currentHostBudgetCents: edit.cap,
    currentEndsAt: ENDS,
    lastBookableAt: null,
    hostSpendCents: edit.serverSpent ?? edit.sheetSpent,
    campaigns: edit.lines,
    liveSinceMs: edit.learning ? NOW - 2 * DAY : NOW - 30 * DAY,
    acknowledgeLearningReset: false,
  });
  const serverAsks = !plan.ok && plan.error === "host_ad_live_edit_learning_reset";
  return { m, plan, serverAsks, startCredit, startPay };
}

/** Naira brand (host minor) on a USD ad account (provider minor): 1 USD cent = 16 kobo. */
const RATIO = 1 / 16;

function mixedPlan(input: { metaDaily: number; tiktokDaily: number; days: number; metaSpent: number; tiktokSpent: number }) {
  const meta: HostLiveCampaign = {
    id: "meta",
    platform: "meta",
    host_budget_cents: input.metaDaily * input.days,
    host_delivery_budget_cents: input.metaDaily,
    provider_budget_cents: Math.floor(input.metaDaily * input.days * RATIO),
    provider_delivery_budget_cents: Math.floor(input.metaDaily * RATIO),
    current_cap_cents: Math.floor(input.metaDaily * input.days * RATIO),
    current_daily_cents: Math.floor(input.metaDaily * RATIO),
    provider_spend_cents: Math.floor(input.metaSpent * RATIO),
    provider_daily_minimum_cents: null,
    lifetime: true,
  };
  const tiktok: HostLiveCampaign = {
    id: "tiktok",
    platform: "tiktok",
    host_budget_cents: input.tiktokDaily * input.days,
    host_delivery_budget_cents: input.tiktokDaily,
    provider_budget_cents: Math.floor(input.tiktokDaily * input.days * RATIO),
    provider_delivery_budget_cents: Math.floor(input.tiktokDaily * RATIO),
    current_cap_cents: Math.floor(input.tiktokDaily * input.days * RATIO),
    current_daily_cents: Math.floor(input.tiktokDaily * RATIO),
    provider_spend_cents: Math.floor(input.tiktokSpent * RATIO),
    provider_daily_minimum_cents: null,
    lifetime: false,
  };
  return {
    lines: [meta, tiktok],
    cap: meta.host_budget_cents + tiktok.host_budget_cents,
    spent: input.metaSpent + input.tiktokSpent,
  };
}

describe("tester retest 6: the learning confirm, client and server executed together", () => {
  test("every Raise/Lower step from -8 to +8 on 300 mixed Meta-lifetime + TikTok plans (NGN on USD): zero disagreements", () => {
    let s = 4238 >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let disagreements = 0;
    let asked = 0;
    let passed = 0;
    const examples: string[] = [];
    for (let i = 0; i < 300; i++) {
      const metaDaily = 160_000 + Math.floor(rnd() * 4_000_000);
      const tiktokDaily = 160_000 + Math.floor(rnd() * 2_000_000);
      const days = 10;
      const p = mixedPlan({
        metaDaily,
        tiktokDaily,
        days,
        metaSpent: Math.floor(metaDaily * 3 * (0.4 + rnd())),
        tiktokSpent: Math.floor(tiktokDaily * 3 * (0.4 + rnd())),
      });
      const startCredit = hostLiveDailyNowCents(p.lines, NOW, Date.parse(ENDS)) as number;
      const startPay = hostAdPayFromCredit(startCredit);
      const step = hostAdEditStep(startPay);
      for (let k = -8; k <= 8; k++) {
        if (k === 0) continue;
        const r = run({ lines: p.lines, cap: p.cap, sheetSpent: p.spent, pickedDailyPay: startPay + k * step, learning: true });
        if (r.m.newCredit <= p.spent) continue;
        if (r.serverAsks) asked++;
        else if (r.plan.ok) passed++;
        else continue; // refused for another reason (minimums etc.): not a learning verdict
        if (r.m.restartsLearning !== r.serverAsks) {
          disagreements++;
          if (examples.length < 3) examples.push(`plan ${i} step ${k}: sheet ${r.m.restartsLearning}, server ${r.serverAsks}`);
        }
      }
    }
    expect(examples).toEqual([]);
    expect(disagreements).toBe(0);
    expect(asked).toBeGreaterThan(500);
    expect(passed).toBeGreaterThan(500);
  });

  test("exactly 20% on the daily passes on both sides; one credit cent more asks on both sides", () => {
    // Start daily 10,000 credit (TikTok only, USD). 12,000 credit is exactly +20%.
    const line: HostLiveCampaign = {
      id: "t", platform: "tiktok",
      host_budget_cents: 100_000, host_delivery_budget_cents: 10_000,
      provider_budget_cents: 100_000, provider_delivery_budget_cents: 10_000,
      current_cap_cents: 100_000, current_daily_cents: 10_000,
      provider_spend_cents: 30_000, provider_daily_minimum_cents: null, lifetime: false,
    };
    // The smallest pay whose credit is >= 12,000 after the 15% fee floors.
    let pay = hostAdPayFromCredit(12_000);
    expect(hostAdCreditFromPay(pay)).toBe(12_000);
    const at = run({ lines: [line], cap: 100_000, sheetSpent: 30_000, pickedDailyPay: pay, learning: true });
    expect(at.m.restartsLearning).toBe(false);
    expect(at.serverAsks).toBe(false);
    expect(at.plan.ok).toBe(true);
    // Next pay cent that lands above 12,000 credit.
    while (hostAdCreditFromPay(pay) === 12_000) pay++;
    const over = run({ lines: [line], cap: 100_000, sheetSpent: 30_000, pickedDailyPay: pay, learning: true });
    expect(hostAdCreditFromPay(pay)).toBe(12_001);
    expect(over.m.restartsLearning).toBe(true);
    expect(over.serverAsks).toBe(true);
    // And the cut side: exactly -20% (8,000) passes, 7,999 asks.
    const cutAt = run({ lines: [line], cap: 100_000, sheetSpent: 30_000, pickedDailyPay: hostAdPayFromCredit(8_000), learning: true });
    expect(hostAdCreditFromPay(hostAdPayFromCredit(8_000))).toBe(8_000);
    expect(cutAt.m.restartsLearning).toBe(false);
    expect(cutAt.serverAsks).toBe(false);
    let cutPay = hostAdPayFromCredit(8_000);
    while (hostAdCreditFromPay(cutPay) === 8_000) cutPay--;
    const cutOver = run({ lines: [line], cap: 100_000, sheetSpent: 30_000, pickedDailyPay: cutPay, learning: true });
    expect(cutOver.m.restartsLearning).toBe(true);
    expect(cutOver.serverAsks).toBe(true);
  });

  test("end-date-only moves: asked on both sides in the learning week, never outside it; the pushed daily stays within one credit cent", () => {
    const p = mixedPlan({ metaDaily: 800_000, tiktokDaily: 400_000, days: 10, metaSpent: 2_400_000, tiktokSpent: 1_200_000 });
    const startCredit = hostLiveDailyNowCents(p.lines, NOW, Date.parse(ENDS)) as number;
    const startPay = hostAdPayFromCredit(startCredit);
    for (const shift of [-5, -1, 1, 3, 12]) {
      const newEndsAt = new Date(Date.parse(ENDS) + shift * DAY).toISOString();
      const inLearning = run({ lines: p.lines, cap: p.cap, sheetSpent: p.spent, pickedDailyPay: startPay, learning: true, newEndsAt });
      expect(inLearning.m.restartsLearning).toBe(true);
      expect(inLearning.serverAsks).toBe(true);
      const after = run({ lines: p.lines, cap: p.cap, sheetSpent: p.spent, pickedDailyPay: startPay, learning: false, newEndsAt });
      expect(after.m.restartsLearning).toBe(false);
      expect(after.plan.ok).toBe(true);
      if (!after.plan.ok) continue;
      const daysLeft = hostAdDaysLeft(new Date(NOW).toISOString(), newEndsAt) as number;
      const pushedDaily = Math.floor((after.m.newCredit - p.spent) / daysLeft);
      // pay -> credit round trip may lose a cent; never more.
      expect(Math.abs(pushedDaily - startCredit)).toBeLessThanOrEqual(1);
    }
  });

  test("stale spend: a sync lands between opening the sheet and Save; a cut the sheet saw at exactly 20% comes back as the learning-reset code", () => {
    const line: HostLiveCampaign = {
      id: "t", platform: "tiktok",
      host_budget_cents: 100_000, host_delivery_budget_cents: 10_000,
      provider_budget_cents: 100_000, provider_delivery_budget_cents: 10_000,
      current_cap_cents: 100_000, current_daily_cents: 10_000,
      provider_spend_cents: 30_000, provider_daily_minimum_cents: null, lifetime: false,
    };
    const r = run({
      lines: [line], cap: 100_000, sheetSpent: 30_000, serverSpent: 31_500,
      pickedDailyPay: hostAdPayFromCredit(8_000), learning: true,
    });
    expect(r.m.restartsLearning).toBe(false); // the sheet saw exactly -20%
    // The server sees (8,000 x 7 - 1,500) / 7 = 7,785 a day: -22%. It must ask
    // with the code the detail screen turns into the confirm, never pass.
    expect(r.plan.ok).toBe(false);
    expect(r.serverAsks).toBe(true);
  });

  test("an over-spent Meta lifetime ad: the sheet starts at the lower pace, and one Lower step is judged on that pace on both sides", () => {
    // Plan 10,000 a day for 10 days; Meta spent 45,000 by day 3 (ahead of plan).
    const line: HostLiveCampaign = {
      id: "m", platform: "meta",
      host_budget_cents: 100_000, host_delivery_budget_cents: 10_000,
      provider_budget_cents: 100_000, provider_delivery_budget_cents: 10_000,
      current_cap_cents: 100_000, current_daily_cents: 10_000,
      provider_spend_cents: 45_000, provider_daily_minimum_cents: null, lifetime: true,
    };
    const startCredit = hostLiveDailyNowCents([line], NOW, Date.parse(ENDS)) as number;
    expect(startCredit).toBe(Math.floor(55_000 / 7)); // 7,857: the pace, not the plan 10,000
    const startPay = hostAdPayFromCredit(startCredit);
    const step = hostAdEditStep(startPay);
    for (let k = 1; k <= 6; k++) {
      const r = run({ lines: [line], cap: 100_000, sheetSpent: 45_000, pickedDailyPay: startPay - k * step, learning: true });
      if (r.m.newCredit <= 45_000) continue;
      expect(r.m.restartsLearning).toBe(r.serverAsks);
    }
    // One Lower step (5%) does not restart learning on either side.
    const one = run({ lines: [line], cap: 100_000, sheetSpent: 45_000, pickedDailyPay: startPay - step, learning: true });
    expect(one.m.restartsLearning).toBe(false);
    expect(one.serverAsks).toBe(false);
  });
});
