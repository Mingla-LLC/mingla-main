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
  replayed: boolean;
}

interface RefundRecord {
  id?: string | number;
  amount?: number;
  status?: string;
  merchant_note?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function refundRecord(value: unknown): RefundRecord {
  return asRecord(value) as RefundRecord;
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
  return {
    id: String(match.id ?? `paystack-refund:${params.merchantNote}`),
    amount: Number(match.amount ?? params.amountSubunits ?? 0),
    status: String(match.status ?? "pending"),
    replayed: true,
  };
}

export async function createPaystackRefund(params: {
  transaction: string;
  merchantNote: string;
  amountSubunits?: number;
  currency?: string;
}): Promise<PaystackRefundResult> {
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
        replayed: true,
      };
    }
    throw new PaystackApiError(
      `Paystack refund failed (${res.status}): ${message || "unknown error"}`,
      res.status,
    );
  }

  const row = refundRecord(json.data);
  return {
    id: String(row.id ?? `paystack-refund:${params.merchantNote}`),
    amount: Number(row.amount ?? params.amountSubunits ?? 0),
    status: String(row.status ?? "pending"),
    replayed: false,
  };
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
