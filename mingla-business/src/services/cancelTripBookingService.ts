/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — service layer for
 * trip-booking cancellation + cascading-tier refund.
 *
 * Mirrors ORCH-0787 [refund-order] orderRefundService pattern (edge fn invoke
 * via supabase.functions.invoke + Idempotency-Key header + FunctionsHttpError
 * error context extraction via duck-typing for RN polyfill safety).
 *
 * Auth modes:
 *   - 'preview' — read-only refund computation. JWT (operator) OR token (buyer).
 *   - 'buyer'   — commit with SHA256-validated token from confirmation email URL.
 *   - 'operator' — commit with JWT (brand member via biz_is_brand_member_for_read_for_caller).
 *
 * SC-22 freshness contract: commit calls pass expectedRefundTotalCents from the
 * preceding preview response; edge fn re-computes at _begin step and returns
 * HTTP 409 {error:'policy_updated', currentRefundTotalCents} if amount diverges.
 * Service surfaces this as a typed CancelTripBookingError with code='policy_updated'.
 */

import { supabase } from "./supabase";

export type CancelActorKind = "buyer" | "operator";

export interface PerPaymentRefund {
  installmentId: string | null;
  ordinal: number;
  sourcePi: string | null;
  paidCents: number;
  refundCents: number;
  currency: string;
  note?: string;
}

export interface RefundPreview {
  mode: "preview";
  orderId: string;
  eventId: string;
  quotedAt: string;
  tripStart: string;
  daysRemaining: number;
  tierPct: number;
  tierKind: "flexible" | "standard" | "strict" | "custom" | "none";
  paidTotalCents: number;
  refundTotalCents: number;
  currency: string;
  perPaymentRefund: PerPaymentRefund[];
  installmentsToCancel: number;
}

export interface CancelTripBookingResult {
  ok: true;
  mode: CancelActorKind;
  refundId: string;
  refundAmountCents: number;
  currency: string;
  tierPct: number;
  stripeRefundIds: string[];
  installmentsCancelled: number;
  processedAt: string;
}

export type CancelTripBookingErrorCode =
  | "order_not_found"
  | "not_a_trip"
  | "already_cancelled"
  | "no_trip_start_date"
  | "invalid_token"
  | "token_required"
  | "order_lookup_failed"
  | "unauthenticated"
  | "reason_invalid_length"
  | "policy_updated"
  | "expected_refund_total_cents_required"
  | "idempotency_key_required"
  | "missing_connected_account"
  | "stripe_refund_failed"
  | "ledger_insert_failed_after_stripe_success"
  | "commit_failed_after_stripe_success"
  | "no_order_line_items"
  | "begin_failed"
  | "compute_failed"
  | "network_error"
  | "internal_error";

export interface CancelTripBookingError extends Error {
  code: CancelTripBookingErrorCode;
  detail?: string;
  httpStatus?: number;
  /** Set when code='policy_updated' — the new amount the buyer/operator must accept. */
  currentRefundTotalCents?: number;
  /** Set when partial Stripe failure — number of refunds that succeeded before rollback. */
  partialSucceededRefunds?: number;
}

const makeError = (
  code: CancelTripBookingErrorCode,
  message: string,
  detail?: string,
  httpStatus?: number,
  extras?: { currentRefundTotalCents?: number; partialSucceededRefunds?: number },
): CancelTripBookingError => {
  const err = new Error(message) as CancelTripBookingError;
  err.code = code;
  if (detail !== undefined) err.detail = detail;
  if (httpStatus !== undefined) err.httpStatus = httpStatus;
  if (extras?.currentRefundTotalCents !== undefined) {
    err.currentRefundTotalCents = extras.currentRefundTotalCents;
  }
  if (extras?.partialSucceededRefunds !== undefined) {
    err.partialSucceededRefunds = extras.partialSucceededRefunds;
  }
  return err;
};

const userMessageFor = (code: string): string => {
  switch (code) {
    case "order_not_found":
      return "Reservation not found.";
    case "not_a_trip":
      return "Cancel this booking from the event dashboard, not the trip cancel flow.";
    case "already_cancelled":
      return "This reservation is already cancelled.";
    case "no_trip_start_date":
      return "This trip has no scheduled start date — contact the organizer.";
    case "invalid_token":
    case "token_required":
      return "This cancel link isn't valid or has been used.";
    case "unauthenticated":
      return "You're signed out. Please sign in and try again.";
    case "reason_invalid_length":
      return "Cancellation reason must be 10–200 characters.";
    case "policy_updated":
      return "The cancellation policy was updated. Refresh to see your new refund amount.";
    case "missing_connected_account":
      return "This brand isn't set up for refunds. Contact the organizer.";
    case "stripe_refund_failed":
      return "Couldn't process the refund. Try again or contact the organizer.";
    case "ledger_insert_failed_after_stripe_success":
    case "commit_failed_after_stripe_success":
      return "Refund was processed but we couldn't update our records. Refresh to confirm.";
    default:
      return "Couldn't cancel the reservation. Try again.";
  }
};

async function invokeCancelTripBooking(
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<unknown> {
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.functions.invoke("cancel-trip-booking", {
      body,
      headers,
    });
  } catch (err) {
    throw makeError(
      "network_error",
      "Couldn't reach the cancel service. Tap to try again.",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (response.error) {
    const ctx = (response.error as { context?: Response }).context;
    let payload: {
      error?: string;
      detail?: string;
      currentRefundTotalCents?: number;
      partialSucceededRefunds?: number;
    } | null = null;
    let httpStatus: number | undefined;
    if (ctx && typeof ctx.text === "function") {
      httpStatus = ctx.status;
      try {
        const text = await ctx.text();
        payload = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
    }
    const code = (payload?.error ?? "internal_error") as CancelTripBookingErrorCode;
    const detail = payload?.detail ?? (response.error as Error).message ?? "Cancel failed";
    throw makeError(code, userMessageFor(code), detail, httpStatus, {
      currentRefundTotalCents: payload?.currentRefundTotalCents,
      partialSucceededRefunds: payload?.partialSucceededRefunds,
    });
  }

  return response.data;
}

function unwrapPreview(raw: unknown): RefundPreview {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    mode: "preview",
    orderId: String(data.orderId ?? ""),
    eventId: String(data.eventId ?? ""),
    quotedAt: String(data.quotedAt ?? new Date().toISOString()),
    tripStart: String(data.tripStart ?? ""),
    daysRemaining: Number(data.daysRemaining ?? 0),
    tierPct: Number(data.tierPct ?? 0),
    tierKind: (data.tierKind as RefundPreview["tierKind"]) ?? "none",
    paidTotalCents: Number(data.paidTotalCents ?? 0),
    refundTotalCents: Number(data.refundTotalCents ?? 0),
    currency: String(data.currency ?? "GBP").toUpperCase(),
    perPaymentRefund: Array.isArray(data.perPaymentRefund)
      ? (data.perPaymentRefund as Array<Record<string, unknown>>).map((p) => ({
          installmentId:
            typeof p.installment_id === "string" ? p.installment_id : null,
          ordinal: Number(p.ordinal ?? 0),
          sourcePi: typeof p.source_pi === "string" ? p.source_pi : null,
          paidCents: Number(p.paid_cents ?? 0),
          refundCents: Number(p.refund_cents ?? 0),
          currency: String(p.currency ?? data.currency ?? "GBP").toUpperCase(),
          note: typeof p.note === "string" ? p.note : undefined,
        }))
      : [],
    installmentsToCancel: Number(data.installmentsToCancel ?? 0),
  };
}

function unwrapCommit(raw: unknown): CancelTripBookingResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    mode: (data.mode as CancelActorKind) ?? "operator",
    refundId: String(data.refundId ?? ""),
    refundAmountCents: Number(data.refundAmountCents ?? 0),
    currency: String(data.currency ?? "GBP").toUpperCase(),
    tierPct: Number(data.tierPct ?? 0),
    stripeRefundIds: Array.isArray(data.stripeRefundIds)
      ? (data.stripeRefundIds as string[])
      : [],
    installmentsCancelled: Number(data.installmentsCancelled ?? 0),
    processedAt: String(data.processedAt ?? new Date().toISOString()),
  };
}

// ---- Public API ----

/** Buyer preview — uses HMAC token from confirmation email URL. */
export async function previewBuyerCancel(
  orderId: string,
  token: string,
): Promise<RefundPreview> {
  return unwrapPreview(
    await invokeCancelTripBooking({ mode: "preview", orderId, token }),
  );
}

/** Operator preview — uses authenticated JWT (auto-attached by supabase-js). */
export async function previewOperatorCancel(orderId: string): Promise<RefundPreview> {
  return unwrapPreview(
    await invokeCancelTripBooking({ mode: "preview", orderId }),
  );
}

export interface BuyerCommitInput {
  orderId: string;
  token: string;
  expectedRefundTotalCents: number;
  idempotencyKey: string;
  reason?: string;
}

export interface OperatorCommitInput {
  orderId: string;
  reason: string; // required + 10-200 chars
  expectedRefundTotalCents: number;
  idempotencyKey: string;
}

export async function commitBuyerCancel(
  input: BuyerCommitInput,
): Promise<CancelTripBookingResult> {
  return unwrapCommit(
    await invokeCancelTripBooking(
      {
        mode: "buyer",
        orderId: input.orderId,
        token: input.token,
        expectedRefundTotalCents: input.expectedRefundTotalCents,
        reason: input.reason,
      },
      { "Idempotency-Key": input.idempotencyKey },
    ),
  );
}

export async function commitOperatorCancel(
  input: OperatorCommitInput,
): Promise<CancelTripBookingResult> {
  return unwrapCommit(
    await invokeCancelTripBooking(
      {
        mode: "operator",
        orderId: input.orderId,
        reason: input.reason,
        expectedRefundTotalCents: input.expectedRefundTotalCents,
      },
      { "Idempotency-Key": input.idempotencyKey },
    ),
  );
}
