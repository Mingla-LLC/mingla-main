// Issue #4522 pass 10 (P10-2) — Refund operations: "Paystack shows it partly
// refunded already". Staff type the other refund's reference and its amount;
// the figure is never taken on trust. This reads Paystack's refund list for
// the charge (the same read the cancel's resume uses,
// listPaystackTransactionRefunds), finds that reference on it and passes the
// amount Paystack lists to the database, which refuses any other figure
// (issue_4522_resolve_trip_cancel_refund_elsewhere_by_ops). An unreadable
// list or an unknown reference records nothing. Never sends a refund.

export type ListedRefund = { id: string; amount: number; status: string; merchantNote: string };

export type OpsRefundedElsewhereInput = {
  attemptId: string;
  reference: string;
  reason: string;
  amountCents: number | null;
  currency: string | null;
  refundedElsewhereCents: number;
};

export type OpsRefundedElsewhereDeps = {
  /** The caller's verified user id, or null. */
  callerId: () => Promise<string | null>;
  /** The charge (transaction reference) of the trip cancel refund attempt, or null. */
  attemptCharge: (attemptId: string) => Promise<string | null>;
  /** Paystack's refunds of the charge; null when the list cannot be trusted. */
  listRefunds: (transaction: string) => Promise<ListedRefund[] | null>;
  /** The database's checked entry point. */
  resolve: (args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export type OpsResult = { status: number; body: Record<string, unknown> };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseOpsRefundedElsewhere(body: Record<string, unknown>): OpsRefundedElsewhereInput | null {
  const figure = body.refundedElsewhereCents;
  if (typeof figure !== "number" || !Number.isSafeInteger(figure) || figure <= 0) return null;
  const attemptId = text(body.attemptId);
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return null;
  return {
    attemptId,
    reference: text(body.reference).trim(),
    reason: text(body.reason).trim(),
    amountCents: typeof body.amountCents === "number" ? body.amountCents : null,
    currency: typeof body.currency === "string" ? body.currency : null,
    refundedElsewhereCents: figure,
  };
}

export async function handleOpsRefundedElsewhere(
  input: OpsRefundedElsewhereInput | null,
  deps: OpsRefundedElsewhereDeps,
): Promise<OpsResult> {
  const callerId = await deps.callerId();
  if (!callerId) return { status: 401, body: { error: "not_authenticated" } };
  if (input === null) {
    return { status: 400, body: { error: "refunded_elsewhere_required", message: "Enter the amount of that Paystack refund." } };
  }
  if (input.reference.length === 0 || input.reference.length > 200) {
    return { status: 400, body: { error: "provider_refund_reference_required", message: "Enter the reference of that other Paystack refund." } };
  }
  const transaction = await deps.attemptCharge(input.attemptId);
  if (!transaction) {
    return { status: 404, body: { error: "trip_cancel_refund_not_found", message: "This refund is no longer in the queue. Refresh the queue." } };
  }
  let rows: ListedRefund[] | null = null;
  try {
    rows = await deps.listRefunds(transaction);
  } catch (listErr) {
    console.error(JSON.stringify({
      event: "ops_refunded_elsewhere_list_failed",
      attempt_id: input.attemptId,
      reason: String((listErr as Error)?.message ?? listErr).slice(0, 200),
    }));
    rows = null;
  }
  if (rows === null) {
    return {
      status: 503,
      body: {
        error: "provider_refund_list_unreadable",
        message: "Paystack's refund list for this payment could not be read just now, so nothing was recorded. Try again in a few minutes.",
      },
    };
  }
  const wanted = input.reference.toLowerCase();
  const found = rows.find((row) => row.id.trim().toLowerCase() === wanted && row.status.toLowerCase() !== "failed");
  if (!found) {
    return {
      status: 422,
      body: {
        error: "provider_refund_reference_not_found",
        message: `Paystack shows no refund with reference ${input.reference} on this payment, so nothing was recorded. Check the reference in the Paystack dashboard.`,
      },
    };
  }
  if (!Number.isSafeInteger(found.amount) || found.amount !== input.refundedElsewhereCents) {
    return {
      status: 422,
      body: {
        error: "refunded_elsewhere_amount_mismatch",
        listed_cents: Number.isSafeInteger(found.amount) ? found.amount : null,
        message: "That amount is not what Paystack shows for this refund, so nothing was recorded. Enter the amount Paystack lists for it.",
      },
    };
  }
  const { data, error } = await deps.resolve({
    p_actor: callerId,
    p_attempt_id: input.attemptId,
    p_provider_refund_reference: input.reference,
    p_reason: input.reason,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_refunded_elsewhere_cents: input.refundedElsewhereCents,
    p_listed_refund_cents: found.amount,
  });
  if (error) {
    const code = String(error.code ?? "");
    const status = code === "42501" ? 403 : code === "PGRST202" || code === "42883" ? 409 : code === "PT409" ? 409 : 422;
    return { status, body: { error: String(error.message ?? "resolve_failed").slice(0, 200), code } };
  }
  return { status: 200, body: (data ?? {}) as Record<string, unknown> };
}
