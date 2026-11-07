// Issue #4271 follow-up — what a host-facing ticket refund does when the Stripe
// arm THROWS.
//
// Before this module, refund-order and admin-refund-order logged the throw and
// returned 502 while the refunds row stayed 'pending' forever. refund_preview and
// biz_refund_order count pending rows as already refunded, so the host could never
// refund that order again ("line_overrefund: requested=2 existing=2").
//
// The rule (money, so deliberately conservative):
//   * FAILED — Stripe provably never saw a refund for this row: refunds.create
//     was not reached in this request AND no #2097 attempt for the row was ever
//     permitted to call it. The decision is made atomically in SQL
//     (issue_4271_commit_refund_failed) under the same refunds row lock that
//     issue_2097_prepare_refund_attempt takes before it permits a call, and the
//     same transaction closes the row's open attempts. A 'failed' row can never
//     reach Stripe again: prepare / claim / record / finalize refuse it.
//   * UNKNOWN — anything else, including a refusal thrown BY refunds.create. The
//     row stays 'pending' exactly as before this change, for the existing
//     reconcile machinery (admin-reconcile-ticket-refund replays it under its
//     original Stripe key).

// deno-lint-ignore no-explicit-any
type RpcResult = { data?: any; error?: { message?: string } | null };
// Structural (like issue2097TicketRefundTruth.ts's RpcClient) so tests can pass a
// fake without initialising Supabase.
export type RefundAttemptReader = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

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
 * A cheap early answer before the atomic SQL commit, which re-checks under the
 * row lock. Fails closed: a lookup error answers true ("Stripe may have it").
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

/**
 * Settles a throw from the Stripe refund arm. Returns 'failed' only when the
 * atomic SQL commit (issue_4271_commit_refund_failed) reports it committed the
 * row failed; every other path, including any error, leaves the row pending and
 * returns 'unknown'.
 */
export async function settleStripeRefundThrow(input: {
  error: unknown;
  tracker: Pick<RefundCreateTracker, "invoked" | "returned">;
  loadPermittedNow: () => Promise<boolean>;
  /** Calls issue_4271_commit_refund_failed with p_provider_call_reached. */
  commitFailed: (providerCallReached: boolean) => PromiseLike<RpcResult>;
  logContext: string;
}): Promise<StripeRefundThrowOutcome> {
  const reason = input.error instanceof Error
    ? input.error.message
    : String(input.error);
  if (input.tracker.invoked || input.tracker.returned) {
    console.error(
      `[${input.logContext}] refunds.create was reached; the refund stays pending`,
      reason,
    );
    return "unknown";
  }
  if (await input.loadPermittedNow()) {
    console.error(
      `[${input.logContext}] an earlier attempt may have reached the provider; the refund stays pending`,
      reason,
    );
    return "unknown";
  }
  try {
    const { data, error } = await input.commitFailed(input.tracker.invoked);
    if (error) {
      console.error(
        `[${input.logContext}] failed-refund commit errored; the refund stays pending`,
        error.message,
      );
      return "unknown";
    }
    const outcome = data && typeof data === "object"
      ? (data as Record<string, unknown>).outcome
      : null;
    return outcome === "failed" ? "failed" : "unknown";
  } catch (commitError) {
    console.error(
      `[${input.logContext}] failed-refund commit threw; the refund stays pending`,
      commitError instanceof Error ? commitError.message : String(commitError),
    );
    return "unknown";
  }
}

/**
 * The Stripe idempotency key a ticket refund was first driven under, as recorded
 * by issue_4271_bind_refund_provider_key. Only the two host-facing prefixes are
 * accepted, and only for this refund id; anything else (an unbound legacy row, a
 * cancel or trip refund) is null so the caller refuses rather than guessing a
 * key, because a guessed key that differs from the original makes Stripe create
 * a second refund.
 */
export function boundRefundProviderKey(
  refundId: string,
  metadata: unknown,
): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const key = (metadata as Record<string, unknown>).provider_idempotency_key;
  if (typeof key !== "string") return null;
  return key === `ticket_refund:${refundId}` ||
      key === `admin_refund:${refundId}`
    ? key
    : null;
}
