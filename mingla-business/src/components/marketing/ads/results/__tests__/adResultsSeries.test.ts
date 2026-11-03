/**
 * #4238 wave 2 — T13: the results series. Missing input stays null, never 0;
 * one day draws no line; zero results hide the results chart; the funnel
 * omits a step with no data source and never assumes values decrease.
 */

import {
  buildFunnel,
  buildPlatformBars,
  buildResultsSeries,
  buildSpendSeries,
} from "../adResultsSeries";
import type { HostAdDailyPoint } from "../../../../../services/hostAdCampaignService";

const point = (day: string, host: number | null, provider: number | null, extra: Partial<HostAdDailyPoint> = {}): HostAdDailyPoint => ({
  day,
  spend_host_cents: host,
  spend_provider_cents: provider,
  provider_currency: provider === null ? null : "USD",
  impressions: provider === null ? null : 1000,
  clicks: provider === null ? null : 30,
  page_visits: 12,
  results: 0,
  ...extra,
});

describe("#4238 T13 adResultsSeries", () => {
  it("cumulative spend in host currency ends at the server total", () => {
    const series = buildSpendSeries({
      daily: [point("2026-11-02", 650000, 420), point("2026-11-01", 4200, 3), point("2026-11-03", 900000, 580)],
      hostCurrency: "NGN",
      budgetCents: 10_000_000,
    });
    expect(series.inHostCurrency).toBe(true);
    expect(series.points.map((p) => p.cumulative)).toEqual([4200, 654200, 1554200]);
    expect(series.total).toBe(1554200);
    expect(series.pauseAt).toBe(9_800_000);
    expect(series.highest).toEqual({ day: "2026-11-03", cents: 900000 });
  });

  it("null FX falls back to the ad apps' currency and drops the host budget", () => {
    const series = buildSpendSeries({
      daily: [point("2026-11-01", null, 300), point("2026-11-02", null, 200)],
      hostCurrency: "NGN",
      budgetCents: 10_000_000,
    });
    expect(series.inHostCurrency).toBe(false);
    expect(series.currency).toBe("USD");
    expect(series.budget).toBeNull();
    expect(series.total).toBe(500);
  });

  it("no spend is null, not zero", () => {
    const series = buildSpendSeries({ daily: [point("2026-11-01", null, null)], hostCurrency: "NGN", budgetCents: 100 });
    expect(series.total).toBeNull();
    expect(series.points).toEqual([]);
  });

  it("zero results hide the chart; cost per result only on days with both", () => {
    expect(buildResultsSeries({ daily: [point("2026-11-01", 100, 1)], inHostCurrency: true }).show).toBe(false);
    const series = buildResultsSeries({
      daily: [point("2026-11-01", 1000, 1, { results: 4 }), point("2026-11-02", 0, 0, { results: 2 }), point("2026-11-03", 500, 1)],
      inHostCurrency: true,
    });
    expect(series.show).toBe(true);
    expect(series.total).toBe(6);
    expect(series.points.map((p) => p.costPerResult)).toEqual([250, null, null]);
  });

  it("funnel: steps with no source are omitted; values that rise are allowed", () => {
    expect(buildFunnel([point("2026-11-01", null, null, { page_visits: 0 })]).map((s) => s.key)).toEqual(["results"]);
    const steps = buildFunnel([point("2026-11-01", 1, 1, { impressions: 10, clicks: 20, page_visits: 30, results: 1 })]);
    expect(steps.map((s) => s.key)).toEqual(["shown", "clicks", "visits", "results"]);
    expect(steps.map((s) => s.share)).toEqual([1, 1, 1, 0.1]);
  });

  it("platform bars sort by spend and size against the largest", () => {
    const bars = buildPlatformBars([
      { platform: "snapchat", spend_provider_cents: 100, provider_currency: "USD", results: 1 },
      { platform: "meta", spend_provider_cents: 400, provider_currency: "USD", results: 3 },
    ]);
    expect(bars.map((b) => [b.platform, b.share])).toEqual([["meta", 1], ["snapchat", 0.25]]);
  });
});
