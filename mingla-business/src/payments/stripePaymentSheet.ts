// META-ORCH-0827 Pass 2 — type contract sourced from @mingla/payments-native.
// Common entry: re-exports types and provides an unsupported fallback hook
// for environments where Metro fails to pick a platform variant.

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
