/**
 * #4238 wave 2 — the numbers behind the Host ad results charts. Pure.
 *
 * Missing input stays null, never 0 (Constitution #9): a day with no spend
 * row has no spend; a step with no data source is omitted. The final
 * cumulative host-currency point equals host_spend_equivalent_cents because
 * the server converts cumulative totals (host-ad-campaign `daily`).
 */

import { formatHostAdMoneyCents } from "../hostAdMoney";
import type {
  HostAdDailyPoint,
  HostAdPlatformSpend,
} from "../../../../services/hostAdCampaignService";

export type SpendPoint = { day: string; cumulative: number };

export type SpendSeries = {
  /** host currency when every day converted, else the ad apps' currency */
  currency: string | null;
  inHostCurrency: boolean;
  points: SpendPoint[];
  total: number | null;
  budget: number | null;
  /** the most spent on one day, for the a11y sentence */
  highest: { day: string; cents: number } | null;
  /**
   * #4238 shared days rule (Host and Admin): "over N days" counts the days
   * whose own spend is above zero. Admin's buildAdminResultsSeries applies
   * the same rule to the same ad_campaign_daily_series rows.
   */
  spendDays: number;
  /** 98% of the budget (the pause point), or null without a budget */
  pauseAt: number | null;
};

export function buildSpendSeries(input: {
  daily: readonly HostAdDailyPoint[];
  hostCurrency: string | null;
  budgetCents: number | null;
}): SpendSeries {
  const days = [...input.daily].sort((a, b) => a.day.localeCompare(b.day));
  const spending = days.filter(
    (point) => point.spend_host_cents !== null || point.spend_provider_cents !== null,
  );
  const inHost =
    spending.length > 0 && spending.every((point) => point.spend_host_cents !== null);
  const providerCurrency =
    spending.find((point) => point.provider_currency)?.provider_currency ?? null;
  const currency = inHost ? input.hostCurrency : providerCurrency;
  let running = 0;
  let highest: SpendSeries["highest"] = null;
  let spendDays = 0;
  const points: SpendPoint[] = [];
  for (const point of spending) {
    const cents = inHost ? point.spend_host_cents : point.spend_provider_cents;
    if (cents === null) continue;
    running += cents;
    if (cents > 0) spendDays += 1;
    points.push({ day: point.day, cumulative: running });
    if (!highest || cents > highest.cents) highest = { day: point.day, cents };
  }
  const budget = inHost && input.budgetCents !== null && input.budgetCents > 0
    ? input.budgetCents
    : null;
  return {
    currency,
    inHostCurrency: inHost,
    points,
    total: points.length > 0 ? running : null,
    budget,
    highest,
    spendDays,
    pauseAt: budget !== null ? Math.floor(budget * 0.98) : null,
  };
}

export type ResultsPoint = {
  day: string;
  results: number;
  /** spend ÷ results, only on days with both > 0 */
  costPerResult: number | null;
};

export type ResultsSeries = {
  points: ResultsPoint[];
  total: number;
  /** total spend ÷ total results (never an average of daily figures) */
  costPerResult: number | null;
  /** false hides the results chart: nothing counted yet */
  show: boolean;
};

export function buildResultsSeries(input: {
  daily: readonly HostAdDailyPoint[];
  inHostCurrency: boolean;
}): ResultsSeries {
  const days = [...input.daily].sort((a, b) => a.day.localeCompare(b.day));
  const points = days.map((point) => {
    const results = point.results ?? 0;
    const spend = input.inHostCurrency ? point.spend_host_cents : point.spend_provider_cents;
    return {
      day: point.day,
      results,
      costPerResult:
        spend !== null && spend > 0 && results > 0 ? Math.round(spend / results) : null,
    };
  });
  const total = points.reduce((sum, point) => sum + point.results, 0);
  const spendTotal = days.reduce((sum, point) => {
    const spend = input.inHostCurrency ? point.spend_host_cents : point.spend_provider_cents;
    return sum + (spend ?? 0);
  }, 0);
  return {
    points,
    total,
    costPerResult: hostAdCostPerResult(spendTotal, total),
    show: total > 0,
  };
}

/** Total spend ÷ total results, or null unless both are above zero. */
export function hostAdCostPerResult(spendCents: number | null, results: number | null): number | null {
  return spendCents !== null && results !== null && spendCents > 0 && results > 0
    ? Math.round(spendCents / results)
    : null;
}

/**
 * The detail page's "Cost per result": total spend ÷ total results. Spend is
 * the brand-currency total when Mingla could convert it, otherwise the same
 * provider-currency total the spend chart shows; results are Mingla's own
 * count, else the chart's daily total. Null only when one of them is 0.
 */
export function hostAdDetailCostPerResult(input: {
  hostSpendCents: number | null;
  hostCurrency: string | null;
  conversions: number;
  daily: readonly HostAdDailyPoint[];
}): { cents: number; currency: string } | null {
  const series = buildSpendSeries({ daily: input.daily, hostCurrency: input.hostCurrency, budgetCents: null });
  const useHost = input.hostSpendCents !== null && input.hostCurrency !== null;
  const spend = useHost ? input.hostSpendCents : series.total;
  const currency = useHost ? input.hostCurrency : series.currency;
  const results = input.conversions > 0
    ? input.conversions
    : input.daily.reduce((sum, point) => sum + (point.results ?? 0), 0);
  const cents = hostAdCostPerResult(spend, results);
  return cents !== null && currency ? { cents, currency } : null;
}

/**
 * #4238 wave 2 rework: "Cost per sale: NGN 103,333.33", written the same way
 * as the results headline ("You've spent NGN 310,000.00 …"), never with a
 * symbol beside a code.
 */
export function hostAdCostPerResultLine(
  costPerLabel: string,
  costPerResult: { cents: number; currency: string } | null,
): string {
  const amount = costPerResult
    ? formatHostAdMoneyCents(costPerResult.cents, costPerResult.currency)
    : null;
  return `${costPerLabel}: ${amount ?? "Shown once we have both spend and results"}`;
}

/**
 * #4238 wave 2 rework: the chart's right-axis value in a 40 px gutter at
 * 390 px. "77,500.00" was clipped to "77,500.(", so the axis shows whole
 * units, shortened past four digits: 950, 9,999, 77.5K, 1.2M.
 */
export function compactAxisAmount(cents: number): string {
  const units = Math.max(0, cents) / 100;
  const trim = (value: number) => value.toFixed(1).replace(/\.0$/, "");
  if (units >= 1_000_000) return `${trim(units / 1_000_000)}M`;
  if (units >= 10_000) return `${trim(units / 1_000)}K`;
  return Math.round(units).toLocaleString("en-US");
}

export type FunnelStep = {
  key: "shown" | "clicks" | "visits" | "results";
  value: number;
  /** share of the first step, 0..1, for the thin bar */
  share: number;
};

/**
 * Shown → clicks → page visits → results. A step with no data source at all
 * (every day null) is omitted, never shown as 0. Values may not decrease, so
 * this is a row of tiles, not a funnel shape.
 */
export function buildFunnel(daily: readonly HostAdDailyPoint[]): FunnelStep[] {
  const sum = (pick: (point: HostAdDailyPoint) => number | null): number | null => {
    const values = daily.map(pick).filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  };
  const raw: { key: FunnelStep["key"]; value: number | null }[] = [
    { key: "shown", value: sum((p) => p.impressions) },
    { key: "clicks", value: sum((p) => p.clicks) },
    { key: "visits", value: sum((p) => p.page_visits) },
    { key: "results", value: sum((p) => p.results) },
  ];
  const present = raw.filter(
    (step): step is { key: FunnelStep["key"]; value: number } =>
      step.value !== null && !(step.key === "visits" && step.value === 0),
  );
  const first = present[0]?.value ?? 0;
  return present.map((step) => ({
    key: step.key,
    value: step.value,
    share: first > 0 ? Math.min(1, step.value / first) : 0,
  }));
}

export type PlatformBar = {
  platform: string;
  cents: number;
  currency: string | null;
  results: number;
  share: number;
};

export function buildPlatformBars(rows: readonly HostAdPlatformSpend[]): PlatformBar[] {
  const max = Math.max(0, ...rows.map((row) => row.spend_provider_cents));
  return [...rows]
    .sort((a, b) => b.spend_provider_cents - a.spend_provider_cents)
    .map((row) => ({
      platform: row.platform,
      cents: row.spend_provider_cents,
      currency: row.provider_currency,
      results: row.results,
      share: max > 0 ? row.spend_provider_cents / max : 0,
    }));
}

/** "2 Nov" in UTC (days are already in the ad's time zone). */
export function shortDay(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** SVG path geometry for a value line on a 0..max scale. */
export function linePath(
  values: readonly number[],
  width: number,
  height: number,
  max: number,
): { d: string; points: { x: number; y: number }[] } {
  const top = 8;
  const divisor = Math.max(values.length - 1, 1);
  const scale = max > 0 ? max : 1;
  const points = values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : (index / divisor) * width,
    y: height - (value / scale) * (height - top),
  }));
  return {
    d: points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" "),
    points,
  };
}
