/**
 * nativeCheckoutFlow — mingla-business buyer-side glue between Stripe
 * PaymentSheet (via @mingla/payments-native) and the ticket-checkout-create
 * edge function.
 *
 * ORCH-0849 (2026-05-15): mirror of app-mobile/src/payments/nativeCheckoutFlow.ts.
 * Replaces the ORCH-0839-B [Stripe Hosted Checkout pivot] expo-web-browser
 * openAuthSessionAsync flow with native PaymentSheet, restoring parity with
 * consumer (app-mobile). Per SPEC_ORCH-0849 §3.4.4 and invariant
 * I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY.
 *
 * Only TWO differences from the consumer mirror:
 *   1. supabase client imported from mingla-business/src/services/supabase
 *      (DEC-PASS2-4 — per-app supabase clients).
 *   2. merchantIdentifier + urlScheme are the business values
 *      ("merchant.com.mingla.business.v2" / "com.mingla.business.v2") to
 *      match the Stripe Dashboard registration AND the
 *      <StripeNativeProvider> mount at mingla-business/app/_layout.tsx.
 *
 * Edge function response shape (requires_payment) is byte-identical to
 * what consumer consumes — same stripeAccountId + customerId +
 * customerEphemeralKeySecret triad per ORCH-0844.
 *
 * Flow:
 *   1. Caller passes eventId + ticketLines + buyer info
 *   2. Invoke ticket-checkout-create with surface: "native"
 *   3. Branch on response.kind:
 *      - free_completed → return {outcome: "succeeded", orderId}
 *      - requires_payment → initStripe → initPaymentSheet → presentPaymentSheet → outcome
 *      - requires_web_redirect → should not happen on native; treat as failure
 */

import { useStripePaymentSheet } from "@mingla/payments-native";
import { initStripe } from "@stripe/stripe-react-native";

import { supabase } from "../services/supabase";

export interface NativeCheckoutInput {
  eventId: string;
  lines: Array<{ ticketTypeId: string; quantity: number }>;
  buyer: {
    name: string;
    email: string;
    phone: string;
    marketingOptIn?: boolean;
  };
  idempotencyKey?: string;
}

export type NativeCheckoutOutcome =
  | { outcome: "succeeded"; orderId: string }
  | { outcome: "canceled" }
  | { outcome: "failed"; message: string };

type CheckoutCreateResponse =
  | {
      kind: "free_completed";
      orderId: string;
      buyerStatusToken?: string;
    }
  | {
      kind: "requires_payment";
      checkoutSessionId: string;
      buyerStatusToken: string;
      totalCents: number;
      currency: string;
      clientSecret: string;
      paymentIntentId: string;
      publishableKey: string | null;
      // ORCH-0844 Connect direct-charge config — see consumer mirror at
      // app-mobile/src/payments/nativeCheckoutFlow.ts for full rationale.
      // The mobile Stripe SDK MUST be re-initialised with stripeAccountId
      // before initPaymentSheet, otherwise the confirm step hits Stripe
      // under the platform context and the client_secret bound to the
      // connected account is rejected (404 → double-resolve on iOS 26).
      // customerId + customerEphemeralKeySecret are paired-or-absent.
      stripeAccountId: string;
      customerId: string | null;
      customerEphemeralKeySecret: string | null;
    }
  | {
      kind: "requires_web_redirect";
      checkoutSessionId: string;
      buyerStatusToken: string;
      hostedCheckoutUrl: string | null;
      totalCents: number;
      currency: string;
    };

const MERCHANT_DISPLAY_NAME = "Mingla";

// ORCH-0849: business merchant identifier + URL scheme. Must match the
// Stripe Dashboard registration AND the <StripeNativeProvider> mount in
// mingla-business/app/_layout.tsx AND the Stripe plugin entry in
// mingla-business/app.json. If any of these three drift, Apple Pay
// silently disappears from PaymentSheet (NOT a crash post-ORCH-0844 —
// just absent). CI gate i-stripe-paymentsheet-parity.mjs verifies the
// three locations agree.
const BUSINESS_MERCHANT_IDENTIFIER = "merchant.com.mingla.business.v2";
const BUSINESS_URL_SCHEME = "com.mingla.business.v2";

/**
 * Minimal edge-function-error extractor inline (mingla-business does not
 * have the shared extractFunctionError util that app-mobile uses). Reads
 * the FunctionsHttpError context body if present; falls back to the
 * caller-supplied message.
 */
async function extractEdgeFunctionError(
  err: unknown,
  fallback: string,
): Promise<string> {
  if (err === null || typeof err !== "object") return fallback;
  const ctx = (err as { context?: unknown }).context;
  if (
    ctx !== null &&
    typeof ctx === "object" &&
    typeof (ctx as { text?: () => Promise<string> }).text === "function"
  ) {
    try {
      const body = await (ctx as { text: () => Promise<string> }).text();
      try {
        const parsed = JSON.parse(body) as { error?: string; message?: string };
        return parsed.error ?? parsed.message ?? fallback;
      } catch {
        return body || fallback;
      }
    } catch {
      return fallback;
    }
  }
  const msg = (err as { message?: string }).message;
  return typeof msg === "string" && msg.length > 0 ? msg : fallback;
}

export const useNativeCheckoutFlow = (): ((
  input: NativeCheckoutInput,
) => Promise<NativeCheckoutOutcome>) => {
  const { initPaymentSheet, presentPaymentSheet, isPaymentSheetSupported } =
    useStripePaymentSheet();

  return async (input: NativeCheckoutInput): Promise<NativeCheckoutOutcome> => {
    if (!isPaymentSheetSupported) {
      return {
        outcome: "failed",
        message: "Native payment is not available on this device.",
      };
    }

    // 1. Create the checkout session on the server.
    const { data, error } = await supabase.functions.invoke<CheckoutCreateResponse>(
      "ticket-checkout-create",
      {
        body: {
          eventId: input.eventId,
          surface: "native",
          buyer: {
            name: input.buyer.name,
            email: input.buyer.email,
            phone: input.buyer.phone,
            marketingOptIn: input.buyer.marketingOptIn === true,
          },
          lines: input.lines,
          ...(input.idempotencyKey !== undefined
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
        },
      },
    );

    if (error) {
      const message = await extractEdgeFunctionError(
        error,
        "Couldn't start checkout. Tap to try again.",
      );
      return { outcome: "failed", message };
    }

    if (!data) {
      return {
        outcome: "failed",
        message: "Empty checkout response from server.",
      };
    }

    // 2a. Free ticket — already finalized on server.
    if (data.kind === "free_completed") {
      return { outcome: "succeeded", orderId: data.orderId };
    }

    // 2b. Native payment required — present Stripe PaymentSheet.
    if (data.kind === "requires_payment") {
      // ORCH-0844 — Connect direct-charge: re-initialise the native Stripe
      // SDK for THIS PaymentIntent's connected account. Without this, the
      // SDK's mid-PaymentSheet confirm call hits Stripe under the platform
      // context and the client_secret (bound to the connected account via
      // ORCH-0843 { stripeAccount } request option) is rejected with a 404.
      //
      // initStripe REPLACES the prior SDK config (it does NOT merge), so we
      // re-pass merchantIdentifier + urlScheme. Values mirror the
      // StripeNativeProvider mount at mingla-business/app/_layout.tsx; if
      // either changes, both call sites must change together. CI gate
      // i-stripe-paymentsheet-parity.mjs verifies the agreement.
      if (data.publishableKey && data.stripeAccountId) {
        await initStripe({
          publishableKey: data.publishableKey,
          stripeAccountId: data.stripeAccountId,
          merchantIdentifier: BUSINESS_MERCHANT_IDENTIFIER,
          urlScheme: BUSINESS_URL_SCHEME,
        });
      } else {
        console.warn(
          "[nativeCheckoutFlow:business] requires_payment missing publishableKey or stripeAccountId — skipping per-PI initStripe; PaymentSheet confirm may fail with 404 if PI is on a connected account",
          {
            hasPublishableKey: Boolean(data.publishableKey),
            hasStripeAccountId: Boolean(data.stripeAccountId),
          },
        );
      }

      const initResult = await initPaymentSheet({
        merchantDisplayName: MERCHANT_DISPLAY_NAME,
        paymentIntentClientSecret: data.clientSecret,
        // returnURL required by Stripe for any payment method that
        // redirects (Apple Pay, 3DS, etc.). Scheme matches the business
        // app.json `scheme` and the Stripe plugin urlScheme.
        returnURL: `${BUSINESS_URL_SCHEME}://stripe-redirect`,
        // ORCH-0844 A-3 — Connect direct-charge Customer + ephemeralKey.
        // Paired-or-absent per edge function contract; absent → guest mode.
        ...(data.customerId && data.customerEphemeralKeySecret
          ? {
              customerId: data.customerId,
              customerEphemeralKeySecret: data.customerEphemeralKeySecret,
            }
          : {}),
        // ORCH-0849 HOTFIX (2026-05-15): explicit applePay + googlePay
        // config blocks REQUIRED for the wallet buttons to render in
        // PaymentSheet. Setting the merchant identifier on initStripe
        // (StripeNativeProvider) only registers the binding; per-sheet
        // wallet exposure happens HERE. Per Stripe React Native docs:
        //   https://docs.stripe.com/payments/accept-a-payment?platform=react-native
        // Mirror of the consumer pattern in
        // app-mobile/src/payments/nativeCheckoutFlow.ts — invariant
        // I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY (ORCH-0849).
        applePay: {
          merchantCountryCode: "US",
        },
        googlePay: {
          merchantCountryCode: "US",
          testEnv: __DEV__,
          currencyCode: "usd",
        },
      });
      if (initResult.error) {
        return {
          outcome: "failed",
          message:
            initResult.error.localizedMessage ??
            initResult.error.message ??
            "Couldn't open payment sheet.",
        };
      }

      const presentResult = await presentPaymentSheet();
      if (presentResult.error) {
        if (presentResult.error.code === "Canceled") {
          return { outcome: "canceled" };
        }
        return {
          outcome: "failed",
          message:
            presentResult.error.localizedMessage ??
            presentResult.error.message ??
            "Payment failed.",
        };
      }

      // PaymentSheet succeeded. Stripe webhook + biz_ticket_checkout_finalize
      // produce the order row asynchronously; we surface the checkoutSessionId
      // here so the caller can navigate to a confirmation surface that polls
      // for the finalized order.
      return { outcome: "succeeded", orderId: data.checkoutSessionId };
    }

    // 2c. Web redirect from a native client is a server/client mismatch
    // post-ORCH-0849 (business no longer requests surface: "mobile-web").
    return {
      outcome: "failed",
      message: "Unexpected web checkout response on native client.",
    };
  };
};
