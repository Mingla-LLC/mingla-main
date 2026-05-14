// useStripePaymentSheet — native Stripe PaymentSheet hook.
//
// Per META-ORCH-0827 Pass 2 (from mingla-business/src/payments/stripePaymentSheet.native.ts).
// Native-only. Web bundles should NOT import this — both consuming apps
// should use platform-extension resolution (.native.ts) or the strict-grep
// CI gate (orch-0778-web-stripe-native-import-gate.mjs) catches violations.
//
// ORCH-0789: preserves Stripe RN's PaymentSheetError discriminator so
// callers can distinguish user-cancel ("Canceled") from card-decline
// ("Failed") from "Timeout". The actual normalization is in
// normalizePaymentSheetResult.ts (kept RN-free so it can be unit-tested
// without the react-native runtime).

import { useStripe } from "@stripe/stripe-react-native";

import { normalizePaymentSheetResult } from "./normalizePaymentSheetResult";
import type {
  PaymentSheetInitInput,
  PaymentSheetResult,
  StripePaymentSheetController,
} from "./types";

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
