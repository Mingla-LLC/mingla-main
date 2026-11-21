/**
 * issue #4522 — the Stripe idempotency key for one charge of a planned
 * instalment row.
 *
 * Version 0 (a row whose amount never changed) keeps today's key byte for
 * byte: `installment:<order>:<ordinal>:<retry>`. A row whose amount a
 * rebalance changed carries `:v<schedule_version>`, so a new amount never
 * reuses a key Stripe already bound to the old one (I-4522-5).
 */
export function installmentIdempotencyKey(input: {
  orderId: string;
  ordinal: number;
  retryCount: number;
  scheduleVersion?: number | null;
}): string {
  return `installment:${input.orderId}:${input.ordinal}:${input.retryCount}` +
    installmentKeyVersionSuffix(input.scheduleVersion);
}

/** `""` for version 0 (today's key unchanged), `:v<n>` once rebalanced. */
export function installmentKeyVersionSuffix(
  scheduleVersion: number | null | undefined,
): string {
  const version = scheduleVersion ?? 0;
  return Number.isInteger(version) && version > 0 ? `:v${version}` : "";
}

/** issue #4522 — a flexible payment's key: one per client key, ever. */
export function flexPaymentIdempotencyKey(
  orderId: string,
  clientKey: string,
): string {
  return `flex:${orderId}:${clientKey}`;
}
