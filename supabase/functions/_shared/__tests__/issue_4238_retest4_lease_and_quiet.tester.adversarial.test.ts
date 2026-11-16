// Issue #4238 retest 4 (tester): adversarial angles on rework 3's goal-switch
// copy lease and Ari's quiet rules that the implementor's test does not take.
//
//  - A copy that FAILS and whose pause also fails must NOT keep the lease:
//    the next sweep has to re-pause the (maybe ACTIVE) new ad set at once,
//    not wait 15 minutes while it spends.
//  - The lease written at create is at least 15 minutes from the run's clock.
//  - Inside the lease, finish makes no Graph call at all (not even a read).
//  - Ari is quiet on every final stop reason, also while pause_requested,
//    and a live ad with no stock left is never told to raise or extend.
//
// FAILS-ON-REVERT (verified at 2b1db824fe): keep copying_ads in the
// pause-failed branch → "failed copy" fails; drop the guard in
// finishGoalPromotion → "no Graph call" fails.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  finishGoalPromotion,
  GOAL_SWITCH_COPY_LEASE_MS,
  type Graph,
  startGoalPromotion,
} from "../adGoalPromotion.ts";
import {
  hostAdSuggestion,
  type HostAdSuggestionInput,
} from "../adSuggestion.ts";

type Row = Record<string, unknown>;

function fakeDb() {
  const tables: Record<string, Row[]> = { ad_plan_automation_events: [] };
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
            for (const r of hits) Object.assign(r, pendingUpdate);
          }
          return {
            data: single ? (hits[0] ? { id: hits[0].id } : null) : hits,
            error: null,
          };
        },
      };
      return q;
    },
  };
  return db;
}

const START = "2026-11-16T10:00:00.000Z";
const startInput = {
  planId: "plan-1",
  campaignId: "camp-1",
  externalCampaignId: "ext-camp",
  oldAdSetExternalId: "old-adset",
  purchases7d: 26,
  source: "platform" as const,
  nowIso: START,
};
const at = (ms: number) => new Date(Date.parse(START) + ms).toISOString();

Deno.test("failed copy + failed pause: the next sweep re-pauses the new ad set at once, no lease wait", async () => {
  const db = fakeDb();
  const graph: Graph = (method, path) => {
    if (method === "GET" && path === "old-adset") {
      return Promise.resolve({
        name: "Ad set",
        promoted_object: { pixel_id: "px1" },
      });
    }
    if (method === "POST" && path === "act_123/adsets") {
      return Promise.resolve({ id: "new-adset" });
    }
    if (method === "GET" && path === "old-adset/ads") {
      return Promise.reject(new Error("graph_timeout"));
    }
    if (method === "POST" && path === "new-adset") {
      return Promise.reject(new Error("pause_failed"));
    }
    return Promise.resolve({ success: true });
  };
  const result = await startGoalPromotion(
    { db, graph, adAccountId: "123" },
    startInput,
  );
  assertEquals(result.state, "failed");
  const row = db.tables.ad_plan_automation_events[0];
  assertEquals(row.status, "pending");
  assertEquals((row.detail as Row).cleanup_required, true);
  const calls: Array<{ method: string; path: string; params?: Row }> = [];
  const sweep: Graph = (method, path, params) => {
    calls.push({ method, path, params });
    return Promise.resolve({ success: true });
  };
  // One minute later, far inside what a lease would be.
  const next = await finishGoalPromotion({ db, graph: sweep }, {
    row: { ...row } as never,
    campaignId: "camp-1",
    nowIso: at(60_000),
  });
  assertEquals(next, "failed");
  assert(
    calls.some((c) =>
      c.path === "new-adset" && (c.params as Row)?.status === "PAUSED"
    ),
    "new ad set paused",
  );
  assert(!calls.some((c) => c.path === "old-adset"), "old ad set untouched");
});

Deno.test("lease written at create is at least 15 minutes from the run's clock", async () => {
  const db = fakeDb();
  const graph: Graph = (method, path) => {
    if (method === "GET" && path === "old-adset") {
      return Promise.resolve({
        name: "Ad set",
        promoted_object: { pixel_id: "px1" },
      });
    }
    if (method === "POST" && path === "act_123/adsets") {
      return Promise.resolve({ id: "new-adset" });
    }
    if (method === "GET" && path === "old-adset/ads") {
      return new Promise(() => {});
    }
    return Promise.resolve({ success: true });
  };
  void startGoalPromotion({ db, graph, adAccountId: "123" }, startInput);
  await new Promise((r) => setTimeout(r, 0));
  const detail = db.tables.ad_plan_automation_events[0].detail as Row;
  assertEquals(detail.copying_ads, true);
  const until = Date.parse(String(detail.copy_lease_until));
  assert(until - Date.parse(START) >= GOAL_SWITCH_COPY_LEASE_MS);
  assert(GOAL_SWITCH_COPY_LEASE_MS >= 15 * 60_000);
});

Deno.test("inside the lease, finish makes no Graph call at all, even with cleanup_required", async () => {
  const db = fakeDb();
  const calls: string[] = [];
  const graph: Graph = (_m, path) => {
    calls.push(path);
    return Promise.resolve({ effective_status: "ACTIVE" });
  };
  const out = await finishGoalPromotion({ db, graph }, {
    row: {
      id: "r1",
      status: "pending",
      detail: {
        old_adset_id: "old-adset",
        new_adset_id: "new-adset",
        cleanup_required: true,
        copying_ads: true,
        copy_lease_until: at(GOAL_SWITCH_COPY_LEASE_MS),
      },
    } as never,
    campaignId: "camp-1",
    nowIso: at(GOAL_SWITCH_COPY_LEASE_MS - 1),
  });
  assertEquals(out, "waiting");
  assertEquals(calls, []);
});

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T12:00:00Z");
function input(
  over: Partial<HostAdSuggestionInput> = {},
): HostAdSuggestionInput {
  return {
    planId: "11111111-1111-4111-8111-111111111111",
    planState: "paused",
    nowMs: NOW,
    liveSinceMs: NOW - 9 * DAY,
    lastEditAt: null,
    goal: "sales",
    currency: "USD",
    currentTotalCents: 90_000,
    currentEndsAt: "2026-11-20T20:00:00Z",
    lastBookableAt: "2026-12-17T20:00:00Z",
    spendCents: 9_000,
    results: 30,
    resultsLast3Days: 4,
    costPerResult: { midCents: 1_000, highCents: 2_000 } as never,
    stock: { remaining: 260, total: 300, unlimited: false },
    walletCents: 1_000_000,
    lastTicketsOffered: false,
    ...over,
  };
}

Deno.test("Ari is quiet on every final stop reason, paused or pause_requested", async () => {
  for (const planState of ["paused", "pause_requested"]) {
    for (
      const stopReason of [
        "sold_out",
        "event_ended",
        "bookings_closed",
        "not_on_sale",
      ]
    ) {
      assertEquals(
        await hostAdSuggestion(input({ planState, stopReason })),
        null,
        `${planState}/${stopReason}`,
      );
    }
  }
});

Deno.test("a live ad with no stock left is never told to raise or extend", async () => {
  for (const remaining of [0, -2]) {
    const s = await hostAdSuggestion(
      input({
        planState: "live",
        stock: { remaining, total: 300, unlimited: false },
      }),
    );
    assert(
      s === null || (s.kind !== "raise_budget" && s.kind !== "extend_end"),
      `remaining ${remaining}: ${s?.kind}`,
    );
  }
});

Deno.test("cheap results with stock and credit still get the raise (quiet rules don't over-silence)", async () => {
  const s = await hostAdSuggestion(
    input({ planState: "live", stopReason: "sold_out" }),
  );
  assertEquals(s?.kind, "raise_budget");
  assertEquals(s?.basis.goal, "sales");
});
