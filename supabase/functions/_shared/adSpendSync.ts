/**
 * toward #3697 Wave 2 — spend feed + 98% hard-cap pause (#3701 / #3705).
 *
 * Pure helpers the hourly admin-ad-spend-sync worker uses. Platform fetch is
 * injected so unit tests never hit the network.
 */

import type { Platform } from "./adChannelCore.ts";
import { shouldPauseForCap } from "./adMoney.ts";

export interface SpendDayRow {
  spend_date: string; // YYYY-MM-DD
  spend_cents: number;
  impressions?: number;
  clicks?: number;
  currency?: string;
}

export interface CampaignSpendTarget {
  id: string;
  platform: Platform;
  external_campaign_id: string;
  status: string;
  cap_cents: number | null;
  ends_at: string | null;
  /** Currency declared by the connected provider account. Never customer currency. */
  provider_currency: string | null;
}

export type PauseReason =
  | "cap_98_percent"
  | "end_date_passed"
  | "destination_unavailable"
  | "destination_check_failed"
  | "spend_fetch_failed";

export interface SpendSyncDecision {
  upserts: Array<{
    campaign_id: string;
    platform: Platform;
    spend_date: string;
    spend_cents: number;
    impressions: number;
    clicks: number;
    currency: string;
  }>;
  total_spend_cents: number;
  pause: PauseReason | null;
}

export function sumSpendCents(rows: readonly SpendDayRow[]): number {
  let total = 0;
  for (const row of rows) {
    const n = Number(row.spend_cents);
    if (Number.isFinite(n) && n > 0) total += Math.floor(n);
  }
  return total;
}

export function endDatePassed(
  endsAt: string | null | undefined,
  nowIso: string = new Date().toISOString(),
): boolean {
  if (!endsAt) return false;
  const end = Date.parse(endsAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return false;
  return now >= end;
}

/** True when starts_at is set and has not yet been reached. */
export function startDateNotReached(
  startsAt: string | null | undefined,
  nowIso: string = new Date().toISOString(),
): boolean {
  if (!startsAt) return false;
  const start = Date.parse(startsAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return false;
  return now < start;
}

/**
 * Build upserts + pause decision for one campaign given fetched daily rows.
 * Does not mutate the DB or call platforms.
 *
 * Cap pause uses `cumulativeSpendCents` when provided (full `ad_spend_daily`
 * total after upsert) so a sliding Meta insights window cannot drop prior spend
 * below the 98% threshold. Without it, falls back to summing `days`.
 */
export function decideSpendSync(input: {
  campaign: CampaignSpendTarget;
  days: readonly SpendDayRow[];
  /** Lifetime spend from ad_spend_daily after upsert (preferred for cap). */
  cumulativeSpendCents?: number;
  nowIso?: string;
}): SpendSyncDecision {
  const currency = typeof input.campaign.provider_currency === "string"
    ? input.campaign.provider_currency.trim().toUpperCase()
    : "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("provider_currency_unresolved");
  }
  const upserts = input.days
    .filter((d) =>
      typeof d.spend_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(d.spend_date)
    )
    .map((d) => {
      const rowCurrency = typeof d.currency === "string"
        ? d.currency.trim().toUpperCase()
        : currency;
      if (rowCurrency !== currency) {
        throw new Error("provider_currency_mismatch");
      }
      return {
        campaign_id: input.campaign.id,
        platform: input.campaign.platform,
        spend_date: d.spend_date,
        spend_cents: Math.max(0, Math.floor(Number(d.spend_cents) || 0)),
        impressions: Math.max(0, Math.floor(Number(d.impressions) || 0)),
        clicks: Math.max(0, Math.floor(Number(d.clicks) || 0)),
        currency,
      };
    });
  const windowTotal = sumSpendCents(upserts);
  const total = typeof input.cumulativeSpendCents === "number" &&
      Number.isFinite(input.cumulativeSpendCents)
    ? Math.max(0, Math.floor(input.cumulativeSpendCents))
    : windowTotal;
  let pause: PauseReason | null = null;
  if (
    input.campaign.status === "ACTIVE" &&
    shouldPauseForCap(total, input.campaign.cap_cents)
  ) {
    pause = "cap_98_percent";
  } else if (
    input.campaign.status === "ACTIVE" &&
    endDatePassed(input.campaign.ends_at, input.nowIso)
  ) {
    pause = "end_date_passed";
  }
  return { upserts, total_spend_cents: total, pause };
}

/** Meta insights spend is a dollar string — convert to integer cents. */
export function metaSpendDollarsToCents(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw * 100);
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return 0;
}

/**
 * Parse Meta campaign insights payload (time_increment=1) into SpendDayRow[].
 * Accepts { data: [...] } or a bare array.
 */
export function parseMetaInsightsSpend(payload: unknown): SpendDayRow[] {
  const root = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(root.data)
    ? root.data
    : [];
  const out: SpendDayRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const dateStart = typeof row.date_start === "string"
      ? row.date_start
      : null;
    if (!dateStart) continue;
    out.push({
      spend_date: dateStart.slice(0, 10),
      spend_cents: metaSpendDollarsToCents(row.spend),
      impressions: Math.max(0, Math.floor(Number(row.impressions) || 0)),
      clicks: Math.max(
        0,
        Math.floor(Number(row.clicks ?? row.inline_link_clicks) || 0),
      ),
      currency: typeof row.account_currency === "string"
        ? row.account_currency
        : undefined,
    });
  }
  return out;
}

function microsToCents(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.round(value / 10_000)) : 0;
}

/** TikTok integrated-report spend is account-currency major units. */
export function parseTikTokReportSpend(payload: unknown): SpendDayRow[] {
  const root = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const data = root.data && typeof root.data === "object"
    ? root.data as Record<string, unknown>
    : {};
  const list = Array.isArray(data.list)
    ? data.list
    : Array.isArray(root.list)
    ? root.list
    : [];
  const out: SpendDayRow[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const dimensions = row.dimensions && typeof row.dimensions === "object"
      ? row.dimensions as Record<string, unknown>
      : {};
    const metrics = row.metrics && typeof row.metrics === "object"
      ? row.metrics as Record<string, unknown>
      : row;
    const day = String(
      dimensions.stat_time_day ?? dimensions.date ?? row.stat_time_day ??
        row.date ?? "",
    ).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    out.push({
      spend_date: day,
      spend_cents: metaSpendDollarsToCents(metrics.spend),
      impressions: Math.max(0, Math.floor(Number(metrics.impressions) || 0)),
      clicks: Math.max(0, Math.floor(Number(metrics.clicks) || 0)),
    });
  }
  return out;
}

/** Snap stats spend is microcurrency. */
export function parseSnapchatStatsSpend(payload: unknown): SpendDayRow[] {
  const root = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const containers = Array.isArray(root.timeseries_stats)
    ? root.timeseries_stats
    : Array.isArray(root.total_stats)
    ? root.total_stats
    : [];
  const out: SpendDayRow[] = [];
  for (const rawContainer of containers) {
    if (!rawContainer || typeof rawContainer !== "object") continue;
    const container = rawContainer as Record<string, unknown>;
    const stat =
      container.timeseries_stat && typeof container.timeseries_stat === "object"
        ? container.timeseries_stat as Record<string, unknown>
        : container;
    const rows = Array.isArray(stat.timeseries) ? stat.timeseries : [stat];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const stats = row.stats && typeof row.stats === "object"
        ? row.stats as Record<string, unknown>
        : row;
      const day = String(row.start_time ?? row.startTime ?? row.date ?? "")
        .slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      out.push({
        spend_date: day,
        spend_cents: microsToCents(stats.spend),
        impressions: Math.max(0, Math.floor(Number(stats.impressions) || 0)),
        clicks: Math.max(
          0,
          Math.floor(Number(stats.swipes ?? stats.clicks) || 0),
        ),
      });
    }
  }
  return out;
}

/** Google Ads costMicros is currency micros. */
export function parseGoogleAdsSpend(payload: unknown): SpendDayRow[] {
  const pages = Array.isArray(payload) ? payload : [payload];
  const out: SpendDayRow[] = [];
  for (const rawPage of pages) {
    if (!rawPage || typeof rawPage !== "object") continue;
    const page = rawPage as Record<string, unknown>;
    const results = Array.isArray(page.results) ? page.results : [];
    for (const raw of results) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const segments = row.segments && typeof row.segments === "object"
        ? row.segments as Record<string, unknown>
        : {};
      const metrics = row.metrics && typeof row.metrics === "object"
        ? row.metrics as Record<string, unknown>
        : {};
      const day = String(segments.date ?? row.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      out.push({
        spend_date: day,
        spend_cents: microsToCents(metrics.costMicros ?? metrics.cost_micros),
        impressions: Math.max(0, Math.floor(Number(metrics.impressions) || 0)),
        clicks: Math.max(0, Math.floor(Number(metrics.clicks) || 0)),
      });
    }
  }
  return out;
}

/** Reddit report SPEND is currency micros; tolerate current v3 row envelopes. */
export function parseRedditReportSpend(payload: unknown): SpendDayRow[] {
  const root = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const data = root.data;
  const rows = Array.isArray(data) ? data : data && typeof data === "object" &&
      Array.isArray((data as Record<string, unknown>).rows)
    ? (data as Record<string, unknown>).rows as unknown[]
    : Array.isArray(root.rows)
    ? root.rows
    : [];
  const out: SpendDayRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const metrics = row.metrics && typeof row.metrics === "object"
      ? row.metrics as Record<string, unknown>
      : row;
    const breakdown = row.breakdowns && typeof row.breakdowns === "object"
      ? row.breakdowns as Record<string, unknown>
      : row;
    const day = String(
      breakdown.DATE ?? breakdown.date ?? row.starts_at ?? row.start_time ?? "",
    ).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    out.push({
      spend_date: day,
      spend_cents: microsToCents(metrics.SPEND ?? metrics.spend),
      impressions: Math.max(
        0,
        Math.floor(Number(metrics.IMPRESSIONS ?? metrics.impressions) || 0),
      ),
      clicks: Math.max(
        0,
        Math.floor(Number(metrics.CLICKS ?? metrics.clicks) || 0),
      ),
    });
  }
  return out;
}
