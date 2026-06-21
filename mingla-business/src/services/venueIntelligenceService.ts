/**
 * ORCH-1186-B — venue intelligence read service.
 *
 * Single read path for the venue Overview intelligence dashboard. Wraps the
 * owner-only `venue_intelligence_overview(p_brand_id)` RPC, which computes all
 * aggregations SERVER-SIDE in the venue's local timezone (Constitution #12) and
 * per-currency (Constitution #10). This service only types + defends the shape;
 * it does NO client-side bucketing or currency math.
 *
 * Error contract: THROWS on RPC error (React Query surfaces it) — matching the
 * eventOrdersService convention. A null/empty RPC payload (brand-new venue) is
 * coerced to a zero-filled VenueIntelligence so the UI shows honest empties,
 * not an error.
 */
import { supabase } from "./supabase";

export type TzConfidence = "iana" | "offset" | "utc";

export interface VenueIntelligence {
  resolvedTimezone: string;
  tzConfidence: TzConfidence;
  brandDefaultCurrency: string;
  orderCount: number;
  firstOrderAt: string | null;
  /** length 24, hour 0..23 */
  hours: { hour: number; orders: number }[];
  /** length 7, weekday 0=Mon..6=Sun */
  days: { weekday: number; orders: number }[];
  /** length 30, oldest -> newest, default-currency only */
  revenueTrend: { currency: string; days: { date: string; netCents: number }[] };
  revenueByCurrency: Record<string, number>;
  rev7dByCurrency: Record<string, number>;
  /** desc by score */
  signalScores: { id: string; score: number }[];
}

/** Raw jsonb shape returned by the RPC (snake_case). */
interface VenueIntelligenceRow {
  resolved_timezone?: string | null;
  tz_confidence?: string | null;
  brand_default_currency?: string | null;
  order_count?: number | null;
  first_order_at?: string | null;
  hours?: { hour: number; orders: number }[] | null;
  days?: { weekday: number; orders: number }[] | null;
  revenue_trend?: {
    currency?: string | null;
    days?: { date: string; net_cents: number }[] | null;
  } | null;
  revenue_by_currency?: Record<string, number> | null;
  rev7d_by_currency?: Record<string, number> | null;
  signal_scores?: { id: string; score: number }[] | null;
}

const zeroFilledHours = (): { hour: number; orders: number }[] =>
  Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));

const zeroFilledDays = (): { weekday: number; orders: number }[] =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, orders: 0 }));

const normalizeTzConfidence = (raw: string | null | undefined): TzConfidence =>
  raw === "iana" || raw === "offset" || raw === "utc" ? raw : "utc";

const emptyIntelligence = (currency: string): VenueIntelligence => ({
  resolvedTimezone: "UTC",
  tzConfidence: "utc",
  brandDefaultCurrency: currency,
  orderCount: 0,
  firstOrderAt: null,
  hours: zeroFilledHours(),
  days: zeroFilledDays(),
  revenueTrend: { currency, days: [] },
  revenueByCurrency: {},
  rev7dByCurrency: {},
  signalScores: [],
});

export async function fetchVenueIntelligence(
  brandId: string,
): Promise<VenueIntelligence> {
  const { data, error } = await supabase.rpc("venue_intelligence_overview", {
    p_brand_id: brandId,
  });

  if (error !== null) {
    throw new Error(`venue_intelligence_overview failed: ${error.message}`);
  }

  const row = (data ?? null) as VenueIntelligenceRow | null;
  if (row === null) {
    return emptyIntelligence("GBP");
  }

  const currency = row.brand_default_currency ?? "GBP";
  const hours =
    Array.isArray(row.hours) && row.hours.length === 24
      ? row.hours.map((h) => ({ hour: h.hour, orders: h.orders }))
      : zeroFilledHours();
  const days =
    Array.isArray(row.days) && row.days.length === 7
      ? row.days.map((d) => ({ weekday: d.weekday, orders: d.orders }))
      : zeroFilledDays();

  const trendDays = Array.isArray(row.revenue_trend?.days)
    ? (row.revenue_trend?.days ?? []).map((d) => ({
        date: d.date,
        netCents: d.net_cents,
      }))
    : [];

  return {
    resolvedTimezone: row.resolved_timezone ?? "UTC",
    tzConfidence: normalizeTzConfidence(row.tz_confidence),
    brandDefaultCurrency: currency,
    orderCount: row.order_count ?? 0,
    firstOrderAt: row.first_order_at ?? null,
    hours,
    days,
    revenueTrend: {
      currency: row.revenue_trend?.currency ?? currency,
      days: trendDays,
    },
    revenueByCurrency: row.revenue_by_currency ?? {},
    rev7dByCurrency: row.rev7d_by_currency ?? {},
    signalScores: Array.isArray(row.signal_scores)
      ? row.signal_scores.map((s) => ({ id: s.id, score: s.score }))
      : [],
  };
}
