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

import type { TripBalance } from "@mingla/offering-rendering/tripBalance";
import type { PlanV2ProbeClient } from "@mingla/offering-rendering/planV2Schema";

import { supabase } from "./supabase";

/**
 * issue #4522 deploy window — web apps deploy before the branch's migrations
 * are applied. Until the plan-v2 schema exists (no `order_installments.kind`,
 * no `biz_trip_event_balances`) every read here takes the pre-#4522 path.
 * Asked through the SAME probe the edge functions use (one owner); a client
 * may not call the service-role switch, so it asks the table question only.
 * A real failure (anything but "does not exist") still throws.
 */
async function planV2SchemaReady(): Promise<boolean> {
  // Kept off the shared service's eager graph: only plan-v2 reads ask.
  const probe = await import("@mingla/offering-rendering/planV2Schema");
  return probe.planV2SchemaAvailable(
    supabase as unknown as PlanV2ProbeClient,
    Date.now,
    { askSwitch: false },
  );
}

export type OrderInstallmentStatus =
  | "scheduled"
  | "collected"
  | "failed"
  | "refunded"
  | "cancelled"
  // issue #4522 — a plan-v2 row rebalanced away, rolled over, written off or
  // a closed flexible attempt (`kind` tells them apart).
  | "superseded";

/** issue #4522 — a set plan row, or a traveler's flexible payment. */
export type OrderInstallmentKind = "scheduled" | "flex";

export interface OrderInstallment {
  id: string;
  orderId: string;
  ordinal: number;
  amountCents: number;
  amountChargedCents: number;
  buyerTotalCents: number | null;
  refundedAmountCents: number;
  currency: string;
  /** ISO 8601 UTC */
  dueAt: string;
  status: OrderInstallmentStatus;
  provider: "stripe" | "paystack";
  collectionMethod: "auto_card" | "pay_link";
  buyerAction: "none" | "pay_link_sent" | "approval_required";
  buyerActionAt: string | null;
  paymentReference: string | null;
  /** @deprecated Use paymentReference. */
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  collectedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  /** issue #4522 — null when the read did not ask for it (plan v2 off). */
  kind: OrderInstallmentKind | null;
}

export interface OrderInstallmentForBrand extends OrderInstallment {
  buyerName: string | null;
  buyerEmail: string | null;
  orderTotalCents: number;
  orderAtRisk: boolean;
  orderAtRiskSince: string | null;
  paymentCardLast4: string | null;
}

// Raw DB row shape (snake_case).
interface OrderInstallmentRow {
  id: string;
  order_id: string;
  ordinal: number;
  amount_cents: number;
  buyer_total_cents: number | null;
  refunded_amount_cents: number;
  currency: string;
  due_at: string;
  status: OrderInstallmentStatus;
  provider: "stripe" | "paystack";
  collection_method: "auto_card" | "pay_link";
  buyer_action: "none" | "pay_link_sent" | "approval_required";
  buyer_action_at: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  collected_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  retry_count: number;
  next_retry_at: string | null;
  kind?: string | null;
}

interface OrderInstallmentBrandRow extends OrderInstallmentRow {
  orders: {
    buyer_name: string | null;
    buyer_email: string | null;
    total_cents: number;
    at_risk: boolean;
    at_risk_since: string | null;
    event_id: string;
    payment_card_last4: string | null;
  };
}

function mapRow(row: OrderInstallmentRow): OrderInstallment {
  return {
    id: row.id,
    orderId: row.order_id,
    ordinal: row.ordinal,
    amountCents: row.amount_cents,
    amountChargedCents: row.buyer_total_cents ?? row.amount_cents,
    buyerTotalCents: row.buyer_total_cents,
    refundedAmountCents: row.refunded_amount_cents,
    currency: row.currency,
    dueAt: row.due_at,
    status: row.status,
    provider: row.provider,
    collectionMethod: row.collection_method,
    buyerAction: row.buyer_action,
    buyerActionAt: row.buyer_action_at,
    paymentReference: row.stripe_payment_intent_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeChargeId: row.stripe_charge_id,
    collectedAt: row.collected_at,
    failedAt: row.failed_at,
    failureReason: row.failure_reason,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at,
    kind: row.kind === "flex" || row.kind === "scheduled" ? row.kind : null,
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
    paymentCardLast4: row.orders.payment_card_last4,
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
      buyer_total_cents,
      refunded_amount_cents,
      currency,
      due_at,
      status,
      provider,
      collection_method,
      buyer_action,
      buyer_action_at,
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
  opts?: { atRiskOnly?: boolean; tripEventId?: string; planV2?: boolean },
): Promise<OrderInstallmentForBrand[]> {
  void brandId; // RLS does the filter; brandId only scopes the query key
  // issue #4522 — `kind` only once the plan-v2 schema exists (deploy window).
  const withKind = opts?.planV2 === true && (await planV2SchemaReady());
  let query = supabase
    .from("order_installments")
    .select(
      `
      id,
      order_id,
      ordinal,
      amount_cents,
      buyer_total_cents,
      refunded_amount_cents,
      currency,
      due_at,
      status,
      provider,
      collection_method,
      buyer_action,
      buyer_action_at,
      stripe_payment_intent_id,
      stripe_charge_id,
      collected_at,
      failed_at,
      failure_reason,
      retry_count,
      next_retry_at,${withKind ? "\n      kind," : ""}
      orders!inner (
        buyer_name,
        buyer_email,
        total_cents,
        at_risk,
        at_risk_since,
        event_id,
        payment_card_last4
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

/** issue #4522 — the frozen plan terms an order was booked on (orders.payment_plan_terms). */
export interface TripPlanTerms {
  depositMinor: number | null;
  countGiven: number | null;
  finalDueAt: string | null;
  tripStartAt: string | null;
  flexEnabled: boolean;
}

/** issue #4522 — one order_balance_events row (why the open rows changed). */
export interface TripBalanceEvent {
  reason: string;
  triggerInstallmentId: string | null;
  createdAt: string;
}

/**
 * issue #4522 S-2 — the server's balance truth for one plan-v2 order, as the
 * host money screen reads it (biz_trip_event_balances → issue_4522_balance).
 */
export interface HostTripBalance {
  orderId: string;
  currency: string;
  depositMinor: number;
  paidMinor: number;
  remainingMinor: number;
  totalMinor: number;
  paymentInFlight: boolean;
  nextPayment: { dueAt: string; amountMinor: number; status?: string } | null;
  openRowIds: string[];
  heldCreditMinor: number;
  overpaymentRefundedMinor: number;
  waivedMinor: number;
  terms: TripPlanTerms;
  balanceEvents: TripBalanceEvent[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const safeInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const isoText = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

function decodeTerms(value: unknown): TripPlanTerms {
  const terms = isObject(value) ? value : {};
  return {
    depositMinor: safeInt(terms.deposit_minor),
    countGiven: safeInt(terms.count_given),
    finalDueAt: isoText(terms.final_due_at),
    tripStartAt: isoText(terms.trip_start_at),
    flexEnabled: terms.flex_enabled === true,
  };
}

/**
 * Fails closed: a balance the shared decoder refuses throws, so the screen
 * shows its error state instead of guessing at money.
 */
export function decodeHostTripBalance(
  value: unknown,
  decodeTripBalance: (raw: unknown) => TripBalance | null,
): HostTripBalance {
  const base = decodeTripBalance(value);
  if (base === null || !isObject(value)) {
    throw new Error("trip_balance_invalid");
  }
  const waived = value.waivedMinor === undefined || value.waivedMinor === null
    ? 0
    : safeInt(value.waivedMinor);
  if (waived === null || waived < 0) throw new Error("trip_balance_invalid");
  const rawEvents = Array.isArray(value.balanceEvents) ? value.balanceEvents : [];
  const balanceEvents: TripBalanceEvent[] = [];
  for (const event of rawEvents) {
    if (!isObject(event) || typeof event.reason !== "string") {
      throw new Error("trip_balance_invalid");
    }
    const createdAt = isoText(event.createdAt);
    if (createdAt === null) throw new Error("trip_balance_invalid");
    balanceEvents.push({
      reason: event.reason,
      triggerInstallmentId:
        typeof event.triggerInstallmentId === "string" ? event.triggerInstallmentId : null,
      createdAt,
    });
  }
  return {
    orderId: base.orderId,
    currency: base.currency,
    depositMinor: base.depositMinor,
    paidMinor: base.paidMinor,
    remainingMinor: base.remainingMinor,
    totalMinor: base.totalMinor,
    paymentInFlight: base.paymentInFlight,
    nextPayment: base.nextPayment,
    openRowIds: base.openRows.map((row) => row.installmentId),
    heldCreditMinor: base.heldCreditMinor,
    overpaymentRefundedMinor: base.overpaymentRefundedMinor,
    waivedMinor: waived,
    terms: decodeTerms(value.terms),
    balanceEvents,
  };
}

/**
 * issue #4522 S-2 — every plan-v2 order's balance on one trip (brand members
 * only; the RPC answers balance_not_found to anyone else). Older plans are
 * not returned and keep the ledger view exactly as before.
 */
export async function fetchTripEventBalances(
  eventId: string,
): Promise<HostTripBalance[]> {
  // issue #4522 deploy window — no plan-v2 schema: no v2 balances, so every
  // order keeps the pre-#4522 ledger view.
  if (!(await planV2SchemaReady())) return [];
  const { data, error } = await supabase.rpc("biz_trip_event_balances", {
    p_event_id: eventId,
  });
  if (error !== null) {
    // The columns are in but this function is not (migrations applied in
    // part): same pre-#4522 view. Any other failure surfaces.
    const { isMissingSchemaError } = await import("@mingla/offering-rendering/planV2Schema");
    if (isMissingSchemaError(error)) return [];
    throw new Error(`fetchTripEventBalances failed: ${error.message}`);
  }
  if (!Array.isArray(data)) throw new Error("trip_balance_invalid");
  // Kept off the shared service's eager graph: only the money route asks.
  const { decodeTripBalance } = await import("@mingla/offering-rendering/tripBalance");
  return data.map((row: unknown) => decodeHostTripBalance(row, decodeTripBalance));
}
