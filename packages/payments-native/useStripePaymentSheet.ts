// useStripePaymentSheet — native Stripe PaymentSheet hook.
//
// Per META-ORCH-0827 Pass 2 (from mingla-business/src/payments/stripePaymentSheet.native.ts).
// Native-only. Web bundles should NOT import this — both consuming apps
// should use platform-extension resolution (.native.ts) or the strict-grep
// CI gate (orch-0778-web-stripe-native-import-gate.mjs) catches violations.
//
// ORCH-0789: preserves Stripe RN's PaymentSheetError discriminator so
// callers can distinguish user-cancel ("Canceled") from card-decline
// ("Failed"). The actual normalization is in normalizePaymentSheetResult.ts
// (kept RN-free so it can be unit-tested without the react-native runtime).
//
// ORCH-0829-B: once-only guard wrapping both initPaymentSheet and
// presentPaymentSheet. Stripe RN can re-enter the native completion
// handler on iOS double-tap; the guard suppresses the second JS-side
// resolution at the cost of returning the same Promise reference for any
// concurrent re-invocation.
//   I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY — callers MUST use this wrapper
//   instead of `useStripe().presentPaymentSheet` directly. PRESERVED.
//
// ORCH-0844 (2026-05-15) — 60s `withTimeout` race REMOVED from both wrappers.
// Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0844_EXPLORER_PAYMENTSHEET_DOUBLE_RESOLVE.md
// Root cause R-2: the timeout race added in ORCH-0829-B D-1 H-3 was layered
// above Stripe's own settle path; on iOS 26 when the native bridge fired
// `RCTPromiseResolveBlock` twice (due to the connected-account 404 caused
// by R-1, now fixed in nativeCheckoutFlow.ts via per-PI initStripe), the
// synthetic Timeout rejection became a third settle vector — compounding
// the "tried to resolve a promise more than once" RN bridge warning.
// The hang the race originally guarded (ORCH-0829-B RETEST_2 90s loading
// skeleton) was resolved at the PI level by ORCH-0837 `payment_method_types:
// ['card']` — with card-only PIs the sheet either resolves within ~2s or
// fails clean; no 60s hang is reachable.
//
// What stayed:
//   - inFlightInitRef / inFlightPresentRef once-only guards (JS-side
//     double-tap defense, different mechanism from native double-resolve).
//   - The PaymentSheetErrorCode "Timeout" union member in types.ts (legacy;
//     no longer emitted by this hook but kept for callsite backward compat).
//
// Cross-references:
//   - I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY        (PRESERVED)
//   - I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE      (RETIRED — ORCH-0844)
//   - I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI (NEW — ORCH-0844; enforced
//     in app-mobile/src/payments/nativeCheckoutFlow.ts via initStripe)
//   - I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES (PRESERVED — ORCH-0837)

import { useRef } from "react";
import { useStripe } from "@stripe/stripe-react-native";

import { normalizePaymentSheetResult } from "./normalizePaymentSheetResult";
import type {
  PaymentSheetInitInput,
  PaymentSheetResult,
  StripePaymentSheetController,
} from "./types";

export const useStripePaymentSheet = (): StripePaymentSheetController => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  // ORCH-0829-B: in-flight refs. Each holds the active Promise during
  // a native call; cleared when the call settles. A second invocation
  // while a first is in flight returns the same Promise reference
  // (callers awaiting both observe the same resolution).
  const inFlightInitRef = useRef<Promise<PaymentSheetResult> | null>(null);
  const inFlightPresentRef = useRef<Promise<PaymentSheetResult> | null>(null);

  return {
    isPaymentSheetSupported: true,
    initPaymentSheet: async (
      input: PaymentSheetInitInput,
    ): Promise<PaymentSheetResult> => {
      if (inFlightInitRef.current !== null) {
        console.log(
          "[useStripePaymentSheet] initPaymentSheet already in flight; returning existing promise",
        );
        return inFlightInitRef.current;
      }
      const p: Promise<PaymentSheetResult> = (async () => {
        console.log("[useStripePaymentSheet] initPaymentSheet → native call");
        try {
          // ORCH-0844: no withTimeout race — see header comment. Native call
          // is awaited directly; the inFlightInitRef finally clears below.
          const result = normalizePaymentSheetResult(
            await initPaymentSheet(input),
          );
          console.log(
            "[useStripePaymentSheet] initPaymentSheet ← resolved error=",
            result.error?.code ?? "none",
          );
          return result;
        } finally {
          inFlightInitRef.current = null;
        }
      })();
      inFlightInitRef.current = p;
      return p;
    },
    presentPaymentSheet: async (): Promise<PaymentSheetResult> => {
      if (inFlightPresentRef.current !== null) {
        console.log(
          "[useStripePaymentSheet] presentPaymentSheet already in flight; returning existing promise (double-invoke suppressed)",
        );
        return inFlightPresentRef.current;
      }
      const p: Promise<PaymentSheetResult> = (async () => {
        console.log("[useStripePaymentSheet] presentPaymentSheet → native call");
        try {
          // ORCH-0844: no withTimeout race — see header comment.
          const result = normalizePaymentSheetResult(
            await presentPaymentSheet(),
          );
          console.log(
            "[useStripePaymentSheet] presentPaymentSheet ← resolved error=",
            result.error?.code ?? "none",
          );
          return result;
        } finally {
          inFlightPresentRef.current = null;
        }
      })();
      inFlightPresentRef.current = p;
      return p;
    },
  };
};
