/**
 * Shared Paystack refund adapter for issue #1175.
 *
 * Paystack does not accept a caller supplied idempotency key for refunds. We
 * therefore reconcile by transaction + an immutable merchant_note before every
 * POST. That closes the lost-response retry window for both partial and full
 * refunds. A full-refund `transaction_reversed` response is also an accepted
 * replay, matching the empirically verified Paystack test-mode behaviour.
 *
 * API contract: https://paystack.com/docs/api/refund/
 */
import {
  PAYSTACK_BASE_URL,
  PaystackApiError,
  resolvePaystackSecretKey,
} from "./paystack.ts";

export interface PaystackRefundResult {
  id: string;
  amount: number;
  status: string;
  currency: string | null;
  integration: string | null;
  transaction: string | null;
  replayed: boolean;
}

export type PaystackRefundOutcomeStatus =
  | "accepted"
  | "processed"
  | "failed";

export type PaystackRefundCanonicalState =
  | "provider_pending"
  | "needs_attention"
  | "processed"
  | "failed_retryable"
  | "failed_terminal";

interface PaystackRefundOutcomeWriteResult {
  error: { message?: string } | null;
}

export const PAYSTACK_MIN_REFUND_SUBUNITS = 5_000;

interface RefundRecord {
  id?: string | number;
  amount?: number;
  status?: string;
  merchant_note?: string;
  currency?: string;
  integration?: unknown;
  transaction?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function refundRecord(value: unknown): RefundRecord {
  return asRecord(value) as RefundRecord;
}

function providerIdentity(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value);
    return normalized.length > 0 && normalized.length <= 128
      ? normalized
      : null;
  }
  const record = asRecord(value);
  for (const key of ["id", "reference", "transaction_reference"]) {
    if (typeof record[key] === "string" || typeof record[key] === "number") {
      const normalized = String(record[key]);
      if (normalized.length > 0 && normalized.length <= 128) return normalized;
    }
  }
  return null;
}

function resultFromRecord(
  row: RefundRecord,
  replayed: boolean,
): PaystackRefundResult {
  return {
    id: row.id === undefined ? "" : String(row.id),
    amount: Number(row.amount ?? NaN),
    status: typeof row.status === "string" ? row.status : "",
    currency: typeof row.currency === "string"
      ? row.currency.toUpperCase()
      : null,
    integration: providerIdentity(row.integration),
    transaction: providerIdentity(row.transaction),
    replayed,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return asRecord(await res.json());
  } catch {
    return {};
  }
}

async function findExistingRefund(params: {
  transaction: string;
  merchantNote: string;
  amountSubunits?: number;
}): Promise<PaystackRefundResult | null> {
  const secret = resolvePaystackSecretKey();
  const query = new URLSearchParams({
    transaction: params.transaction,
    perPage: "100",
  });
  const res = await fetch(`${PAYSTACK_BASE_URL}/refund?${query.toString()}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = await readJson(res);
  if (!res.ok || json.status !== true) {
    throw new PaystackApiError(
      `Paystack refund reconciliation failed (${res.status}): ${
        typeof json.message === "string" ? json.message : "unknown error"
      }`,
      res.status,
    );
  }
  const rows = Array.isArray(json.data) ? json.data.map(refundRecord) : [];
  const match = rows.find((row) =>
    row.merchant_note === params.merchantNote &&
    (params.amountSubunits === undefined ||
      Number(row.amount ?? NaN) === params.amountSubunits)
  );
  if (!match) return null;
  return resultFromRecord(match, true);
}

export async function createPaystackRefund(params: {
  transaction: string;
  merchantNote: string;
  amountSubunits?: number;
  currency?: string;
}): Promise<PaystackRefundResult> {
  if (
    params.amountSubunits !== undefined &&
    params.amountSubunits < PAYSTACK_MIN_REFUND_SUBUNITS
  ) {
    throw new PaystackApiError(
      "Paystack partial refunds must be at least NGN 50",
      422,
    );
  }
  const existing = await findExistingRefund(params);
  if (existing) return existing;

  const secret = resolvePaystackSecretKey();
  const res = await fetch(`${PAYSTACK_BASE_URL}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction: params.transaction,
      ...(params.amountSubunits === undefined
        ? {}
        : { amount: params.amountSubunits }),
      currency: params.currency ?? "NGN",
      merchant_note: params.merchantNote,
    }),
  });
  const json = await readJson(res);
  const message = typeof json.message === "string" ? json.message : "";
  const providerCode = typeof json.code === "string" ? json.code : "";
  const replaySignal = `${providerCode} ${message}`.toLowerCase();
  if (!res.ok || json.status !== true) {
    if (
      params.amountSubunits === undefined &&
      res.status === 400 &&
      (replaySignal.includes("transaction_reversed") ||
        replaySignal.includes("already reversed"))
    ) {
      return {
        id: `paystack:transaction_reversed:${params.transaction}`,
        amount: 0,
        status: "processed",
        currency: params.currency?.toUpperCase() ?? "NGN",
        integration: null,
        transaction: params.transaction,
        replayed: true,
      };
    }
    throw new PaystackApiError(
      `Paystack refund failed (${res.status}): ${message || "unknown error"}`,
      res.status,
    );
  }

  const row = refundRecord(json.data);
  const result = resultFromRecord(row, false);
  return {
    ...result,
    id: result.id || `paystack-refund:${params.merchantNote}`,
    amount: Number.isFinite(result.amount)
      ? result.amount
      : params.amountSubunits ?? 0,
    status: result.status || "pending",
    currency: result.currency ?? params.currency?.toUpperCase() ?? "NGN",
    transaction: result.transaction ?? params.transaction,
  };
}

export function paystackRefundOutcomeStatus(
  providerStatus: string | null,
): PaystackRefundOutcomeStatus {
  const normalized = (providerStatus ?? "").trim().toLowerCase();
  if (normalized === "processed") return "processed";
  if (normalized === "failed" || normalized === "canceled") return "failed";
  return "accepted";
}

export function paystackRefundCanonicalState(
  providerStatus: string | null,
): PaystackRefundCanonicalState {
  switch ((providerStatus ?? "").trim().toLowerCase()) {
    case "processed":
      return "processed";
    case "needs-attention":
    case "needs_attention":
      return "needs_attention";
    case "failed":
    case "canceled":
      return "failed_terminal";
    case "pending":
    case "processing":
    case "accepted":
      return "provider_pending";
    default:
      return "failed_retryable";
  }
}

export async function retryPaystackRefundWithCustomerDetails(params: {
  refundId: string;
  currency: string;
  accountNumber: string;
  bankId: string;
}): Promise<PaystackRefundResult> {
  if (params.currency !== "NGN") {
    throw new PaystackApiError("invalid_currency", 422);
  }
  if (!/^[0-9]{10}$/.test(params.accountNumber)) {
    throw new PaystackApiError("invalid_account_number", 422);
  }
  if (!/^[0-9]{1,10}$/.test(params.bankId)) {
    throw new PaystackApiError("invalid_bank_id", 422);
  }
  const secret = resolvePaystackSecretKey();
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/refund/retry_with_customer_details/${
      encodeURIComponent(params.refundId)
    }`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refund_account_details: {
          currency: "NGN",
          account_number: params.accountNumber,
          bank_id: params.bankId,
        },
      }),
    },
  );
  const json = await readJson(res);
  if (res.status !== 200 || json.status !== true) {
    throw new PaystackApiError(
      "Paystack attention recovery failed",
      res.status,
    );
  }
  const row = refundRecord(json.data);
  const result = resultFromRecord(row, true);
  if (
    result.id !== params.refundId ||
    !Number.isSafeInteger(result.amount) ||
    result.amount < 0 ||
    result.currency !== "NGN" ||
    !result.integration ||
    !result.transaction ||
    !["pending", "processing", "processed"].includes(
      result.status.trim().toLowerCase(),
    )
  ) {
    throw new PaystackApiError("Paystack attention recovery mismatch", 502);
  }
  return result;
}

export async function getPaystackRefund(
  refundId: string,
): Promise<PaystackRefundResult> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(refundId)) {
    throw new PaystackApiError("invalid_refund_id", 422);
  }
  const secret = resolvePaystackSecretKey();
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/refund/${encodeURIComponent(refundId)}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  const json = await readJson(res);
  if (!res.ok || json.status !== true) {
    throw new PaystackApiError("Paystack refund lookup failed", res.status);
  }
  const row = refundRecord(json.data);
  return resultFromRecord(row, true);
}

export async function persistPaystackRefundOutcome(
  writeOutcome: () => PromiseLike<PaystackRefundOutcomeWriteResult>,
  context: string,
): Promise<void> {
  const { error } = await writeOutcome();
  if (error) {
    throw new Error(
      `paystack_refund_outcome_persist_failed:${context}:${
        error.message ?? "unknown error"
      }`,
    );
  }
}

export function paystackRefundTransaction(
  primaryReference: string | null,
  chargeId: string | null,
): string | null {
  if (chargeId && chargeId.length > 0) return chargeId;
  if (primaryReference && primaryReference.length > 0) return primaryReference;
  return null;
}

export function isRetryablePaystackRefundError(error: unknown): boolean {
  if (!(error instanceof PaystackApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

export function isPaystackRefundBelowMinimumError(error: unknown): boolean {
  return error instanceof PaystackApiError && error.status === 422;
}
