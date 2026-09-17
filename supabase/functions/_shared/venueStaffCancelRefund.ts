// Issue #3391 — the host cancels a PAID venue booking and the guest is refunded.
//
// Seth's decisions (2026-09-15): the guest gets the full amount back, Mingla's
// fee included, automatically. This module is the edge half of that:
//
//   1. PREPARE (atomic, as the caller). `biz_venue_cancel_paid_reservation`
//      runs with the host's own JWT, so auth.uid() and the manager-plus rank
//      gate are the database's, not ours. It cancels the booking and commits the
//      exact refund obligation (row, three ledger legs, requested event) in one
//      transaction. A retry replays the same refund.
//   2. RUN (best effort). The #1221 runner executes the provider legs. The
//      refund is LEASED first so this action and the */5 source-refund-sweep
//      never run the same refund at once; the runner's Stripe calls carry the
//      attempt's idempotency key and Paystack reconciles before it creates, so
//      even a lost lease cannot refund twice. A runner failure never un-cancels
//      the booking: the refund is rescheduled and the sweep finishes it.
//   3. REPORT the durable state, never an optimistic "refunded".
//
// Kept out of index.ts so it runs under Deno tests with injected clients.

import {
  runSourceRefundOperation,
  type SourceRefundOperation,
  sourceRefundPostsEnabled,
} from "./sourceRefundControlPlane.ts";

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

type RpcResult = { data: unknown; error: { message?: string } | null };

/** Stable literals raised by biz_venue_cancel_paid_reservation → HTTP status. */
export const VENUE_STAFF_CANCEL_ERROR_STATUS: Readonly<Record<string, number>> =
  Object.freeze({
    not_authenticated: 401,
    not_authorized: 403,
    reservation_not_found: 404,
    not_a_paid_reservation: 409,
    already_refunded: 409,
    seated_no_auto_refund: 409,
    cancel_not_allowed: 409,
    payout_in_flight: 409,
    application_fee_unrecorded: 409,
    payment_reference_missing: 409,
  });

export function venueStaffCancelErrorCode(message: string): string | null {
  for (const code of Object.keys(VENUE_STAFF_CANCEL_ERROR_STATUS)) {
    if (message.includes(code)) return code;
  }
  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VenueStaffCancelDeps {
  /** Calls a Postgres function AS THE HOST (their JWT). */
  userRpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
  /** Service-role client: lease, runner, durable read-back. */
  service: ServiceClient;
  runOperation?: typeof runSourceRefundOperation;
  postsEnabled?: () => boolean;
  now?: () => Date;
  workerId?: string;
}

export type VenueStaffCancelRunner =
  | "ran"
  | "deferred"
  | "held_by_another_runner"
  | "settled"
  | "posts_disabled";

/** Mirrors public.issue_1221_source_refund_summary so every client reads one shape. */
export function sourceRefundSummaryFromRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const buyerState = String(row.buyer_state);
  return {
    refund_id: row.id,
    source_type: row.source_type,
    subject_id: row.subject_id,
    refund_kind: row.refund_kind,
    buyer_state: buyerState,
    fee_state: row.fee_state,
    financial_state: row.financial_state,
    amount_cents: Number(row.buyer_refund_requested_cents),
    currency: row.currency,
    requested_at: row.requested_at,
    updated_at: row.updated_at,
    processed_at: row.processed_at ?? null,
    ops_status: row.ops_status,
    attention_generation: Number(row.attention_generation ?? 0),
    can_retry: buyerState === "failed_retryable",
    public_message_code: buyerState === "processed"
      ? "refund_processed"
      : buyerState === "needs_attention"
      ? "refund_needs_attention"
      : buyerState === "failed_retryable" || buyerState === "failed_terminal"
      ? "refund_delayed"
      : "refund_processing",
  };
}

export async function handleVenueStaffCancel(
  input: { reservationId: string; reason?: string | null },
  deps: VenueStaffCancelDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const reservationId = input.reservationId.trim();
  if (!UUID_RE.test(reservationId)) {
    return { status: 400, body: { error: "reservation_id_required" } };
  }
  const reason = typeof input.reason === "string"
    ? input.reason.trim().slice(0, 480)
    : "";

  const prepared = await deps.userRpc("biz_venue_cancel_paid_reservation", {
    p_reservation_id: reservationId,
    p_reason: reason.length >= 3 ? reason : null,
  });
  if (prepared.error) {
    const code = venueStaffCancelErrorCode(prepared.error.message ?? "");
    if (code) {
      return {
        status: VENUE_STAFF_CANCEL_ERROR_STATUS[code],
        body: { error: code },
      };
    }
    console.error("venue_staff_cancel_prepare_failed", {
      reservation_id: reservationId,
    });
    return { status: 500, body: { error: "cancel_failed" } };
  }

  const durable = (prepared.data ?? {}) as {
    cancelled?: boolean;
    replayed?: boolean;
    refund?: Record<string, unknown> | null;
  };
  const refundId = typeof durable.refund?.refund_id === "string"
    ? durable.refund.refund_id
    : "";
  if (!refundId) {
    // The RPC raises rather than cancel without a refund; reaching here means
    // the contract drifted, and the host must not be told it worked.
    console.error("venue_staff_cancel_refund_missing", {
      reservation_id: reservationId,
    });
    return { status: 500, body: { error: "cancel_failed" } };
  }

  const now = deps.now ?? (() => new Date());
  const postsEnabled = deps.postsEnabled ?? sourceRefundPostsEnabled;
  const runOperation = deps.runOperation ?? runSourceRefundOperation;
  const workerId = deps.workerId ??
    `venue-staff-cancel:${crypto.randomUUID()}`;

  let runner: VenueStaffCancelRunner = "posts_disabled";
  if (postsEnabled()) {
    const claim = await deps.service.rpc(
      "issue_3391_claim_source_refund_operation",
      {
        p_refund_id: refundId,
        p_worker_id: workerId,
        p_now: now().toISOString(),
      },
    );
    const operation = Array.isArray(claim.data)
      ? claim.data[0] as SourceRefundOperation | undefined
      : undefined;
    if (claim.error) {
      runner = "deferred";
    } else if (!operation) {
      runner = "held_by_another_runner";
    } else {
      try {
        await runOperation(deps.service, operation);
        runner = "ran";
      } catch (caught) {
        const code = caught instanceof Error
          ? caught.message.split(":")[0]
          : "runner_failed";
        console.warn("venue_staff_cancel_runner_deferred", {
          refund_id: refundId,
          error_code: code,
        });
        // Same hand-off the sweep uses: release the lease and back off.
        await deps.service.rpc("schedule_source_refund_retry", {
          p_refund_id: refundId,
          p_safe_reason_code: /^[a-z0-9_]{3,80}$/.test(code)
            ? code
            : "runner_failed",
          p_now: now().toISOString(),
        });
        runner = "deferred";
      }
    }
  }

  const { data: current } = await deps.service.from("source_refunds")
    .select("*").eq("id", refundId).maybeSingle();
  const refund = current
    ? sourceRefundSummaryFromRow(current as Record<string, unknown>)
    : durable.refund;
  if (
    runner === "held_by_another_runner" &&
    (current as { financial_state?: string } | null)?.financial_state ===
      "reconciled"
  ) {
    runner = "settled";
  }
  const buyerState = String(
    (refund as { buyer_state?: unknown } | null)?.buyer_state ?? "queued",
  );
  return {
    status: buyerState === "processed" ? 200 : 202,
    body: {
      status: "cancelled",
      cancelled: durable.cancelled !== false,
      replayed: durable.replayed === true,
      refundEligible: true,
      refund,
      runner,
    },
  };
}
