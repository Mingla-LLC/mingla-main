// META-ORCH-0827 Pass 2 — normalizePaymentSheetResult lives in @mingla/payments-native.
// This file is a thin re-export to preserve any local imports inside
// mingla-business that referenced the old path. New code should import
// directly from @mingla/payments-native.
export {
  normalizePaymentSheetResult,
  isPaymentSheetErrorCode,
} from "@mingla/payments-native";
