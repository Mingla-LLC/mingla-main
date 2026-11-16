// Issue #4238 — independent tester, retest of rework 1 (head 15cc1f7134).
//
// Angles the implementor suites do not take: the Host app's edit sheet and the
// server's live-edit planner are EXECUTED TOGETHER. The implementor tests pin
// each side alone (client: "sends spent + daily x days left"; server: "spreads
// what is left over the days left"). Here the client's figure is fed to the
// server's planHostLiveEdit and the daily the apps actually get is compared to
// the daily the Host picked, including a Naira brand on a USD ad account where
// the amended provider daily is converted back for the detail page.
//
// The learning-window cases reproduce a defect the tester retest verdict on
// #4238 reported: the restart-learning confirm was judged on the change of
// the TOTAL. Rework 2 judges the DAILY amount on both sides, so these were
// turned from `test.failing` repros into plain tests.

import { describe, expect, test } from "@jest/globals";
import { hostAdCreditFromPay, hostAdPayFromCredit } from "../hostAdBuilderModel";
import { hostAdDaysLeft, hostAdEditDailyMoney, hostAdEditStep } from "../hostAdManageModel";
import {
  hostPlanDailyCreditCents,
  planHostLiveEdit,
  type HostLiveCampaign,
} from "../../../../../../supabase/functions/_shared/adHostLiveEdit";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T10:00:00.000Z");

/** A tiny deterministic PRNG so failures replay. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function campaign(over: Partial<HostLiveCampaign>): HostLiveCampaign {
  return {
    id: "c1",
    platform: "tiktok",
    host_budget_cents: 70_000,
    host_delivery_budget_cents: 7_000,
    provider_budget_cents: 70_000,
    provider_delivery_budget_cents: 7_000,
    current_cap_cents: 70_000,
    current_daily_cents: 7_000,
    provider_spend_cents: 0,
    provider_daily_minimum_cents: null,
    lifetime: false,
    ...over,
  };
}

/** What the sheet would send, and what the server makes of it. */
function roundTrip(input: {
  cap: number;
  spent: number;
  startDailyCredit: number;
  pickedDailyPay: number;
  endsAtIso: string;
  newEndsAtIso?: string;
  ratio?: number; // provider minor units per host minor unit (NGN brand on USD account < 1)
}) {
  const ratio = input.ratio ?? 1;
  const daysLeft = hostAdDaysLeft(new Date(NOW).toISOString(), input.newEndsAtIso ?? input.endsAtIso) ?? 1;
  const startDailyPay = hostAdPayFromCredit(input.startDailyCredit);
  const m = hostAdEditDailyMoney({
    dailyPay: input.pickedDailyPay,
    startDailyPay,
    daysLeft,
    endChanged: input.newEndsAtIso !== undefined,
    capCredit: input.cap,
    spentCredit: input.spent,
    walletCredit: 10_000_000,
    learning: false,
    step: hostAdEditStep(startDailyPay),
  });
  const providerSpend = Math.floor(input.spent * ratio);
  const row = campaign({
    host_budget_cents: input.cap,
    host_delivery_budget_cents: input.startDailyCredit,
    provider_budget_cents: Math.max(1, Math.floor(input.cap * ratio)),
    provider_delivery_budget_cents: Math.max(1, Math.floor(input.startDailyCredit * ratio)),
    current_cap_cents: Math.max(1, Math.floor(input.cap * ratio)),
    current_daily_cents: Math.max(1, Math.floor(input.startDailyCredit * ratio)),
    provider_spend_cents: providerSpend,
  });
  const plan = planHostLiveEdit({
    planState: "live",
    lastEditAt: null,
    nowMs: NOW,
    newHostBudgetCents: m.newCredit,
    newEndsAt: input.newEndsAtIso ?? null,
    currentHostBudgetCents: input.cap,
    currentEndsAt: input.endsAtIso,
    lastBookableAt: null,
    hostSpendCents: input.spent,
    campaigns: [row],
    liveSinceMs: null,
  });
  return { m, plan, row, daysLeft };
}

describe("tester: the daily the Host picks is the daily the apps get (client + server executed)", () => {
  test("USD brand, random caps, spend, days left and picks: server daily == picked daily in credit", () => {
    const r = rng(4238);
    let checked = 0;
    for (let i = 0; i < 4_000; i++) {
      const startDailyCredit = 500 + Math.floor(r() * 200_000);
      const totalDays = 2 + Math.floor(r() * 40);
      const cap = startDailyCredit * totalDays;
      const daysGone = Math.floor(r() * (totalDays - 1));
      const spent = Math.floor(cap * (daysGone / totalDays) * (0.3 + r() * 0.9));
      const endsAtIso = new Date(NOW + (totalDays - daysGone) * DAY - Math.floor(r() * DAY * 0.9)).toISOString();
      const pickedDailyPay = Math.max(100, hostAdPayFromCredit(startDailyCredit) + Math.round((r() - 0.5) * 2 * hostAdPayFromCredit(startDailyCredit)));
      const { m, plan } = roundTrip({ cap, spent, startDailyCredit, pickedDailyPay, endsAtIso });
      if (m.newCredit <= spent) continue; // refused as below spend: covered elsewhere
      expect(plan.ok).toBe(true);
      if (!plan.ok) continue;
      const serverDaily = plan.lines.reduce((sum, line) => sum + line.new_provider_delivery_budget_cents, 0);
      const cappedPick = Math.min(hostAdCreditFromPay(pickedDailyPay), plan.lines[0].new_provider_budget_cents);
      if (serverDaily !== cappedPick) {
        throw new Error(`case ${i}: picked ${hostAdCreditFromPay(pickedDailyPay)} credit/day, server set ${serverDaily}`);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(3_000);
  });

  test("moving only the end date keeps the daily the page shows (daily x NEW days left)", () => {
    const endsAtIso = new Date(NOW + 10 * DAY).toISOString();
    for (const extraDays of [-8, -3, -1, 1, 5, 20]) {
      const newEndsAtIso = new Date(NOW + (10 + extraDays) * DAY).toISOString();
      const startDailyCredit = 7_000;
      const { m, plan, daysLeft } = roundTrip({
        cap: 140_000,
        spent: 70_000,
        startDailyCredit,
        pickedDailyPay: hostAdPayFromCredit(startDailyCredit),
        endsAtIso,
        newEndsAtIso,
      });
      expect(m.newCredit).toBe(70_000 + startDailyCredit * daysLeft);
      expect(plan.ok).toBe(true);
      if (plan.ok) expect(plan.lines[0].new_provider_delivery_budget_cents).toBe(startDailyCredit);
    }
  });

  test("NGN brand on a USD ad account: after an edit the detail page shows the picked Naira daily (within 2 kobo, never more)", () => {
    // 1 kobo of credit buys 1/1700 of a US cent at the frozen rate (fee inside the ratio is irrelevant here).
    const ratio = 1 / 1700;
    const r = rng(1700);
    for (let i = 0; i < 1_000; i++) {
      const startDailyCredit = 1_000_000 + Math.floor(r() * 50_000_000); // ₦10,000 – ₦510,000 a day
      const totalDays = 5 + Math.floor(r() * 25);
      const cap = startDailyCredit * totalDays;
      const spent = Math.floor(cap * 0.2);
      const endsAtIso = new Date(NOW + (totalDays - 1) * DAY).toISOString();
      const pickedDailyPay = Math.round(hostAdPayFromCredit(startDailyCredit) * (0.8 + r() * 0.6));
      const { plan } = roundTrip({ cap, spent, startDailyCredit, pickedDailyPay, endsAtIso, ratio });
      expect(plan.ok).toBe(true);
      if (!plan.ok) continue;
      const amended = plan.lines[0].new_provider_delivery_budget_cents;
      const shown = hostPlanDailyCreditCents({
        campaigns: [{ platform: "tiktok", amended_provider_delivery_budget_cents: amended }],
        allocations: [{
          platform: "tiktok",
          host_delivery_budget_cents: startDailyCredit,
          provider_delivery_budget_cents: Math.max(1, Math.floor(startDailyCredit * ratio)),
        }],
      });
      const picked = hostAdCreditFromPay(pickedDailyPay);
      expect(shown).not.toBeNull();
      // The USD daily is whole cents, so the Naira shown is the pick rounded to the cent's worth.
      const oneProviderCentInHost = startDailyCredit / Math.max(1, Math.floor(startDailyCredit * ratio));
      if ((shown as number) > picked || picked - (shown as number) > Math.ceil(oneProviderCentInHost) + 2) {
        throw new Error(`case ${i}: picked ₦${picked / 100}/day, page shows ₦${(shown as number) / 100}`);
      }
    }
  });
});

describe("tester: the restart-learning confirm judges the daily (fixed in rework 2)", () => {
  // Day 3 of a 10-day TikTok ad at 7,000 credit a day, on plan: 21,000 spent, 7 days left.
  const cap = 70_000;
  const endsAtIso = new Date(NOW + 7 * DAY - 60_000).toISOString();
  const startDailyCredit = 7_000;
  const startDailyPay = hostAdPayFromCredit(startDailyCredit);

  function inLearning(pickedDailyPay: number, spent: number) {
    const daysLeft = hostAdDaysLeft(new Date(NOW).toISOString(), endsAtIso) ?? 1;
    const m = hostAdEditDailyMoney({
      dailyPay: pickedDailyPay,
      startDailyPay,
      daysLeft,
      capCredit: cap,
      spentCredit: spent,
      walletCredit: 10_000_000,
      learning: true,
      step: hostAdEditStep(startDailyPay),
    });
    const plan = planHostLiveEdit({
      planState: "live",
      lastEditAt: null,
      nowMs: NOW,
      newHostBudgetCents: m.newCredit,
      newEndsAt: null,
      currentHostBudgetCents: cap,
      currentEndsAt: endsAtIso,
      lastBookableAt: null,
      hostSpendCents: spent,
      campaigns: [campaign({ provider_spend_cents: spent })],
      liveSinceMs: NOW - 2 * DAY,
      acknowledgeLearningReset: false,
    });
    const serverAsks = !plan.ok && plan.error === "host_ad_live_edit_learning_reset";
    return { m, serverAsks };
  }

  test("raising the daily by 28% in learning asks to confirm the restart (client and server)", () => {
    const { m, serverAsks } = inLearning(Math.round(startDailyPay * 1.28), 21_000);
    // The apps' daily moves by 28% (> the 20% the learning rule allows) ...
    expect(m.restartsLearning).toBe(true);
    expect(serverAsks).toBe(true);
  });

  test("lowering the daily by 5% on an under-spent ad in learning does not warn that a change 'this big' restarts it", () => {
    // Only 5,000 spent of the 21,000 planned: the total drops by >20% although the daily moves 5%.
    const { m, serverAsks } = inLearning(Math.round(startDailyPay * 0.95), 5_000);
    expect(m.restartsLearning).toBe(false);
    expect(serverAsks).toBe(false);
  });
});
