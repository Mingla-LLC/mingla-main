// Issue #4238 rework 2 (after the tester retest FAIL at 15cc1f7134), server side.
//
//  P1-1  planHostLiveEdit: the learning-restart confirm judges the DAILY the
//        apps get ((new total - spent) / days left, against the daily now),
//        and the end date; never the total. Same 20% as the Host app.
//  P3-2  hostLiveDailyNowCents: a lifetime (total) budget app's daily is its
//        pace, (cap - spent) / days left, so "Raise" never sets a smaller
//        lifetime budget than Meta is already pacing.
//  P3-1  startGoalPromotion: the new ad set's id is saved on the pending row
//        (cleanup_required) right after it is created, before any ad copy.
//
// @invariant I-4238-LIVE-DAILY-NOW (declared in adHostLiveEdit.ts)
// @invariant I-4238-LEARNING-CONFIRM (declared in issue_4238_learning_edit.test.ts)
// @invariant I-4238-GOAL-SWITCH-TRACKED-AT-CREATE (declared in adGoalPromotion.ts)

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type HostLiveCampaign,
  hostLiveDailyNowCents,
  hostLiveNewDailyCents,
  planHostLiveEdit,
} from "../adHostLiveEdit.ts";
import {
  finishGoalPromotion,
  type Graph,
  startGoalPromotion,
} from "../adGoalPromotion.ts";

type Row = Record<string, unknown>;
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T10:00:00.000Z");

const row = (over: Partial<HostLiveCampaign> = {}): HostLiveCampaign => ({
  id: "c1",
  platform: "tiktok",
  host_budget_cents: 70_000,
  host_delivery_budget_cents: 7_000,
  provider_budget_cents: 70_000,
  provider_delivery_budget_cents: 7_000,
  current_cap_cents: 70_000,
  current_daily_cents: 7_000,
  provider_spend_cents: 21_000,
  ...over,
});

// Day 3 of a 10-day ad at 7,000 a day: 7 days left.
const endsAt = new Date(NOW + 7 * DAY - 60_000).toISOString();
const learningEdit = (newTotal: number, spent: number, over: Row = {}) =>
  planHostLiveEdit({
    planState: "live",
    lastEditAt: null,
    nowMs: NOW,
    newHostBudgetCents: newTotal,
    newEndsAt: null,
    currentHostBudgetCents: 70_000,
    currentEndsAt: endsAt,
    lastBookableAt: null,
    hostSpendCents: spent,
    campaigns: [row({ provider_spend_cents: spent })],
    liveSinceMs: NOW - 2 * DAY,
    acknowledgeLearningReset: false,
    ...over,
  });
const asks = (plan: ReturnType<typeof planHostLiveEdit>) =>
  !plan.ok && plan.error === "host_ad_live_edit_learning_reset";

Deno.test("P1-1: a 28% daily raise in the learning week asks to confirm, though the total moves 19.6% (fail-on-revert)", () => {
  // 21,000 spent + 8,960 x 7 = 83,720: the total moves 19.6%, the daily 28%.
  const plan = learningEdit(21_000 + 8_960 * 7, 21_000);
  assert(asks(plan));
  if (!plan.ok) assertEquals(plan.learning?.change_pct, 28);
  assert(learningEdit(21_000 + 8_960 * 7, 21_000, { acknowledgeLearningReset: true }).ok);
});

Deno.test("P1-1: a 5% daily cut on an under-spent ad does not ask, though the total drops 26.4% (fail-on-revert)", () => {
  // 5,000 spent + 6,650 x 7 = 51,550: the total drops 26.4%, the daily 5%.
  const plan = learningEdit(5_000 + 6_650 * 7, 5_000);
  assert(plan.ok, JSON.stringify(plan));
});

Deno.test("P1-1: exactly 20% on the daily passes; 20% + 1 a day asks; an end-date move always asks", () => {
  assert(learningEdit(21_000 + 8_400 * 7, 21_000).ok);
  assert(asks(learningEdit(21_000 + 8_401 * 7, 21_000)));
  assert(learningEdit(21_000 + 5_600 * 7, 21_000).ok);
  assert(asks(learningEdit(21_000 + 5_599 * 7, 21_000)));
  assert(asks(learningEdit(70_000, 21_000, {
    newHostBudgetCents: null,
    newEndsAt: new Date(NOW + 9 * DAY).toISOString(),
  })));
});

Deno.test("P1-1: the daily the rule judges is the daily the plan pushes", () => {
  const total = 21_000 + 8_000 * 7;
  const plan = learningEdit(total, 21_000, { acknowledgeLearningReset: true });
  assert(plan.ok);
  if (!plan.ok) return;
  assertEquals(plan.lines[0].new_provider_delivery_budget_cents, 8_000);
  assertEquals(hostLiveNewDailyCents(total, 21_000, NOW, Date.parse(endsAt)), 8_000);
});

Deno.test("P1-1: a daily app's daily now is its current (amended) daily at the frozen ratio", () => {
  // NGN brand on a USD account: 1,000,000 kobo a day = 588 US cents a day.
  const ngn = row({
    host_delivery_budget_cents: 1_000_000,
    provider_delivery_budget_cents: 588,
    current_daily_cents: 600,
  });
  assertEquals(hostLiveDailyNowCents([ngn], NOW, Date.parse(endsAt)), Math.floor((600 * 1_000_000) / 588));
  assertEquals(hostLiveDailyNowCents([row({ current_daily_cents: 0 })], NOW, Date.parse(endsAt)), null);
  assertEquals(hostLiveDailyNowCents([], NOW, Date.parse(endsAt)), null);
});

// ── P3-2: Meta lifetime (total) budget ─────────────────────────────────────

const lifetimeMeta = row({
  platform: "meta",
  lifetime: true,
  // Plan daily 7,000, but only 5,000 spent by day 3: Meta paces what is left.
  provider_spend_cents: 5_000,
});

Deno.test("P3-2: a lifetime app's daily now is its pace, (cap - spent) / days left (fail-on-revert)", () => {
  // (70,000 - 5,000) / 7 = 9,285 a day, not the plan's 7,000.
  assertEquals(hostLiveDailyNowCents([lifetimeMeta], NOW, Date.parse(endsAt)), 9_285);
});

Deno.test("P3-2: Raise from the pace never sets a smaller Meta lifetime budget (real daily never drops)", () => {
  const pace = hostLiveDailyNowCents([lifetimeMeta], NOW, Date.parse(endsAt)) as number;
  for (const step of [100, 500, 1_000, 5_000]) {
    const newTotal = 5_000 + (pace + step) * 7;
    const plan = planHostLiveEdit({
      planState: "live",
      lastEditAt: null,
      nowMs: NOW,
      newHostBudgetCents: newTotal,
      newEndsAt: null,
      currentHostBudgetCents: 70_000,
      currentEndsAt: endsAt,
      lastBookableAt: null,
      hostSpendCents: 5_000,
      campaigns: [lifetimeMeta],
      liveSinceMs: null,
    });
    assert(plan.ok);
    if (!plan.ok) continue;
    const line = plan.lines[0];
    assert(line.lifetime_changed === true);
    const oldPace = (lifetimeMeta.current_cap_cents - 5_000) / 7;
    const newPace = (line.new_provider_budget_cents - 5_000) / 7;
    assert(newPace > oldPace, `step ${step}: Meta pace ${oldPace} -> ${newPace}`);
  }
});

// ── P3-1: the goal switch's new ad set is tracked before the ad copy ──────

function fakeDb(rows: Row[] = [], failUpdates = false) {
  const tables: Record<string, Row[]> = { ad_plan_automation_events: rows };
  let seq = 0;
  // deno-lint-ignore no-explicit-any
  const db: any = {
    tables,
    from(table: string) {
      const list = tables[table] ?? (tables[table] = []);
      const filters: Array<(r: Row) => boolean> = [];
      let pendingUpdate: Row | null = null;
      let pendingInsert: Row | null = null;
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select: () => q,
        eq(c: string, v: unknown) {
          filters.push((r) => r[c] === v);
          return q;
        },
        insert(r: Row) {
          pendingInsert = r;
          return q;
        },
        update(patch: Row) {
          pendingUpdate = patch;
          return q;
        },
        maybeSingle: () => q.run(true),
        then(resolve: (v: unknown) => void) {
          resolve(q.run(false));
        },
        run(single: boolean) {
          if (pendingInsert) {
            const saved = { id: `row-${++seq}`, ...pendingInsert };
            list.push(saved);
            return { data: single ? { id: saved.id } : [saved], error: null };
          }
          const hits = list.filter((r) => filters.every((f) => f(r)));
          if (pendingUpdate) {
            const patch = pendingUpdate as Row;
            const tracking = (patch.detail as Row | undefined)?.copying_ads === true;
            if (failUpdates && tracking) return { data: null, error: { message: "db down" } };
            for (const r of hits) Object.assign(r, patch);
          }
          return { data: single ? (hits[0] ? { id: hits[0].id } : null) : hits, error: null };
        },
      };
      return q;
    },
  };
  return db;
}

const startInput = {
  planId: "plan-1",
  campaignId: "camp-1",
  externalCampaignId: "ext-camp",
  oldAdSetExternalId: "old-adset",
  purchases7d: 26,
  source: "platform" as const,
  nowIso: "2026-11-16T10:00:00.000Z",
};

/** Meta that creates the ad set, then hangs on the ad read (a killed run). */
function hangingGraph() {
  const calls: Array<{ method: string; path: string; params?: Row }> = [];
  const graph: Graph = (method, path, params) => {
    calls.push({ method, path, params });
    if (method === "GET" && path === "old-adset") {
      return Promise.resolve({ name: "Ad set", promoted_object: { pixel_id: "px1" } });
    }
    if (method === "POST" && path === "act_123/adsets") return Promise.resolve({ id: "new-adset" });
    if (method === "GET" && path === "old-adset/ads") return new Promise(() => {});
    return Promise.resolve({ success: true });
  };
  return { graph, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

Deno.test("P3-1: a run killed while copying ads leaves the new ad set tracked, and the next sweep pauses it (fail-on-revert)", async () => {
  const db = fakeDb();
  const { graph } = hangingGraph();
  void startGoalPromotion({ db, graph, adAccountId: "123" }, startInput);
  await tick();
  // The process dies here: the ads read never returns.
  const saved = db.tables.ad_plan_automation_events[0];
  assertEquals(saved.status, "pending");
  assertEquals((saved.detail as Row).new_adset_id, "new-adset");
  assertEquals((saved.detail as Row).cleanup_required, true);

  const next: Array<{ method: string; path: string; params?: Row }> = [];
  const sweep: Graph = (method, path, params) => {
    next.push({ method, path, params });
    return Promise.resolve({ success: true });
  };
  const result = await finishGoalPromotion({ db, graph: sweep }, {
    row: saved as never,
    campaignId: "camp-1",
    nowIso: "x",
  });
  assertEquals(result, "failed");
  assert(next.some((c) => c.path === "new-adset" && (c.params as Row)?.status === "PAUSED"));
  assert(!next.some((c) => c.path === "old-adset" && c.method === "POST"));
});

Deno.test("P3-1: a completed switch clears the cleanup mark and records the copied ads", async () => {
  const db = fakeDb();
  const graph: Graph = (method, path) => {
    if (method === "GET" && path === "old-adset") {
      return Promise.resolve({ name: "Ad set", promoted_object: { pixel_id: "px1" } });
    }
    if (method === "POST" && path === "act_123/adsets") return Promise.resolve({ id: "new-adset" });
    if (method === "GET" && path === "old-adset/ads") {
      return Promise.resolve({ data: [{ id: "a1", name: "Ad", creative: { id: "cr1" } }] });
    }
    if (method === "POST" && path === "act_123/ads") return Promise.resolve({ id: "new-ad-1" });
    return Promise.resolve({ success: true });
  };
  const result = await startGoalPromotion({ db, graph, adAccountId: "123" }, startInput);
  assertEquals(result.state, "created");
  const detail = db.tables.ad_plan_automation_events[0].detail as Row;
  assertEquals(detail.cleanup_required, false);
  assertEquals(detail.new_ad_ids, ["new-ad-1"]);
});

Deno.test("P3-1: if the id can't be saved, the new ad set is paused and no ad is copied", async () => {
  const db = fakeDb([], true);
  const { graph, calls } = hangingGraph();
  const result = await startGoalPromotion({ db, graph, adAccountId: "123" }, startInput);
  assertEquals(result.state, "failed");
  assert(calls.some((c) => c.path === "new-adset" && (c.params as Row)?.status === "PAUSED"));
  assert(!calls.some((c) => c.path === "old-adset/ads"));
  assertEquals(db.tables.ad_plan_automation_events[0].status, "failed");
});
