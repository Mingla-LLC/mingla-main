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

Deno.test("#4238 list summary: month spend, budgets, results and a 30-day sparkline", () => {
  const campaigns = [{
    currency: "USD",
    lifecycle: "live",
    campaign_ids: ["c1"],
    cap_cents: 10_000,
    primary_result_count: 3,
  }] as unknown as Parameters<typeof buildHostListSummary>[0]["campaigns"];
  const summary = buildHostListSummary({
    campaigns,
    spend: [
      { campaign_id: "c1", spend_date: "2026-11-01", spend_cents: 400, currency: "USD" },
      { campaign_id: "c1", spend_date: "2026-10-20", spend_cents: 100, currency: "USD" },
    ],
    nowIso: "2026-11-02T12:00:00Z",
  })!;
  assertEquals(summary.spent_cents, 400, "this month only");
  assertEquals(summary.budget_cents, 10_000);
  assertEquals(summary.results, 3);
  assertEquals(summary.daily_spend.length, 30);
  assertEquals(summary.daily_spend.at(-2), { day: "2026-11-01", cents: 400 });
  assertEquals(buildHostListSummary({ campaigns: [] as never, spend: [], nowIso: "2026-11-02T00:00:00Z" }), null);
});

Deno.test("#4238 list summary never sums mixed currencies", () => {
  const campaigns = [{ currency: "NGN", lifecycle: "live", campaign_ids: ["c1"], cap_cents: 1, primary_result_count: 0 }] as never;
  const summary = buildHostListSummary({
    campaigns,
    spend: [{ campaign_id: "c1", spend_date: "2026-11-01", spend_cents: 400, currency: "USD" }],
    nowIso: "2026-11-02T12:00:00Z",
  })!;
  assertEquals(summary.spent_cents, null);
  assertEquals(summary.daily_spend.at(-2)?.cents, null);
});
