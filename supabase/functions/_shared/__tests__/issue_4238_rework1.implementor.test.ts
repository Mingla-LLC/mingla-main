// MINGLA-INVARIANT: I-4238-GOAL-SWITCH-AT-MOST-ONE-EXTRA | issue #4238 | A goal-ladder switch whose new ad set could not be paused stays pending with cleanup_required (never failed, so it is never re-claimed) until a later sweep pauses that ad set; the old ad set is never paused on that path.
// MINGLA-INVARIANT: I-4238-PLAN-DAILY-IN-BRAND-MONEY | issue #4238 | The Host ad detail's daily amount comes from the plan allocation (amendment-aware, frozen-rate converted to the brand's money), never from ad_campaigns.daily_budget_cents; an unreadable app gives null, never 0.
// Issue #4238 rework 1 (after the tester FAIL on 27212fe70f) — server side.
//
//  P1-2 / P1-3  hostPlanDailyCreditCents: the detail's daily amount comes
//               from the plan allocation in the BRAND's money (amendments
//               converted at the frozen ratio), never daily_budget_cents.
//  P1-1         hostPlanPublicPageUrl: Share results gets a clean public link.
//  P2-3         buildAdCreditPaystackReference: a new amount is a new
//               reference; the same attempt and amount stays the same.
//  P2-4         goal ladder: a new ad set that can't be paused stays pending
//               (cleanup_required) and is paused by the next sweep; never a
//               failed row that would be re-claimed into a third ad set.
//
// @invariant I-4238-PLAN-DAILY-IN-BRAND-MONEY (declared in adHostLiveEdit.ts)
// @invariant I-4238-GOAL-SWITCH-AT-MOST-ONE-EXTRA (declared in adGoalPromotion.ts)

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hostPlanDailyCreditCents,
  hostPlanPublicPageUrl,
} from "../adHostLiveEdit.ts";
import { buildAdCreditPaystackReference } from "../adCreditStripe.ts";
import {
  creditCentsFromPay,
  HOST_FEE_RATIO,
  hostMinimumPayCents,
} from "../adMoney.ts";
import { decideGoalPromotion } from "../adGoalLadder.ts";
import {
  finishGoalPromotion,
  type Graph,
  startGoalPromotion,
} from "../adGoalPromotion.ts";

type Row = Record<string, unknown>;

// ── P1-2 / P1-3: the daily amount in the brand's money ─────────────────────

Deno.test("P1-2: a TikTok-only ad (daily_budget_cents null on the campaign) reads the plan's daily", () => {
  assertEquals(
    hostPlanDailyCreditCents({
      campaigns: [{ platform: "tiktok", daily_budget_cents: null }],
      allocations: [{
        platform: "tiktok",
        host_delivery_budget_cents: 2_333,
        provider_delivery_budget_cents: 2_333,
      }],
    }),
    2_333,
  );
});

Deno.test("P1-2: Meta + Snapchat + Reddit add up their plan dailies; daily_budget_cents is ignored", () => {
  assertEquals(
    hostPlanDailyCreditCents({
      campaigns: [
        { platform: "meta", daily_budget_cents: 99_999 },
        { platform: "snapchat", daily_budget_cents: null },
        { platform: "reddit", daily_budget_cents: null },
      ],
      allocations: [
        { platform: "meta", host_delivery_budget_cents: 3_000, provider_delivery_budget_cents: 3_000 },
        { platform: "snapchat", host_delivery_budget_cents: 2_000, provider_delivery_budget_cents: 2_000 },
        { platform: "reddit", host_delivery_budget_cents: 1_000, provider_delivery_budget_cents: 1_000 },
      ],
    }),
    6_000,
  );
});

Deno.test("P1-3: an NGN brand on a USD ad account shows Naira, not US cents (fail-on-revert)", () => {
  // ₦16,000.00 a day = US$10.00 a day at the plan's frozen rate.
  const allocations = [{
    platform: "meta",
    host_currency: "NGN",
    provider_currency: "USD",
    host_delivery_budget_cents: 1_600_000,
    provider_delivery_budget_cents: 1_000,
  }];
  const daily = hostPlanDailyCreditCents({
    campaigns: [{ platform: "meta", daily_budget_cents: 1_000 }],
    allocations,
  });
  assertEquals(daily, 1_600_000);
  // The old screen summed daily_budget_cents: 1,000 "kobo" = ₦10.
  assert(daily !== 1_000);
  // A live edit raised the provider daily to US$15: ₦24,000 at the same ratio.
  assertEquals(
    hostPlanDailyCreditCents({
      campaigns: [{ platform: "meta", amended_provider_delivery_budget_cents: 1_500 }],
      allocations,
    }),
    2_400_000,
  );
});

Deno.test("P1-2: an app with no readable allocation makes the daily unknown (null), never 0", () => {
  assertEquals(
    hostPlanDailyCreditCents({
      campaigns: [{ platform: "meta" }, { platform: "tiktok" }],
      allocations: [{ platform: "meta", host_delivery_budget_cents: 500, provider_delivery_budget_cents: 500 }],
    }),
    null,
  );
  assertEquals(hostPlanDailyCreditCents({ campaigns: [], allocations: [] }), null);
  assertEquals(
    hostPlanDailyCreditCents({
      campaigns: [{ platform: "meta", amended_provider_delivery_budget_cents: -4 }],
      allocations: [{ platform: "meta", host_delivery_budget_cents: 500, provider_delivery_budget_cents: 500 }],
    }),
    null,
  );
});

// ── Money parity with the Host app (replaces the Jest read-the-source pins) ─

Deno.test("money parity: the server gives the same pay/credit table the Host app's W6a test pins", () => {
  // The same rows issue_4238_w6a_builder_money.implementor.test.ts asserts for
  // hostAdPayFromCredit / hostAdCreditFromPay on the client.
  assertEquals(HOST_FEE_RATIO, 0.15);
  assertEquals(hostMinimumPayCents(100), 118);
  assertEquals(hostMinimumPayCents(500), 589);
  assertEquals(hostMinimumPayCents(2000), 2353);
  assertEquals(creditCentsFromPay(5_000_00), 4_250_00);
  assertEquals(creditCentsFromPay(0), 0);
  assertEquals(hostMinimumPayCents(-1), 0);
});

// ── P1-1: the public link Share results uses ────────────────────────────────

Deno.test("P1-1: only a clean https public page link is shared", () => {
  assertEquals(
    hostPlanPublicPageUrl({ canonical_url: "https://usemingla.com/e/rooftop/summer-jam" }),
    "https://usemingla.com/e/rooftop/summer-jam",
  );
  assertEquals(hostPlanPublicPageUrl({ canonical_url: "https://usemingla.com/e/a/b?utm_source=meta" }), null);
  assertEquals(hostPlanPublicPageUrl({ canonical_url: "http://usemingla.com/e/a/b" }), null);
  assertEquals(hostPlanPublicPageUrl({}), null);
  assertEquals(hostPlanPublicPageUrl(null), null);
});

// ── P2-3: a new payment reference per amount ────────────────────────────────

Deno.test("P2-3: a retried Naira top-up for a new amount gets a new reference (fail-on-revert)", () => {
  const brandId = "11111111-1111-4111-8111-111111111111";
  const a = buildAdCreditPaystackReference({ brandId, clientIdem: "attempt-1", payCents: 500_000 });
  const again = buildAdCreditPaystackReference({ brandId, clientIdem: "attempt-1", payCents: 500_000 });
  const other = buildAdCreditPaystackReference({ brandId, clientIdem: "attempt-1", payCents: 750_000 });
  const next = buildAdCreditPaystackReference({ brandId, clientIdem: "attempt-2", payCents: 500_000 });
  assertEquals(a, again);
  assert(a !== other, "same key, new amount must be a new reference");
  assert(a !== next, "a new attempt must be a new reference");
  for (const ref of [a, other, next]) {
    assert(ref.startsWith("mingla_adc_"));
    assert(ref.length <= 100);
  }
});

// ── P2-4: the goal-ladder failure path ──────────────────────────────────────

function fakeDb(rows: Row[] = []) {
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
        insert(row: Row) {
          pendingInsert = row;
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
          if (pendingUpdate) for (const r of hits) Object.assign(r, pendingUpdate);
          return { data: single ? (hits[0] ? { id: hits[0].id } : null) : hits, error: null };
        },
      };
      return q;
    },
  };
  return db;
}

/** Creates the new ad set, then the ad copy throws; pausing the new ad set fails `pauseFailures` times. */
function brokenGraph(pauseFailures: number) {
  const calls: Array<{ method: string; path: string; params?: Row }> = [];
  let left = pauseFailures;
  const graph: Graph = (method, path, params) => {
    calls.push({ method, path, params });
    if (method === "GET" && path === "old-adset") {
      return Promise.resolve({ name: "Ad set", promoted_object: { pixel_id: "px1" } });
    }
    if (method === "POST" && path === "act_123/adsets") return Promise.resolve({ id: "new-adset" });
    if (method === "GET" && path === "old-adset/ads") return Promise.reject(new Error("meta: ads read failed"));
    if (method === "POST" && path === "new-adset") {
      if (left > 0) {
        left -= 1;
        return Promise.reject(new Error("meta: pause failed"));
      }
      return Promise.resolve({ success: true });
    }
    if (method === "GET" && path === "new-adset") return Promise.resolve({ effective_status: "ACTIVE" });
    return Promise.resolve({ success: true });
  };
  return { graph, calls };
}

const startInput = {
  planId: "plan-1",
  campaignId: "camp-1",
  externalCampaignId: "ext-camp",
  oldAdSetExternalId: "old-adset",
  purchases7d: 26,
  source: "platform" as const,
  nowIso: "2028-07-20T12:00:00.000Z",
};

Deno.test("P2-4: a new ad set that can't be paused keeps the row pending with cleanup_required (fail-on-revert)", async () => {
  const db = fakeDb();
  const { graph, calls } = brokenGraph(1);
  const result = await startGoalPromotion({ db, graph, adAccountId: "123" }, startInput);
  assertEquals(result.state, "failed");
  const row = db.tables.ad_plan_automation_events[0];
  assertEquals(row.status, "pending");
  assertEquals((row.detail as Row).new_adset_id, "new-adset");
  assertEquals((row.detail as Row).cleanup_required, true);
  // The old ad set is never touched on this path.
  assert(!calls.some((c) => c.path === "old-adset" && c.method === "POST"));
  // A pending row never switches again (no third ad set).
  assertEquals(
    decideGoalPromotion({
      platform: "meta",
      stage: "checkout_first",
      purchases7d: 26,
      liveSinceMs: Date.parse(startInput.nowIso) - 4 * 86_400_000,
      endsAtMs: Date.parse(startInput.nowIso) + 10 * 86_400_000,
      nowMs: Date.parse(startInput.nowIso) + 2 * 86_400_000,
      existing: { status: "pending", atMs: Date.parse(startInput.nowIso) },
    }).promote,
    false,
  );
});

Deno.test("P2-4: the next sweep pauses the stray new ad set (never the old one) and only then marks failed", async () => {
  const db = fakeDb();
  const first = brokenGraph(1);
  await startGoalPromotion({ db, graph: first.graph, adAccountId: "123" }, startInput);
  const row = db.tables.ad_plan_automation_events[0];

  // Sweep 2: the pause fails again: still pending, nothing else happens.
  const second = brokenGraph(1);
  const waiting = await finishGoalPromotion({ db, graph: second.graph }, {
    row: { ...row, detail: { ...(row.detail as Row), old_adset_id: "old-adset" } } as never,
    campaignId: "camp-1",
    nowIso: "x",
  });
  assertEquals(waiting, "waiting");
  assertEquals(row.status, "pending");
  assert(!second.calls.some((c) => c.path === "old-adset" && c.method === "POST"));

  // Sweep 3: the pause works: failed, cleanup done, old ad set still untouched.
  const third = brokenGraph(0);
  const done = await finishGoalPromotion({ db, graph: third.graph }, {
    row: { ...row } as never,
    campaignId: "camp-1",
    nowIso: "x",
  });
  assertEquals(done, "failed");
  assertEquals(row.status, "failed");
  assertEquals((row.detail as Row).cleanup_required, false);
  assert(third.calls.some((c) => c.path === "new-adset" && (c.params as Row)?.status === "PAUSED"));
  assert(!third.calls.some((c) => c.path === "old-adset" && c.method === "POST"));
});

Deno.test("P2-4: a refused new ad set that can't be paused stays pending instead of failed", async () => {
  const db = fakeDb([{
    id: "row-9",
    status: "pending",
    detail: { new_adset_id: "new-adset", old_adset_id: "old-adset" },
  }]);
  let pauses = 0;
  const graph: Graph = (method, path) => {
    if (method === "GET" && path === "new-adset") return Promise.resolve({ effective_status: "WITH_ISSUES" });
    if (method === "POST" && path === "new-adset") {
      pauses += 1;
      return Promise.reject(new Error("meta: pause failed"));
    }
    return Promise.resolve({ success: true });
  };
  const row = db.tables.ad_plan_automation_events[0];
  assertEquals(
    await finishGoalPromotion({ db, graph }, { row: { ...row } as never, campaignId: "camp-1", nowIso: "x" }),
    "waiting",
  );
  assertEquals(pauses, 1);
  assertEquals(row.status, "pending");
  assertEquals((row.detail as Row).cleanup_required, true);
  assertEquals((row.detail as Row).error, "new_adset_with_issues");
});
