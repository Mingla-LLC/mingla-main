/**
 * issue #4522 (rework F7) — reading a refund computation's payment entries.
 *
 * biz_compute_refund_for_cancel reports the deposit kept by "Deposit is
 * non-refundable" under its own top-level key, `deposit_non_refundable_cents`.
 * An earlier build appended it as a stray element of `per_payment_refund`
 * (`{ deposit_non_refundable_cents }`, no refund fields). Readers accept both:
 * only entries carrying numeric money fields are payments, and the kept
 * deposit comes from the top-level key, else from a stray element.
 */

export interface RefundPaymentEntry {
  installment_id: string | null;
  ordinal: number;
  source_pi: string | null;
  paid_cents: number;
  refund_cents: number;
  currency: string;
  note?: string;
}

const isMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** The payment entries of a computation; anything else is ignored. */
export function paymentRefundEntries(list: unknown): RefundPaymentEntry[] {
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is RefundPaymentEntry =>
    typeof entry === "object" && entry !== null &&
    isMoney((entry as Record<string, unknown>).refund_cents) &&
    isMoney((entry as Record<string, unknown>).paid_cents)
  );
}

/** The deposit a traveler's cancel keeps (0 when none). */
export function depositKeptCents(
  result: { deposit_non_refundable_cents?: unknown; per_payment_refund?: unknown },
): number {
  if (isMoney(result.deposit_non_refundable_cents)) {
    return Math.max(0, result.deposit_non_refundable_cents);
  }
  if (!Array.isArray(result.per_payment_refund)) return 0;
  let kept = 0;
  for (const entry of result.per_payment_refund) {
    const value = typeof entry === "object" && entry !== null
      ? (entry as Record<string, unknown>).deposit_non_refundable_cents
      : undefined;
    if (isMoney(value)) kept += Math.max(0, value);
  }
  return kept;
}

/** issue #4522 (N2) — the overpayment a cancel returns in full on top (0 when none). */
export function overpaymentReturnCents(result: { overpayment_return_cents?: unknown }): number {
  return isMoney(result.overpayment_return_cents) ? Math.max(0, result.overpayment_return_cents) : 0;
}

interface RefundComputeClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

/**
 * issue #4522 (D-9, rework F6) — the refund a cancel will compute, for the
 * actor who cancels: with the #4522 schema, issue_4522_compute_refund_for_cancel_as
 * (so a host's preview refunds a non-refundable deposit exactly as begin
 * will); before the #4522 migrations are applied, the pre-#4522
 * biz_compute_refund_for_cancel, called exactly as it always was.
 */
export function computeRefundForActor(
  client: RefundComputeClient,
  planV2: boolean,
  input: { orderId: string; cancelAt: string; actorKind: string },
): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> {
  return planV2
    ? client.rpc("issue_4522_compute_refund_for_cancel_as", {
      p_order_id: input.orderId,
      p_cancel_at: input.cancelAt,
      p_actor_kind: input.actorKind,
    })
    : client.rpc("biz_compute_refund_for_cancel", {
      p_order_id: input.orderId,
      p_cancel_at: input.cancelAt,
    });
}
