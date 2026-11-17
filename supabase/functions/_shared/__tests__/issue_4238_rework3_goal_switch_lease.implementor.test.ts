// MINGLA-INVARIANT: I-4238-GOAL-SWITCH-COPY-LEASE | issue #4238 | finishGoalPromotion never pauses, fails or applies a goal-switch row whose detail says copying_ads with an unexpired copy_lease_until; only the run that holds the lease clears it. Enforced by issue_4238_rework3_goal_switch_lease.implementor.test.ts.
// Issue #4238 rework 3 (after retest 3), server side.
//
//  P3-1 race  An overlapping sweep's finishGoalPromotion read the goal-switch
//             row while another run was still copying ads into the new ad set,
//             paused that ad set and failed the row; the copying run still
//             returned "created". The copy now holds a lease
//             (copy_lease_until); finish waits while it is held.
//  P3-3       Ari never suggests extending (or raising) an ad that is paused
//             because it sold out or its event is over.
//  P3-2       Ari's suggestion says which goal its cost per result counts
//             (basis.goal), so the card names the right unit.
//
// @invariant I-4238-GOAL-SWITCH-COPY-LEASE (declared in adGoalPromotion.ts)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  finishGoalPromotion,
  GOAL_SWITCH_COPY_LEASE_MS,
  goalSwitchCopyHeld,
  type Graph,
  startGoalPromotion,
} from "../adGoalPromotion.ts";
import { hostAdSuggestion, type HostAdSuggestionInput } from "../adSuggestion.ts";

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
          if (pendingUpdate) for (const r of hits) Object.assign(r, pendingUpdate);
          return { data: single ? (hits[0] ? { id: hits[0].id } : null) : hits, error: null };
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

Deno.test("race (tester retest 3): a second sweep during the ad copy leaves the switch alone, and it applies (fail-on-revert)", async () => {
  const db = fakeDb();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const calls: Array<{ method: string; path: string; params?: Row }> = [];
  const graph: Graph = async (method, path, params) => {
    calls.push({ method, path, params });
    if (method === "GET" && path === "old-adset") return { name: "Ad set", promoted_object: { pixel_id: "px1" } };
    if (method === "POST" && path === "act_123/adsets") return { id: "new-adset" };
    if (method === "GET" && path === "old-adset/ads") {
      await gate;
      return { data: [{ id: "a1", name: "Ad", creative: { id: "cr1" } }] };
    }
    if (method === "POST" && path === "act_123/ads") return { id: "new-ad-1" };
    if (method === "GET" && path === "new-adset") return { effective_status: "ACTIVE" };
    return { success: true };
  };
  const first = startGoalPromotion({ db, graph, adAccountId: "123" }, startInput);
  await new Promise((r) => setTimeout(r, 0));
  const row = db.tables.ad_plan_automation_events[0];
  assertEquals((row.detail as Row).copying_ads, true);
  // The overlapping sweep, 2 minutes later, with its own snapshot of the row.
  const second = await finishGoalPromotion({ db, graph }, {
    row: { ...row, detail: { ...(row.detail as Row) } } as never,
    campaignId: "camp-1",
    nowIso: at(2 * 60_000),
  });
  assertEquals(second, "waiting");
  assert(!calls.some((c) => c.path === "new-adset" && c.method === "POST"), "new ad set never paused mid-copy");
  release();
  const result = await first;
  assertEquals(result.state, "created");
  const after = db.tables.ad_plan_automation_events[0];
  assertEquals(after.status, "pending");
  assertEquals((after.detail as Row).cleanup_required, false);
  assertEquals((after.detail as Row).copying_ads, undefined);
  assertEquals((after.detail as Row).new_ad_ids, ["new-ad-1"]);
  // The next sweep then finishes the switch normally.
  const third = await finishGoalPromotion({ db, graph }, {
    row: { ...after } as never,
    campaignId: "camp-1",
    nowIso: at(60 * 60_000),
  });
  assertEquals(third, "applied");
  assert(calls.some((c) => c.path === "old-adset" && (c.params as Row)?.status === "PAUSED"));
});

Deno.test("a run that died mid-copy is cleaned up once its lease has ended (never before)", async () => {
  const db = fakeDb();
  const graph: Graph = (method, path) => {
    if (method === "GET" && path === "old-adset") return Promise.resolve({ name: "Ad set", promoted_object: { pixel_id: "px1" } });
    if (method === "POST" && path === "act_123/adsets") return Promise.resolve({ id: "new-adset" });
    if (method === "GET" && path === "old-adset/ads") return new Promise(() => {});
    return Promise.resolve({ success: true });
  };
  void startGoalPromotion({ db, graph, adAccountId: "123" }, startInput);
  await new Promise((r) => setTimeout(r, 0));
  const saved = db.tables.ad_plan_automation_events[0];
  const sweepCalls: Array<{ path: string; params?: Row }> = [];
  const sweep: Graph = (_m, path, params) => {
    sweepCalls.push({ path, params });
    return Promise.resolve({ success: true });
  };
  const early = await finishGoalPromotion({ db, graph: sweep }, {
    row: saved as never,
    campaignId: "camp-1",
    nowIso: at(GOAL_SWITCH_COPY_LEASE_MS - 1_000),
  });
  assertEquals(early, "waiting");
  assertEquals(sweepCalls.length, 0);
  const late = await finishGoalPromotion({ db, graph: sweep }, {
    row: saved as never,
    campaignId: "camp-1",
    nowIso: at(GOAL_SWITCH_COPY_LEASE_MS + 1_000),
  });
  assertEquals(late, "failed");
  assert(sweepCalls.some((c) => c.path === "new-adset" && (c.params as Row)?.status === "PAUSED"));
  assert(!sweepCalls.some((c) => c.path === "old-adset"));
});

Deno.test("goalSwitchCopyHeld: unreadable lease or clock waits; no copy mark is never held", () => {
  assertEquals(goalSwitchCopyHeld({ copying_ads: true }, START), true);
  assertEquals(goalSwitchCopyHeld({ copying_ads: true, copy_lease_until: at(1) }, "x"), true);
  assertEquals(goalSwitchCopyHeld({ copying_ads: true, copy_lease_until: at(0) }, at(0)), false);
  assertEquals(goalSwitchCopyHeld({ cleanup_required: true }, "x"), false);
});

// ── Ari's suggestion (P3-2, P3-3) ───────────────────────────────────────────

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T12:00:00Z");
function input(over: Partial<HostAdSuggestionInput> = {}): HostAdSuggestionInput {
  return {
    planId: "11111111-1111-4111-8111-111111111111",
    planState: "paused",
    nowMs: NOW,
    liveSinceMs: NOW - 9 * DAY,
    lastEditAt: null,
    goal: "visits",
    currency: "USD",
    currentTotalCents: 90_000,
    currentEndsAt: "2026-11-20T20:00:00Z",
    lastBookableAt: "2026-12-17T20:00:00Z",
    spendCents: 40_500,
    results: 0,
    resultsLast3Days: 0,
    costPerResult: null,
    stock: { remaining: 260, total: 300, unlimited: false },
    walletCents: 100_000,
    lastTicketsOffered: false,
    ...over,
  };
}

Deno.test("P3-3: paused for sold out or a passed event → no 'run it until …' (fail-on-revert)", async () => {
  for (const stopReason of ["sold_out", "event_ended"]) {
    assertEquals(await hostAdSuggestion(input({ stopReason })), null, stopReason);
  }
  // A Host's own pause still gets the extend (the event runs to Dec 17).
  const own = await hostAdSuggestion(input({ stopReason: "host_paused" }));
  assertEquals(own?.kind, "extend_end");
  // Live again after new stock: the old sold-out pause no longer silences Ari.
  const resumed = await hostAdSuggestion(input({ planState: "live", stopReason: "sold_out" }));
  assertEquals(resumed?.kind, "extend_end");
});

Deno.test("P3-3: no stock left → never an extend, even without a stop reason", async () => {
  const s = await hostAdSuggestion(input({ planState: "live", stock: { remaining: 0, total: 300, unlimited: false } }));
  assert(s?.kind !== "extend_end");
});

Deno.test("P3-2: basis.goal names what the cost per result counted", async () => {
  const s = await hostAdSuggestion(input({ planState: "live", stopReason: null }));
  assertEquals(s?.basis.goal, "visits");
});
