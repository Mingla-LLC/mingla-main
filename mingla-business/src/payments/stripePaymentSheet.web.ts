import type {
  PaymentSheetResult,
  StripePaymentSheetController,
} from "./stripePaymentSheet";

const unsupported = async (): Promise<PaymentSheetResult> => ({
  error: { message: "Stripe PaymentSheet is not available on web." },
});

export const useStripePaymentSheet = (): StripePaymentSheetController => ({
  isPaymentSheetSupported: false,
  initPaymentSheet: unsupported,
  presentPaymentSheet: unsupported,
});
