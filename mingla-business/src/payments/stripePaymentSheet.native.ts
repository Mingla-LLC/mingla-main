// META-ORCH-0827 Pass 2 — native useStripePaymentSheet lives in @mingla/payments-native.
// This file is a thin re-export so existing imports keep working (Metro
// resolves stripePaymentSheet.native.ts on iOS/Android; .web.ts is the
// stub web variant; .ts is the common fallback / type contract).
export { useStripePaymentSheet } from "@mingla/payments-native";
export type {
  PaymentSheetError,
  PaymentSheetErrorCode,
  PaymentSheetResult,
  PaymentSheetInitInput,
  StripePaymentSheetController,
} from "@mingla/payments-native";
