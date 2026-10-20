// MINGLA-INVARIANT: I-3697-BUDGET-CHANGE-AMENDS-NEVER-REWRITES | issue #3697 | a budget change is an append-only amendment bound to the plan hash; the cap never drops below spend-to-date, the provider push is reverted when it cannot be recorded, and the frozen allocation is never rewritten
/**
 * Issue #3697 — governed "Change budget".
 *
 * Before: the only way to change a live Mingla campaign's budget was Meta Ads
 * Manager, which leaves Mingla's frozen cap, its 98% auto-pause and the
 * funding hold out of step with what Meta spends.
 *
 * FAILS ON REVERT: delete _shared/adBudgetChange.ts or
 * _shared/adBudgetChangeAction.ts (imports fail), the `change_budget` branch
 * in admin-ad-campaign-action, or the amended-cap read in adSpendSync.ts.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type BudgetCampaign,
  planBudgetChange,
  proportionalSplit,
  spendToDate,
} from "../adBudgetChange.ts";
import { runBudgetChange } from "../adBudgetChangeAction.ts";
import { providerCapCents } from "../adSpendSync.ts";
import type { ChannelAdapter, Platform } from "../adChannelCore.ts";

const VERSION_ID = "534424c7-0000-4000-8000-000000000002";
const HASH = "1fde3e33cd9611bda2806c7b3b10b8987c563fe7" + "0".repeat(24);
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";

const meta = (overrides: Partial<BudgetCampaign> = {}): BudgetCampaign => ({
  id: CAMPAIGN_ID,
  platform: "meta",
  provider_currency: "USD",
  provider_budget_cents: 12000,
  provider_delivery_budget_cents: 3000,
  lifetime_budget_cents: null,
  fx_snapshot_id: null,
  status: "ACTIVE",
  ...overrides,
});

Deno.test("#3697 $30/day + $120 cap → $45/day + $160 cap on one Meta campaign", () => {
  const plan = planBudgetChange({
    ownerKind: "mingla",
    campaigns: [meta()],
    spendByCampaign: { [CAMPAIGN_ID]: 5000 },
    newDailyCents: 4500,
    newCapCents: 16000,
  });
  assert(plan.ok);
  assertEquals(plan.previous, { daily_cents: 3000, cap_cents: 12000 });
  assertEquals(plan.next, { daily_cents: 4500, cap_cents: 16000 });
  assertEquals(plan.lines, [{
    campaign_id: CAMPAIGN_ID,
    platform: "meta",
    previous_cap_cents: 12000,
    new_cap_cents: 16000,
    previous_daily_cents: 3000,
    new_daily_cents: 4500,
    spend_cents: 5000,
    daily_changed: true,
  }]);
});

Deno.test("#3697 refuses a cap below spend, a daily above the cap and Host plans", () => {
  const base = {
    ownerKind: "mingla",
    campaigns: [meta()],
    spendByCampaign: { [CAMPAIGN_ID]: 5000 },
  };
  const below = planBudgetChange({ ...base, newCapCents: 4999 });
  assertEquals(below.ok ? null : below.error, "cap_below_spend");
  const above = planBudgetChange({ ...base, newDailyCents: 20000 });
  assertEquals(above.ok ? null : above.error, "daily_above_cap");
  const host = planBudgetChange({
    ...base,
    ownerKind: "host",
    newCapCents: 20000,
  });
  assertEquals(
    host.ok ? null : host.error,
    "host_budget_change_not_available_yet",
  );
  const empty = planBudgetChange({ ...base });
  assertEquals(empty.ok ? null : empty.error, "budget_change_empty");
  const bad = planBudgetChange({ ...base, newCapCents: -1 });
  assertEquals(bad.ok ? null : bad.error, "budget_amount_invalid");
  const unknown = planBudgetChange({
    ...base,
    spendByCampaign: { [CAMPAIGN_ID]: null },
    newCapCents: 20000,
  });
  assertEquals(unknown.ok ? null : unknown.error, "spend_unknown");
});

Deno.test("#3697 starts from the latest amendment, not the frozen allocation", () => {
  const plan = planBudgetChange({
    ownerKind: "mingla",
    campaigns: [meta({
      amended_provider_budget_cents: 16000,
      amended_provider_delivery_budget_cents: 4500,
    })],
    spendByCampaign: { [CAMPAIGN_ID]: 0 },
    newCapCents: 15000,
  });
  assert(plan.ok);
  assertEquals(plan.previous.cap_cents, 16000);
  assertEquals(plan.lines[0].daily_changed, false);
});

Deno.test("#3697 honest refusals: other providers' daily push, lifetime, FX", () => {
  const tiktok = meta({ id: "t", platform: "tiktok" as Platform });
  const daily = planBudgetChange({
    ownerKind: "mingla",
    campaigns: [tiktok],
    spendByCampaign: { t: 0 },
    newDailyCents: 6000,
  });
  assertEquals(
    daily.ok ? null : daily.error,
    "budget_change_not_supported_for_tiktok",
  );
  const capOnly = planBudgetChange({
    ownerKind: "mingla",
    campaigns: [tiktok],
    spendByCampaign: { t: 0 },
    newCapCents: 20000,
  });
  assert(capOnly.ok, "a cap-only change is Mingla-enforced and needs no push");
  const lifetime = planBudgetChange({
    ownerKind: "mingla",
    campaigns: [meta({ lifetime_budget_cents: 12000 })],
    spendByCampaign: { [CAMPAIGN_ID]: 0 },
    newCapCents: 20000,
  });
  assertEquals(
    lifetime.ok ? null : lifetime.error,
    "lifetime_budget_change_not_supported_yet",
  );
  const fx = planBudgetChange({
    ownerKind: "mingla",
    campaigns: [meta({ fx_snapshot_id: "fx" })],
    spendByCampaign: { [CAMPAIGN_ID]: 0 },
    newCapCents: 20000,
  });
  assertEquals(fx.ok ? null : fx.error, "fx_budget_change_not_supported_yet");
});

Deno.test("#3697 the split conserves every minor unit and keeps proportions", () => {
  assertEquals(proportionalSplit(10001, [6000, 4000]), [6001, 4000]);
  assertEquals(proportionalSplit(100, [1, 1, 1]), [34, 33, 33]);
  assertEquals(proportionalSplit(16000, [12000]), [16000]);
  const plan = planBudgetChange({
    ownerKind: "mingla",
    campaigns: [
      meta(),
      meta({
        id: "m2",
        provider_budget_cents: 6000,
        provider_delivery_budget_cents: 1500,
      }),
    ],
    spendByCampaign: { [CAMPAIGN_ID]: 0, m2: 0 },
    newCapCents: 27000,
  });
  assert(plan.ok);
  assertEquals(plan.lines.map((line) => line.new_cap_cents), [18000, 9000]);
  assertEquals(
    spendToDate([{ spend_cents: 10, currency: "USD" }, {
      spend_cents: 5,
      currency: "NGN",
    }], "USD"),
    null,
  );
  assertEquals(spendToDate([{ spend_cents: 10, currency: "usd" }], "USD"), 10);
});

Deno.test("#3697 the 98% auto-pause reads the amended cap", () => {
  const target = {
    id: "x",
    platform: "meta" as Platform,
    external_campaign_id: "1",
    status: "ACTIVE",
    cap_cents: 12000,
    currency: "USD",
    provider_budget_cents: 12000,
    amended_provider_budget_cents: 16000,
    ends_at: null,
    provider_currency: "USD",
  };
  assertEquals(providerCapCents(target), 16000);
  assertEquals(
    providerCapCents({ ...target, amended_provider_budget_cents: null }),
    12000,
  );
  const sync = Deno.readTextFileSync(
    new URL("../../admin-ad-spend-sync/index.ts", import.meta.url),
  );
  assert(
    sync.includes("amended_provider_budget_cents, ends_at"),
    "spend sync must load the amended cap",
  );
});

// ── runBudgetChange (fake db + adapter) ─────────────────────────────────────

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, rpcError: unknown = null) {
  const rpcCalls: { name: string; args: Row }[] = [];
  return {
    rpcCalls,
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      const rows = () =>
        (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        order: () => query,
        maybeSingle: () =>
          Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return query;
    },
    rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });
      return Promise.resolve(
        rpcError
          ? { data: null, error: rpcError }
          : { data: { amendments: [] }, error: null },
      );
    },
  };
}

function femzyTables(overrides: Record<string, Row[]> = {}) {
  return {
    ad_plans: [{
      id: "p1",
      owner_kind: "mingla",
      state: "live",
      current_version_id: VERSION_ID,
    }],
    ad_campaigns: [{
      ...meta(),
      connection_id: "conn",
      external_campaign_id: "52609700000001",
      plan_version_id: VERSION_ID,
      plan_hash: HASH,
    }],
    ad_spend_daily: [{
      campaign_id: CAMPAIGN_ID,
      spend_cents: 5000,
      currency: "USD",
    }],
    ad_connections: [{ id: "conn", connected: true, status: "connected" }],
    ...overrides,
  };
}

function adapter(calls: string[], fail = false) {
  return (_platform: Platform) =>
    ({
      setBudget: (_conn: unknown, level: string, id: string, cents: number) => {
        calls.push(`${level}:${id}:${cents}`);
        return fail ? Promise.reject(new Error("meta 500")) : Promise.resolve();
      },
    }) as unknown as ChannelAdapter;
}

const campaign = {
  id: CAMPAIGN_ID,
  plan_version_id: VERSION_ID,
  plan_hash: HASH,
};

Deno.test("#3697 runBudgetChange pushes the Meta campaign daily budget, then records the amendment", async () => {
  const db = fakeDb(femzyTables());
  const calls: string[] = [];
  const result = await runBudgetChange(
    { db, getAdapter: adapter(calls) },
    {
      campaign,
      actorId: "admin",
      body: {
        daily_budget_cents: 4500,
        cap_cents: 16000,
        reason: "Clicks are cheap on day 1",
      },
    },
  );
  assertEquals(result.status, 200);
  assertEquals(calls, ["campaign:52609700000001:4500"]);
  assertEquals(db.rpcCalls[0].name, "ad_plan_amend_budget");
  assertEquals(db.rpcCalls[0].args.p_changes, [{
    campaign_id: CAMPAIGN_ID,
    new_provider_budget_cents: 16000,
    new_provider_delivery_budget_cents: 4500,
  }]);
  assertEquals(db.rpcCalls[0].args.p_reason, "Clicks are cheap on day 1");
});

Deno.test("#3697 runBudgetChange: provider failure saves nothing; record failure reverts the provider", async () => {
  const failing = fakeDb(femzyTables());
  const failCalls: string[] = [];
  const failed = await runBudgetChange(
    { db: failing, getAdapter: adapter(failCalls, true) },
    {
      campaign,
      actorId: "admin",
      body: { daily_budget_cents: 4500, reason: "x" },
    },
  );
  assertEquals(failed.status, 502);
  assertEquals(failing.rpcCalls.length, 0);

  const refusing = fakeDb(femzyTables(), {
    message: "ad_budget_cap_below_spend:1:2",
  });
  const calls: string[] = [];
  const refused = await runBudgetChange(
    { db: refusing, getAdapter: adapter(calls) },
    {
      campaign,
      actorId: "admin",
      body: { daily_budget_cents: 4500, reason: "x" },
    },
  );
  assertEquals(refused.status, 409);
  assertEquals(calls, [
    "campaign:52609700000001:4500",
    "campaign:52609700000001:3000",
  ]);
});

Deno.test("#3697 runBudgetChange refusals: reason, Host plan, unsynced live spend, below spend", async () => {
  const calls: string[] = [];
  const noReason = await runBudgetChange(
    { db: fakeDb(femzyTables()), getAdapter: adapter(calls) },
    { campaign, actorId: "admin", body: { cap_cents: 16000, reason: "  " } },
  );
  assertEquals(noReason.status, 400);
  const host = await runBudgetChange(
    {
      db: fakeDb(femzyTables({
        ad_plans: [{
          id: "p1",
          owner_kind: "host",
          state: "live",
          current_version_id: VERSION_ID,
        }],
      })),
      getAdapter: adapter(calls),
    },
    { campaign, actorId: "admin", body: { cap_cents: 16000, reason: "x" } },
  );
  assertEquals(host.body.error, "host_budget_change_not_available_yet");
  const unsynced = await runBudgetChange(
    {
      db: fakeDb(femzyTables({ ad_spend_daily: [] })),
      getAdapter: adapter(calls),
    },
    { campaign, actorId: "admin", body: { cap_cents: 16000, reason: "x" } },
  );
  assertEquals(unsynced.body.error, "spend_unknown");
  const below = await runBudgetChange(
    { db: fakeDb(femzyTables()), getAdapter: adapter(calls) },
    { campaign, actorId: "admin", body: { cap_cents: 4000, reason: "x" } },
  );
  assertEquals(below.body.error, "cap_below_spend");
  const ended = await runBudgetChange(
    {
      db: fakeDb(femzyTables({
        ad_plans: [{
          id: "p1",
          owner_kind: "mingla",
          state: "stop_requested",
          current_version_id: VERSION_ID,
        }],
      })),
      getAdapter: adapter(calls),
    },
    { campaign, actorId: "admin", body: { cap_cents: 16000, reason: "x" } },
  );
  assertEquals(ended.status, 409);
  assertEquals(calls, [], "no refusal reaches a provider");
});

Deno.test("#3697 admin-ad-campaign-action routes change_budget admin-only", () => {
  const source = Deno.readTextFileSync(
    new URL("../../admin-ad-campaign-action/index.ts", import.meta.url),
  );
  assert(source.includes('action !== "change_budget"'));
  assert(
    source.includes(
      'if (!adminRow && action === "change_budget")',
    ),
  );
  assert(source.includes("runBudgetChange("));
});
