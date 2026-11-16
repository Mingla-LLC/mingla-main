/**
 * #4238 W3 T-4 — the "your ad is getting tired" signal.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { creativeFatigueDue, type FatigueDay } from "../adCreativeFatigue.ts";

const LIVE = Date.parse("2026-11-01T09:00:00Z");
const day = (n: number) =>
  new Date(LIVE + (n - 1) * 86_400_000).toISOString().slice(0, 10);
const at = (n: number) => Date.parse(`${day(n)}T12:00:00Z`);

/** Baseline CTR on days 2–4, recent CTR on days 5–7 (seen on day 8). */
function days(
  baselineCtr: number,
  recentCtr: number,
  recentImpressions = 1200,
): FatigueDay[] {
  const out: FatigueDay[] = [];
  for (let n = 1; n <= 10; n++) {
    const impressions = n >= 5 ? recentImpressions : 1000;
    const rate = n >= 5 ? recentCtr : baselineCtr;
    out.push({
      metric_date: day(n),
      impressions,
      link_clicks: Math.round(impressions * rate),
    });
  }
  return out;
}

const base = {
  platform: "meta",
  stage: "prospecting" as const,
  liveSinceMs: LIVE,
  frequency7d: 3.2,
  lastFiredMs: null,
};

Deno.test("SC-T4: CTR 1.0% → 0.65% with frequency 3.2 fires on day 8", () => {
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(8), days: days(0.01, 0.0065) }),
    true,
  );
});

Deno.test("SC-T4: CTR 0.75% does not fire; day 6 does not fire", () => {
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(8), days: days(0.01, 0.0075) }),
    false,
  );
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(6), days: days(0.01, 0.005) }),
    false,
  );
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(7), days: days(0.01, 0.005) }),
    false,
  );
});

Deno.test("T-4: exactly 70% fires; frequency 2.9 does not; retarget needs 6", () => {
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(8), days: days(0.01, 0.007) }),
    true,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      frequency7d: 2.9,
      nowMs: at(8),
      days: days(0.01, 0.005),
    }),
    false,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      stage: "retarget",
      frequency7d: 5.9,
      nowMs: at(8),
      days: days(0.01, 0.005),
    }),
    false,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      stage: "retarget",
      frequency7d: 6,
      nowMs: at(8),
      days: days(0.01, 0.005),
    }),
    true,
  );
});

Deno.test("T-4: under 3,000 impressions in the last 3 days does not fire", () => {
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(8), days: days(0.01, 0.005, 999) }),
    false,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      nowMs: at(8),
      days: days(0.01, 0.005, 1000),
    }),
    true,
  );
});

Deno.test("T-4 adversarial: zero baseline impressions, a repeat inside 7 days, Google/Reddit", () => {
  const noBaseline = days(0.01, 0.005).map((row, index) =>
    index >= 1 && index <= 3 ? { ...row, impressions: 0, link_clicks: 0 } : row
  );
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(8), days: noBaseline }),
    false,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      nowMs: at(8),
      lastFiredMs: at(2),
      days: days(0.01, 0.005),
    }),
    false,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      nowMs: at(9),
      lastFiredMs: at(2),
      days: days(0.01, 0.005),
    }),
    true,
  );
  for (const platform of ["google", "reddit"]) {
    assertEquals(
      creativeFatigueDue({
        ...base,
        platform,
        nowMs: at(8),
        days: days(0.01, 0.005),
      }),
      false,
    );
  }
  assertEquals(
    creativeFatigueDue({
      ...base,
      liveSinceMs: null,
      nowMs: at(8),
      days: days(0.01, 0.005),
    }),
    false,
  );
});

import { evaluateCreativeFatigue } from "../adCreativeFatigue.ts";

function fatigueDb(rows: Record<string, Record<string, unknown>[]>) {
  const inserted: Record<string, unknown>[] = [];
  const from = (table: string) => {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    const chain: Record<string, unknown> = {};
    const run = () => ({
      data: (rows[table] ?? []).filter((row) => filters.every((f) => f(row))),
      error: null,
    });
    Object.assign(chain, {
      select: () => chain,
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return chain;
      },
      gte: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        (rows[table] ??= []).push({
          ...row,
          created_at: new Date(at(8)).toISOString(),
        });
        return Promise.resolve({ error: null });
      },
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    });
    return chain;
  };
  return { db: { from }, inserted };
}

Deno.test("T-4 sweep: records one creative_fatigue row, then not again inside 7 days", async () => {
  const metrics = days(0.01, 0.0065).map((row) => ({
    ...row,
    campaign_id: "camp-1",
    provider_ad_id: "ad-1",
    creative_id: "cre-1",
  }));
  const { db, inserted } = fatigueDb({
    ad_creative_metrics_daily: metrics,
    ad_stage_metrics_daily: [{
      campaign_id: "camp-1",
      stage: "prospecting",
      frequency: 3.2,
    }],
    ad_plan_automation_events: [],
  });
  const ctx = {
    planId: "plan-1",
    campaignId: "camp-1",
    platform: "meta",
    liveSinceMs: LIVE,
    nowMs: at(8),
  };
  assertEquals(await evaluateCreativeFatigue(db, ctx), "recorded:1");
  assertEquals(inserted[0].kind, "creative_fatigue");
  assertEquals(
    (inserted[0].detail as Record<string, unknown>).creative_id,
    "cre-1",
  );
  assertEquals(await evaluateCreativeFatigue(db, ctx), "none");
  assertEquals(inserted.length, 1);
  assertEquals(
    await evaluateCreativeFatigue(db, { ...ctx, platform: "google" }),
    "not_supported",
  );
});

Deno.test("T-4 data: Meta level-ad insights parse into per-ad daily rows; Host ad sets are the prospecting stage", async () => {
  const { parseMetaAdMetrics } = await import(
    "../adCreativeFatigue.ts"
  );
  assertEquals(
    parseMetaAdMetrics({
      data: [
        {
          ad_id: "a1",
          date_start: "2026-11-08",
          impressions: "1200",
          inline_link_clicks: "8",
          spend: "3.21",
        },
        { ad_id: "", date_start: "2026-11-08", impressions: "1" },
        { ad_id: "a2", date_start: "bad", impressions: "1" },
        { ad_id: "a3", date_start: "2026-11-09", impressions: "-4" },
      ],
    }),
    [
      {
        provider_ad_id: "a1",
        metric_date: "2026-11-08",
        impressions: 1200,
        link_clicks: 8,
        spend_cents: 321,
      },
      {
        provider_ad_id: "a3",
        metric_date: "2026-11-09",
        impressions: 0,
        link_clicks: 0,
        spend_cents: 0,
      },
    ],
  );
  assertEquals(parseMetaAdMetrics(null), []);
  const create = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assertEquals(
    create.split('stage: requestedOwnerKind === "host" ? "prospecting" : null,')
      .length - 1,
    3,
  );
  const sync = await Deno.readTextFile(
    new URL("../adCreativeFatigue.ts", import.meta.url),
  );
  assertEquals(sync.includes('level: "ad"'), true);
  assertEquals(
    sync.includes('from("ad_creative_metrics_daily").upsert('),
    true,
  );
});
