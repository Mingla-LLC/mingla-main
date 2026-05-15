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
  /**
   * ORCH-0844: optional. Redundant under ORCH-0837 `payment_method_types:
   * ['card']` (the PI itself enforces card-only) but retained as an
   * optional callsite escape hatch in case a future surface needs to opt
   * back into delayed methods. Callers SHOULD omit unless they have a
   * specific reason to set it.
   */
  allowsDelayedPaymentMethods?: boolean;
  /**
   * ORCH-0829-B: Stripe-defined URL the SDK navigates back to after a
   * payment method redirect (Apple Pay completion handoff, iDEAL bank
   * return, Klarna, etc.). Without this, Stripe RN logs a warning and
   * silently hides every redirect-based payment method from the sheet.
   * Should match the app's URL scheme (e.g. `com.mingla.app.v2://...`).
   */
  returnURL?: string;
  /**
   * ORCH-0844: Connect direct-charge Customer ID (lives on the connected
   * account, NOT the platform). Paired-or-absent with
   * customerEphemeralKeySecret. When both are present, PaymentSheet shows
   * saved-PM UI; when absent, sheet opens in guest mode.
   */
  customerId?: string;
  /**
   * ORCH-0844: ephemeralKey secret minted for the customerId on the same
   * connected account. Paired-or-absent with customerId.
   */
  customerEphemeralKeySecret?: string;
}

export interface StripePaymentSheetController {
  isPaymentSheetSupported: boolean;
  initPaymentSheet: (
    input: PaymentSheetInitInput,
  ) => Promise<PaymentSheetResult>;
  presentPaymentSheet: () => Promise<PaymentSheetResult>;
}
