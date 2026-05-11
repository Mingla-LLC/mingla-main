/**
 * brandStripeOrphanedRefundsService — read-only refund history for detached brands.
 *
 * Per B2a Path C V3 SPEC §6 + DEC-V3-7.
 *
 * ORCH-0787 (Q-7 folded scope, S-09 fix): corrected column names to match the
 * actual `payment_webhook_events` schema. Pre-fix this service queried
 * `event_id`, `raw_payload`, `event_type`, `account_id` — but the real columns
 * are `stripe_event_id`, `payload`, `type` (no `account_id` until the ORCH-0787
 * migration adds it as a generated column from `payload->>'account'`).
 *
 * Reads `payment_webhook_events` directly (no edge fn — RLS allows brand
 * payments-managers to read their brand's webhook events). Filters to:
 *   - type = 'charge.refund.updated' (or modern refund.* once ORCH-0787 webhook lands)
 *   - account_id (generated column) matches the brand's stripe_account_id
 *
 * Returns the most recent 20 refund events with derived display fields.
 */

import { supabase } from "./supabase";

export interface OrphanedRefundEntry {
  eventId: string;
  amountMinor: number;
  currency: string;
  status: "succeeded" | "failed" | "pending" | "canceled" | string;
  createdAt: string;
}

interface RawWebhookEventRow {
  stripe_event_id: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

const MAX_ROWS = 20;

export async function fetchBrandStripeOrphanedRefunds(
  brandId: string,
): Promise<OrphanedRefundEntry[]> {
  // Lookup the brand's stripe_account_id from stripe_connect_accounts.
  const { data: connectRow, error: connectErr } = await supabase
    .from("stripe_connect_accounts")
    .select("stripe_account_id")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ stripe_account_id: string | null }>();

  if (connectErr) throw connectErr;
  const stripeAccountId = connectRow?.stripe_account_id ?? null;
  if (stripeAccountId === null) return [];

  // ORCH-0787 fix: use real columns (`stripe_event_id`, `payload`, `type`) and the new
  // generated `account_id` column added in migration 20260520000000.
  const { data, error } = await supabase
    .from("payment_webhook_events")
    .select("stripe_event_id, payload, created_at")
    .eq("type", "charge.refund.updated")
    .eq("account_id", stripeAccountId)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS)
    .returns<RawWebhookEventRow[]>();

  if (error) throw error;

  return (data ?? []).map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const dataObj = (payload.data as { object?: Record<string, unknown> } | undefined)
      ?.object ?? {};
    return {
      eventId: row.stripe_event_id,
      amountMinor:
        typeof dataObj.amount === "number" ? (dataObj.amount as number) : 0,
      currency:
        typeof dataObj.currency === "string"
          ? (dataObj.currency as string).toUpperCase()
          : "GBP",
      status:
        typeof dataObj.status === "string" ? (dataObj.status as string) : "unknown",
      createdAt: row.created_at,
    };
  });
}
