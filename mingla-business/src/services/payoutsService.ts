/**
 * Payout rows for payments dashboard (B2 / issue #47).
 */

import { supabase } from "./supabase";
import type { BrandPayout, BrandPayoutStatus } from "../store/currentBrandStore";

export interface PayoutRow {
  id: string;
  stripe_payout_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  arrival_date: string | null;
  created_at: string;
}

function mapStatus(db: string): BrandPayoutStatus {
  if (db === "paid") return "paid";
  if (db === "failed") return "failed";
  return "in_transit";
}

function arrivalIso(row: PayoutRow): string {
  if (row.arrival_date !== null && row.arrival_date.length > 0) {
    return `${row.arrival_date}T12:00:00.000Z`;
  }
  return row.created_at;
}

export async function listPayoutsForBrand(brandId: string): Promise<BrandPayout[]> {
  const { data, error } = await supabase
    .from("payouts")
    .select("id, stripe_payout_id, amount_cents, currency, status, arrival_date, created_at")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) throw error;
  const rows = (data ?? []) as PayoutRow[];
  const cur = (r: PayoutRow): string =>
    String(r.currency ?? "GBP")
      .trim()
      .toUpperCase()
      .slice(0, 3);

  return rows.map((r) => ({
    id: r.id,
    amountGbp: r.amount_cents / 100,
    currency: cur(r),
    status: mapStatus(r.status),
    arrivedAt: arrivalIso(r),
  }));
}
