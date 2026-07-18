/**
 * ORCH-1387 — TESTER-ADVERSARIAL type-rejection-breadth typetest (mingla-tester,
 * TEST phase; SPEC §9 angle A-3). COMPILE-ONLY — never imported at runtime,
 * never bundled; included ONLY by
 * `../tsconfig.orch1387.tester-adversarial.typetest.json` and driven by
 * `mingla-business/src/payments/__tests__/walletConfigAdversarial.orch1387.tester.test.mjs`.
 *
 * DIFFERENT ANGLE than the implementor's shipped typetest
 * (`paymentSheetInitInput.orch1387.typetest.ts`): that file pins the two
 * callsite payload shapes + 6 first-order negatives. THIS file attacks the
 * contract's rejection BREADTH across the vendor CartSummaryItem UNION and
 * the wallet param objects — the shapes a future refactor is most likely to
 * get subtly wrong (Deferred/Recurring variants, wrong-typed booleans,
 * excess keys INSIDE the wallet params, non-array cartItems).
 *
 * TWO-SIDED like the shipped lane:
 *  - Reverting the ORCH-1387 `types.ts` wallet-key extension breaks the
 *    POSITIVES below → red (the tester fails-on-revert angle).
 *  - Widening `applePay`/`googlePay` (any / Record<string, unknown>) makes
 *    the in-params `@ts-expect-error` directives unused → TS2578 → red.
 */

import type { PaymentSheetInitInput } from "../types";

// ─── BREADTH POSITIVES — the full vendor cart-item union must stay usable ──

// BP-1: Deferred item WITH its required deferredDate compiles.
const posDeferred: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      {
        label: "Pre-order",
        amount: "45.99",
        paymentType: "Deferred",
        deferredDate: 1789000000,
      },
    ],
  },
};

// BP-2: Recurring item with intervalUnit + intervalCount compiles.
const posRecurring: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      {
        label: "Membership",
        amount: "12.50",
        paymentType: "Recurring",
        intervalUnit: "month",
        intervalCount: 1,
      },
    ],
  },
};

// BP-3: Immediate item with isPending boolean compiles.
const posPending: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      {
        label: "Estimate",
        amount: "0.00",
        paymentType: "Immediate",
        isPending: true,
      },
    ],
  },
};

// ─── BREADTH NEGATIVES — each MUST stay a compile error ────────────────────

// AN-1: Deferred item WITHOUT deferredDate — rejected.
const negDeferredNoDate: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      // @ts-expect-error ORCH-1387 tester AN-1 — Deferred requires deferredDate
      { label: "Pre-order", amount: "45.99", paymentType: "Deferred" },
    ],
  },
};

// AN-2: googlePay testEnv must be a boolean, never the string "true".
const negTestEnvString: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  googlePay: {
    merchantCountryCode: "US",
    // @ts-expect-error ORCH-1387 tester AN-2 — testEnv is boolean, not string
    testEnv: "true",
  },
};

// AN-3: excess unknown key INSIDE applePay params stays rejected (guards
// ApplePayParams itself against index-signature/Record widening).
const negApplePayExcessKey: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    // @ts-expect-error ORCH-1387 tester AN-3 — unknown key on ApplePayParams
    walletFoo: 1,
  },
};

// AN-4: isPending must be a boolean, never a string.
const negIsPendingString: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      {
        label: "Ticket",
        amount: "45.99",
        paymentType: "Immediate",
        // @ts-expect-error ORCH-1387 tester AN-4 — isPending is boolean
        isPending: "yes",
      },
    ],
  },
};

// AN-5: cartItems must be an ARRAY, not a single bare item object.
const negCartItemsNotArray: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    // @ts-expect-error ORCH-1387 tester AN-5 — cartItems is CartSummaryItem[]
    cartItems: { label: "Ticket", amount: "45.99", paymentType: "Immediate" },
  },
};

// AN-6: label must be a string — a number is exactly a 4.9-hostile shape.
const negLabelNumber: PaymentSheetInitInput = {
  merchantDisplayName: "Mingla",
  paymentIntentClientSecret: "pi_123_secret_456",
  applePay: {
    merchantCountryCode: "US",
    cartItems: [
      // @ts-expect-error ORCH-1387 tester AN-6 — label is a string (the 4.9 product line)
      { label: 42, amount: "45.99", paymentType: "Immediate" },
    ],
  },
};

// Bind all cases so none is a dead declaration.
export type Orch1387TesterAdversarialBound = [
  typeof posDeferred,
  typeof posRecurring,
  typeof posPending,
  typeof negDeferredNoDate,
  typeof negTestEnvString,
  typeof negApplePayExcessKey,
  typeof negIsPendingString,
  typeof negCartItemsNotArray,
  typeof negLabelNumber,
];
