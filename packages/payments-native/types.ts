// Shared types for Stripe PaymentSheet integration on native (iOS/Android).
//
// NOT shipped for web — web buyers use Stripe Checkout Sessions per
// ORCH-0790; the consumer app has no web target.

// ORCH-1387: type-only namespace import of the INSTALLED vendor types.
// `import type` is erased syntax — zero runtime/bundle impact; the package
// stays RN-free at runtime for the normalizePaymentSheetResult unit tests.
// The `PaymentSheet` namespace is an explicit named export in the installed
// @stripe/stripe-react-native 0.65.1 (types/index.d.ts:5,16) — immune to
// `export *` collision-drop.
import type { PaymentSheet } from "@stripe/stripe-react-native";

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
  /**
   * ORCH-1387: first-classing of the ORCH-0849-HOTFIX wallet config — wallet
   * exposure is per-sheet, HERE (the provider/initStripe `merchantIdentifier`
   * only registers the binding). Carries the ORCH-1244/1246 Apple Guideline
   * 4.9 contract: `cartItems[…].label` MUST be the product/event/trip/
   * experience/venue title — fallback "Ticket"/"Reservation" — NEVER the
   * company/merchantDisplayName. Typed against the INSTALLED vendor params
   * because the SDK receives this object verbatim (whole-object forward,
   * INVESTIGATION_ORCH-1387 F-1).
   * Enforced by I-PROPOSED-1387-WALLET-CONFIG-THREADED via
   * .github/scripts/strict-grep/orch-1387-wallet-config-threaded.mjs (W-11)
   * + the scoped type lane tsconfig.orch1387.typetest.json.
   */
  applePay?: PaymentSheet.ApplePayParams;
  /**
   * ORCH-1387: same ORCH lineage as `applePay` — the Android analog
   * (INVESTIGATION_ORCH-1387 Q7): `googlePay` rides the identical
   * whole-object forward into the native PaymentSheet config.
   * Enforced by I-PROPOSED-1387-WALLET-CONFIG-THREADED via
   * orch-1387-wallet-config-threaded.mjs (W-11) + the scoped type lane.
   */
  googlePay?: PaymentSheet.GooglePayParams;
}

export interface StripePaymentSheetController {
  isPaymentSheetSupported: boolean;
  initPaymentSheet: (
    input: PaymentSheetInitInput,
  ) => Promise<PaymentSheetResult>;
  presentPaymentSheet: () => Promise<PaymentSheetResult>;
}
