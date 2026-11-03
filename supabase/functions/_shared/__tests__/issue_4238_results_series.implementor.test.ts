// Issue #4238 wave 2 — the Host results-over-time series (host-ad-campaign
// get `daily`, list `summary`). Missing data stays null, never 0; the last
// cumulative host-currency point equals host_spend_equivalent_cents.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildHostDailySeries,
  buildHostListSummary,
  type DailySeriesRow,
} from "../hostAdCampaignList.ts";

const row = (day: string, platform: string, spend: number | null, extra: Partial<DailySeriesRow> = {}): DailySeriesRow => ({
  day,
  campaign_id: platform,
  platform,
  spend_cents: spend,
  currency: spend === null ? null : "USD",
  impressions: spend === null ? null : 1000,
  clicks: spend === null ? null : 20,
  page_visits: 5,
  results: 0,
  ...extra,
});

// Frozen FX: 1 USD cent = 15.5 kobo, rounded on the cumulative total.
const fx = (amount: number) => Math.round(amount * 15.5);

Deno.test("#4238 cumulative conversion: the last point equals the converted total", async () => {
  const rows = [
    row("2026-11-01", "meta", 333),
    row("2026-11-01", "snapchat", 101),
    row("2026-11-02", "meta", 333),
    row("2026-11-03", "meta", 334),
    row("2026-11-03", "snapchat", 99),
  ];
  const { daily, by_platform_spend } = await buildHostDailySeries({
    rows,
    hostCurrency: "NGN",
    convert: ({ amount }) => Promise.resolve(fx(amount)),
  });
  const total = daily.reduce((sum, point) => sum + (point.spend_host_cents ?? 0), 0);
  // host_spend_equivalent_cents converts each platform's total once.
  assertEquals(total, fx(1000) + fx(200));
  assertEquals(daily.map((d) => d.spend_provider_cents), [434, 333, 433]);
  assertEquals(by_platform_spend.map((p) => [p.platform, p.spend_provider_cents]), [["meta", 1000], ["snapchat", 200]]);
});

Deno.test("#4238 a failed conversion nulls host spend on every day (USD fallback)", async () => {
  const { daily } = await buildHostDailySeries({
    rows: [row("2026-11-01", "meta", 100), row("2026-11-02", "meta", 100)],
    hostCurrency: "NGN",
    convert: () => Promise.resolve(null),
  });
  assert(daily.every((d) => d.spend_host_cents === null));
  assertEquals(daily.map((d) => d.spend_provider_cents), [100, 100]);
  assertEquals(daily[0].provider_currency, "USD");
});

Deno.test("#4238 a day with visits but no spend row keeps spend null, not 0", async () => {
  const { daily } = await buildHostDailySeries({
    rows: [row("2026-11-01", "meta", null)],
    hostCurrency: "USD",
    convert: ({ amount }) => Promise.resolve(amount),
  });
  assertEquals(daily[0].spend_host_cents, null);
  assertEquals(daily[0].spend_provider_cents, null);
  assertEquals(daily[0].impressions, null);
  assertEquals(daily[0].page_visits, 5);
});

type ListedCampaigns = Parameters<typeof buildHostListSummary>[0]["campaigns"];
const summaryOf = (over: Partial<Parameters<typeof buildHostListSummary>[0]>) =>
  buildHostListSummary({
    campaigns: [] as unknown as ListedCampaigns,
    rawCampaigns: [],
    spend: [],
    conversions: [],
    allocations: [],
    nowIso: "2026-11-02T12:00:00Z",
    timeZone: "UTC",
    convert: () => Promise.resolve(null),
    ...over,
  });

Deno.test("#4238 list summary: month spend, budgets, results and a 30-day sparkline", async () => {
  const campaigns = [{
    currency: "USD",
    lifecycle: "live",
    campaign_ids: ["c1"],
    cap_cents: 10_000,
    primary_result_count: 3,
  }] as unknown as ListedCampaigns;
  const summary = (await summaryOf({
    campaigns,
    rawCampaigns: [{ id: "c1", platform: "meta", plan_version_id: "v1" }],
    spend: [
      { campaign_id: "c1", spend_date: "2026-11-01", spend_cents: 400, currency: "USD" },
      { campaign_id: "c1", spend_date: "2026-10-20", spend_cents: 100, currency: "USD" },
    ],
    conversions: [
      { campaign_id: "c1", created_at: "2026-11-01T09:00:00Z" },
      { campaign_id: "c1", created_at: "2026-11-02T09:00:00Z" },
      { campaign_id: "c1", created_at: "2026-10-30T09:00:00Z" },
    ],
  }))!;
  assertEquals(summary.spent_cents, 400, "this month only");
  assertEquals(summary.budget_cents, 10_000);
  assertEquals(summary.results, 2, "only this calendar month's results");
  assertEquals(summary.daily_spend.length, 30);
  assertEquals(summary.daily_spend.at(-2), { day: "2026-11-01", cents: 400 });
  assertEquals(await summaryOf({}), null);
});

// #4238 P1-3: Meta bills in USD; the brand's card reads NGN at the plan's
// frozen rate, exactly like the detail page (cumulative conversion).
Deno.test("#4238 list summary converts provider spend at each plan's frozen rate", async () => {
  const campaigns = [{ currency: "NGN", lifecycle: "live", campaign_ids: ["c1", "c2"], cap_cents: 5_000_000 }] as unknown as ListedCampaigns;
  const calls: string[] = [];
  const summary = (await summaryOf({
    campaigns,
    rawCampaigns: [
      { id: "c1", platform: "meta", plan_version_id: "v1" },
      { id: "c2", platform: "snapchat", plan_version_id: "v1" },
    ],
    spend: [
      { campaign_id: "c1", spend_date: "2026-10-31", spend_cents: 100, currency: "USD" },
      { campaign_id: "c1", spend_date: "2026-11-01", spend_cents: 333, currency: "USD" },
      { campaign_id: "c2", spend_date: "2026-11-02", spend_cents: 1_000, currency: "NGN" },
    ],
    allocations: [
      { plan_version_id: "v1", platform: "meta", host_currency: "NGN", provider_currency: "USD", fx_snapshot_id: "fx-meta" },
      { plan_version_id: "v1", platform: "snapchat", host_currency: "NGN", provider_currency: "NGN", fx_snapshot_id: null },
    ],
    convert: ({ amount, source, target, snapshotId }) => {
      calls.push(`${amount}:${source}->${target}@${snapshotId}`);
      return Promise.resolve(Math.round(amount * 1550.5));
    },
  }))!;
  // Meta: convert(433) - convert(100); Snapchat already NGN.
  assertEquals(summary.spent_cents, Math.round(433 * 1550.5) - Math.round(100 * 1550.5) + 1_000);
  assertEquals(summary.currency, "NGN");
  assertEquals(calls.sort(), ["100:USD->NGN@fx-meta", "433:USD->NGN@fx-meta"]);
  assertEquals(summary.daily_spend.at(-1), { day: "2026-11-02", cents: 1_000 });
  assertEquals(summary.daily_spend.at(-2)?.cents, Math.round(333 * (Math.round(433 * 1550.5) / 433)));
});

Deno.test("#4238 list summary hides spend when any campaign can't be converted", async () => {
  const campaigns = [{ currency: "NGN", lifecycle: "live", campaign_ids: ["c1", "c2"], cap_cents: 1 }] as unknown as ListedCampaigns;
  const base = {
    campaigns,
    rawCampaigns: [
      { id: "c1", platform: "meta", plan_version_id: "v1" },
      { id: "c2", platform: "snapchat", plan_version_id: "v1" },
    ],
    spend: [
      { campaign_id: "c1", spend_date: "2026-11-01", spend_cents: 400, currency: "USD" },
      { campaign_id: "c2", spend_date: "2026-11-01", spend_cents: 900, currency: "NGN" },
    ],
  };
  // No allocation (no frozen rate) for Meta: hidden, not "NGN 900".
  const noRate = (await summaryOf({ ...base, convert: ({ amount }) => Promise.resolve(amount * 1500) }))!;
  assertEquals(noRate.spent_cents, null);
  assert(noRate.daily_spend.every((d) => d.cents === null));
  // A failed conversion: hidden.
  const failed = (await summaryOf({
    ...base,
    allocations: [{ plan_version_id: "v1", platform: "meta", host_currency: "NGN", provider_currency: "USD", fx_snapshot_id: "fx" }],
    convert: () => Promise.resolve(null),
  }))!;
  assertEquals(failed.spent_cents, null);
  // Mixed host currencies across ads: hidden.
  const mixed = (await summaryOf({
    ...base,
    campaigns: [
      { currency: "NGN", lifecycle: "live", campaign_ids: ["c1"], cap_cents: 1 },
      { currency: "GBP", lifecycle: "live", campaign_ids: ["c2"], cap_cents: 1 },
    ] as unknown as ListedCampaigns,
  }))!;
  assertEquals(mixed.spent_cents, null);
});

Deno.test("#4238 list summary counts the month in the brand's time zone", async () => {
  const campaigns = [{ currency: "NGN", lifecycle: "live", campaign_ids: ["c1"], cap_cents: 1 }] as unknown as ListedCampaigns;
  // 23:30 UTC on 31 Oct is 00:30 on 1 Nov in Lagos (UTC+1): November there.
  const summary = (await summaryOf({
    campaigns,
    rawCampaigns: [{ id: "c1", platform: "meta", plan_version_id: "v1" }],
    nowIso: "2026-10-31T23:30:00Z",
    timeZone: "Africa/Lagos",
    spend: [
      { campaign_id: "c1", spend_date: "2026-10-31", spend_cents: 700, currency: "NGN" },
      { campaign_id: "c1", spend_date: "2026-11-01", spend_cents: 50, currency: "NGN" },
    ],
    conversions: [
      { campaign_id: "c1", created_at: "2026-10-31T23:10:00Z" }, // 00:10 1 Nov Lagos
      { campaign_id: "c1", created_at: "2026-10-31T22:50:00Z" }, // 23:50 31 Oct Lagos
    ],
  }))!;
  assertEquals(summary.spent_cents, 50, "October's spend is last month in Lagos");
  assertEquals(summary.results, 1);
  assertEquals(summary.daily_spend.at(-1), { day: "2026-11-01", cents: 50 });
});
