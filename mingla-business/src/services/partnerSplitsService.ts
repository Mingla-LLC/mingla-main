/**
 * partnerSplitsService — ORCH-1054 frontend reader for partner_splits.
 *
 * RLS allows:
 *   - SELF read by partner_account_id = auth.uid()
 *   - brand_owner / brand_admin on the brand can read brand history
 *   - superadmin can read all
 *
 * No mutation endpoints — writes are service-role only via the stripe-webhook
 * router (charge.succeeded creates rows; refund/dispute flips them).
 */

import { supabase } from "./supabase";

export type PartnerSplitStatus =
  | "pending"
  | "transferred"
  | "blocked_currency_mismatch"
  | "blocked_no_stripe"
  | "failed"
  | "reversed"
  | "reversed_pending";

export interface PartnerSplitRow {
  id: string;
  order_id: string;
  brand_id: string;
  partner_account_id: string;
  mingla_fee_cents: number;
  partner_share_cents: number;
  transfer_currency: string;
  stripe_transfer_id: string | null;
  stripe_application_fee_id: string;
  status: PartnerSplitStatus;
  error_message: string | null;
  created_at: string;
  transferred_at: string | null;
  reversed_at: string | null;
}

export interface PartnerEarningsCurrencyBucket {
  currency: string;
  transferred_cents: number;
  pending_cents: number;
  reversed_cents: number;
  count: number;
}

export interface PartnerEarningsSummary {
  totals_by_currency: PartnerEarningsCurrencyBucket[];
  by_month: Array<{
    month: string;
    currency: string;
    transferred_cents: number;
    count: number;
  }>;
  by_brand: Array<{
    brand_id: string;
    currency: string;
    transferred_cents: number;
    count: number;
  }>;
}

export const partnerSplitsKeys = {
  all: ["partnerSplits"] as const,
  list: (params?: { from?: string; to?: string; currency?: string }) =>
    [
      ...partnerSplitsKeys.all,
      "list",
      params?.from ?? null,
      params?.to ?? null,
      params?.currency ?? null,
    ] as const,
  summary: (params?: { from?: string; to?: string }) =>
    [
      ...partnerSplitsKeys.all,
      "summary",
      params?.from ?? null,
      params?.to ?? null,
    ] as const,
};

export async function listPartnerSplits(
  params: {
    from?: string;
    to?: string;
    currency?: string;
    limit?: number;
  } = {},
): Promise<PartnerSplitRow[]> {
  let query = supabase
    .from("partner_splits")
    .select(
      "id, order_id, brand_id, partner_account_id, mingla_fee_cents, partner_share_cents, transfer_currency, stripe_transfer_id, stripe_application_fee_id, status, error_message, created_at, transferred_at, reversed_at",
    )
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 200);
  if (params.from) query = query.gte("created_at", params.from);
  if (params.to) query = query.lte("created_at", params.to);
  if (params.currency) {
    query = query.eq("transfer_currency", params.currency.toLowerCase());
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as PartnerSplitRow[];
}

/** Client-side aggregation: groups by currency, by month (ISO YYYY-MM in UTC),
 * and by brand_id. Multi-currency support — we do NOT FX between currencies
 * (per I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY); each currency is its own
 * bucket. */
export function summarizePartnerSplits(
  rows: PartnerSplitRow[],
): PartnerEarningsSummary {
  const byCurrency = new Map<string, PartnerEarningsCurrencyBucket>();
  const byMonth = new Map<
    string,
    { transferred_cents: number; count: number }
  >();
  const byBrand = new Map<
    string,
    { transferred_cents: number; count: number }
  >();

  for (const row of rows) {
    const cur = row.transfer_currency.toLowerCase();
    const bucket = byCurrency.get(cur) ?? {
      currency: cur,
      transferred_cents: 0,
      pending_cents: 0,
      reversed_cents: 0,
      count: 0,
    };
    bucket.count += 1;
    if (row.status === "transferred") {
      bucket.transferred_cents += row.partner_share_cents;
      const month = row.created_at.slice(0, 7); // YYYY-MM
      const monthKey = `${month}|${cur}`;
      const mEntry = byMonth.get(monthKey) ??
        { transferred_cents: 0, count: 0 };
      mEntry.transferred_cents += row.partner_share_cents;
      mEntry.count += 1;
      byMonth.set(monthKey, mEntry);
      const brandKey = `${row.brand_id}|${cur}`;
      const bEntry = byBrand.get(brandKey) ??
        { transferred_cents: 0, count: 0 };
      bEntry.transferred_cents += row.partner_share_cents;
      bEntry.count += 1;
      byBrand.set(brandKey, bEntry);
    } else if (row.status === "pending") {
      bucket.pending_cents += row.partner_share_cents;
    } else if (row.status === "reversed" || row.status === "reversed_pending") {
      bucket.reversed_cents += row.partner_share_cents;
    }
    byCurrency.set(cur, bucket);
  }

  return {
    totals_by_currency: Array.from(byCurrency.values()).sort((a, b) =>
      a.currency.localeCompare(b.currency)
    ),
    by_month: Array.from(byMonth.entries()).map(([key, value]) => {
      const [month, currency] = key.split("|");
      return {
        month,
        currency,
        transferred_cents: value.transferred_cents,
        count: value.count,
      };
    }).sort((a, b) =>
      b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency)
    ),
    by_brand: Array.from(byBrand.entries()).map(([key, value]) => {
      const [brand_id, currency] = key.split("|");
      return {
        brand_id,
        currency,
        transferred_cents: value.transferred_cents,
        count: value.count,
      };
    }).sort((a, b) => b.transferred_cents - a.transferred_cents),
  };
}

export async function getPartnerEarningsSummary(
  params: { from?: string; to?: string } = {},
): Promise<PartnerEarningsSummary> {
  const rows = await listPartnerSplits({ ...params, limit: 1000 });
  return summarizePartnerSplits(rows);
}
