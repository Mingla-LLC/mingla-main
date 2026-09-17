import type { SourceRefundSummary } from "../types/venueReservation";
import { supabase } from "./supabase";

function map(row: Record<string, unknown>): SourceRefundSummary {
  return {
    refundId: String(row.refund_id),
    sourceType: row.source_type as SourceRefundSummary["sourceType"],
    subjectId: String(row.subject_id),
    refundKind: String(row.refund_kind),
    buyerState: row.buyer_state as SourceRefundSummary["buyerState"],
    feeState: row.fee_state as SourceRefundSummary["feeState"],
    financialState: row.financial_state as SourceRefundSummary["financialState"],
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    requestedAt: String(row.requested_at),
    updatedAt: String(row.updated_at),
    processedAt: row.processed_at ? String(row.processed_at) : null,
    opsStatus: row.ops_status as SourceRefundSummary["opsStatus"],
    canRetry: row.can_retry === true,
  };
}

export async function listSourceRefundSummaries(input: {
  brandId: string;
  sourceType: SourceRefundSummary["sourceType"];
  subjectIds: string[];
}): Promise<SourceRefundSummary[]> {
  if (input.subjectIds.length === 0) return [];
  const { data, error } = await supabase.rpc("biz_list_source_refund_summaries", {
    p_brand_id: input.brandId,
    p_source_type: input.sourceType,
    p_subject_ids: input.subjectIds,
    p_limit: Math.min(100, input.subjectIds.length),
    p_cursor: null,
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(map);
}

export async function requestSourceRefundAction(input: {
  refundId: string;
  action: "retry" | "escalate";
  reason: string;
}): Promise<SourceRefundSummary> {
  const { data, error } = await supabase.functions.invoke(
    "source-refund-action",
    { body: input },
  );
  if (error) throw error;
  return map((data?.refund ?? {}) as Record<string, unknown>);
}

/**
 * #3391 — the host cancels a PAID venue booking and the guest is refunded in
 * full, Mingla's fee included. The edge action commits the cancel and the
 * refund obligation in one database transaction, then runs the #1221 refund
 * runner. A retry replays the same refund; it never refunds twice.
 *
 * Throws `VenueCancelRefundError` carrying the server's refusal code
 * (`payout_in_flight`, `already_refunded`, `seated_no_auto_refund`, ...).
 */
export class VenueCancelRefundError extends Error {
  readonly code: string | null;
  constructor(code: string | null) {
    super(code ?? "venue_cancel_refund_failed");
    this.name = "VenueCancelRefundError";
    this.code = code;
  }
}

async function edgeErrorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (
    context === null ||
    typeof context !== "object" ||
    typeof (context as { json?: unknown }).json !== "function"
  ) {
    return null;
  }
  try {
    const body = (await (context as { json: () => Promise<unknown> }).json()) as {
      error?: unknown;
    };
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

export async function cancelPaidVenueReservation(input: {
  reservationId: string;
  reason?: string | null;
}): Promise<{ refund: SourceRefundSummary; replayed: boolean }> {
  const { data, error } = await supabase.functions.invoke(
    "venue-reservation-cancel",
    {
      body: {
        reservationId: input.reservationId,
        actor: "venue",
        reason: input.reason ?? null,
      },
    },
  );
  if (error) throw new VenueCancelRefundError(await edgeErrorCode(error));
  const refund = (data as { refund?: unknown } | null)?.refund;
  if (refund === null || typeof refund !== "object") {
    throw new VenueCancelRefundError(null);
  }
  return {
    refund: map(refund as Record<string, unknown>),
    replayed: (data as { replayed?: unknown }).replayed === true,
  };
}

export async function requestRsvpContributionRefund(input: {
  eventId: string;
  contributionId: string;
  mode: "discretionary" | "cancellation";
  reason: string;
}): Promise<SourceRefundSummary> {
  const { data, error } = await supabase.functions.invoke(
    "rsvp-contribution-refund",
    {
      body: input,
      headers: { "idempotency-key": `${input.eventId}:${input.contributionId}:${input.mode}` },
    },
  );
  if (error) throw error;
  return map((data?.refund ?? {}) as Record<string, unknown>);
}
