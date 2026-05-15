// Shared types for Stripe PaymentSheet integration on native (iOS/Android).
//
// NOT shipped for web — web buyers use Stripe Checkout Sessions per
// ORCH-0790; the consumer app has no web target.

export type PaymentSheetErrorCode = "Canceled" | "Failed" | "Timeout";

export interface PaymentSheetError {
  code: PaymentSheetErrorCode;
  message: string;
  localizedMessage?: string;
  declineCode?: string;
  stripeErrorCode?: string;
}

export interface PaymentSheetResult {
  error?: PaymentSheetError;
}

export interface PaymentSheetInitInput {
  merchantDisplayName: string;
  paymentIntentClientSecret: string;
  allowsDelayedPaymentMethods: boolean;
  /**
   * ORCH-0829-B: Stripe-defined URL the SDK navigates back to after a
   * payment method redirect (Apple Pay completion handoff, iDEAL bank
   * return, Klarna, etc.). Without this, Stripe RN logs a warning and
   * silently hides every redirect-based payment method from the sheet.
   * Should match the app's URL scheme (e.g. `com.mingla.app.v2://...`).
   */
  returnURL?: string;
}

export interface StripePaymentSheetController {
  isPaymentSheetSupported: boolean;
  initPaymentSheet: (
    input: PaymentSheetInitInput,
  ) => Promise<PaymentSheetResult>;
  presentPaymentSheet: () => Promise<PaymentSheetResult>;
}
