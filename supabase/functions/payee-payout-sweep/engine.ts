export const PAYSTACK_TRANSFER_MIN_KOBO = 5_000;

export interface PayeePayoutWork {
  payout_id: string;
  payee_user_id: string;
  rail: "stripe" | "paystack";
  currency: string;
  amount_minor: number;
  account_ref: string;
  attempt: number;
  provider_ref: string | null;
  transfer_group: string;
  source_charge_id: string | null;
}

export function payeePayoutIdempotencyKey(
  payoutId: string,
  attempt: number,
): string {
  return `payee_share:${payoutId}:${attempt}`;
}

export function paystackPayeeReference(
  payoutId: string,
  attempt: number,
): string {
  return `mpay_${payoutId}_a${attempt}`;
}

export function paystackReferenceMatchesWork(
  work: PayeePayoutWork,
  reference: string,
): boolean {
  return reference === paystackPayeeReference(work.payout_id, work.attempt);
}

export function stripeTransferPayload(work: PayeePayoutWork) {
  const payload: Record<string, unknown> = {
    amount: work.amount_minor,
    currency: work.currency.toLowerCase(),
    destination: work.account_ref,
    transfer_group: work.transfer_group,
    metadata: {
      mingla_payee_payout_id: work.payout_id,
      mingla_payee_user_id: work.payee_user_id,
      mingla_issue: "3872",
    },
  };
  if (work.source_charge_id) {
    payload.source_transaction = work.source_charge_id;
  }
  return payload;
}

export function isDefinitiveProviderFailure(error: unknown): boolean {
  const value = error as { status?: number; type?: string; code?: string };
  if (typeof value?.status === "number") {
    return value.status >= 400 && value.status < 500 && value.status !== 409;
  }
  return value?.type === "StripeInvalidRequestError" ||
    value?.type === "StripePermissionError" ||
    value?.code === "account_invalid" || value?.code === "destination_invalid";
}

export function providerFailureCode(error: unknown): string {
  const value = error as { code?: unknown; type?: unknown; status?: unknown };
  const code = typeof value?.code === "string"
    ? value.code
    : typeof value?.type === "string"
    ? value.type
    : typeof value?.status === "number"
    ? `http_${value.status}`
    : "provider_error";
  return code.slice(0, 120);
}

export function paystackTransferState(value: Record<string, unknown>):
  | "paid"
  | "in_transit"
  | "failed" {
  const status = String(value.status ?? "").toLowerCase();
  if (status === "success" || status === "successful") return "paid";
  if (status === "failed" || status === "reversed") return "failed";
  return "in_transit";
}
