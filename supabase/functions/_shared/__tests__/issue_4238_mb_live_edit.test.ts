// MINGLA-INVARIANT: I-4238-LIVE-EDIT-ONCE-A-DAY | issue #4238 | A Host live ad's budget/end date changes at most once per 24 hours, the end never passes the last bookable moment, the new total never drops below spend so far, and Ads credit moves in the same transaction as the change (host_ad_amend_live).
/**
 * #4238 media-buyer, wave D — a Host changes a live ad's budget and end
 * date: once a day, never past the last bookable moment, never under spend,
 * provider amounts at the plan's own frozen ratios, pushes reverted when the
 * record fails. Guards I-4238-LIVE-EDIT-ONCE-A-DAY (declared in
 * ../adHostLiveEdit.ts).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type HostLiveCampaign,
  planHostLiveEdit,
  runHostLiveEdit,
} from "../adHostLiveEdit.ts";
import type { ChannelAdapter, Platform } from "../adChannelCore.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const camp = (platform: Platform, id: string): HostLiveCampaign => ({
  id,
  platform,
  host_budget_cents: 3_000_000,
  host_delivery_budget_cents: 300_000,
  provider_budget_cents: 1_700,
  provider_delivery_budget_cents: 200,
  current_cap_cents: 1_700,
  current_daily_cents: 200,
  provider_spend_cents: 500,
});
const base = {
  planState: "live",
  lastEditAt: null,
  nowMs: NOW,
  currentHostBudgetCents: 6_000_000,
  currentEndsAt: "2026-11-20T22:59:00Z",
  lastBookableAt: "2026-12-06T22:59:00Z",
  hostSpendCents: 1_500_000,
  campaigns: [camp("meta", "m"), camp("google", "g")],
};

Deno.test("D1 once a day, end capped, never under spend", () => {
  assertEquals(
    planHostLiveEdit({ ...base, lastEditAt: "2026-11-10T00:00:00Z", newHostBudgetCents: 7_000_000, newEndsAt: null }),
    { ok: false, error: "host_ad_live_edit_once_a_day" },
  );
  assertEquals(
    planHostLiveEdit({ ...base, newHostBudgetCents: null, newEndsAt: "2026-12-07T10:00:00Z" }),
    { ok: false, error: "host_ad_live_edit_end_after_last_bookable" },
  );
  assertEquals(
    planHostLiveEdit({ ...base, newHostBudgetCents: 1_000_000, newEndsAt: null }),
    { ok: false, error: "host_ad_live_edit_below_spend" },
  );
  assertEquals(
    planHostLiveEdit({ ...base, planState: "ended", newHostBudgetCents: 7_000_000, newEndsAt: null }),
    { ok: false, error: "host_ad_live_edit_state_invalid" },
  );
});

Deno.test("D1 caps follow the frozen ratio; Google keeps its daily amount", () => {
  const plan = planHostLiveEdit({
    ...base,
    newHostBudgetCents: 9_000_000,
    newEndsAt: "2026-12-06T22:59:00Z",
  });
  if (!plan.ok) throw new Error(plan.error);
  // r9 (P1-1): each app keeps its spend (USD 5) plus its half of what is
  // left (NGN 75,000 / 2 at 1,700/3,000,000 = 2,125, less one cent for the
  // frozen-rate rounding), so the caps can never add up past NGN 90,000.
  assertEquals(plan.lines.map((l) => l.new_provider_budget_cents), [2624, 2624]);
  // What is left (NGN 75,000) over 27 days, at the frozen daily ratio.
  assertEquals(plan.lines[0].new_provider_delivery_budget_cents, 92);
  assertEquals(plan.lines[1].new_provider_delivery_budget_cents, 200);
  assertEquals(plan.dailyNotPushed, ["google"]);
  assertEquals(plan.newEndsAt, "2026-12-06T22:59:00.000Z");
});

Deno.test("D1 the record failing (not a lost race) reverts the app pushes", async () => {
  const calls: string[] = [];
  let last = 0;
  const adapter = {
    setBudget: (_c: unknown, _l: unknown, id: string, cents: number) => {
      calls.push(`set:${id}:${cents}`);
      last = cents;
      return Promise.resolve();
    },
    getBudget: () => Promise.resolve({ cents: last, field: "daily_budget" }),
    setEndTime: (_c: unknown, _l: unknown, id: string, end: string) => {
      calls.push(`end:${id}:${end}`);
      return Promise.resolve();
    },
  } as unknown as ChannelAdapter;
  const db = {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = chain;
      q.eq = chain;
      q.order = chain;
      q.maybeSingle = () =>
        Promise.resolve({ data: table === "ad_connections" ? { connected: true, status: "connected" } : null });
      (q as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: table === "ad_sets" ? [{ external_adset_id: "as1" }] : [] });
      return q;
    },
    // r9 (P1-2): a once-a-day refusal is a lost race and is never undone
    // (issue_4238_mb_live_edit_r9.implementor.test.ts); any other record
    // failure still reverts.
    rpc: () => Promise.resolve({ data: null, error: { code: "XX000", message: "connection reset" } }),
  };
  const plan = planHostLiveEdit({
    ...base,
    campaigns: [camp("meta", "m")],
    newHostBudgetCents: 9_000_000,
    newEndsAt: "2026-12-06T22:59:00Z",
  });
  if (!plan.ok) throw new Error(plan.error);
  const result = await runHostLiveEdit({ db, getAdapter: () => adapter }, {
    plan,
    versionId: "v",
    planHash: "h".repeat(64),
    campaigns: [{ id: "m", platform: "meta", external_campaign_id: "c1", connection_id: "k", provider_delivery_budget_cents: 200, provider_budget_cents: 1700 }],
    actorId: "a",
    idempotencyKey: "host_live_key_0001",
    previousEndsAt: "2026-11-20T22:59:00Z",
  });
  assertEquals(result.status, 409, JSON.stringify(result.body));
  assertEquals(result.body.error, "host_ad_live_edit_not_recorded");
  // Pushed: budget then end time; reverted in reverse order.
  assertEquals(calls, [
    // NGN 75,000 left over 27 days, at the frozen daily ratio.
    "set:c1:185",
    "end:as1:2026-12-06T22:59:00.000Z",
    "end:as1:2026-11-20T22:59:00Z",
    "set:c1:200",
  ]);
});
