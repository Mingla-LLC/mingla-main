// #4238 AC 4: pace per app, reusing the 98% cap rule (providerCapCents ×
// CAP_PAUSE_RATIO), never a copy of it.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hostAdPace, type HostAdPaceCampaign, hostAdPaceState } from "../hostAdOverview.ts";

const NOW = Date.parse("2026-11-19T23:30:00Z");
const app = (over: Partial<HostAdPaceCampaign>): HostAdPaceCampaign => ({
  id: "c-snap",
  platform: "snapchat",
  external_campaign_id: "x",
  status: "ACTIVE",
  cap_cents: null,
  provider_budget_cents: 1649,
  amended_provider_budget_cents: null,
  provider_currency: "USD",
  starts_at: "2026-11-18T23:00:00Z",
  ends_at: "2026-11-21T22:59:59.999Z",
  status_synced_at: "2026-11-19T23:15:00Z",
  auto_pause_reason: null,
  provider_spend_cents: 1040,
  spent_credit_cents: 1481100,
  page_visits: 200,
  ...over,
});

Deno.test("#4238 pace: Tinoe Snapchat ends early, Meta on pace", () => {
  const snap = hostAdPaceState(app({}), NOW);
  assertEquals(snap.state, "ends_early");
  // 576 left to the 1616 pause point at 1040 per 24.25h ≈ 13.43h after the sync
  const expected = Date.parse("2026-11-19T23:15:00Z") + (1616 - 1040) / (1040 / (24.25 * 3_600_000));
  assertEquals(snap.stops_at, new Date(Math.round(expected)).toISOString());
  assert(snap.stops_at !== null && snap.stops_at.startsWith("2026-11-20"));
  const meta = hostAdPaceState(app({ id: "c-meta", platform: "meta", provider_budget_cents: 425, provider_spend_cents: 84 }), NOW);
  assertEquals(meta, { state: "on_pace", stops_at: null });
});

Deno.test("#4238 pace: under 12h elapsed is on pace", () => {
  assertEquals(
    hostAdPaceState(app({ starts_at: "2026-11-19T12:00:00Z", status_synced_at: "2026-11-19T23:00:00Z" }), NOW).state,
    "on_pace",
  );
});

Deno.test("#4238 pace: at 98% or paused or auto-paused is stopped", () => {
  assertEquals(hostAdPaceState(app({ provider_spend_cents: 1616 }), NOW).state, "stopped");
  // One cent under the pause point is still running (it will stop soon).
  assertEquals(hostAdPaceState(app({ provider_spend_cents: 1615 }), NOW).state, "ends_early");
  assertEquals(hostAdPaceState(app({ status: "PAUSED" }), NOW).state, "stopped");
  assertEquals(hostAdPaceState(app({ auto_pause_reason: "end_date_passed" }), NOW).state, "stopped");
});

Deno.test("#4238 pace: no end date never ends early; amended cap is preferred; no cap is on pace", () => {
  assertEquals(hostAdPaceState(app({ ends_at: null }), NOW).state, "on_pace");
  // Amended cap 5000 → 4900 pause point is far away: on pace.
  assertEquals(hostAdPaceState(app({ amended_provider_budget_cents: 5000 }), NOW).state, "on_pace");
  // Amended cap 1000 → 980 pause point already passed: stopped.
  assertEquals(hostAdPaceState(app({ amended_provider_budget_cents: 1000 }), NOW).state, "stopped");
  assertEquals(hostAdPaceState(app({ provider_budget_cents: null }), NOW).state, "on_pace");
});

Deno.test("#4238 pace: plan totals, even share and per-visit cost; FX null keeps spent null", () => {
  const pace = hostAdPace({
    phase: "live",
    currency: "NGN",
    totalCreditCents: 3000000,
    spentCreditCents: 1600000,
    nowMs: Date.parse("2026-11-20T11:00:00Z"),
    campaigns: [app({}), app({ id: "c-meta", platform: "meta", provider_budget_cents: 425, provider_spend_cents: 84, spent_credit_cents: null, page_visits: 114 })],
  });
  assert(pace !== null);
  assertEquals(pace.total_credit_cents, 3000000);
  assertEquals(pace.spent_credit_cents, 1600000);
  assert(pace.even_share !== null && Math.abs(pace.even_share - 0.5) < 0.001);
  assertEquals(pace.apps[0].cost_per_visit_credit_cents, Math.round(1481100 / 200));
  assertEquals(pace.apps[1].spent_credit_cents, null);
  assertEquals(pace.apps[1].cost_per_visit_credit_cents, null);
});

Deno.test("#4238 pace: hidden when ended, in review, without a currency, cap or spend", () => {
  const input = { phase: "live" as const, currency: "NGN", totalCreditCents: 100, spentCreditCents: 10, nowMs: NOW, campaigns: [app({})] };
  assertEquals(hostAdPace({ ...input, phase: "ended" }), null);
  assertEquals(hostAdPace({ ...input, phase: "review" }), null);
  assertEquals(hostAdPace({ ...input, phase: "rejected" }), null);
  assertEquals(hostAdPace({ ...input, currency: null }), null);
  assertEquals(hostAdPace({ ...input, totalCreditCents: null }), null);
  assertEquals(hostAdPace({ ...input, spentCreditCents: null }), null);
  assert(hostAdPace({ ...input, phase: "paused" }) !== null);
});
