import type {
  PaymentSheetResult,
  StripePaymentSheetController,
} from "./stripePaymentSheet";

// ORCH-0790: web buyers use Stripe Checkout Sessions (hosted page) via
// `ticket-checkout-create` with `surface: "web"`. The PaymentSheet web
// stub is therefore never exercised on the happy path — but if a caller
// invokes it anyway, return a typed error so downstream code can branch
// safely on `code === "Failed"`.
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
