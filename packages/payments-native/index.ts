// @mingla/payments-native — Native Stripe PaymentSheet glue shared between
// mingla-business native and app-mobile native.
//
// NOT for web. Per I-MOR-0827-CONSUMER-NATIVE-STRIPE-ONLY +
// I-MOR-0827-PACKAGE-ISOLATION (META-ORCH-0827 Pass 2). Web buyers use
// Stripe Checkout Sessions via mingla-business web — that code stays in
// mingla-business/.

export { StripeNativeProvider } from "./StripeNativeProvider";
export { useStripePaymentSheet } from "./useStripePaymentSheet";
export { normalizePaymentSheetResult, isPaymentSheetErrorCode } from "./normalizePaymentSheetResult";
export type {
  PaymentSheetInitInput,
  PaymentSheetResult,
  PaymentSheetError,
  PaymentSheetErrorCode,
  StripePaymentSheetController,
} from "./types";
