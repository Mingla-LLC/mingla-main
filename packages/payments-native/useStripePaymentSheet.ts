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
//
// ORCH-0829-B: once-only guard wrapping both initPaymentSheet and
// presentPaymentSheet. Stripe RN 0.50.3 on iOS 26 occasionally invokes
// the PaymentSheet completion handler TWICE for the same call (verified
// by the operator's screenshot showing two `present(from:completion:)`
// frames in the Swift stack). The second invocation surfaces as
// "Tried to resolve a promise more than once." which breaks the
// PaymentSheet UX. The guard suppresses the second JS-side resolution
// at the cost of returning the same Promise reference for any
// concurrent re-invocation. New invariant:
// I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY — callers MUST use this wrapper
// instead of `useStripe().presentPaymentSheet` directly.
//
// ORCH-0829-B D-1 H-3: timeout race layered ABOVE the once-only guard.
// Stripe RN 0.50.3 on iOS 26 can hang the native completion handler
// indefinitely (proven in ORCH-0829-B RETEST_2 where the PaymentSheet
// showed a loading skeleton for ~90s then silently self-dismissed,
// leaving the JS-side Promise pending forever). Without a timeout race
// the in-flight refs stay set permanently and the user is locked out of
// the entire payment flow for the rest of the app session. 60s matches
// Stripe SDK's own internal soft-timeout behavior; any longer and the
// user gives up. The synthetic timeout error has code='Timeout' so
// callers can detect it specifically (separate from 'Canceled' and
// 'Failed'). The rejection propagates through the IIFE's try/finally
// so the in-flight ref still clears on timeout. New invariant:
// I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE (proposed; codified at CLOSE
// alongside I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE).

import { useRef } from "react";
import { useStripe } from "@stripe/stripe-react-native";

import { normalizePaymentSheetResult } from "./normalizePaymentSheetResult";
import type {
  PaymentSheetInitInput,
  PaymentSheetResult,
  StripePaymentSheetController,
} from "./types";

// ORCH-0829-B D-1 H-3: timeout budget for both native calls.
const PAYMENT_SHEET_TIMEOUT_MS = 60_000;

// ORCH-0829-B D-1 H-3: race a Promise against a timer. On timeout, reject
// with a synthetic Error carrying code='Timeout' so the upstream
// normalizePaymentSheetResult / nativeCheckoutFlow can distinguish it
// from Stripe's own 'Canceled' and 'Failed' codes. The original Promise
// is left to settle on its own (no abort mechanism — Stripe RN doesn't
// expose one); we only stop awaiting it. The diagnostic log fires when
// the timer wins, giving the tester a positive Metro-log signal that
// the race triggered.
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log(
        `[useStripePaymentSheet] ${label} timed out after ${ms}ms — rejecting with synthetic Timeout error`,
      );
      reject(
        Object.assign(new Error(`${label} timed out after ${ms}ms`), {
          code: "Timeout",
        }),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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
          const result = normalizePaymentSheetResult(
            await withTimeout(
              initPaymentSheet(input),
              PAYMENT_SHEET_TIMEOUT_MS,
              "initPaymentSheet",
            ),
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
          const result = normalizePaymentSheetResult(
            await withTimeout(
              presentPaymentSheet(),
              PAYMENT_SHEET_TIMEOUT_MS,
              "presentPaymentSheet",
            ),
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
