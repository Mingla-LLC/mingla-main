// MINGLA-INVARIANT: I-4238-LIVE-DAILY-NOW | issue #4238 | The learning-restart rule (server planHostLiveEdit and the Host edit sheet) and the edit sheet's starting daily judge the daily the apps get now: a daily app's current daily, a lifetime app's pace (cap - spent) / days left, both at the frozen ratio; never the plan total.
// Issue #4238 rework 2 (after the tester retest FAIL at 15cc1f7134), Host app.
//
//  P1-1  hostAdEditDailyMoney.restartsLearning judges the DAILY amount (and
//        the end date), never the total, and agrees with the server's
//        planHostLiveEdit on every case (both executed together).
//  P3-2  a Meta lifetime (total) budget ad: the sheet starts from the pace
//        the server reports, so one "Raise" step never lowers Meta's budget.
//  P3-3  Share results on a browser without Web Share copies the link.
//
// @invariant I-4238-LIVE-DAILY-NOW (declared in supabase/functions/_shared/adHostLiveEdit.ts)

import { describe, expect, test } from "@jest/globals";
import { hostAdPayFromCredit } from "../hostAdBuilderModel";
import { hostAdDaysLeft, hostAdEditDailyMoney, hostAdEditStep, hostAdShareOrCopy } from "../hostAdManageModel";
import {
  hostLiveDailyNowCents,
  planHostLiveEdit,
  type HostLiveCampaign,
} from "../../../../../../supabase/functions/_shared/adHostLiveEdit";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T10:00:00.000Z");
const endsAt = new Date(NOW + 7 * DAY - 60_000).toISOString();

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const row = (over: Partial<HostLiveCampaign> = {}): HostLiveCampaign => ({
  id: "c1",
  platform: "tiktok",
  host_budget_cents: 70_000,
  host_delivery_budget_cents: 7_000,
  provider_budget_cents: 70_000,
  provider_delivery_budget_cents: 7_000,
  current_cap_cents: 70_000,
  current_daily_cents: 7_000,
  provider_spend_cents: 0,
  ...over,
});

/** The sheet's figures and the server's verdict on the same edit. */
function both(input: { campaign: HostLiveCampaign; cap: number; spent: number; pickedDailyPay: number; learning?: boolean }) {
  const startCredit = hostLiveDailyNowCents([input.campaign], NOW, Date.parse(endsAt)) as number;
  const startPay = hostAdPayFromCredit(startCredit);
  const daysLeft = hostAdDaysLeft(new Date(NOW).toISOString(), endsAt) ?? 1;
  const m = hostAdEditDailyMoney({
    dailyPay: input.pickedDailyPay,
    startDailyPay: startPay,
    startDailyCredit: startCredit,
    daysLeft,
    capCredit: input.cap,
    spentCredit: input.spent,
    walletCredit: 100_000_000,
    learning: input.learning ?? true,
    step: hostAdEditStep(startPay),
  });
  const plan = planHostLiveEdit({
    planState: "live",
    lastEditAt: null,
    nowMs: NOW,
    newHostBudgetCents: m.newCredit,
    newEndsAt: null,
    currentHostBudgetCents: input.cap,
    currentEndsAt: endsAt,
    lastBookableAt: null,
    hostSpendCents: input.spent,
    campaigns: [input.campaign],
    liveSinceMs: NOW - 2 * DAY,
    acknowledgeLearningReset: false,
  });
  const serverAsks = !plan.ok && plan.error === "host_ad_live_edit_learning_reset";
  return { m, plan, serverAsks, startPay, startCredit };
}

describe("P1-1: the learning confirm judges the daily, the same on both sides", () => {
  test("a 28% daily raise asks (client and server), though the total moves under 20% (fail-on-revert)", () => {
    const campaign = row({ provider_spend_cents: 21_000 });
    const startPay = hostAdPayFromCredit(7_000);
    const r = both({ campaign, cap: 70_000, spent: 21_000, pickedDailyPay: Math.round(startPay * 1.28) });
    expect(Math.abs(r.m.newCredit - 70_000) / 70_000).toBeLessThan(0.2);
    expect(r.m.restartsLearning).toBe(true);
    expect(r.serverAsks).toBe(true);
  });

  test("a 5% daily cut on an under-spent ad does not warn (client and server), though the total drops 26% (fail-on-revert)", () => {
    const campaign = row({ provider_spend_cents: 5_000 });
    const start = hostAdPayFromCredit(7_000);
    const r = both({ campaign, cap: 70_000, spent: 5_000, pickedDailyPay: Math.round(start * 0.95) });
    expect(Math.abs(r.m.newCredit - 70_000) / 70_000).toBeGreaterThan(0.2);
    expect(r.m.restartsLearning).toBe(false);
    expect(r.serverAsks).toBe(false);
  });

  test("an end-date move in the learning week always restarts it; out of learning nothing warns", () => {
    const base = { startDailyPay: 10_000, daysLeft: 5, capCredit: 50_000, spentCredit: 0, walletCredit: 0, step: 500 };
    expect(hostAdEditDailyMoney({ ...base, dailyPay: 10_000, endChanged: true, learning: true }).restartsLearning).toBe(true);
    expect(hostAdEditDailyMoney({ ...base, dailyPay: 20_000, learning: false }).restartsLearning).toBe(false);
    expect(hostAdEditDailyMoney({ ...base, dailyPay: 10_000, learning: true }).restartsLearning).toBe(false);
  });

  test("2,000 random edits: the sheet warns exactly when the server asks", () => {
    const r = rng(20_260_116);
    let disagreements = 0;
    let asked = 0;
    for (let i = 0; i < 2_000; i++) {
      const daily = 1_000 + Math.floor(r() * 100_000);
      const cap = daily * 10;
      const spent = Math.floor(daily * 3 * (0.2 + r()));
      const campaign = row({
        host_budget_cents: cap,
        host_delivery_budget_cents: daily,
        provider_budget_cents: cap,
        provider_delivery_budget_cents: daily,
        current_cap_cents: cap,
        current_daily_cents: daily,
        provider_spend_cents: spent,
      });
      const startPay = hostAdPayFromCredit(daily);
      const picked = Math.max(100, Math.round(startPay * (0.6 + r() * 0.8)));
      const res = both({ campaign, cap, spent, pickedDailyPay: picked });
      if (res.m.newCredit <= spent || !res.m.dailyChanged) continue;
      if (res.serverAsks) asked++;
      if (res.m.restartsLearning !== res.serverAsks) disagreements++;
    }
    expect(asked).toBeGreaterThan(200);
    // Only the pay→credit rounding of a pick sitting on the 20% line may differ.
    expect(disagreements).toBeLessThanOrEqual(2);
  });
});

describe("P3-2: Raise on a Meta lifetime (total) budget ad never lowers real delivery", () => {
  test("the sheet starts at Meta's pace; one Raise step gives a larger lifetime budget (fail-on-revert)", () => {
    // Plan daily 7,000, only 5,000 spent by day 3: Meta paces 65,000 over 7 days.
    const campaign = row({ platform: "meta", lifetime: true, provider_spend_cents: 5_000 });
    const startCredit = hostLiveDailyNowCents([campaign], NOW, Date.parse(endsAt)) as number;
    expect(startCredit).toBe(9_285);
    const startPay = hostAdPayFromCredit(startCredit);
    const r = both({
      campaign,
      cap: 70_000,
      spent: 5_000,
      pickedDailyPay: startPay + hostAdEditStep(startPay),
      learning: false,
    });
    expect(r.plan.ok).toBe(true);
    if (!r.plan.ok) return;
    expect(r.m.changePay).toBeGreaterThan(0); // labelled as more set aside, never "comes back"
    expect(r.plan.lines[0].new_provider_budget_cents).toBeGreaterThan(campaign.current_cap_cents);
  });
});

describe("P3-3: Share results without a share sheet copies the link", () => {
  test("desktop web without Web Share: copies the link and reports it (fail-on-revert)", async () => {
    const copied: string[] = [];
    const outcome = await hostAdShareOrCopy({
      share: () => Promise.reject(new Error("native_share_unavailable")),
      copy: async () => {
        copied.push("https://usemingla.com/e/brand/event");
      },
    });
    expect(outcome).toBe("copied");
    expect(copied).toHaveLength(1);
  });

  test("shared normally; a closed share sheet is not an error; other failures still throw", async () => {
    await expect(hostAdShareOrCopy({ share: async () => undefined, copy: async () => undefined })).resolves.toBe("shared");
    const abort = new Error("closed");
    abort.name = "AbortError";
    await expect(hostAdShareOrCopy({ share: () => Promise.reject(abort), copy: async () => undefined })).resolves.toBe(
      "cancelled",
    );
    await expect(
      hostAdShareOrCopy({ share: () => Promise.reject(new Error("boom")), copy: async () => undefined }),
    ).rejects.toThrow("boom");
    await expect(
      hostAdShareOrCopy({
        share: () => Promise.reject(new Error("native_share_unavailable")),
        copy: () => Promise.reject(new Error("clipboard_unavailable")),
      }),
    ).rejects.toThrow("clipboard_unavailable");
  });
});
