/**
 * #4238 W4c (sub-item 1): Snapchat and TikTok reach parity with Meta — the
 * retarget ad set built at create from the frozen split, one ad per extra
 * creative, live edits that pause / rebalance / resume without ever going
 * under the app floor, the accepted last-tickets offer applied through the
 * apps' review, and per-ad numbers for the tired-creative record.
 */
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { hostAdSetSplitAsBuilt, hostAdSetUnits } from "../adHostPlanRules.ts";
import { dailyTargets } from "../adHostLiveEdit.ts";
import {
  applyLastTicketsOfferByAds,
  type LastTicketsAdOps,
  lastTicketsReview,
} from "../adGoalPromotion.ts";
import {
  parseSnapchatAdMetrics,
  parseTikTokAdMetrics,
} from "../adCreativeFatigue.ts";
import { snapchatCampaignStatsPath } from "../snapchatSpendStats.ts";
import { snapchatCopyAdWithHeadline } from "../snapchat.ts";
import type { AdConnectionRow } from "../adChannelCore.ts";

const FLOORS = { snapchat: 500, tiktok: 2000 } as const;
const READY = { audienceReady: true, buyerExclusionReady: true };

const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

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
      update: (patch: Row) => {
        writes.push([`${table}.update`, patch]);
        const done = {
          eq: () => done,
          then: (r: (v: unknown) => void) => r({ error: null }),
        };
        return done;
      },
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: rows, error: null }),
    };
    return chain;
  };
  return { writes, db: { from: query } };
}

function stagePlan() {
  return {
    blocked: false,
    stages: [
      {
        stage: "prospecting",
        executable: true,
        includeAudienceIds: [] as string[],
        excludeAudienceIds: ["buyers"],
        audienceCodes: [] as string[],
        audienceSizes: {} as Record<string, number | null>,
      },
      {
        stage: "retarget",
        executable: true,
        includeAudienceIds: ["viewers"],
        excludeAudienceIds: ["buyers"],
        audienceCodes: ["S1"],
        audienceSizes: { S1: 5000 } as Record<string, number | null>,
      },
    ],
  };
}

Deno.test("as built: Snapchat and TikTok now promise the retarget ad set where create builds it", () => {
  for (const platform of ["snapchat", "tiktok"] as const) {
    const floor = FLOORS[platform];
    const split = hostAdSetSplitAsBuilt(platform, 10 * floor, floor, READY);
    assertEquals(split.ad_sets, 2, platform);
    assert(split.prospecting_cents >= floor && split.retarget_cents >= floor);
    // Below 2F it stays one ad set: the minimum is never raised.
    assertEquals(
      hostAdSetSplitAsBuilt(platform, 2 * floor - 1, floor, READY).ad_sets,
      1,
    );
  }
});

Deno.test("create units: Snap segments and TikTok audiences — warm in, buyers out", () => {
  const snap = hostAdSetUnits({
    platform: "snapchat",
    frozen: { ad_sets: 2 },
    dailySpendCents: 5000,
    floorCents: 500,
    budgetMode: "daily",
    stagePlan: stagePlan(),
    baseTargeting: { countries: ["US"], segment_exclude_ids: ["host-x"] },
  });
  assertEquals(snap.units.map((u) => [u.stage, u.budgetCents]), [
    ["prospecting", 4000],
    ["retarget", 1000],
  ]);
  assertEquals(snap.units[1].targeting.segment_include_ids, ["viewers"]);
  assertEquals(snap.units[1].targeting.segment_exclude_ids, [
    "host-x",
    "buyers",
  ]);
  const tiktok = hostAdSetUnits({
    platform: "tiktok",
    frozen: { ad_sets: 2 },
    dailySpendCents: 10_000,
    floorCents: 2000,
    budgetMode: "daily",
    stagePlan: stagePlan(),
    baseTargeting: { location_ids: ["1"] },
  });
  assertEquals(tiktok.units.map((u) => u.budgetCents), [8000, 2000]);
  assertEquals(tiktok.units[1].targeting.audience_ids, ["viewers"]);
  assertEquals(tiktok.units[1].targeting.excluded_audience_ids, ["buyers"]);
});

Deno.test("create wiring: the Host Snapchat and TikTok branches build from prepareHostAdSets with ABO budgets", async () => {
  const source = await read("../../admin-ad-create-campaign/index.ts");
  for (
    const [name, platform, conn] of [
      ["hostSnap", "snapchat", "sconn"],
      ["hostTikTok", "tiktok", "tconn"],
    ]
  ) {
    const start = source.indexOf(
      `${name} = await prepareHostAdSets(supabase, {`,
    );
    assert(start > 0, `${name} prepare missing`);
    const block = source.slice(start, start + 700);
    assert(block.includes(`platform: "${platform}"`));
    assert(block.includes(`connection: ${conn}`));
    assert(
      block.includes(`floorCents: hostAdSetFloorCents("${platform}", ${conn})`),
    );
    assert(
      source.includes(`} else if (${name}) {`),
      `${name} create branch missing`,
    );
  }
  // Each ad squad / ad group carries its own split budget; one ad per creative.
  assertEquals(source.split("budgetCents: unit.budgetCents,").length - 1, 2);
  assert(
    source.includes("ads: planS.creativeIds.map((creativeId, index) => {"),
  );
  assert(
    source.includes("ads: planT.creativeIds.map((creativeId, index) => {"),
  );
});

Deno.test("adversarial (live edit): Snap and TikTok Host edits F..6F never leave a running ad set below F", async () => {
  for (const platform of ["snapchat", "tiktok"] as const) {
    const floor = FLOORS[platform];
    for (let spend = floor; spend <= 6 * floor; spend += Math.ceil(floor / 7)) {
      for (const paused of [false, true]) {
        const { db } = fakeDb({
          ad_sets: [
            {
              id: "p",
              campaign_id: "c",
              external_adset_id: "xp",
              budget_cents: 4 * floor,
              stage: "prospecting",
            },
            {
              id: "r",
              campaign_id: "c",
              external_adset_id: "xr",
              budget_cents: floor,
              stage: "retarget",
            },
          ],
          ad_plan_automation_events: paused
            ? [{ campaign_id: "c", kind: "retarget_removed" }]
            : [],
        });
        const targets = await dailyTargets(db, {
          id: "c",
          owner_kind: "host",
          platform,
          external_campaign_id: "xc",
          daily_budget_cents: null,
        }, {
          campaign_id: "c",
          platform,
          new_provider_budget_cents: 100 * floor,
          new_provider_delivery_budget_cents: spend,
          daily_changed: true,
          floor_cents: floor,
        }, 5 * floor);
        const running = targets.filter((t) =>
          t.stage === "prospecting" ||
          (t.stage === "retarget" &&
            (paused ? t.status === "resume" : t.status !== "pause"))
        );
        for (const t of running) {
          assert(
            t.nextCents >= floor,
            `${platform} ${spend} ${t.stage} ${t.nextCents}`,
          );
        }
        const total = running.reduce((sum, t) => sum + t.nextCents, 0);
        assertEquals(total, spend, `${platform} ${spend} adds up`);
        if (spend < 2 * floor) {
          assertEquals(running.length, 1);
        }
      }
    }
  }
});

Deno.test("last tickets review vocabulary: Snap review_status, TikTok secondary status", () => {
  assertEquals(lastTicketsReview("snapchat", "APPROVED"), "ready");
  assertEquals(lastTicketsReview("snapchat", "PENDING"), "waiting");
  assertEquals(lastTicketsReview("snapchat", "REJECTED"), "refused");
  assertEquals(lastTicketsReview("tiktok", "AD_STATUS_DELIVERY_OK"), "ready");
  assertEquals(lastTicketsReview("tiktok", "AD_STATUS_AUDIT"), "waiting");
  assertEquals(lastTicketsReview("tiktok", "AD_STATUS_AUDIT_DENY"), "refused");
  assertEquals(lastTicketsReview("tiktok", null), "waiting");
});

function ops(statuses: Record<string, string>) {
  const calls: string[] = [];
  const value: LastTicketsAdOps = {
    copyAd: (set, ad, text) => {
      calls.push(`copy:${set}:${ad}:${text}`);
      return Promise.resolve(`new-${ad}`);
    },
    reviewStatus: (id) => Promise.resolve(statuses[id] ?? null),
    pauseAd: (id) => {
      calls.push(`pause:${id}`);
      return Promise.resolve();
    },
  };
  return { calls, value };
}

const TABLES = () => ({
  ad_sets: [{ id: "s1", campaign_id: "c", external_adset_id: "x1" }],
  ads: [
    { id: "a1", ad_set_id: "s1", external_ad_id: "ad1", status: "ACTIVE" },
    { id: "a2", ad_set_id: "s1", external_ad_id: "ad2", status: "PAUSED" },
  ],
});

Deno.test("last tickets (Snap/TikTok): step 1 copies every live ad with the words, nothing paused", async () => {
  for (const platform of ["snapchat", "tiktok"] as const) {
    const { db, writes } = fakeDb(TABLES());
    const o = ops({});
    const out = await applyLastTicketsOfferByAds(
      { db, platform, ops: o.value },
      {
        row: {
          id: "o",
          status: "pending",
          detail: { primary: "Last tickets!", accepted_at: "t" },
        } as never,
        campaignId: "c",
        nowIso: "2026-11-16T00:00:00Z",
      },
    );
    assertEquals(out, "created");
    assertEquals(o.calls, ["copy:x1:ad1:Last tickets!"]);
    const patch = writes.find(([name]) =>
      name === "ad_plan_automation_events.update"
    )?.[1] as Row;
    assertEquals((patch.detail as Row).new_ad_ids, ["new-ad1"]);
    assertEquals((patch.detail as Row).old_ad_ids, ["ad1"]);
  }
});

Deno.test("last tickets (Snap/TikTok): old ads pause only once every new ad is approved; a refusal keeps them", async () => {
  const row = (extra: Row) =>
    ({
      id: "o",
      status: "pending",
      detail: {
        primary: "Last tickets!",
        accepted_at: "t",
        new_ad_ids: ["n1"],
        old_ad_ids: ["ad1"],
        ...extra,
      },
    }) as never;
  const input = (r: never) => ({
    row: r,
    campaignId: "c",
    nowIso: "2026-11-16T00:00:00Z",
  });
  let o = ops({ n1: "PENDING" });
  assertEquals(
    await applyLastTicketsOfferByAds({
      db: fakeDb(TABLES()).db,
      platform: "snapchat",
      ops: o.value,
    }, input(row({}))),
    "waiting",
  );
  assertEquals(o.calls, []);
  o = ops({ n1: "APPROVED" });
  assertEquals(
    await applyLastTicketsOfferByAds({
      db: fakeDb(TABLES()).db,
      platform: "snapchat",
      ops: o.value,
    }, input(row({}))),
    "applied",
  );
  assertEquals(o.calls, ["pause:ad1"]);
  o = ops({ n1: "AD_STATUS_AUDIT_DENY" });
  const refused = fakeDb(TABLES());
  assertEquals(
    await applyLastTicketsOfferByAds({
      db: refused.db,
      platform: "tiktok",
      ops: o.value,
    }, input(row({}))),
    "failed:new_ad_refused",
  );
  assertEquals(o.calls, ["pause:n1"]);
});

Deno.test("last tickets (Snap): words longer than a Snap headline are refused before any provider call", async () => {
  await assertRejects(
    () =>
      snapchatCopyAdWithHeadline(
        { platform: "snapchat" } as unknown as AdConnectionRow,
        "sq",
        "ad",
        "Last few tickets left for Saturday night — grab yours now",
      ),
    Error,
    "34",
  );
});

Deno.test("sweep wiring: Snap and TikTok accepted offers run through the adapter copy hooks", async () => {
  const sweep = await read("../adGoalPromotion.ts");
  assert(
    sweep.includes(
      "report.last_tickets_apply = await applyLastTicketsOfferByAds(",
    ),
  );
  const sync = await read("../../admin-ad-spend-sync/index.ts");
  assert(
    sync.includes(
      "adOps: hostLastTicketsAdOps(input.target.platform, input.connection)",
    ),
  );
  assert(
    sync.includes(
      "snapchatCopyAdWithHeadline(connection, adSetId, adId, text)",
    ),
  );
  assert(
    sync.includes("tiktokCopyAdWithText(connection, adSetId, adId, text)"),
  );
  const accept = await read("../../host-ad-campaign/index.ts");
  assert(
    accept.includes(
      'platform === "meta" || platform === "snapchat" || platform === "tiktok"',
    ),
  );
});

Deno.test("per-ad numbers: TikTok AUCTION_AD report and Snap breakdown=ad parse into one row per ad per day", async () => {
  assertEquals(
    parseTikTokAdMetrics({
      list: [
        {
          dimensions: { ad_id: "17", stat_time_day: "2026-11-15 00:00:00" },
          metrics: { spend: "12.34", impressions: "900", clicks: "31" },
        },
        {
          dimensions: { ad_id: "", stat_time_day: "2026-11-15 00:00:00" },
          metrics: {},
        },
      ],
    }),
    [{
      provider_ad_id: "17",
      metric_date: "2026-11-15",
      impressions: 900,
      link_clicks: 31,
      spend_cents: 1234,
    }],
  );
  assertEquals(
    parseSnapchatAdMetrics({
      timeseries_stats: [{
        timeseries_stat: {
          breakdown_stats: {
            ad: [{
              id: "ad-a",
              timeseries: [{
                start_time: "2026-11-15T00:00:00.000-08:00",
                stats: { impressions: 400, swipes: 12, spend: 2_500_000 },
              }],
            }],
          },
        },
      }],
    }),
    [{
      provider_ad_id: "ad-a",
      metric_date: "2026-11-15",
      impressions: 400,
      link_clicks: 12,
      spend_cents: 250,
    }],
  );
  const path = snapchatCampaignStatsPath("c1", {
    start_time: "s",
    end_time: "e",
    timeZone: "UTC",
  } as never, "ad");
  assert(path.includes("breakdown=ad"));
  const sync = await read("../../admin-ad-spend-sync/index.ts");
  const fn = sync.slice(sync.indexOf("async function syncHostAdMetrics("));
  assert(fn.includes('data_level: "AUCTION_AD"'));
  assert(fn.includes('dimensions: ["ad_id", "stat_time_day"]'));
  assert(fn.includes('breakdown: "ad"'));
  assert(
    fn.includes(
      "creative_id: creativeByAd.get(row.provider_ad_id) ?? fallback",
    ),
  );
});
