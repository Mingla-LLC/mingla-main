import { useStripe } from "@stripe/stripe-react-native";
import type {
  PaymentSheetInitInput,
  PaymentSheetResult,
  StripePaymentSheetController,
} from "./stripePaymentSheet";

export const useStripePaymentSheet = (): StripePaymentSheetController => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  return {
    isPaymentSheetSupported: true,
    initPaymentSheet: (
      input: PaymentSheetInitInput,
    ): Promise<PaymentSheetResult> => initPaymentSheet(input),
    presentPaymentSheet: (): Promise<PaymentSheetResult> =>
      presentPaymentSheet(),
  };
};
