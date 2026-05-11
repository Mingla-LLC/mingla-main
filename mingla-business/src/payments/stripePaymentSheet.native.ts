import { useStripe } from "@stripe/stripe-react-native";
import type {
  PaymentSheetInitInput,
  PaymentSheetResult,
  StripePaymentSheetController,
} from "./stripePaymentSheet";
import { normalizePaymentSheetResult } from "./normalizePaymentSheetResult";

// ORCH-0789: preserve the Stripe RN PaymentSheetError discriminator so
// callers can distinguish user-cancel ("Canceled") from card-decline
// ("Failed") from "Timeout". The actual normalization is in
// normalizePaymentSheetResult.ts (kept RN-free so it can be unit-tested
// without the react-native runtime).
export const useStripePaymentSheet = (): StripePaymentSheetController => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  return {
    isPaymentSheetSupported: true,
    initPaymentSheet: async (
      input: PaymentSheetInitInput,
    ): Promise<PaymentSheetResult> =>
      normalizePaymentSheetResult(await initPaymentSheet(input)),
    presentPaymentSheet: async (): Promise<PaymentSheetResult> =>
      normalizePaymentSheetResult(await presentPaymentSheet()),
  };
};
