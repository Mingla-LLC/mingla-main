// META-ORCH-0827 Pass 2 — web stub. mingla-business web buyers use Stripe
// Checkout Sessions via ticket-checkout-create with `surface: "web"`
// (ORCH-0790). The PaymentSheet web stub is never exercised on the happy
// path — but if a caller invokes it anyway, return a typed error so
// downstream code can branch safely on `code === "Failed"`.

import type {
  PaymentSheetResult,
  StripePaymentSheetController,
} from "@mingla/payments-native";

const unsupported = async (): Promise<PaymentSheetResult> => ({
  error: {
    code: "Failed",
    message: "Stripe PaymentSheet is not available on web.",
  },
});

export const useStripePaymentSheet = (): StripePaymentSheetController => ({
  isPaymentSheetSupported: false,
  initPaymentSheet: unsupported,
  presentPaymentSheet: unsupported,
});
