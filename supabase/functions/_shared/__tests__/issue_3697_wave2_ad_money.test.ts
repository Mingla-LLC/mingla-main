/**
 * toward #3697 Wave 2 — D1 minimums + 98% hard-cap helpers (#3709 / #3701).
 */
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY,
  calendarDaysBetween,
  capPauseThresholdCents,
  computeAdMinimum,
  computeCapCents,
  googleTotalDaysOk,
  shouldPauseForCap,
} from "../adMoney.ts";
import {
  decideSpendSync,
  metaSpendDollarsToCents,
  parseGoogleAdsSpend,
  parseMetaInsightsSpend,
  parseRedditReportSpend,
  parseSnapchatStatsSpend,
  parseTikTokReportSpend,
  startDateNotReached,
} from "../adSpendSync.ts";

Deno.test("D1: Meta+TikTok+Snapchat for 7 days = $525 ad budget (Seth example)", () => {
  const result = computeAdMinimum({
    platforms: ["meta", "tiktok", "snapchat"],
    days: 7,
    mode: "lifetime",
    ownerKind: "mingla",
    metaFloorCents: 500, // $5/day LINK_CLICKS
  });
  // Meta $5×7 + TikTok $50×7 + Snap $20×7 = 35 + 350 + 140 = 525
  assertEquals(result.min_budget_cents, 52500);
  assertEquals(result.min_pay_cents, 52500);
});

Deno.test("D1: host pay adds 15% fee (ceil)", () => {
  const result = computeAdMinimum({
    platforms: ["reddit"],
    days: 1,
    mode: "daily",
    ownerKind: "host",
  });
  assertEquals(result.min_budget_cents, 500);
  assertEquals(result.min_pay_cents, Math.ceil(500 / 0.85));
});

Deno.test("D1 table matches contract floors", () => {
  assertEquals(AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY.tiktok, 5000);
  assertEquals(AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY.snapchat, 2000);
  assertEquals(AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY.reddit, 500);
  assertEquals(AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY.google, 0);
});

Deno.test("Google total budget needs ≥3 days", () => {
  assertEquals(googleTotalDaysOk("lifetime", 2), false);
  assertEquals(googleTotalDaysOk("lifetime", 3), true);
  assertEquals(googleTotalDaysOk("daily", 1), true);
});

Deno.test("calendar days inclusive", () => {
  assertEquals(
    calendarDaysBetween("2026-10-01T00:00:00Z", "2026-10-07T23:00:00Z"),
    7,
  );
});

Deno.test("hard cap: lifetime amount; daily × days; 98% pause", () => {
  assertEquals(
    computeCapCents({ mode: "lifetime", amountCents: 10000, days: 7 }),
    10000,
  );
  assertEquals(
    computeCapCents({ mode: "daily", amountCents: 1000, days: 7 }),
    7000,
  );
  assertEquals(capPauseThresholdCents(10000), 9800);
  assertEquals(shouldPauseForCap(9799, 10000), false);
  assertEquals(shouldPauseForCap(9800, 10000), true);
});

Deno.test("spend sync: upserts + pause at 98%", () => {
  const decision = decideSpendSync({
    campaign: {
      id: "c1",
      platform: "meta",
      external_campaign_id: "ext",
      status: "ACTIVE",
      cap_cents: 10000,
      ends_at: null,
      provider_currency: "USD",
    },
    days: [
      { spend_date: "2026-10-01", spend_cents: 5000 },
      { spend_date: "2026-10-02", spend_cents: 4800 },
    ],
  });
  assertEquals(decision.total_spend_cents, 9800);
  assertEquals(decision.pause, "cap_98_percent");
  assertEquals(decision.upserts.length, 2);
});

Deno.test("spend sync: cumulative spend (not sliding window) drives cap pause", () => {
  const decision = decideSpendSync({
    campaign: {
      id: "c1",
      platform: "meta",
      external_campaign_id: "ext",
      status: "ACTIVE",
      cap_cents: 10000,
      ends_at: null,
      provider_currency: "USD",
    },
    days: [{ spend_date: "2026-10-31", spend_cents: 100 }],
    cumulativeSpendCents: 9800,
  });
  assertEquals(decision.total_spend_cents, 9800);
  assertEquals(decision.pause, "cap_98_percent");
  assertEquals(decision.upserts.length, 1);
});

Deno.test("launch guard: startDateNotReached", () => {
  assertEquals(
    startDateNotReached("2026-10-10T00:00:00Z", "2026-10-09T23:00:00Z"),
    true,
  );
  assertEquals(
    startDateNotReached("2026-10-10T00:00:00Z", "2026-10-10T00:00:00Z"),
    false,
  );
  assertEquals(startDateNotReached(null, "2026-10-10T00:00:00Z"), false);
});

Deno.test("spend sync: end date pause when under cap", () => {
  const decision = decideSpendSync({
    campaign: {
      id: "c1",
      platform: "meta",
      external_campaign_id: "ext",
      status: "ACTIVE",
      cap_cents: 100000,
      ends_at: "2026-10-01T00:00:00Z",
      provider_currency: "USD",
    },
    days: [{ spend_date: "2026-09-30", spend_cents: 100 }],
    nowIso: "2026-10-02T00:00:00Z",
  });
  assertEquals(decision.pause, "end_date_passed");
});

Deno.test("spend sync: provider currency is mandatory and cannot be widened", () => {
  const campaign = {
    id: "c1",
    platform: "meta" as const,
    external_campaign_id: "ext",
    status: "ACTIVE",
    cap_cents: 10000,
    ends_at: null,
    provider_currency: null,
  };
  assertThrows(
    () => decideSpendSync({ campaign, days: [] }),
    Error,
    "provider_currency_unresolved",
  );
  assertThrows(
    () =>
      decideSpendSync({
        campaign: { ...campaign, provider_currency: "USD" },
        days: [{ spend_date: "2026-10-01", spend_cents: 100, currency: "NGN" }],
      }),
    Error,
    "provider_currency_mismatch",
  );
});

Deno.test("Meta insights spend dollars → cents", () => {
  assertEquals(metaSpendDollarsToCents("12.34"), 1234);
  const rows = parseMetaInsightsSpend({
    data: [
      {
        date_start: "2026-10-01",
        spend: "1.50",
        impressions: "10",
        clicks: "2",
      },
    ],
  });
  assertEquals(rows[0].spend_cents, 150);
  assertEquals(rows[0].impressions, 10);
});

Deno.test("all five spend feeds normalize daily cost to cents", () => {
  assertEquals(
    parseTikTokReportSpend({
      data: {
        list: [{
          dimensions: { stat_time_day: "2026-10-01" },
          metrics: { spend: "12.34", impressions: "8", clicks: "2" },
        }],
      },
    })[0],
    {
      spend_date: "2026-10-01",
      spend_cents: 1234,
      impressions: 8,
      clicks: 2,
    },
  );
  assertEquals(
    parseSnapchatStatsSpend({
      timeseries_stats: [{
        timeseries_stat: {
          timeseries: [{
            start_time: "2026-10-01T00:00:00Z",
            stats: { spend: 12_340_000, impressions: 9, swipes: 3 },
          }],
        },
      }],
    })[0],
    {
      spend_date: "2026-10-01",
      spend_cents: 1234,
      impressions: 9,
      clicks: 3,
    },
  );
  assertEquals(
    parseGoogleAdsSpend({
      results: [{
        segments: { date: "2026-10-01" },
        metrics: { costMicros: "12340000", impressions: "10", clicks: "4" },
      }],
    })[0],
    {
      spend_date: "2026-10-01",
      spend_cents: 1234,
      impressions: 10,
      clicks: 4,
    },
  );
  assertEquals(
    parseRedditReportSpend({
      data: [{
        breakdowns: { DATE: "2026-10-01" },
        metrics: { SPEND: 12_340_000, IMPRESSIONS: 11, CLICKS: 5 },
      }],
    })[0],
    {
      spend_date: "2026-10-01",
      spend_cents: 1234,
      impressions: 11,
      clicks: 5,
    },
  );
});

Deno.test("Meta CBO lifetime uses lifetime_budget not daily_budget", async () => {
  const { buildMetaCampaignBody, buildMetaAdSetBody } = await import(
    "../meta.ts"
  );
  const campaign = buildMetaCampaignBody({
    name: "c",
    objective: "OUTCOME_TRAFFIC",
    lifetimeBudgetCents: 21000,
  });
  assertEquals(campaign.lifetime_budget, 21000);
  assertEquals(campaign.daily_budget, undefined);
  const adSet = buildMetaAdSetBody("ext", {
    name: "s",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
    targeting: { geo_locations: { countries: ["US"] } },
    endTime: "2026-10-07T23:00:00+0000",
  });
  assertEquals(adSet.end_time, "2026-10-07T23:00:00+0000");
});
// #3697 v1.4: spend assertions now use provider_currency because Host and
// provider minor units must never share an implicit currency authority.
