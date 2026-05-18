/**
 * ORCH-0873 [Tr3 Installment Payments Stage 2 UI] — service layer for
 * order_installments ledger reads + manual retry RPC.
 *
 * Reads are RLS-gated by ORCH-0869 [Tr3 Installment Payments] backend Stages
 * 1 + 1b policies:
 *   - order_installments_read_brand_member (SELECT) — brand members see all
 *     installments for orders on their events.
 *   - order_installments_read_buyer (SELECT) — signed-in buyer sees own.
 *
 * biz_retry_installment(uuid) RPC defined in
 * supabase/migrations/20260610000000_tr3_installments.sql.
 *
 * Per SPEC_ORCH-0873 §3.3.1.
 */

import { supabase } from "./supabase";

export type OrderInstallmentStatus =
  | "scheduled"
  | "collected"
  | "failed"
  | "refunded"
  | "cancelled";

export interface OrderInstallment {
  id: string;
  orderId: string;
  ordinal: number;
  amountCents: number;
  currency: string;
  /** ISO 8601 UTC */
  dueAt: string;
  status: OrderInstallmentStatus;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  collectedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  nextRetryAt: string | null;
}

export interface OrderInstallmentForBrand extends OrderInstallment {
  buyerName: string | null;
  buyerEmail: string | null;
  orderTotalCents: number;
  orderAtRisk: boolean;
  orderAtRiskSince: string | null;
}

// Raw DB row shape (snake_case).
interface OrderInstallmentRow {
  id: string;
  order_id: string;
  ordinal: number;
  amount_cents: number;
  currency: string;
  due_at: string;
  status: OrderInstallmentStatus;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  collected_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  retry_count: number;
  next_retry_at: string | null;
}

interface OrderInstallmentBrandRow extends OrderInstallmentRow {
  orders: {
    buyer_name: string | null;
    buyer_email: string | null;
    total_cents: number;
    at_risk: boolean;
    at_risk_since: string | null;
    event_id: string;
  };
}

function mapRow(row: OrderInstallmentRow): OrderInstallment {
  return {
    id: row.id,
    orderId: row.order_id,
    ordinal: row.ordinal,
    amountCents: row.amount_cents,
    currency: row.currency,
    dueAt: row.due_at,
    status: row.status,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeChargeId: row.stripe_charge_id,
    collectedAt: row.collected_at,
    failedAt: row.failed_at,
    failureReason: row.failure_reason,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at,
  };
}

function mapBrandRow(row: OrderInstallmentBrandRow): OrderInstallmentForBrand {
  return {
    ...mapRow(row),
    buyerName: row.orders.buyer_name,
    buyerEmail: row.orders.buyer_email,
    orderTotalCents: row.orders.total_cents,
    orderAtRisk: row.orders.at_risk,
    orderAtRiskSince: row.orders.at_risk_since,
  };
}

/**
 * Fetch installments for a single order. Service-throws on transport/RLS
 * errors per Mingla services contract.
 */
export async function fetchInstallmentsForOrder(
  orderId: string,
): Promise<OrderInstallment[]> {
  const { data, error } = await supabase
    .from("order_installments")
    .select(
      `
      id,
      order_id,
      ordinal,
      amount_cents,
      currency,
      due_at,
      status,
      stripe_payment_intent_id,
      stripe_charge_id,
      collected_at,
      failed_at,
      failure_reason,
      retry_count,
      next_retry_at
    `,
    )
    .eq("order_id", orderId)
    .order("ordinal", { ascending: true });

  if (error !== null) {
    throw new Error(`fetchInstallmentsForOrder failed: ${error.message}`);
  }
  return (data ?? []).map((r) => mapRow(r as OrderInstallmentRow));
}

/**
 * Fetch installments for all orders in a brand's trips. Joins orders for
 * traveler-name + at-risk fields. Brand-member RLS policy filters to only
 * the brand's events.
 *
 * @param brandId — used to scope via events.brand_id (RLS does the actual
 *   filter; passing brandId is informational only for query keys).
 * @param opts.atRiskOnly — when true, filters server-side to orders where
 *   at_risk = true.
 * @param opts.tripEventId — when set, restricts to a single trip event.
 */
export async function fetchInstallmentsForBrandTrips(
  brandId: string,
  opts?: { atRiskOnly?: boolean; tripEventId?: string },
): Promise<OrderInstallmentForBrand[]> {
  void brandId; // RLS does the filter; brandId only scopes the query key
  let query = supabase
    .from("order_installments")
    .select(
      `
      id,
      order_id,
      ordinal,
      amount_cents,
      currency,
      due_at,
      status,
      stripe_payment_intent_id,
      stripe_charge_id,
      collected_at,
      failed_at,
      failure_reason,
      retry_count,
      next_retry_at,
      orders!inner (
        buyer_name,
        buyer_email,
        total_cents,
        at_risk,
        at_risk_since,
        event_id
      )
    `,
    )
    .order("due_at", { ascending: true });

  if (opts?.tripEventId !== undefined && opts.tripEventId.length > 0) {
    query = query.eq("orders.event_id", opts.tripEventId);
  }
  if (opts?.atRiskOnly === true) {
    query = query.eq("orders.at_risk", true);
  }

  const { data, error } = await query;
  if (error !== null) {
    throw new Error(`fetchInstallmentsForBrandTrips failed: ${error.message}`);
  }
  return (data ?? []).map((r) => mapBrandRow(r as unknown as OrderInstallmentBrandRow));
}

export type RetryInstallmentResult =
  | { ok: true; installmentId: string; scheduledForImmediateRetry: true }
  | { ok: false; reason: string; currentStatus?: string };

/**
 * Manual retry of a failed installment. Calls biz_retry_installment RPC.
 * Throws on transport/network/unknown error. Returns {ok: false, reason}
 * for business-logic rejections per the RPC's jsonb return shape.
 */
export async function retryInstallment(
  installmentId: string,
): Promise<RetryInstallmentResult> {
  const { data, error } = await supabase.rpc("biz_retry_installment", {
    p_installment_id: installmentId,
  });

  if (error !== null) {
    throw new Error(`retryInstallment RPC failed: ${error.message}`);
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  const ok = payload.ok === true;
  if (ok) {
    return {
      ok: true,
      installmentId: String(payload.installment_id ?? installmentId),
      scheduledForImmediateRetry: true,
    };
  }
  return {
    ok: false,
    reason: typeof payload.reason === "string" ? payload.reason : "unknown",
    currentStatus: typeof payload.current_status === "string"
      ? payload.current_status
      : undefined,
  };
}
