/** Issue #3697 — normalize provider reports into daily ad-set/stage facts. */

import { metaSpendDollarsToCents } from "./adSpendSync.ts";

export type AdStageName = "prospecting" | "retarget" | "abandoners";

export type AdStageMetricTarget = {
  id: string;
  externalAdSetId: string;
  stage: AdStageName;
  optimizationGoal: string;
};

export type AdStageMetricRow = {
  ad_set_id: string;
  stage: AdStageName;
  metric_date: string;
  spend_cents: number;
  results: number;
  result_type: string;
  cost_per_result_cents: number | null;
  reach: number;
  frequency: number;
  impressions: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function integer(value: unknown): number {
  return Math.floor(nonNegative(value));
}

function centsFromMicros(value: unknown): number {
  return Math.max(0, Math.round(nonNegative(value) / 10_000));
}

function day(value: unknown): string | null {
  const candidate = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

function targetMap(targets: readonly AdStageMetricTarget[]) {
  return new Map(targets.map((target) => [target.externalAdSetId, target]));
}

function costPerResult(spendCents: number, results: number): number | null {
  return results > 0 ? Math.round(spendCents / results) : null;
}

function actionValue(actions: unknown, names: readonly string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const action of actions) {
    const row = record(action);
    if (names.includes(String(row.action_type ?? ""))) {
      return nonNegative(row.value);
    }
  }
  return 0;
}

function isSalesGoal(goal: string): boolean {
  return /PURCHASE|CONVERT|CONVERSION|SHOPPING|SALES/i.test(goal);
}

export function parseMetaStageMetrics(
  payload: unknown,
  targets: readonly AdStageMetricTarget[],
): AdStageMetricRow[] {
  const root = record(payload);
  const rows = Array.isArray(root.data) ? root.data : [];
  const byExternalId = targetMap(targets);
  const out: AdStageMetricRow[] = [];
  for (const raw of rows) {
    const provider = record(raw);
    const target = byExternalId.get(String(provider.adset_id ?? ""));
    const metricDate = day(provider.date_start);
    if (!target || !metricDate) continue;
    const sales = isSalesGoal(target.optimizationGoal);
    const results = actionValue(
      provider.actions,
      sales
        ? [
          "offsite_conversion.fb_pixel_purchase",
          "omni_purchase",
          "purchase",
        ]
        : ["landing_page_view"],
    );
    const spendCents = metaSpendDollarsToCents(provider.spend);
    out.push({
      ad_set_id: target.id,
      stage: target.stage,
      metric_date: metricDate,
      spend_cents: spendCents,
      results,
      result_type: sales ? "purchase" : "landing_page_view",
      cost_per_result_cents: costPerResult(spendCents, results),
      reach: integer(provider.reach),
      frequency: nonNegative(provider.frequency),
      impressions: integer(provider.impressions),
    });
  }
  return out;
}

export function parseTikTokStageMetrics(
  payload: unknown,
  targets: readonly AdStageMetricTarget[],
): AdStageMetricRow[] {
  const root = record(payload);
  const data = record(root.data);
  const rows = Array.isArray(data.list)
    ? data.list
    : Array.isArray(root.list)
    ? root.list
    : [];
  const byExternalId = targetMap(targets);
  const out: AdStageMetricRow[] = [];
  for (const raw of rows) {
    const row = record(raw);
    const dimensions = record(row.dimensions);
    const metrics = Object.keys(record(row.metrics)).length > 0
      ? record(row.metrics)
      : row;
    const target = byExternalId.get(String(
      dimensions.adgroup_id ?? dimensions.ad_group_id ?? row.adgroup_id ?? "",
    ));
    const metricDate = day(
      dimensions.stat_time_day ?? dimensions.date ?? row.stat_time_day,
    );
    if (!target || !metricDate) continue;
    const sales = isSalesGoal(target.optimizationGoal);
    const results = sales
      ? nonNegative(
        metrics.total_complete_payment ?? metrics.complete_payment ??
          metrics.conversion,
      )
      : nonNegative(metrics.landing_page_view ?? metrics.click_landing_page);
    const spendCents = metaSpendDollarsToCents(metrics.spend);
    const reach = integer(metrics.reach);
    const impressions = integer(metrics.impressions);
    out.push({
      ad_set_id: target.id,
      stage: target.stage,
      metric_date: metricDate,
      spend_cents: spendCents,
      results,
      result_type: sales ? "complete_payment" : "landing_page_view",
      cost_per_result_cents: costPerResult(spendCents, results),
      reach,
      frequency: nonNegative(metrics.frequency) ||
        (reach > 0 ? impressions / reach : 0),
      impressions,
    });
  }
  return out;
}

export function parseSnapchatStageMetrics(
  payload: unknown,
  target: AdStageMetricTarget,
): AdStageMetricRow[] {
  const root = record(payload);
  const containers = Array.isArray(root.timeseries_stats)
    ? root.timeseries_stats
    : Array.isArray(root.total_stats)
    ? root.total_stats
    : [];
  const out: AdStageMetricRow[] = [];
  for (const rawContainer of containers) {
    const container = record(rawContainer);
    const stat = Object.keys(record(container.timeseries_stat)).length > 0
      ? record(container.timeseries_stat)
      : container;
    const rows = Array.isArray(stat.timeseries) ? stat.timeseries : [stat];
    for (const raw of rows) {
      const row = record(raw);
      const stats = Object.keys(record(row.stats)).length > 0
        ? record(row.stats)
        : row;
      const metricDate = day(row.start_time ?? row.startTime ?? row.date);
      if (!metricDate) continue;
      const sales = isSalesGoal(target.optimizationGoal);
      const results = sales
        ? nonNegative(
          stats.conversion_purchases ?? stats.purchases ?? stats.purchase,
        )
        : nonNegative(stats.conversion_page_views ?? stats.page_views);
      const spendCents = centsFromMicros(stats.spend);
      const reach = integer(stats.reach);
      const impressions = integer(stats.impressions);
      out.push({
        ad_set_id: target.id,
        stage: target.stage,
        metric_date: metricDate,
        spend_cents: spendCents,
        results,
        result_type: sales ? "purchase" : "page_view",
        cost_per_result_cents: costPerResult(spendCents, results),
        reach,
        frequency: nonNegative(stats.frequency) ||
          (reach > 0 ? impressions / reach : 0),
        impressions,
      });
    }
  }
  return out;
}
