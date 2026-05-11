export interface PaymentSheetResult {
  error?: {
    message?: string;
  };
}

export interface PaymentSheetInitInput {
  merchantDisplayName: string;
  paymentIntentClientSecret: string;
  allowsDelayedPaymentMethods: boolean;
}

export interface StripePaymentSheetController {
  isPaymentSheetSupported: boolean;
  initPaymentSheet: (
    input: PaymentSheetInitInput,
  ) => Promise<PaymentSheetResult>;
  presentPaymentSheet: () => Promise<PaymentSheetResult>;
}

const unsupported = async (): Promise<PaymentSheetResult> => ({
  error: { message: "Stripe PaymentSheet is not available on web." },
});

export const useStripePaymentSheet = (): StripePaymentSheetController => ({
  isPaymentSheetSupported: false,
  initPaymentSheet: unsupported,
  presentPaymentSheet: unsupported,
});
