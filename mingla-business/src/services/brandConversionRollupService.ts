/**
 * ISSUE-865 PR1 WP-4 — brand ad-conversion rollup read service.
 *
 * Single read path for the venue Overview "Customers your ads drove" tile. Wraps
 * the SECURITY DEFINER, brand-scoped `brand_conversion_rollup(p_brand_id)` RPC,
 * which self-authorizes (an owner reads ONLY their own brand's rows) and counts
 * ONLY ad-DRIVEN conversions (a click_id/touch_id/campaign_id is present) — never
 * organic sales, per the dashboard's no-fabrication constitution. Two-tier value:
 * a paid Purchase carries value, a free RSVP is a £0 lead but still a driven
 * customer.
 *
 * Error contract: THROWS on RPC error (React Query surfaces it), matching the
 * venueIntelligenceService convention. This service only types + defends the
 * shape; all aggregation is SERVER-SIDE.
 */
import { supabase } from "./supabase";

export interface RollupPlatformRow {
  platform: string;
  conversions: number;
  valueCents: number;
}

export interface RollupTopCampaign {
  campaignId: string;
  name: string | null;
  conversions: number;
}

export interface BrandConversionRollup {
  /** Distinct ad-driven customers in the trailing 30 days / lifetime. */
  customersDriven30d: number;
  customersDrivenLifetime: number;
  /** Value'd Purchase revenue per currency (free RSVP leads contribute £0). */
  valueByCurrency30d: Record<string, number>;
  valueByCurrencyLifetime: Record<string, number>;
  byPlatform: RollupPlatformRow[];
  topCampaign: RollupTopCampaign | null;
  sendHealth: { sent: number; failed: number; skipped: number; pending: number };
}

interface RollupRow {
  authorized?: boolean | null;
  customers_driven_30d?: number | null;
  customers_driven_lifetime?: number | null;
  value_cents_30d?: Record<string, number> | null;
  value_cents_lifetime?: Record<string, number> | null;
  by_platform?: { platform: string; conversions: number; value_cents: number }[] | null;
  top_campaign?: { campaign_id: string; name: string | null; conversions: number } | null;
  send_health?: { sent: number; failed: number; skipped: number; pending: number } | null;
}

const EMPTY_ROLLUP: BrandConversionRollup = {
  customersDriven30d: 0,
  customersDrivenLifetime: 0,
  valueByCurrency30d: {},
  valueByCurrencyLifetime: {},
  byPlatform: [],
  topCampaign: null,
  sendHealth: { sent: 0, failed: 0, skipped: 0, pending: 0 },
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Normalize the raw RPC jsonb into the typed, honest-empty-safe rollup. */
export function normalizeBrandConversionRollup(raw: unknown): BrandConversionRollup {
  const row = (raw ?? null) as RollupRow | null;
  if (row === null) return { ...EMPTY_ROLLUP };
  const byPlatform = Array.isArray(row.by_platform)
    ? row.by_platform.map((p) => ({
        platform: typeof p.platform === "string" ? p.platform : "unknown",
        conversions: num(p.conversions),
        valueCents: num(p.value_cents),
      }))
    : [];
  const top = row.top_campaign ?? null;
  return {
    customersDriven30d: num(row.customers_driven_30d),
    customersDrivenLifetime: num(row.customers_driven_lifetime),
    valueByCurrency30d: (row.value_cents_30d ?? {}) as Record<string, number>,
    valueByCurrencyLifetime: (row.value_cents_lifetime ?? {}) as Record<string, number>,
    byPlatform,
    topCampaign: top
      ? {
          campaignId: top.campaign_id,
          name: top.name ?? null,
          conversions: num(top.conversions),
        }
      : null,
    sendHealth: {
      sent: num(row.send_health?.sent),
      failed: num(row.send_health?.failed),
      skipped: num(row.send_health?.skipped),
      pending: num(row.send_health?.pending),
    },
  };
}

export async function fetchBrandConversionRollup(
  brandId: string,
): Promise<BrandConversionRollup> {
  const { data, error } = await supabase.rpc("brand_conversion_rollup", {
    p_brand_id: brandId,
  });
  if (error !== null) {
    throw new Error(`brand_conversion_rollup failed: ${error.message}`);
  }
  return normalizeBrandConversionRollup(data);
}
