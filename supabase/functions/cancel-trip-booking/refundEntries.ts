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
