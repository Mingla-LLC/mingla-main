/**
 * #4238 W4c (sub-item 3): a Host raise past 2F on a one-ad-set Snapchat or
 * TikTok plan adds the retarget ad set live — only past the thresholds,
 * never on Meta (CBO), every ad set >= F, and the apps never run above the
 * new daily total in between (new ad set paused → ads → prospecting lowered
 * → retarget on). A failure undoes what it pushed.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  addHostRetargetAdSetLive,
  hostRetargetLiveAddDecision,
} from "../hostRetargetLiveAdd.ts";
import type { AdConnectionRow, ChannelAdapter } from "../adChannelCore.ts";

const READY = { audienceReady: true, buyerExclusionReady: true };
const base = {
  platform: "snapchat",
  ownerKind: "host",
  originalDailyCents: 800,
  amendedDailyCents: 1500,
  floorCents: 500,
  hasRetargetAdSet: false,
  lifetime: false,
  readiness: READY,
};

Deno.test("decision: a raise from below 2F to at least 2F adds it; R = max(F, 20%), both >= F", () => {
  assertEquals(hostRetargetLiveAddDecision(base), {
    add: true,
    prospectingCents: 1000,
    retargetCents: 500,
  });
  const tiktok = hostRetargetLiveAddDecision({
    ...base,
    platform: "tiktok",
    originalDailyCents: 3000,
    amendedDailyCents: 20_000,
    floorCents: 2000,
  });
  assertEquals(tiktok, { add: true, prospectingCents: 16_000, retargetCents: 4000 });
});

Deno.test("adversarial decision: never below the thresholds, never on Meta, never twice, never without the audience", () => {
  const no = (over: Record<string, unknown>) =>
    hostRetargetLiveAddDecision({ ...base, ...over } as typeof base).add;
  assertEquals(no({ amendedDailyCents: 999 }), false); // still below 2F
  assertEquals(no({ originalDailyCents: 1000 }), false); // started at 2F: not a raise past it
  assertEquals(no({ amendedDailyCents: null }), false); // no raise at all
  assertEquals(no({ platform: "meta" }), false); // CBO one-ad-set Meta
  assertEquals(no({ platform: "reddit" }), false);
  assertEquals(no({ hasRetargetAdSet: true }), false);
  assertEquals(no({ lifetime: true }), false);
  assertEquals(no({ readiness: { audienceReady: false, buyerExclusionReady: true } }), false);
  assertEquals(no({ readiness: { audienceReady: true, buyerExclusionReady: false } }), false);
  assertEquals(no({ ownerKind: "mingla" }), false);
  assertEquals(no({ floorCents: null }), false);
  // Brute force: whenever it adds, both ad sets are >= F and add up.
  for (const floor of [500, 2000]) {
    for (let amended = floor; amended <= 8 * floor; amended += 37) {
      const d = hostRetargetLiveAddDecision({
        ...base,
        originalDailyCents: floor,
        amendedDailyCents: amended,
        floorCents: floor,
      });
      if (amended < 2 * floor) assertEquals(d.add, false);
      if (d.add) {
        assert(d.prospectingCents >= floor && d.retargetCents >= floor);
        assertEquals(d.prospectingCents + d.retargetCents, amended);
      }
    }
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
      single: () => Promise.resolve({ data: { id: "new-local" }, error: null }),
      insert: (item: unknown) => {
        writes.push([`${table}.insert`, item]);
        return { ...chain, then: (r: (v: unknown) => void) => r({ error: null }) };
      },
      update: (patch: Row) => {
        writes.push([`${table}.update`, patch]);
        return { eq: () => Promise.resolve({ error: null }) };
      },
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
    };
    return chain;
  };
  return { writes, db: { from: query } };
}

const TABLES = () => ({
  ad_sets: [{
    id: "p",
    campaign_id: "c",
    external_adset_id: "xp",
    name: "Gig — prospecting",
    targeting: { countries: ["US"], segment_exclude_ids: ["host-x"] },
    optimization_goal: "SWIPES",
    billing_event: "IMPRESSION",
    budget_cents: 1500,
    stage: "prospecting",
  }],
  ads: [
    { ad_set_id: "p", external_ad_id: "a1", external_creative_id: "cr1", creative_id: "lib1", status: "ACTIVE" },
    { ad_set_id: "p", external_ad_id: "a2", external_creative_id: "cr2", creative_id: "lib2", status: "PAUSED" },
  ],
});

function adapter(calls: string[], opts: { failCopy?: boolean; readback?: number } = {}) {
  let reads = 0;
  return {
    platform: "snapchat",
    createAdSet: (_c: unknown, campaign: string, input: Row) => {
      calls.push(`createAdSet:${campaign}:${input.budgetCents}:${JSON.stringify((input.targeting as Row).segment_include_ids)}`);
      return Promise.resolve({ externalId: "xr" });
    },
    setBudget: (_c: unknown, _l: string, id: string, cents: number) => {
      calls.push(`budget:${id}:${cents}`);
      return Promise.resolve();
    },
    getBudget: () => {
      reads += 1;
      // First read: what the app holds now; second: the readback.
      return Promise.resolve({ cents: reads === 1 ? 1500 : opts.readback ?? 1000, field: "daily_budget_micro" });
    },
    setStatus: (_c: unknown, _l: string, id: string, status: string) => {
      calls.push(`status:${id}:${status}`);
      return Promise.resolve();
    },
  } as unknown as ChannelAdapter;
}

const INPUT = {
  campaignId: "c",
  externalCampaignId: "xc",
  platform: "snapchat" as const,
  planId: "plan",
  decision: { prospectingCents: 1000, retargetCents: 500 },
  include: ["viewers"],
  exclude: ["buyers"],
  audienceCodes: ["S1"],
  audienceSizes: { S1: 4000 },
};

Deno.test("live add: paused retarget first, ads copied, prospecting lowered and read back, then retarget on", async () => {
  const calls: string[] = [];
  const { db, writes } = fakeDb(TABLES());
  const out = await addHostRetargetAdSetLive({
    db,
    adapter: adapter(calls),
    connection: {} as AdConnectionRow,
    copyAdInto: (set, ad) => {
      calls.push(`copy:${set}:${ad.externalAdId}`);
      return Promise.resolve(`n-${ad.externalAdId}`);
    },
  }, INPUT);
  assertEquals(out, "added:1");
  assertEquals(calls, [
    'createAdSet:xc:500:["viewers"]',
    "copy:xr:a1",
    "budget:xp:1000",
    "status:xr:ACTIVE",
  ]);
  const event = writes.find(([n]) => n === "ad_plan_automation_events.insert")?.[1] as Row;
  assertEquals([event.kind, event.status], ["retarget_added", "applied"]);
});

Deno.test("live add adversarial: a copy failure pauses the new ad set and never lowers prospecting", async () => {
  const calls: string[] = [];
  const { db, writes } = fakeDb(TABLES());
  const out = await addHostRetargetAdSetLive({
    db,
    adapter: adapter(calls),
    connection: {} as AdConnectionRow,
    copyAdInto: () => Promise.reject(new Error("snap down")),
  }, INPUT);
  assert(out.startsWith("failed:"));
  assertEquals(calls, ['createAdSet:xc:500:["viewers"]', "status:xr:PAUSED"]);
  const event = writes.find(([n]) => n === "ad_plan_automation_events.insert")?.[1] as Row;
  assertEquals([event.kind, event.status], ["retarget_added", "failed"]);
});

Deno.test("live add adversarial: a readback mismatch puts prospecting back and pauses the new ad set", async () => {
  const calls: string[] = [];
  const { db } = fakeDb(TABLES());
  const out = await addHostRetargetAdSetLive({
    db,
    adapter: adapter(calls, { readback: 900 }),
    connection: {} as AdConnectionRow,
    copyAdInto: (_set, ad) => Promise.resolve(`n-${ad.externalAdId}`),
  }, INPUT);
  assert(out.startsWith("failed:provider_budget_readback_mismatch"));
  assertEquals(calls.slice(-2), ["status:xr:PAUSED", "budget:xp:1500"]);
  assert(!calls.includes("status:xr:ACTIVE"));
});

Deno.test("sweep wiring: only a raise (original < 2F <= amended), once, retried no sooner than a day", async () => {
  const src = await Deno.readTextFile(new URL("../../admin-ad-spend-sync/index.ts", import.meta.url));
  const fn = src.slice(src.indexOf("async function maybeAddHostRetargetLive("));
  assert(fn.includes("!(original < 2 * floor) ||\n    amended < 2 * floor"));
  assert(fn.includes('tries.some((row) => row.status === "applied")'));
  assert(fn.includes("< 86_400_000"));
  assert(src.includes("const retarget = await maybeAddHostRetargetLive(supabase, input);"));
});
