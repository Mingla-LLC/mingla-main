// Issue #4271 follow-up — what a host-facing ticket refund does when the Stripe
// arm THROWS.
//
// Before this module, refund-order and admin-refund-order logged the throw and
// returned 502 while the refunds row stayed 'pending' forever. refund_preview and
// biz_refund_order count pending rows as already refunded, so the host could never
// refund that order again ("line_overrefund: requested=2 existing=2").
//
// The rule (money, so deliberately conservative):
//   * FAILED — Stripe provably made no refund for this row. The row is committed
//     'failed' so the tickets can be refunded again under a fresh row.
//       a) refunds.create itself threw an error type that guarantees no side
//          effect (permission, authentication, card, invalid request that is not
//          an idempotency/lock conflict), AND no earlier request for this row had
//          been allowed to reach refunds.create; or
//       b) refunds.create was never called in this request AND no attempt for
//          this row has ever been allowed to call it (ticket_refund_attempts.
//          provider_call_permitted_at is NULL on every attempt). Nothing could
//          have moved, whatever the error was (a failed read, a network error).
//   * UNKNOWN — anything else: refunds.create returned and a later step threw,
//     refunds.create threw a network / 5xx / rate-limit / idempotency error, or an
//     earlier request may already have reached Stripe. The row stays 'pending'
//     and is recoverable: a retry replays it with the same Stripe idempotency key
//     (`ticket_refund:${refundId}`), so Stripe returns the original result.
//
// https://docs.stripe.com/error-handling — idempotency, and which errors are safe.

// deno-lint-ignore no-explicit-any
type RpcResult = { data?: any; error?: { message?: string } | null };
// Structural (like issue2097TicketRefundTruth.ts's RpcClient) so tests can pass a
// fake without initialising Supabase.
export type RefundAttemptReader = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

/**
 * True only for Stripe errors that guarantee the request had no side effect.
 * Everything not listed (StripeAPIError, StripeConnectionError,
 * StripeRateLimitError, StripeIdempotencyError, an idempotency_key_in_use 409,
 * a lock_timeout, a plain Error) is NOT definitive.
 */
export function isDefinitiveStripeRefundError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const e = error as {
    type?: unknown;
    rawType?: unknown;
    code?: unknown;
    statusCode?: unknown;
  };
  const type = typeof e.type === "string" ? e.type : "";
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.statusCode === "number" ? e.statusCode : 0;
  if (status === 409 || status === 429 || status >= 500) return false;
  if (code.includes("idempotency") || code === "lock_timeout") return false;
  if (
    type === "StripePermissionError" ||
    type === "StripeAuthenticationError" ||
    type === "StripeCardError"
  ) {
    return true;
  }
  return type === "StripeInvalidRequestError";
}

/** Records whether this request called refunds.create and whether it returned. */
export interface RefundCreateTracker {
  invoked: boolean;
  returned: boolean;
  track<T>(create: () => Promise<T>): () => Promise<T>;
}

export function trackRefundCreate(): RefundCreateTracker {
  const tracker: RefundCreateTracker = {
    invoked: false,
    returned: false,
    track<T>(create: () => Promise<T>) {
      return async () => {
        tracker.invoked = true;
        const created = await create();
        tracker.returned = true;
        return created;
      };
    },
  };
  return tracker;
}

/**
 * Whether any attempt for this refund was ever allowed to call refunds.create.
 * Fails closed: a lookup error answers true (treat as "Stripe may have it").
 */
export async function refundEverPermittedProviderCall(
  supabase: RefundAttemptReader,
  refundId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("ticket_refund_attempts")
      .select("id")
      .eq("refund_id", refundId)
      .not("provider_call_permitted_at", "is", null)
      .limit(1);
    if (error || !Array.isArray(data)) return true;
    return data.length > 0;
  } catch {
    return true;
  }
}

export type StripeRefundThrowOutcome = "failed" | "unknown";

export function classifyStripeRefundThrow(input: {
  error: unknown;
  createInvoked: boolean;
  createReturned: boolean;
  /** An attempt for this row was permitted to call Stripe BEFORE this request. */
  permittedBeforeRequest: boolean;
  /** An attempt for this row is permitted to call Stripe now (after the throw). */
  permittedNow: boolean;
}): StripeRefundThrowOutcome {
  if (input.createReturned) return "unknown";
  if (input.createInvoked) {
    return isDefinitiveStripeRefundError(input.error) &&
        !input.permittedBeforeRequest
      ? "failed"
      : "unknown";
  }
  return input.permittedNow ? "unknown" : "failed";
}

/**
 * Classifies the throw and, when Stripe provably made no refund, commits the row
 * 'failed' through the caller's existing commit RPC. Returns what the row is now.
 * A commit error leaves the row pending, so the outcome reported is 'unknown'.
 */
export async function settleStripeRefundThrow(input: {
  error: unknown;
  tracker: Pick<RefundCreateTracker, "invoked" | "returned">;
  permittedBeforeRequest: boolean;
  loadPermittedNow: () => Promise<boolean>;
  commitFailed: () => PromiseLike<RpcResult>;
  logContext: string;
}): Promise<StripeRefundThrowOutcome> {
  const permittedNow = input.tracker.invoked
    ? true
    : await input.loadPermittedNow();
  const outcome = classifyStripeRefundThrow({
    error: input.error,
    createInvoked: input.tracker.invoked,
    createReturned: input.tracker.returned,
    permittedBeforeRequest: input.permittedBeforeRequest,
    permittedNow,
  });
  if (outcome === "unknown") return "unknown";
  try {
    const { error } = await input.commitFailed();
    if (error) {
      console.error(
        `[${input.logContext}] failed-refund commit errored; row stays pending`,
        error.message,
      );
      return "unknown";
    }
  } catch (commitError) {
    console.error(
      `[${input.logContext}] failed-refund commit threw; row stays pending`,
      commitError instanceof Error ? commitError.message : String(commitError),
    );
    return "unknown";
  }
  return "failed";
}

type ResumeRpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<RpcResult>;

/**
 * A host retrying a refund that is stuck 'pending' (Stripe outcome unknown) gets a
 * new client idempotency key, so biz_refund_order counts the stuck row and raises
 * line_overrefund / refund_pending_on_order. When the stuck row asks for exactly
 * the same lines and Stripe has not recorded a refund for it, replay it under its
 * ORIGINAL key, lines and reason: the RPC returns it as an idempotent replay and
 * the Stripe call reuses `ticket_refund:${refundId}`, so no second refund exists.
 * Returns null when nothing is resumable (the original error stands). The caller
 * MUST carry on with the returned idempotencyKey: it is the attempt fingerprint
 * and part of the Stripe request, which Stripe only replays when identical.
 */
export async function resumeStuckRefund(input: {
  errorMessage: string;
  orderId: string;
  lines: unknown[];
  serviceRpc: ResumeRpc;
  replay: (args: {
    p_order_id: string;
    p_lines: unknown;
    p_reason: string;
    p_idempotency_key: string;
  }) => PromiseLike<RpcResult>;
}): Promise<{ result: RpcResult; idempotencyKey: string } | null> {
  const message = input.errorMessage.toLowerCase();
  if (
    !message.includes("line_overrefund") &&
    !message.includes("refund_pending_on_order")
  ) {
    return null;
  }
  const { data, error } = await input.serviceRpc(
    "issue_4271_resumable_refund",
    { p_order_id: input.orderId, p_lines: input.lines },
  );
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (
    typeof row.idempotency_key !== "string" ||
    typeof row.reason !== "string" || !Array.isArray(row.lines)
  ) {
    return null;
  }
  const result = await input.replay({
    p_order_id: input.orderId,
    p_lines: row.lines,
    p_reason: row.reason,
    p_idempotency_key: row.idempotency_key,
  });
  return { result, idempotencyKey: row.idempotency_key };
}
