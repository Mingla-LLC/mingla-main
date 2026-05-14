// ORCH-0789: pure Stripe PaymentSheet result normalizer.
//
// Extracted to @mingla/payments-native per META-ORCH-0827 Pass 2. Shared
// between mingla-business native and app-mobile native. Pure logic — no
// React Native runtime dependency — so unit-testable in isolation.

import type {
  PaymentSheetError,
  PaymentSheetErrorCode,
  PaymentSheetResult,
} from "./types";

const PAYMENT_SHEET_ERROR_CODES: readonly PaymentSheetErrorCode[] = [
  "Canceled",
  "Failed",
  "Timeout",
] as const;

export const isPaymentSheetErrorCode = (
  value: unknown,
): value is PaymentSheetErrorCode =>
  typeof value === "string" &&
  (PAYMENT_SHEET_ERROR_CODES as readonly string[]).includes(value);

export const normalizePaymentSheetResult = (
  raw: { error?: unknown },
): PaymentSheetResult => {
  if (!raw.error || typeof raw.error !== "object") return {};
  const e = raw.error as Record<string, unknown>;
  // Unknown Stripe codes default to "Failed" (conservative: caller shows a
  // real-error toast rather than silently swallowing).
  const code: PaymentSheetErrorCode = isPaymentSheetErrorCode(e.code)
    ? e.code
    : "Failed";
  const error: PaymentSheetError = {
    code,
    message: typeof e.message === "string" ? e.message : "Payment failed",
  };
  if (typeof e.localizedMessage === "string") {
    error.localizedMessage = e.localizedMessage;
  }
  if (typeof e.declineCode === "string") {
    error.declineCode = e.declineCode;
  }
  if (typeof e.stripeErrorCode === "string") {
    error.stripeErrorCode = e.stripeErrorCode;
  }
  return { error };
};
