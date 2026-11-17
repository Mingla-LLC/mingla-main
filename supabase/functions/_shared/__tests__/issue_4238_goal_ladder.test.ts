// Issue #4238 W2 item 4 — the goal ladder: started checkouts first, then
// Purchase, at most once per app, never in the first 3 days or with fewer
// than 5 days left, every switch recorded.
//
// @invariant I-4238-ONE-GOAL-SWITCH
//   owner: supabase/functions/_shared/adGoalLadder.ts decideGoalPromotion +
//          ad_plan_automation_events_once (20280801004238)
//   rule: one switch per plan and app; a second sweep or a concurrent sweep
//         never switches again; a failed switch leaves the old ad set running.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideGoalPromotion,
  HOST_LADDER_PLATFORMS,
  hostSalesLadderStart,
  ladderMetaCustomEventType,
  ladderStageFor,
} from "../adGoalLadder.ts";
import {
  finishGoalPromotion,
  type Graph,
  parseMetaResultCounts,
  runHostAdAutomation,
  startGoalPromotion,
} from "../adGoalPromotion.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2028-07-20T12:00:00Z");

// ── A tiny fake for the automation table (unique index included) ───────────
type Row = Record<string, unknown>;
function fakeDb(rows: Row[] = [], extra: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    ad_plan_automation_events: rows,
    ...extra,
  };
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
        select() {
          return q;
        },
        eq(c: string, v: unknown) {
          filters.push((r) => r[c] === v);
          return q;
        },
        gte(c: string, v: string) {
          filters.push((r) => String(r[c]) >= v);
          return q;
        },
        in(c: string, v: unknown[]) {
          filters.push((r) => v.includes(r[c]));
          return q;
        },
        limit() {
          return q;
        },
        order() {
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
        maybeSingle() {
          return q.run(true);
        },
        then(resolve: (v: unknown) => void) {
          resolve(q.run(false));
        },
        run(single: boolean) {
          if (pendingInsert) {
            const r = pendingInsert;
            const once = [
              "goal_promoted",
              "low_stock_copy",
              "slow_sales_nudge",
            ];
            if (
              table === "ad_plan_automation_events" &&
              once.includes(String(r.kind)) &&
              list.some((x) =>
                x.plan_id === r.plan_id && x.platform === r.platform &&
                x.kind === r.kind
              )
            ) {
              return {
                data: null,
                error: { code: "23505", message: "duplicate key" },
              };
            }
            const saved = {
              id: `row-${++seq}`,
              created_at: new Date(NOW).toISOString(),
              ...r,
            };
            list.push(saved);
            return { data: single ? { id: saved.id } : [saved], error: null };
          }
          const hits = list.filter((r) => filters.every((f) => f(r)));
          if (pendingUpdate) {
            for (const r of hits) Object.assign(r, pendingUpdate);
            return {
              data: single ? (hits[0] ? { id: hits[0].id } : null) : hits,
              error: null,
            };
          }
          return {
            data: single ? hits[0] ?? null : hits,
            error: null,
            count: hits.length,
          };
        },
      };
      return q;
    },
  };
  return db;
}

function fakeGraph(opts: { failAdSet?: boolean; status?: string } = {}) {
  const calls: Array<
    { method: string; path: string; params?: Record<string, unknown> }
  > = [];
  const graph: Graph = (method, path, params) => {
    calls.push({ method, path, params });
    if (method === "GET" && path === "old-adset") {
      return Promise.resolve({
        name: "Rooftop — ad set",
        promoted_object: {
          pixel_id: "px1",
          custom_event_type: "INITIATE_CHECKOUT",
        },
        targeting: { geo_locations: { countries: ["NG"] } },
        billing_event: "IMPRESSIONS",
        optimization_goal: "OFFSITE_CONVERSIONS",
        end_time: "2028-08-01T00:00:00Z",
      });
    }
    if (method === "POST" && path === "act_123/adsets") {
      if (opts.failAdSet) {
        return Promise.reject(new Error("meta: (#100) invalid"));
      }
      return Promise.resolve({ id: "new-adset" });
    }
    if (method === "GET" && path === "old-adset/ads") {
      return Promise.resolve({
        data: [
          { id: "ad1", name: "Ad 1", creative: { id: "cr1" } },
          { id: "ad2", name: "Ad 2", creative: { id: "cr2" } },
        ],
      });
    }
    if (method === "POST" && path === "act_123/ads") {
      return Promise.resolve({
        id: `new-${(params?.creative as Row).creative_id}`,
      });
    }
    if (method === "GET" && path === "new-adset") {
      return Promise.resolve({ effective_status: opts.status ?? "ACTIVE" });
    }
    return Promise.resolve({ success: true });
  };
  return { graph, calls };
}

const baseFacts = {
  platform: "meta" as const,
  stage: "checkout_first" as const,
  purchases7d: 26,
  liveSinceMs: NOW - 4 * DAY,
  endsAtMs: NOW + 10 * DAY,
  nowMs: NOW,
  existing: null,
};

// ── SC-4.1 start rule ──────────────────────────────────────────────────────
Deno.test("SC-4.1: 10 purchases a week on Meta freezes checkout_first; 25+ freezes purchase", () => {
  assertEquals(
    hostSalesLadderStart({
      platforms: ["meta"],
      optimizationByPlatform: { meta: "sales" },
      expectedPurchasesWeekMid: { meta: 10 },
    }),
    { meta: "checkout_first" },
  );
  assertEquals(
    hostSalesLadderStart({
      platforms: ["meta"],
      optimizationByPlatform: { meta: "sales" },
      expectedPurchasesWeekMid: { meta: 25 },
    }),
    { meta: "purchase" },
  );
  // Unknown guidance starts on the safe side.
  assertEquals(
    hostSalesLadderStart({
      platforms: ["meta"],
      optimizationByPlatform: { meta: "sales" },
      expectedPurchasesWeekMid: {},
    }),
    { meta: "checkout_first" },
  );
  assertEquals(
    ladderMetaCustomEventType("checkout_first"),
    "INITIATE_CHECKOUT",
  );
});

Deno.test("adversarial: Snap, Google, Reddit and TikTok (Z-1 unconfirmed) never get a ladder; visits/sign-ups never do", () => {
  const out = hostSalesLadderStart({
    platforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
    optimizationByPlatform: {
      meta: "signups",
      snapchat: "sales",
      tiktok: "sales",
      google: "sales",
      reddit: "sales",
    },
    expectedPurchasesWeekMid: { snapchat: 1, tiktok: 1, google: 1, reddit: 1 },
  });
  assertEquals(out, {});
  assertEquals([...HOST_LADDER_PLATFORMS], ["meta"]);
  // A client-forged stage on a non-ladder app is ignored.
  assertEquals(
    ladderStageFor(
      { sales_ladder_by_platform: { tiktok: "checkout_first" } },
      "tiktok",
    ),
    "purchase",
  );
  assertEquals(
    decideGoalPromotion({ ...baseFacts, platform: "snapchat" }),
    { promote: false, reason: "not_a_ladder_app" },
  );
});

// ── SC-4.2 / SC-4.3 promote rule ───────────────────────────────────────────
Deno.test("SC-4.2: day 4, 26 purchases in 7 days, 10 days left → promote", () => {
  assertEquals(decideGoalPromotion(baseFacts), { promote: true });
});

Deno.test("SC-4.3: day 2, or 4 days left, or 24 purchases → no switch", () => {
  assertEquals(
    decideGoalPromotion({ ...baseFacts, liveSinceMs: NOW - 2 * DAY }),
    { promote: false, reason: "too_early" },
  );
  // Exactly 3 days live passes; one second short does not.
  assertEquals(
    decideGoalPromotion({ ...baseFacts, liveSinceMs: NOW - 3 * DAY }),
    { promote: true },
  );
  assertEquals(
    decideGoalPromotion({ ...baseFacts, liveSinceMs: NOW - 3 * DAY + 1000 }),
    { promote: false, reason: "too_early" },
  );
  assertEquals(
    decideGoalPromotion({ ...baseFacts, endsAtMs: NOW + 4 * DAY }),
    { promote: false, reason: "too_late" },
  );
  assertEquals(
    decideGoalPromotion({ ...baseFacts, purchases7d: 24 }),
    { promote: false, reason: "not_enough_purchases" },
  );
  assertEquals(
    decideGoalPromotion({ ...baseFacts, liveSinceMs: null }),
    { promote: false, reason: "not_live" },
  );
});

Deno.test("SC-4.3: a recorded switch never switches again; a failed one retries only after a day", () => {
  assertEquals(
    decideGoalPromotion({
      ...baseFacts,
      existing: { status: "applied", atMs: NOW - 9 * DAY },
    }),
    { promote: false, reason: "already_switched" },
  );
  assertEquals(
    decideGoalPromotion({
      ...baseFacts,
      existing: { status: "pending", atMs: NOW - 9 * DAY },
    }),
    { promote: false, reason: "already_switched" },
  );
  assertEquals(
    decideGoalPromotion({
      ...baseFacts,
      existing: { status: "failed", atMs: NOW - 2 * 3600_000 },
    }),
    { promote: false, reason: "retry_tomorrow" },
  );
  assertEquals(
    decideGoalPromotion({
      ...baseFacts,
      existing: { status: "failed", atMs: NOW - DAY - 1 },
    }),
    { promote: true },
  );
});

// ── Provider steps ─────────────────────────────────────────────────────────
const startInput = {
  planId: "plan-1",
  campaignId: "camp-1",
  externalCampaignId: "ext-camp",
  oldAdSetExternalId: "old-adset",
  purchases7d: 26,
  source: "platform" as const,
  nowIso: new Date(NOW).toISOString(),
};

Deno.test("SC-4.2: the switch is a NEW ad set with PURCHASE, the same targeting and creatives; one row recorded", async () => {
  const db = fakeDb();
  const { graph, calls } = fakeGraph();
  const result = await startGoalPromotion(
    { db, graph, adAccountId: "123" },
    startInput,
  );
  assertEquals(result, { state: "created", newAdSetId: "new-adset" });
  const create = calls.find((c) => c.path === "act_123/adsets");
  assert(create);
  assertEquals(
    (create.params?.promoted_object as Row).custom_event_type,
    "PURCHASE",
  );
  assertEquals((create.params?.promoted_object as Row).pixel_id, "px1");
  assertEquals(create.params?.campaign_id, "ext-camp");
  assertEquals(create.params?.targeting, {
    geo_locations: { countries: ["NG"] },
  });
  assertEquals(
    calls.filter((c) => c.path === "act_123/ads").map((c) =>
      (c.params?.creative as Row).creative_id
    ),
    ["cr1", "cr2"],
  );
  // The old ad set is NOT paused yet (it keeps running until the new one is ACTIVE).
  assert(!calls.some((c) => c.path === "old-adset" && c.method === "POST"));
  const rows = db.tables.ad_plan_automation_events;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].kind, "goal_promoted");
  assertEquals((rows[0].detail as Row).new_adset_id, "new-adset");
  assertEquals((rows[0].detail as Row).from, "checkout");
});

Deno.test("adversarial: two concurrent sweeps produce one switch (the unique row)", async () => {
  const db = fakeDb();
  const a = fakeGraph();
  const b = fakeGraph();
  const [first, second] = await Promise.all([
    startGoalPromotion({ db, graph: a.graph, adAccountId: "123" }, startInput),
    startGoalPromotion({ db, graph: b.graph, adAccountId: "123" }, startInput),
  ]);
  const states = [first.state, second.state].sort();
  assertEquals(states, ["claimed_elsewhere", "created"]);
  const creates = [...a.calls, ...b.calls].filter((c) =>
    c.path === "act_123/adsets"
  );
  assertEquals(creates.length, 1);
});

Deno.test("adversarial: a provider error on the new ad set leaves the old one ACTIVE and records failed", async () => {
  const db = fakeDb();
  const { graph, calls } = fakeGraph({ failAdSet: true });
  const result = await startGoalPromotion(
    { db, graph, adAccountId: "123" },
    startInput,
  );
  assertEquals(result.state, "failed");
  assert(!calls.some((c) => c.path === "old-adset" && c.method === "POST"));
  assertEquals(db.tables.ad_plan_automation_events[0].status, "failed");
});

Deno.test("finish: ACTIVE new ad set → old paused, row applied; refused → new paused, old untouched; in review → wait", async () => {
  const mkRow = () => ({
    id: "row-1",
    status: "pending" as const,
    detail: { new_adset_id: "new-adset", old_adset_id: "old-adset" },
    created_at: new Date(NOW).toISOString(),
    applied_at: null,
  });
  {
    const db = fakeDb([{ ...mkRow() }]);
    const { graph, calls } = fakeGraph({ status: "ACTIVE" });
    assertEquals(
      await finishGoalPromotion({ db, graph }, {
        row: mkRow(),
        campaignId: "camp-1",
        nowIso: "x",
      }),
      "applied",
    );
    assert(
      calls.some((c) =>
        c.path === "old-adset" && (c.params as Row).status === "PAUSED"
      ),
    );
    assertEquals(db.tables.ad_plan_automation_events[0].status, "applied");
  }
  {
    const db = fakeDb([{ ...mkRow() }]);
    const { graph, calls } = fakeGraph({ status: "DISAPPROVED" });
    assertEquals(
      await finishGoalPromotion({ db, graph }, {
        row: mkRow(),
        campaignId: "camp-1",
        nowIso: "x",
      }),
      "failed",
    );
    assert(
      calls.some((c) =>
        c.path === "new-adset" && (c.params as Row)?.status === "PAUSED"
      ),
    );
    assert(!calls.some((c) => c.path === "old-adset" && c.method === "POST"));
  }
  {
    const db = fakeDb([{ ...mkRow() }]);
    const { graph, calls } = fakeGraph({ status: "PENDING_REVIEW" });
    assertEquals(
      await finishGoalPromotion({ db, graph }, {
        row: mkRow(),
        campaignId: "camp-1",
        nowIso: "x",
      }),
      "waiting",
    );
    assert(!calls.some((c) => c.method === "POST"));
  }
});

Deno.test("sweep: a second sweep after the switch adds nothing (runHostAdAutomation)", async () => {
  const db = fakeDb([], {
    ad_spend_daily: [{
      campaign_id: "camp-1",
      spend_date: "2028-07-18",
      purchase_events: 26,
    }],
    ad_sets: [{ campaign_id: "camp-1", external_adset_id: "old-adset" }],
  });
  const { graph, calls } = fakeGraph({ status: "ACTIVE" });
  const ctx = {
    planId: "plan-1",
    campaignId: "camp-1",
    platform: "meta",
    externalCampaignId: "ext-camp",
    canonical: { sales_ladder_by_platform: { meta: "checkout_first" } },
    eventId: null,
    eventStartMs: null,
    endsAtMs: NOW + 10 * DAY,
    liveSinceMs: NOW - 4 * DAY,
    nowMs: NOW,
  };
  const deps = {
    db,
    graph,
    adAccountId: "123",
    readStock: () => Promise.resolve(null),
  };
  assertEquals((await runHostAdAutomation(deps, ctx)).ladder, "created");
  assertEquals((await runHostAdAutomation(deps, ctx)).ladder, "applied");
  assertEquals(
    (await runHostAdAutomation(deps, ctx)).ladder,
    "already_switched",
  );
  assertEquals(calls.filter((c) => c.path === "act_123/adsets").length, 1);
  assertEquals(db.tables.ad_plan_automation_events.length, 1);
});

Deno.test("Meta result counts: one alias per result, never summed", () => {
  const counts = parseMetaResultCounts({
    data: [{
      date_start: "2028-07-18",
      actions: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "4" },
        { action_type: "purchase", value: "4" },
        {
          action_type: "offsite_conversion.fb_pixel_initiate_checkout",
          value: "11",
        },
      ],
    }],
  });
  assertEquals(counts.get("2028-07-18"), {
    purchase: 4,
    checkout: 11,
    signup: 0,
  });
});

Deno.test("SC-4.1 wiring + SC-4.4: create sends INITIATE_CHECKOUT for checkout_first; Host payloads carry no ladder field", async () => {
  const create = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assert(
    create.includes(
      'ladderStageFor(hostCanonical, platform) === "checkout_first"',
    ),
  );
  assert(create.includes('ladderMetaCustomEventType("checkout_first")'));
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  // The ladder is server-computed: a client value is always deleted first.
  assert(plan.includes("delete canonical.sales_ladder_by_platform;"));
  const host = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  assert(!host.includes("sales_ladder_by_platform"));
  assert(!host.includes("goal_promoted"));
});
