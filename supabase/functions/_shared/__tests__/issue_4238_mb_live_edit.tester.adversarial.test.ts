/**
 * #4238 media-buyer, tester round 8 — adversarial checks on a Host changing a
 * live ad's budget and end date (adHostLiveEdit.ts). A different angle from
 * issue_4238_mb_live_edit.test.ts: uneven spend, hostile inputs, a lost race,
 * an undo that fails, and TikTok's increase limit.
 *
 *   T1  The per-app caps never add up to more than the new total. When one
 *       app has spent more than its even share, the others must shrink, or
 *       the apps can spend more than the Ads credit set aside and settlement
 *       lands in "attention required". RED at 0bcf8a9bc.
 *   T2  Hostile amounts and dates are refused before any app is touched.
 *   T3  A lost race (another edit was recorded first, PT409 once a day) must
 *       not put the app back on the pre-edit daily budget while Mingla's
 *       record holds the winner's budget. RED at 0bcf8a9bc.
 *   T4  An undo that fails is never reported as undone. RED at 0bcf8a9bc.
 *   T5  TikTok refusing a raise over its limit undoes Meta's push and never
 *       calls host_ad_amend_live (no money moves).
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type HostLiveCampaign,
  planHostLiveEdit,
  runHostLiveEdit,
} from "../adHostLiveEdit.ts";
import type { ChannelAdapter, Platform } from "../adChannelCore.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const END = "2026-11-20T22:59:00Z";

const camp = (
  platform: Platform,
  id: string,
  spend: number,
  over: Partial<HostLiveCampaign> = {},
): HostLiveCampaign => ({
  id,
  platform,
  host_budget_cents: 5_000,
  host_delivery_budget_cents: 500,
  provider_budget_cents: 5_000,
  provider_delivery_budget_cents: 500,
  current_cap_cents: 5_000,
  current_daily_cents: 500,
  provider_spend_cents: spend,
  ...over,
});

const base = {
  planState: "live",
  lastEditAt: null,
  nowMs: NOW,
  currentHostBudgetCents: 10_000,
  currentEndsAt: END,
  lastBookableAt: "2026-12-06T22:59:00Z",
};

Deno.test("T1 the per-app caps never add up to more than the new total", () => {
  // Same currency, ratio 1. Meta delivered fast (4,900 of its 5,000), Snapchat
  // slowly (100). The Host lowers the total to 6,000 (above the 5,000 spent).
  const plan = planHostLiveEdit({
    ...base,
    hostSpendCents: 5_000,
    newHostBudgetCents: 6_000,
    newEndsAt: null,
    campaigns: [camp("meta", "m", 4_900), camp("snapchat", "s", 100)],
  });
  if (!plan.ok) throw new Error(plan.error);
  const caps = plan.lines.reduce((sum, line) => sum + line.new_provider_budget_cents, 0);
  // At 0bcf8a9bc: Meta keeps 4,900 (its spend), Snapchat gets 3,000 → 7,900,
  // so the apps may spend 1,900 more than the 6,000 set aside.
  assert(
    caps <= 6_000,
    `caps add up to ${caps}, above the new total of 6,000: ${JSON.stringify(plan.lines)}`,
  );
  for (const line of plan.lines) {
    const spent = line.campaign_id === "m" ? 4_900 : 100;
    assert(line.new_provider_budget_cents >= spent, "a cap never drops under that app's spend");
  }
});

Deno.test("T2 hostile amounts and dates are refused before any app is touched", () => {
  const plan = (newHostBudgetCents: unknown, newEndsAt: unknown) =>
    planHostLiveEdit({
      ...base,
      hostSpendCents: 1_000,
      newHostBudgetCents,
      newEndsAt,
      campaigns: [camp("meta", "m", 1_000)],
    });
  for (const bad of [0, -500, 12.5, Number.NaN, "abc", Number.MAX_SAFE_INTEGER + 2]) {
    assertEquals(plan(bad, null), { ok: false, error: "host_ad_live_edit_amount_invalid" }, String(bad));
  }
  assertEquals(plan(500, null), { ok: false, error: "host_ad_live_edit_below_spend" });
  assertEquals(plan(null, "2026-12-07T00:00:00Z"), {
    ok: false,
    error: "host_ad_live_edit_end_after_last_bookable",
  });
  assertEquals(plan(null, "2026-11-10T11:59:59Z"), { ok: false, error: "host_ad_live_edit_end_in_past" });
  assertEquals(plan(null, "not a date"), { ok: false, error: "host_ad_live_edit_end_invalid" });
  assertEquals(plan(null, 1_800_000_000_000), { ok: false, error: "host_ad_live_edit_end_invalid" });
  assertEquals(plan(null, null), { ok: false, error: "host_ad_live_edit_empty" });
});

type Budgets = Map<string, number>;

function fakeAdapter(budgets: Budgets, opts: { failUndoFor?: string; refuse?: (id: string, cents: number) => string | null } = {}) {
  const sets: string[] = [];
  const adapter = {
    setBudget: (_c: unknown, _l: unknown, id: string, cents: number) => {
      const refusal = opts.refuse?.(id, cents);
      if (refusal) return Promise.reject(new Error(refusal));
      if (opts.failUndoFor && sets.includes(`${id}:push`) && id === opts.failUndoFor) {
        return Promise.reject(new Error("provider_timeout"));
      }
      sets.push(`${id}:push`);
      budgets.set(id, cents);
      return Promise.resolve();
    },
    getBudget: (_c: unknown, _l: unknown, id: string) =>
      Promise.resolve({ cents: budgets.get(id) ?? 0, field: "daily_budget" }),
  } as unknown as ChannelAdapter;
  return adapter;
}

function fakeDb(rpc: () => Promise<{ data: unknown; error: unknown }>, calls: string[] = []) {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = chain;
      q.eq = chain;
      q.order = chain;
      q.in = chain;
      q.maybeSingle = () =>
        Promise.resolve({ data: table === "ad_connections" ? { connected: true, status: "connected" } : null });
      (q as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: table === "ad_sets" ? [{ id: "as1", external_adset_id: "as1", budget_cents: 500 }] : [] });
      return q;
    },
    rpc: (name: string) => {
      calls.push(name);
      return rpc();
    },
  };
}

const rows = [
  { id: "m", platform: "meta", external_campaign_id: "meta-c", connection_id: "k1", provider_delivery_budget_cents: 500, provider_budget_cents: 5_000 },
  { id: "t", platform: "tiktok", external_campaign_id: "tt-c", connection_id: "k2", provider_delivery_budget_cents: 500, provider_budget_cents: 5_000 },
];

function raisePlan() {
  const plan = planHostLiveEdit({
    ...base,
    hostSpendCents: 0,
    newHostBudgetCents: 20_000,
    newEndsAt: null,
    campaigns: [camp("meta", "m", 0), camp("tiktok", "t", 0)],
  });
  if (!plan.ok) throw new Error(plan.error);
  // With no end change the daily stays; give it a real daily change.
  return {
    ...plan,
    lines: plan.lines.map((line) => ({ ...line, new_provider_delivery_budget_cents: 600, daily_changed: true })),
  };
}

Deno.test("T3 a lost race never puts the app back on the pre-edit daily budget", async () => {
  // Two taps (two keys): both planned 600/day. The first is recorded with
  // 600/day; the second's host_ad_amend_live hits PT409 once a day.
  const budgets: Budgets = new Map([["meta-c", 600], ["as1", 600]]);
  const recordedDaily = 600; // what Mingla's record now says (the winner)
  const result = await runHostLiveEdit({
    db: fakeDb(() => Promise.resolve({ data: null, error: { code: "PT409", message: "host_ad_live_edit_once_a_day" } })),
    getAdapter: () => fakeAdapter(budgets),
  }, {
    plan: raisePlan(),
    versionId: "v",
    planHash: "h".repeat(64),
    campaigns: rows,
    actorId: "a",
    idempotencyKey: "host_live_p_second-tap",
    previousEndsAt: END,
  });
  assertEquals(result.status, 409);
  // At 0bcf8a9bc the loser "reverts" Meta and TikTok to 500/day, while the
  // recorded amendment (and the hold) say 600/day.
  assertEquals(
    budgets.get("meta-c"),
    recordedDaily,
    "Meta's daily budget no longer matches what Mingla recorded",
  );
});

Deno.test("T4 an undo that fails is never reported as undone", async () => {
  const budgets: Budgets = new Map([["meta-c", 500], ["as1", 500]]);
  const result = await runHostLiveEdit({
    db: fakeDb(() => Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } })),
    getAdapter: () => fakeAdapter(budgets, { failUndoFor: "meta-c" }),
  }, {
    plan: raisePlan(),
    versionId: "v",
    planHash: "h".repeat(64),
    campaigns: [rows[0]],
    actorId: "a",
    idempotencyKey: "host_live_p_undo-fails",
    previousEndsAt: END,
  });
  // Meta is still on 600/day: the undo failed.
  assertEquals(budgets.get("meta-c"), 600);
  // At 0bcf8a9bc the failed undo is swallowed and the response says nothing,
  // so the Host reads "Nothing was changed" while Meta runs at 600/day.
  const failed = (result.body as Record<string, unknown>).revert_failed;
  assert(
    Array.isArray(failed) && failed.includes("meta"),
    `the response must name the app whose undo failed, got ${JSON.stringify(result.body)}`,
  );
});

Deno.test("T5 TikTok refusing a raise undoes Meta and moves no money", async () => {
  const budgets: Budgets = new Map([["meta-c", 500], ["as1", 500]]);
  const rpcCalls: string[] = [];
  const result = await runHostLiveEdit({
    db: fakeDb(() => Promise.resolve({ data: { id: "edit" }, error: null }), rpcCalls),
    getAdapter: (platform) =>
      fakeAdapter(budgets, {
        refuse: (_id, cents) => platform === "tiktok" && cents > 500 * 1.3 ? "budget_increase_too_large" : null,
      }),
  }, {
    plan: {
      ...raisePlan(),
      lines: raisePlan().lines.map((line) => ({ ...line, new_provider_delivery_budget_cents: 1_000 })),
    },
    versionId: "v",
    planHash: "h".repeat(64),
    campaigns: rows,
    actorId: "a",
    idempotencyKey: "host_live_p_tiktok-limit",
    previousEndsAt: END,
  });
  assertEquals(result.status, 502);
  assertEquals(result.body.error, "tiktok_budget_update_failed");
  assertEquals(budgets.get("meta-c"), 500, "Meta is back on its old daily budget");
  assertEquals(rpcCalls, [], "host_ad_amend_live is never called, so no credit moves");
});
