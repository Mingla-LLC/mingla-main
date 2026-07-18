/**
 * ORCH-1387 — scoped type-contract lane for the wallet config on
 * `PaymentSheetInitInput` (I-PROPOSED-1387-WALLET-CONFIG-THREADED).
 *
 * COMPILE-ONLY. This file is never imported at runtime and never bundled —
 * it is included ONLY by `../tsconfig.orch1387.typetest.json` and runs in CI
 * via the `orch-1387-wallet-type-contract` job:
 *
 *   cd mingla-business && npx tsc --noEmit -p ../packages/payments-native/tsconfig.orch1387.typetest.json
 *
 * WHY THIS LANE EXISTS (SPEC_ORCH-1387 §4.5.3): neither app's `tsc` is a CI
 * gate (ORCH-1385 D-6 — output is diff-vs-baseline, never absolute) and
 * jest/babel strip types unchecked, so this scoped, D-6-immune lane is the
 * ONLY enforcement the type half of the wallet contract has.
 *
 * TWO-SIDED ENFORCEMENT:
 *   - Reverting the ORCH-1387 `types.ts` extension (removing `applePay`/
 *     `googlePay`) breaks the POSITIVE cases below → lane red (T-9).
 *   - WIDENING the keys (e.g. `applePay?: any` / `Record<string, unknown>`)
 *     makes the NEGATIVE `@ts-expect-error` directives unused → TS2578 →
 *     lane red (T-10).
 *
 * Apple Guideline 4.9 context (ORCH-1244/1246): `cartItems[…].label` MUST be
 * the product title — fallback "Ticket"/"Reservation" — NEVER the company/
 * merchantDisplayName. The runtime threading of that contract is guarded by
 * orch-1387-wallet-config-threaded.mjs (W-1..W-11) + both structural suites;
 * THIS file guards the type shapes those callsites compile against.
 */

import type { PaymentSheet } from "@stripe/stripe-react-native";

import type { PaymentSheetInitInput } from "../types";

// ─── POSITIVE 1 — full business-callsite payload shape must compile ────────
// Mirrors mingla-business/src/payments/nativeCheckoutFlow.native.ts:327-368.
const businessCallsiteShape: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  returnURL: "com.sethogieva.minglabusiness://stripe-redirect",
  customerId: "cus_123",
  customerEphemeralKeySecret: "ek_123",
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      {
        label: "Sunset Rooftop Party",
        amount: "45.99",
        paymentType: "Immediate",
      },
    ],
  },
  googlePay: {
    merchantCountryCode: "US",
    testEnv: true,
    currencyCode: "usd",
  },
};

// ─── POSITIVE 2 — reserve-flow shape: Pick<> spread into a full input ──────
// Mirrors app-mobile/src/hooks/useReserveTable.ts walletConfig + init call.
const reserveWalletConfig: Pick<
  PaymentSheetInitInput,
  "applePay" | "googlePay"
> = {
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      { label: "Reservation", amount: "12.50", paymentType: "Immediate" },
    ],
  },
  googlePay: {
    merchantCountryCode: "US",
    testEnv: false,
    currencyCode: "usd",
  },
};
const reserveCallsiteShape: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  returnURL: "com.mingla.app.v2://stripe-redirect",
  ...reserveWalletConfig,
};

// ─── POSITIVE 3 — helper-mirror ↔ vendor assignability pin ─────────────────
// Both apps carry a LOCAL "Mirror of @stripe/stripe-react-native" interface
// for the buildApplePayCartItems return (mingla-business/src/payments/
// applePayCartItems.ts:13, app-mobile/src/payments/applePayCartItem.ts:28).
// Those helpers are DO-NOT-TOUCH (SPEC §4.1) — this pins that their return
// types stay structurally assignable to the vendor's cartItems element type
// without touching them. Structural mirror declared locally on purpose.
interface ApplePayCartItemMirror {
  label: string;
  amount: string;
  paymentType: "Immediate";
}
declare const businessHelperReturn: ApplePayCartItemMirror[];
declare const consumerHelperReturn: [ApplePayCartItemMirror];
const businessHelperAssignable: NonNullable<
  PaymentSheet.ApplePayParams["cartItems"]
> = businessHelperReturn;
const consumerHelperAssignable: NonNullable<
  PaymentSheet.ApplePayParams["cartItems"]
> = consumerHelperReturn;

// ─── NEGATIVES — each MUST stay a compile error (TS2578 trips if not) ──────

// N-1: cartItem amount must be a decimal STRING (major units), never a number.
const negAmountNumber: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      {
        label: "Ticket",
        // @ts-expect-error ORCH-1387 N-1 — amount is a decimal string, not a number
        amount: 4599,
        paymentType: "Immediate",
      },
    ],
  },
};

// N-2: paymentType must be a vendor CartSummaryItemType — "Sometime" is not.
const negPaymentType: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      // @ts-expect-error ORCH-1387 N-2 — "Sometime" is not a CartSummaryItem paymentType
      { label: "Ticket", amount: "45.99", paymentType: "Sometime" },
    ],
  },
};

// N-3: a cartItem without a label is exactly the Apple-4.9 hole — rejected.
const negMissingLabel: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      // @ts-expect-error ORCH-1387 N-3 — label is REQUIRED (the 4.9 product line)
      { amount: "45.99", paymentType: "Immediate" },
    ],
  },
};

// N-4: applePay requires merchantCountryCode — an empty config is rejected.
const negEmptyApplePay: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  // @ts-expect-error ORCH-1387 N-4 — merchantCountryCode is required on ApplePayParams
  applePay: {},
};

// N-5: googlePay merchantCountryCode must be a string.
const negGooglePayCountryCode: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  // @ts-expect-error ORCH-1387 N-5 — merchantCountryCode is a string, not a number
  googlePay: { merchantCountryCode: 123 },
};

// N-6: unknown excess keys on the init literal stay rejected (guards against
// PaymentSheetInitInput ever widening to an index-signature/Record shape).
const negExcessKey: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  // @ts-expect-error ORCH-1387 N-6 — unknown keys are excess properties
  walletFoo: {},
};

// Reference the positives so they are bound uses, not dead declarations.
export type Orch1387TypetestBound = [
  typeof businessCallsiteShape,
  typeof reserveCallsiteShape,
  typeof businessHelperAssignable,
  typeof consumerHelperAssignable,
  typeof negAmountNumber,
  typeof negPaymentType,
  typeof negMissingLabel,
  typeof negEmptyApplePay,
  typeof negGooglePayCountryCode,
  typeof negExcessKey,
];
