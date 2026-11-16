/**
 * #4238 W4a T-2 + 6b: the retarget ad set is built at create from the frozen
 * split, folds back to one ad set when anything changed, and live budget
 * edits pause, rebalance or resume it without ever giving a running ad set
 * less than its floor. The Host minimum stays the one-ad-set price.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  hostAdSetSplit,
  hostAdSetUnits,
  hostLiveAdSetBudgets,
} from "../adHostPlanRules.ts";
import { dailyTargets, runHostLiveEdit } from "../adHostLiveEdit.ts";

const FLOORS: Record<string, number> = {
  meta: 100,
  snapchat: 500,
  tiktok: 2000,
};

type Sizes = Record<string, number | null>;
function stagePlan(opts: { warm?: boolean; buyers?: boolean } = {}) {
  const warm = opts.warm !== false;
  const buyers = opts.buyers !== false;
  return {
    blocked: !buyers,
    stages: [
      {
        stage: "prospecting",
        executable: buyers,
        includeAudienceIds: [],
        excludeAudienceIds: buyers ? ["buyers"] : [],
        audienceCodes: [],
        audienceSizes: {} as Sizes,
      },
      {
        stage: "retarget",
        executable: buyers && warm,
        includeAudienceIds: warm ? ["viewers"] : [],
        excludeAudienceIds: buyers ? ["buyers", "starters"] : [],
        audienceCodes: warm ? ["M1"] : [],
        audienceSizes: (warm ? { M1: 4000 } : {}) as Sizes,
      },
      {
        stage: "abandoners",
        executable: buyers && warm,
        includeAudienceIds: warm ? ["starters"] : [],
        excludeAudienceIds: buyers ? ["buyers"] : [],
        audienceCodes: warm ? ["M5"] : [],
        audienceSizes: (warm ? { M5: 1200 } : {}) as Sizes,
      },
    ],
  };
}

const BASE = {
  geo_locations: { countries: ["US"] },
  excluded_custom_audiences: [{ id: "host-excluded" }],
  targeting_automation: { advantage_audience: 1 },
};

Deno.test("create: a frozen one-ad-set plan builds exactly one prospecting ad set", () => {
  const built = hostAdSetUnits({
    platform: "meta",
    frozen: { ad_sets: 1 },
    dailySpendCents: 1000,
    floorCents: 100,
    budgetMode: "daily",
    stagePlan: stagePlan(),
    baseTargeting: BASE,
  });
  assertEquals(built.units.map((u) => [u.stage, u.budgetCents]), [[
    "prospecting",
    1000,
  ]]);
  assertEquals(built.units[0].targeting, BASE);
});

Deno.test("create: two ad sets at 1,000 → 800 prospecting / 200 retarget, warm in, buyers out", () => {
  const built = hostAdSetUnits({
    platform: "meta",
    frozen: { ad_sets: 2 },
    dailySpendCents: 1000,
    floorCents: 100,
    budgetMode: "daily",
    stagePlan: stagePlan(),
    baseTargeting: BASE,
  });
  assertEquals(built.folded, null);
  assertEquals(built.units.map((u) => [u.stage, u.budgetCents]), [
    ["prospecting", 800],
    ["retarget", 200],
  ]);
  const retarget = built.units[1].targeting;
  assertEquals(retarget.custom_audiences, [{ id: "viewers" }, {
    id: "starters",
  }]);
  assertEquals(retarget.excluded_custom_audiences, [{ id: "host-excluded" }, {
    id: "buyers",
  }]);
  assertEquals(retarget.targeting_automation, { advantage_audience: 0 });
  assertEquals(retarget.geo_locations, BASE.geo_locations);
});

Deno.test("create: folds back to one when the audience shrank, buyers vanished, or the run is lifetime", () => {
  for (
    const [plan, mode, reason] of [
      [stagePlan({ warm: false }), "daily", "retarget_audience_not_ready"],
      [stagePlan({ buyers: false }), "daily", "retarget_audience_not_ready"],
      [null, "daily", "retarget_audience_not_ready"],
      [stagePlan(), "lifetime", "retarget_needs_daily_budget"],
    ] as const
  ) {
    const built = hostAdSetUnits({
      platform: "snapchat",
      frozen: { ad_sets: 2 },
      dailySpendCents: 2000,
      floorCents: 500,
      budgetMode: mode,
      stagePlan: plan,
      baseTargeting: { countries: ["US"] },
    });
    assertEquals(built.units.length, 1, reason);
    assertEquals(built.units[0].budgetCents, 2000);
    assertEquals(built.folded, reason);
  }
});

Deno.test("brute force (create): every spend from F to 6F gives every ad set ≥ F and adds up", () => {
  for (const [platform, floor] of Object.entries(FLOORS)) {
    for (let spend = floor; spend <= 6 * floor; spend += 1) {
      const built = hostAdSetUnits({
        platform,
        frozen: { ad_sets: 2 },
        dailySpendCents: spend,
        floorCents: floor,
        budgetMode: "daily",
        stagePlan: stagePlan(),
        baseTargeting: { countries: ["US"] },
      });
      assertEquals(
        built.units.reduce((sum, u) => sum + u.budgetCents, 0),
        spend,
      );
      for (const unit of built.units) {
        assert(unit.budgetCents >= floor, `${platform}:${spend}`);
      }
      assertEquals(
        built.units.length,
        spend >= 2 * floor ? 2 : 1,
        `${platform}:${spend}`,
      );
    }
  }
});

Deno.test("brute force (live edit): no edit ever leaves a running ad set below F; below 2F the retarget pauses", () => {
  for (const [platform, floor] of Object.entries(FLOORS)) {
    for (const paused of [false, true]) {
      for (let spend = floor; spend <= 6 * floor; spend += 1) {
        const next = hostLiveAdSetBudgets({
          platform,
          dailySpendCents: spend,
          floorCents: floor,
          adSets: [
            { id: "p", stage: "prospecting", paused: false },
            { id: "r", stage: "retarget", paused },
          ],
        });
        const running = next.filter((row) =>
          row.stage === "prospecting" ||
          (row.status === "resume" || (row.status === null && !paused))
        );
        assertEquals(running.reduce((sum, row) => sum + row.cents, 0), spend);
        for (const row of running) {
          assert(row.cents >= floor, `${platform}:${spend}`);
        }
        const retarget = next.find((row) => row.stage === "retarget")!;
        if (spend < 2 * floor) {
          assertEquals(retarget.status, paused ? null : "pause");
        } else {
          assertEquals(retarget.status, paused ? "resume" : null);
        }
      }
    }
  }
});

Deno.test("the Host minimum is still the one-ad-set price (retarget never raises it)", () => {
  // At exactly F the split is one ad set at F: nothing is added on top.
  for (const [platform, floor] of Object.entries(FLOORS)) {
    const split = hostAdSetSplit(platform, floor, floor, {
      audienceReady: true,
      buyerExclusionReady: true,
    });
    assertEquals([split.ad_sets, split.prospecting_cents], [1, floor]);
  }
});

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const writes: Array<[string, unknown]> = [];
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (key: string, value: unknown) => {
        rows = rows.filter((row) => row[key] === value);
        return chain;
      },
      in: (key: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[key]));
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () =>
        Promise.resolve({ data: rows[0] ?? null, error: null }),
      insert: (items: Row[]) => {
        writes.push([`${table}.insert`, items]);
        return Promise.resolve({ error: null });
      },
      update: (patch: Row) => {
        writes.push([`${table}.update`, patch]);
        return { eq: () => Promise.resolve({ error: null }) };
      },
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: rows, error: null }),
    };
    return chain;
  };
  return {
    writes,
    db: {
      from: query,
      rpc: () => Promise.resolve({ data: { id: "edit" }, error: null }),
    },
  };
}

const AD_SETS = [
  {
    id: "l-p",
    campaign_id: "c1",
    external_adset_id: "x-p",
    budget_cents: 800,
    stage: "prospecting",
    status: "ACTIVE",
  },
  {
    id: "l-r",
    campaign_id: "c1",
    external_adset_id: "x-r",
    budget_cents: 200,
    stage: "retarget",
    status: "ACTIVE",
  },
];
const CAMPAIGN = {
  id: "c1",
  owner_kind: "host",
  platform: "meta",
  external_campaign_id: "mc",
  connection_id: "k",
  daily_budget_cents: null,
  provider_delivery_budget_cents: 1000,
  provider_budget_cents: 10_000,
};

Deno.test("live edit: Meta ABO cut below 2F pauses retarget and gives prospecting the whole day", async () => {
  const { db } = fakeDb({ ad_sets: AD_SETS, ad_plan_automation_events: [] });
  const targets = await dailyTargets(db, CAMPAIGN, {
    campaign_id: "c1",
    platform: "meta",
    new_provider_budget_cents: 5000,
    new_provider_delivery_budget_cents: 150,
    daily_changed: true,
    floor_cents: 100,
  }, 1000);
  assertEquals(
    targets.map((t) => [t.level, t.externalId, t.nextCents, t.status ?? null]),
    [
      ["ad_set", "x-p", 150, null],
      ["ad_set", "x-r", 200, "pause"],
    ],
  );
});

Deno.test("live edit: an Admin (mingla) campaign keeps the proportional ad-set split", async () => {
  const { db } = fakeDb({ ad_sets: AD_SETS, ad_plan_automation_events: [] });
  const targets = await dailyTargets(
    db,
    { ...CAMPAIGN, owner_kind: "mingla" },
    {
      campaign_id: "c1",
      platform: "meta",
      new_provider_budget_cents: 5000,
      new_provider_delivery_budget_cents: 150,
      daily_changed: true,
      floor_cents: 100,
    },
    1000,
  );
  assertEquals(targets.map((t) => [t.nextCents, t.status ?? null]), [[
    120,
    null,
  ], [30, null]]);
});

Deno.test("live edit: the pause happens before prospecting is raised, and retarget_removed is recorded", async () => {
  const { db, writes } = fakeDb({
    ad_sets: AD_SETS,
    ad_plan_automation_events: [],
    ad_connections: [{ id: "k", connected: true, status: "connected" }],
  });
  const calls: string[] = [];
  const budgets = new Map<string, number>([["x-p", 800], ["x-r", 200]]);
  const adapter = {
    setStatus: (_c: unknown, _l: string, id: string, status: string) => {
      calls.push(`status:${id}:${status}`);
      return Promise.resolve();
    },
    setBudget: (_c: unknown, _l: string, id: string, cents: number) => {
      calls.push(`budget:${id}:${cents}`);
      budgets.set(id, cents);
      return Promise.resolve();
    },
    getBudget: (_c: unknown, _l: string, id: string) =>
      Promise.resolve({ cents: budgets.get(id) ?? 0, field: "daily_budget" }),
  };
  const result = await runHostLiveEdit({
    db,
    // deno-lint-ignore no-explicit-any
    getAdapter: () => adapter as any,
  }, {
    plan: {
      ok: true,
      newHostBudgetCents: 5000,
      newEndsAt: null,
      dailyNotPushed: [],
      lines: [{
        campaign_id: "c1",
        platform: "meta",
        new_provider_budget_cents: 5000,
        new_provider_delivery_budget_cents: 150,
        daily_changed: true,
        floor_cents: 100,
      }],
    },
    planId: "plan-1",
    versionId: "v",
    planHash: "h".repeat(64),
    campaigns: [CAMPAIGN],
    actorId: "a",
    idempotencyKey: "host_live_plan-1_k",
    previousEndsAt: null,
  });
  assertEquals(result.status, 200);
  assertEquals(calls, ["status:x-r:PAUSED", "budget:x-p:150"]);
  const events = writes.find(([name]) =>
    name === "ad_plan_automation_events.insert"
  )?.[1] as Row[];
  assertEquals(events.map((row) => [row.plan_id, row.kind, row.platform]), [[
    "plan-1",
    "retarget_removed",
    "meta",
  ]]);
});

Deno.test("create wiring: the Host Meta branch builds from prepareHostAdSets, ABO only with two ad sets", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assert(source.includes("hostMeta = await prepareHostAdSets(supabase, {"));
  assert(
    source.includes("const hostMetaAbo = (hostMeta?.units.length ?? 0) > 1;"),
  );
  assert(
    source.includes(
      "...(hostMetaAbo ? { budgetCents: unit.budgetCents } : {}),",
    ),
  );
  assert(source.includes("ads: plan.creativeIds.map((creativeId, index) => {"));
});
