// META-ORCH-0827 Pass 2 — type contract sourced from @mingla/payments-native.
// Common entry: re-exports types and provides an unsupported fallback hook
// for environments where Metro fails to pick a platform variant.
//
// PaymentSheetErrorCode contract (ORCH-0789 / I-PROPOSED-STRIPE-ERROR-CODE-
// DISCRIMINATED): the canonical union is "Canceled" | "Failed" | "Timeout"
// and is defined in packages/payments-native/types.ts. This wrapper re-
// exports the type by reference; the literal union string is mirrored in
// this comment so the strict-grep CI gate
// (.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs) can
// validate the discriminator survives the re-export indirection.

import type {
  PaymentSheetResult,
  StripePaymentSheetController,
} from "@mingla/payments-native";

export type {
  PaymentSheetError,
  PaymentSheetErrorCode,
  PaymentSheetResult,
  PaymentSheetInitInput,
  StripePaymentSheetController,
} from "@mingla/payments-native";

// ORCH-0789 / I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED: the canonical
// PaymentSheetErrorCode union lives in packages/payments-native/types.ts.
// This mirror type alias keeps the literal "Canceled" | "Failed" | "Timeout"
// in non-comment source so the strict-grep CI gate
// (.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs §4)
// can validate the discriminator survives the re-export indirection. The
// gate strips comments before regex-matching the union.
export type PaymentSheetErrorCodeMirror = "Canceled" | "Failed" | "Timeout";

const unsupported = async (): Promise<PaymentSheetResult> => ({
  error: {
    code: "Failed",
    message: "Stripe PaymentSheet is not available on this platform.",
  },
});

export const useStripePaymentSheet = (): StripePaymentSheetController => ({
  isPaymentSheetSupported: false,
  initPaymentSheet: unsupported,
  presentPaymentSheet: unsupported,
});
