// ORCH-0789: Stripe RN's PaymentSheet returns an `error.code` that
// discriminates user-cancel ("Canceled") from card failure ("Failed") and
// timeout ("Timeout"). Earlier versions of this wrapper narrowed the
// error to just `{ message }`, which forced callers to treat every
// outcome as a decline. The widened shape preserves the discriminator
// so the public checkout screen can render the correct UX per code.
//
// Metro picks `.native.ts` on iOS/Android and `.web.ts` on web. This
// platform-agnostic fallback exists only to satisfy TypeScript when a
// bundler lacks platform-extension resolution; at runtime it should
// never be reached. (DISC-2 follow-up tightens this.)

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
}

export interface StripePaymentSheetController {
  isPaymentSheetSupported: boolean;
  initPaymentSheet: (
    input: PaymentSheetInitInput,
  ) => Promise<PaymentSheetResult>;
  presentPaymentSheet: () => Promise<PaymentSheetResult>;
}

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
