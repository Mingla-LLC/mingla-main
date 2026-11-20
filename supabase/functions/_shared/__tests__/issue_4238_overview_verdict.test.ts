// MINGLA-INVARIANT: I-4238-OVERVIEW-NO-INVENTED-VERDICT | issue #4238 | hostAdVerdict returns null without a known positive guidance_snapshot mid and high, for the visits goal, or when host spend is unknown; checkout_started is never below counted purchases and is null (hidden) on a read failure.
// #4238 AC 1, 6, 7: the Overview verdict, run length and "Updated" time.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type HostAdFunnelTotals,
  hostAdOverviewPhase,
  hostAdRunDays,
  hostAdSyncedAt,
  hostAdVerdict,
} from "../hostAdOverview.ts";

const NOW = Date.parse("2026-11-19T23:15:00Z");
const LIVE = Date.parse("2026-11-18T23:00:00Z");
const snapshot = { goal: "sales", known: true, cost_per_result_cents: 1000, cost_per_result_high_cents: 1250 };
const funnel: HostAdFunnelTotals = { shown: 1000, taps: 50, visits: 40, checkout: 3, bought: 1 };
const base = {
  snapshot,
  spendCredit: 2000,
  results: 2,
  liveSinceMs: LIVE,
  earliestStartMs: LIVE,
  nowMs: NOW,
  phase: "live" as const,
  hasPlan: true,
  funnel,
};

Deno.test("#4238 verdict: Tinoe fixture is behind with nobody buying", () => {
  const v = hostAdVerdict({
    ...base,
    snapshot: { goal: "sales", known: true, cost_per_result_cents: 91667, cost_per_result_high_cents: 114584 },
    spendCredit: 1481100,
    results: 0,
    funnel: { shown: 26660, taps: 415, visits: 314, checkout: 0, bought: 0 },
  });
  assertEquals(v, { state: "behind", drop_off: "not_buying", cost_per_result_cents: null, expected_cost_per_result_cents: 91667 });
});

Deno.test("#4238 verdict: ahead, on_track and behind with results, boundaries on_track", () => {
  assertEquals(hostAdVerdict({ ...base, spendCredit: 1400, results: 2 })?.state, "ahead"); // 700 < 750
  assertEquals(hostAdVerdict({ ...base, spendCredit: 1500, results: 2 })?.state, "on_track"); // cpr == mid×0.75
  assertEquals(hostAdVerdict({ ...base, spendCredit: 2500, results: 2 })?.state, "on_track"); // cpr == high
  const behind = hostAdVerdict({ ...base, spendCredit: 2502, results: 2 });
  assertEquals(behind?.state, "behind");
  assertEquals(behind?.cost_per_result_cents, 1251);
  assertEquals(behind?.drop_off, "too_dear");
});

Deno.test("#4238 verdict: no result yet is on_track up to the dear end, then behind", () => {
  assertEquals(hostAdVerdict({ ...base, spendCredit: 1250, results: 0 })?.state, "on_track");
  assertEquals(hostAdVerdict({ ...base, spendCredit: 1251, results: 0 })?.state, "behind");
});

Deno.test("#4238 verdict: too early on no spend or under 24h live", () => {
  assertEquals(hostAdVerdict({ ...base, spendCredit: 0 })?.state, "too_early");
  assertEquals(hostAdVerdict({ ...base, liveSinceMs: NOW - 23 * 3_600_000 })?.state, "too_early");
  // live-since unknown falls back to the earliest start
  assertEquals(hostAdVerdict({ ...base, liveSinceMs: null, earliestStartMs: NOW - 3_600_000 })?.state, "too_early");
  assertEquals(hostAdVerdict({ ...base, liveSinceMs: null, earliestStartMs: null, spendCredit: 0 })?.state, "too_early");
});

Deno.test("#4238 I-4238-OVERVIEW-NO-INVENTED-VERDICT: null cases", () => {
  assertEquals(hostAdVerdict({ ...base, snapshot: null }), null);
  assertEquals(hostAdVerdict({ ...base, snapshot: { ...snapshot, known: false } }), null);
  assertEquals(hostAdVerdict({ ...base, snapshot: { ...snapshot, cost_per_result_cents: 0 } }), null);
  assertEquals(hostAdVerdict({ ...base, snapshot: { ...snapshot, cost_per_result_high_cents: null } }), null);
  assertEquals(hostAdVerdict({ ...base, snapshot: { ...snapshot, cost_per_result_cents: 10.5 } }), null);
  assertEquals(hostAdVerdict({ ...base, snapshot: { ...snapshot, goal: "visits" } }), null);
  assertEquals(hostAdVerdict({ ...base, spendCredit: null }), null);
  assertEquals(hostAdVerdict({ ...base, phase: "review" }), null);
  assertEquals(hostAdVerdict({ ...base, phase: "rejected" }), null);
  assertEquals(hostAdVerdict({ ...base, hasPlan: false }), null);
});

Deno.test("#4238 verdict: each drop-off branch, null steps skipped", () => {
  const behind = (f: HostAdFunnelTotals, goal = "sales") =>
    hostAdVerdict({ ...base, snapshot: { ...snapshot, goal }, spendCredit: 5000, results: 0, funnel: f })?.drop_off;
  assertEquals(behind({ shown: 100, taps: 0, visits: 0, checkout: 0, bought: 0 }), "not_tapping");
  assertEquals(behind({ shown: 100, taps: 5, visits: 0, checkout: 0, bought: 0 }), "not_reaching_page");
  assertEquals(behind({ shown: 100, taps: 5, visits: 4, checkout: 0, bought: 0 }), "not_buying");
  assertEquals(behind({ shown: 100, taps: 5, visits: 4, checkout: 2, bought: 0 }), "not_finishing");
  assertEquals(behind({ shown: 100, taps: 5, visits: 4, checkout: 2, bought: 1 }), "too_dear");
  // signups: visits with no sign-up
  assertEquals(behind({ shown: 100, taps: 5, visits: 4, checkout: null, bought: 0 }, "signups"), "not_buying");
  // null steps are skipped, never read as 0
  assertEquals(behind({ shown: null, taps: 5, visits: null, checkout: null, bought: 0 }), "too_dear");
  assertEquals(behind({ shown: 100, taps: null, visits: 4, checkout: null, bought: 0 }), "too_dear");
});

Deno.test("#4238 run days: Tinoe is 3, no end is null", () => {
  assertEquals(hostAdRunDays(["2026-11-18T23:00:00Z"], ["2026-11-21T22:59:59.999Z"]), 3);
  assertEquals(hostAdRunDays(["2026-11-18T23:00:00Z", "2026-11-19T01:00:00Z"], [null, "2026-11-28T23:00:00Z"]), 10);
  assertEquals(hostAdRunDays(["2026-11-18T23:00:00Z"], [null]), null);
  assertEquals(hostAdRunDays(["2026-11-18T23:00:00Z"], ["2026-11-19T01:00:00Z"]), 1);
});

Deno.test("#4238 synced at: the stalest running or paused app", () => {
  assertEquals(
    hostAdSyncedAt([
      { status: "ACTIVE", status_synced_at: "2026-11-19T10:00:00Z" },
      { status: "PAUSED", status_synced_at: "2026-11-19T09:00:00Z" },
      { status: "ARCHIVED", status_synced_at: "2026-11-01T00:00:00Z" },
    ]),
    "2026-11-19T09:00:00.000Z",
  );
  assertEquals(hostAdSyncedAt([{ status: "ARCHIVED", status_synced_at: "2026-11-19T10:00:00Z" }]), null);
  assertEquals(hostAdSyncedAt([{ status: "ACTIVE", status_synced_at: null }]), null);
});

Deno.test("#4238 overview phase mirrors the Host screen", () => {
  assertEquals(hostAdOverviewPhase({ planState: "live", campaigns: [{ status: "ACTIVE" }] }), "live");
  assertEquals(hostAdOverviewPhase({ planState: "paused", campaigns: [{ status: "PAUSED" }] }), "paused");
  assertEquals(hostAdOverviewPhase({ planState: "ended", campaigns: [] }), "ended");
  assertEquals(hostAdOverviewPhase({ planState: "live", campaigns: [{ status: "ARCHIVED" }] }), "ended");
  assertEquals(hostAdOverviewPhase({ planState: "platform_rejected", campaigns: [] }), "rejected");
  assertEquals(hostAdOverviewPhase({ planState: "provider_review", campaigns: [{ status: "PAUSED" }] }), "review");
});
