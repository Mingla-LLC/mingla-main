// MINGLA-INVARIANT: I-4238-LIVE-EDIT-CAPS-WITHIN-TOTAL | issue #4238 | The per-app caps of a Host live edit never add up, in the brand's money at each campaign's frozen rate, to more than the new total; host_ad_amend_live refuses caps above it (PT409).
// MINGLA-INVARIANT: I-4238-LIVE-EDIT-CLAIM-BEFORE-PUSH | issue #4238 | A Host live edit is claimed under the plan lock (host_ad_live_edit_claim) before any provider push; a same-key retry returns the saved edit; a once-a-day refusal never undoes a push.
/**
 * #4238 media-buyer, rework after tester round 8 — a Host changing a live
 * ad's budget. Guards I-4238-LIVE-EDIT-CAPS-WITHIN-TOTAL and
 * I-4238-LIVE-EDIT-CLAIM-BEFORE-PUSH (declared in ../adHostLiveEdit.ts).
 *
 *   R1  Caps across three apps with different frozen rates and uneven spend
 *       never add up past the new total in the brand's money (P1-1).
 *   R2  A lower that would put an app under its own daily minimum is refused
 *       before any push, naming the app and the minimum in the brand's money
 *       (P2-2).
 *   R3  "In progress" at record time is a lost race: no undo, staff told
 *       (P1-2).
 *   R4  A failed undo is named, reported to staff, and never reported as
 *       undone (P2-1).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type HostLiveCampaign,
  type HostLiveEditProblem,
  planHostLiveEdit,
  runHostLiveEdit,
} from "../adHostLiveEdit.ts";
import type { ChannelAdapter, Platform } from "../adChannelCore.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const END = "2026-11-20T12:00:00Z";
const base = {
  planState: "live",
  lastEditAt: null,
  nowMs: NOW,
  currentEndsAt: END,
  lastBookableAt: "2026-12-06T22:59:00Z",
};

// NGN plan, USD apps. host→provider ratio = 1/1500 less a 10% fee.
const usd = (
  platform: Platform,
  id: string,
  hostCap: number,
  spendUsdCents: number,
  minimum: number | null = null,
): HostLiveCampaign => ({
  id,
  platform,
  host_budget_cents: hostCap,
  host_delivery_budget_cents: hostCap / 10,
  provider_budget_cents: Math.floor((hostCap * 0.9) / 1500),
  provider_delivery_budget_cents: Math.floor((hostCap * 0.9) / 15000),
  current_cap_cents: Math.floor((hostCap * 0.9) / 1500),
  current_daily_cents: Math.floor((hostCap * 0.9) / 15000),
  provider_spend_cents: spendUsdCents,
  provider_daily_minimum_cents: minimum,
});

// What SQL does: each cap back to NGN at the frozen 1500 rate, rounded.
const capsInNaira = (lines: { new_provider_budget_cents: number }[]) =>
  lines.reduce((sum, line) => sum + Math.round(line.new_provider_budget_cents * 1500), 0);

Deno.test("R1 caps never add up past the new total, whatever the spend", () => {
  const campaigns = [
    usd("meta", "m", 15_000_000, 8_500),
    usd("tiktok", "t", 9_000_000, 200),
    usd("snapchat", "s", 6_000_000, 0),
  ];
  // Spend so far in NGN at 1500: 12,750,000 + 300,000 + 0.
  const hostSpend = 13_050_000;
  // A total at the spend so far leaves nothing to run on: refused.
  const atSpend = planHostLiveEdit({
    ...base,
    currentHostBudgetCents: 30_000_000,
    hostSpendCents: hostSpend,
    newHostBudgetCents: hostSpend,
    newEndsAt: null,
    campaigns,
  });
  assertEquals(atSpend, { ok: false, error: "host_ad_live_edit_below_spend" });
  for (const total of [13_100_000, 14_000_000, 20_000_000, 31_000_000, 45_000_000]) {
    const plan = planHostLiveEdit({
      ...base,
      currentHostBudgetCents: 30_000_000,
      hostSpendCents: hostSpend,
      newHostBudgetCents: total,
      newEndsAt: null,
      campaigns,
    });
    if (!plan.ok) throw new Error(`${total}: ${plan.error}`);
    assert(
      capsInNaira(plan.lines) <= total,
      `${total}: caps are NGN ${capsInNaira(plan.lines) / 100}: ${JSON.stringify(plan.lines)}`,
    );
    for (const [index, line] of plan.lines.entries()) {
      assert(
        line.new_provider_budget_cents >= campaigns[index].provider_spend_cents,
        "a cap never drops under that app's spend",
      );
      assert(line.new_provider_delivery_budget_cents <= line.new_provider_budget_cents);
    }
  }
});

Deno.test("R2 a lower under an app's daily minimum is refused, naming the app", () => {
  const plan = planHostLiveEdit({
    ...base,
    currentHostBudgetCents: 30_000_000,
    hostSpendCents: 0,
    // NGN 31,000 left over 10 days for two apps: TikTok gets ~USD 0.93 a day.
    newHostBudgetCents: 3_100_000,
    newEndsAt: null,
    campaigns: [
      usd("meta", "m", 15_000_000, 0),
      usd("tiktok", "t", 15_000_000, 0, 5_000),
    ],
  });
  assertEquals(plan.ok, false);
  if (plan.ok) return;
  assertEquals(plan.error, "host_ad_live_edit_below_app_minimum");
  // USD 50 at the frozen daily ratio (1/1500 less 10%) = NGN 83,333.34.
  assertEquals(plan.detail, "tiktok:8333334");
  // Without a known minimum the same lower is planned.
  const open = planHostLiveEdit({
    ...base,
    currentHostBudgetCents: 30_000_000,
    hostSpendCents: 0,
    newHostBudgetCents: 3_100_000,
    newEndsAt: null,
    campaigns: [usd("meta", "m", 15_000_000, 0), usd("tiktok", "t", 15_000_000, 0)],
  });
  assertEquals(open.ok, true);
});

type Budgets = Map<string, number>;

function adapter(budgets: Budgets, failUndo: boolean) {
  const seen = new Set<string>();
  return {
    setBudget: (_c: unknown, _l: unknown, id: string, cents: number) => {
      if (failUndo && seen.has(id)) return Promise.reject(new Error("provider_timeout"));
      seen.add(id);
      budgets.set(id, cents);
      return Promise.resolve();
    },
    getBudget: (_c: unknown, _l: unknown, id: string) =>
      Promise.resolve({ cents: budgets.get(id) ?? 0, field: "daily_budget" }),
  } as unknown as ChannelAdapter;
}

function db(rpcError: { code: string; message: string } | null) {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = chain;
      q.eq = chain;
      q.order = chain;
      q.maybeSingle = () =>
        Promise.resolve({ data: table === "ad_connections" ? { connected: true, status: "connected" } : null });
      (q as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [] });
      return q;
    },
    rpc: () => Promise.resolve({ data: rpcError ? null : { id: "edit" }, error: rpcError }),
  };
}

const metaPlan = {
  ok: true as const,
  newHostBudgetCents: 20_000,
  newEndsAt: null,
  dailyNotPushed: [],
  lines: [{
    campaign_id: "m",
    platform: "meta" as Platform,
    new_provider_budget_cents: 5_000,
    new_provider_delivery_budget_cents: 700,
    daily_changed: true,
  }],
};
const metaRow = [{ id: "m", platform: "meta", external_campaign_id: "meta-c", connection_id: "k", provider_delivery_budget_cents: 500, provider_budget_cents: 5_000 }];
const run = (rpcError: { code: string; message: string } | null, failUndo: boolean, budgets: Budgets, problems: HostLiveEditProblem[]) =>
  runHostLiveEdit({
    db: db(rpcError),
    getAdapter: () => adapter(budgets, failUndo),
    onProblem: (problem) => {
      problems.push(problem);
      return Promise.resolve();
    },
  }, {
    plan: metaPlan,
    versionId: "v",
    planHash: "h".repeat(64),
    campaigns: metaRow,
    actorId: "a",
    idempotencyKey: "host_live_p_r9-key",
    previousEndsAt: END,
  });

Deno.test("R3 'in progress' at record time is a lost race: no undo, staff told", async () => {
  const budgets: Budgets = new Map([["meta-c", 500]]);
  const problems: HostLiveEditProblem[] = [];
  const result = await run({ code: "PT409", message: "host_ad_live_edit_in_progress" }, false, budgets, problems);
  assertEquals(result.status, 409);
  assertEquals(result.body.error, "host_ad_live_edit_in_progress");
  assertEquals(budgets.get("meta-c"), 700, "the push stays; staff reconcile it");
  assertEquals(problems.map((p) => [p.kind, p.platforms]), [["not_reverted", ["meta"]]]);
});

Deno.test("R4 a failed undo is named, reported, and never called undone", async () => {
  const budgets: Budgets = new Map([["meta-c", 500]]);
  const problems: HostLiveEditProblem[] = [];
  const result = await run({ code: "XX000", message: "boom" }, true, budgets, problems);
  assertEquals(result.status, 502);
  assertEquals(result.body.error, "host_ad_live_edit_undo_failed");
  assertEquals(result.body.detail, "meta");
  assertEquals(result.body.revert_failed, ["meta"]);
  assertEquals(result.body.reverted, []);
  assertEquals(budgets.get("meta-c"), 700);
  assertEquals(problems.map((p) => p.kind), ["undo_failed"]);
  // An undo that works is reported as undone, with nothing for staff.
  const okBudgets: Budgets = new Map([["meta-c", 500]]);
  const none: HostLiveEditProblem[] = [];
  const undone = await run({ code: "XX000", message: "boom" }, false, okBudgets, none);
  assertEquals(undone.body.error, "host_ad_live_edit_not_recorded");
  assertEquals(undone.body.reverted, ["meta"]);
  assertEquals(okBudgets.get("meta-c"), 500);
  assertEquals(none, []);
});

Deno.test("R5 the success path records and reports nothing", async () => {
  const budgets: Budgets = new Map([["meta-c", 500]]);
  const problems: HostLiveEditProblem[] = [];
  const result = await run(null, false, budgets, problems);
  assertEquals(result.status, 200);
  assertEquals(budgets.get("meta-c"), 700);
  assertEquals(problems, []);
});

import { providerCapCents } from "../adSpendSync.ts";
import { shouldPauseForCap } from "../adMoney.ts";

Deno.test("R6 lowering Meta + Google succeeds; Google's cap is recorded and Mingla stops it there", async () => {
  // r9 P1-A: NGN 3,100,000 on Meta + Google, USD 100 a day each (rate
  // 1,550). Meta spent USD 490, Google USD 10. Lower to NGN 1,000,000.
  const camp = (platform: Platform, id: string, spend: number): HostLiveCampaign => ({
    id,
    platform,
    host_budget_cents: 155_000_000,
    host_delivery_budget_cents: 15_500_000,
    provider_budget_cents: 100_000,
    provider_delivery_budget_cents: 10_000,
    current_cap_cents: 100_000,
    current_daily_cents: 10_000,
    provider_spend_cents: spend,
    provider_daily_minimum_cents: platform === "meta" ? 500 : 0,
  });
  const planned = planHostLiveEdit({
    ...base,
    nowMs: Date.parse("2026-11-04T00:00:00Z"),
    currentEndsAt: "2026-11-09T00:00:00Z",
    currentHostBudgetCents: 310_000_000,
    hostSpendCents: 77_500_000,
    newHostBudgetCents: 100_000_000,
    newEndsAt: null,
    campaigns: [camp("meta", "m", 49_000), camp("google", "g", 1_000)],
  });
  if (!planned.ok) throw new Error(planned.error);
  const google = planned.lines.find((line) => line.platform === "google")!;
  assertEquals(google.daily_changed, false);
  assertEquals(planned.dailyNotPushed, ["google"]);

  const budgets: Budgets = new Map([["meta-c", 10_000]]);
  const touched: string[] = [];
  let recorded: Array<Record<string, number | string>> = [];
  const result = await runHostLiveEdit({
    db: {
      ...db(null),
      rpc: (_name: string, args: Record<string, unknown>) => {
        recorded = args.p_changes as Array<Record<string, number | string>>;
        return Promise.resolve({ data: { id: "edit" }, error: null });
      },
    },
    getAdapter: (platform) => {
      touched.push(platform);
      // Google has no budget readback: calling it at all would fail the edit.
      return platform === "google" ? ({} as ChannelAdapter) : adapter(budgets, false);
    },
  }, {
    plan: planned,
    versionId: "v",
    planHash: "h".repeat(64),
    campaigns: [
      { id: "m", platform: "meta", external_campaign_id: "meta-c", connection_id: "k1", provider_delivery_budget_cents: 10_000, provider_budget_cents: 100_000 },
      { id: "g", platform: "google", external_campaign_id: "g-c", connection_id: "k2", provider_delivery_budget_cents: 10_000, provider_budget_cents: 100_000 },
    ],
    actorId: "a",
    idempotencyKey: "host_live_p_r9-google-lower",
    previousEndsAt: "2026-11-09T00:00:00Z",
  });
  assertEquals(result.status, 200, JSON.stringify(result.body));
  assertEquals(touched.includes("google"), false, "Google is never asked for a daily push");
  assertEquals(result.body.daily_not_pushed, ["google"]);
  const googleRow = recorded.find((row) => row.campaign_id === "g")!;
  assertEquals(googleRow.new_provider_budget_cents, google.new_provider_budget_cents);
  assert(Number(googleRow.new_provider_delivery_budget_cents) <= Number(googleRow.new_provider_budget_cents));
  // Spend sync reads the recorded (amended) cap and pauses Google at it.
  const cap = providerCapCents({
    amended_provider_budget_cents: Number(googleRow.new_provider_budget_cents),
    provider_budget_cents: 100_000,
  } as Parameters<typeof providerCapCents>[0]);
  assertEquals(cap, google.new_provider_budget_cents);
  assertEquals(shouldPauseForCap(cap!, cap), true);
  assertEquals(shouldPauseForCap(1_000, cap), false);
});

Deno.test("R7 a record that throws after a push still reverts and names a failed undo", async () => {
  const throwing = (failUndo: boolean, budgets: Budgets, problems: HostLiveEditProblem[]) =>
    runHostLiveEdit({
      db: { ...db(null), rpc: () => Promise.reject(new Error("connection reset by peer")) },
      getAdapter: () => adapter(budgets, failUndo),
      onProblem: (problem) => {
        problems.push(problem);
        return Promise.resolve();
      },
    }, {
      plan: metaPlan,
      versionId: "v",
      planHash: "h".repeat(64),
      campaigns: metaRow,
      actorId: "a",
      idempotencyKey: "host_live_p_r10-throw",
      previousEndsAt: END,
    });
  const ok: Budgets = new Map([["meta-c", 500]]);
  const none: HostLiveEditProblem[] = [];
  const undone = await throwing(false, ok, none);
  assertEquals(undone.status, 502);
  assertEquals(undone.body.error, "host_ad_live_edit_not_recorded");
  assertEquals(ok.get("meta-c"), 500, "the push was undone");
  assertEquals(none, []);
  const stuck: Budgets = new Map([["meta-c", 500]]);
  const problems: HostLiveEditProblem[] = [];
  const failed = await throwing(true, stuck, problems);
  assertEquals(failed.body.error, "host_ad_live_edit_undo_failed");
  assertEquals(problems.map((p) => p.kind), ["undo_failed"]);
});

Deno.test("R8 a claim left by a crashed request is reported to staff", async () => {
  const source = await Deno.readTextFile(new URL("../../host-ad-campaign/index.ts", import.meta.url));
  const claim = source.indexOf('"host_ad_live_edit_claim"');
  const lapsed = source.indexOf("claim?.lapsed_claim");
  const report = source.indexOf('kind: "lapsed_claim"', lapsed);
  assert(claim > 0 && lapsed > claim && report > lapsed, "the handler reports a lapsed claim right after claiming");
  assert(source.includes("recordLiveEditProblem(db, {"), "through the same record + alert path as a failed undo");
});
