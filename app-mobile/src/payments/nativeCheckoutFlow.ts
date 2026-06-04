/**
 * nativeCheckoutFlow — consumer-side glue between Stripe PaymentSheet
 * (via @mingla/payments-native) and the ticket-checkout-create edge
 * function.
 *
 * Per META-ORCH-0827 Pass 2 Step 9. This file is per-app glue (not in the
 * package) because it depends on app-mobile's supabase client + edge
 * function error util — those stay per-app per DEC-PASS2-4.
 *
 * Flow:
 *   1. Caller passes eventId + ticketLines + buyer info (from auth profile)
 *   2. Invoke ticket-checkout-create with surface: "native"
 *   3. Branch on response.kind:
 *      - free_completed → return {outcome: "succeeded", orderId}
 *      - requires_payment → initPaymentSheet → presentPaymentSheet → return outcome
 *      - requires_web_redirect → should not happen on native; treat as failure
 */

import { useStripePaymentSheet } from "@mingla/payments-native";
import { initStripe } from "@stripe/stripe-react-native";
// META-ORCH-1076 [Paystack Africa] — in-app browser for the Paystack hosted
// checkout redirect (the pre-ORCH-0849 hosted-checkout primitive). The buyer
// pays on Paystack's page; we never parse payment state from the redirect URL —
// we poll ticket-checkout-status, which is driven by the verified charge.success
// webhook (the source of truth).
//   https://paystack.com/docs/guides/using_the_paystack_checkout_in_a_mobile_webview/
import * as WebBrowser from "expo-web-browser";

import { supabase } from "../services/supabase";
import { extractFunctionError } from "../utils/edgeFunctionError";

export interface NativeCheckoutInput {
  eventId: string;
  lines: Array<{ ticketTypeId: string; quantity: number }>;
  buyer: {
    name: string;
    email: string;
    phone: string;
    marketingOptIn?: boolean;
    // ORCH-1006 Surface 6: the buyer no longer types a billing address (tax is
    // sourced at the venue server-side). Optional + forwarded only when present
    // for backward compatibility with any non-native caller.
    address?: {
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      postal: string;
      country: string;
    };
  };
  idempotencyKey?: string;
  taxCalculationId?: string | null;
  // ORCH-1016: trip intake answers ride the existing ticket-checkout-create body
  // key → orders.intake_form_data. The key is already supported server-side
  // (ticket-checkout-create reads it for trip checkouts); this just forwards it
  // from the native consumer path. No new edge-fn contract.
  intakeFormData?: Array<{
    ticket_type_id: string;
    schema_version_id: string;
    answers: Record<string, unknown>;
  }>;
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
      subtotalCents: number;
      taxCents: number;
      taxBreakdown: unknown[];
      currency: string;
      clientSecret: string;
      paymentIntentId: string;
      publishableKey: string | null;
      // ORCH-0844 — Connect direct-charge mobile config. The PI lives on
      // a connected account (ORCH-0843 direct-charge shape); the mobile
      // Stripe SDK MUST be re-initialised with this stripeAccountId before
      // initPaymentSheet, otherwise the SDK's mid-sheet confirm hits Stripe
      // under the platform context and the client_secret is rejected with
      // a 404 (manifests on iOS 26 as native RCTPromiseResolveBlock firing
      // twice → "tried to resolve a promise more than once" bridge warning).
      // customerId + customerEphemeralKeySecret are paired-or-absent: when
      // the edge function's Connect-scoped Customer/ephemeralKey creation
      // fails, both are null and the mobile sheet falls back to guest mode.
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
    }
  // META-ORCH-1076 [Paystack Africa] — Nigerian (NGN) brands. The buyer is sent
  // to Paystack's hosted checkout in an in-app browser, then we poll the server
  // for the finalized order (driven by the verified charge.success webhook).
  | {
      kind: "requires_paystack_redirect";
      checkoutSessionId: string;
      buyerStatusToken: string;
      authorizationUrl: string;
      reference: string;
      totalCents: number;
      currency: string;
    };

const MERCHANT_DISPLAY_NAME = "Mingla";

// META-ORCH-1076 — bounded poll for the Paystack order (webhook is the truth;
// the redirect is unreliable). ~25s budget at 1.5s intervals.
const PAYSTACK_POLL_INTERVAL_MS = 1500;
const PAYSTACK_POLL_MAX_ATTEMPTS = 17;

// META-ORCH-1076 — poll ticket-checkout-status until the order finalizes.
// Returns the orderId once order_id != null, else null on timeout. NEVER
// fabricates success — a timeout returns null and the caller surfaces a
// "couldn't confirm yet" message.
async function pollPaystackOrder(
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < PAYSTACK_POLL_MAX_ATTEMPTS; attempt++) {
    const { data } = await supabase.functions.invoke<{
      order: { orderId: string } | null;
    }>("ticket-checkout-status", {
      body: { checkoutSessionId, buyerStatusToken },
    });
    const orderId = data?.order?.orderId;
    if (orderId) return orderId;
    await new Promise((resolve) => setTimeout(resolve, PAYSTACK_POLL_INTERVAL_MS));
  }
  return null;
}

export const isStripeGooglePayTestEnv = (): boolean =>
  process.env.EAS_BUILD_PROFILE !== "production";

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
            // Forwarded only if a caller still supplies one (edge fn ignores it
            // — tax is venue-sourced, SPEC §B.1).
            ...(input.buyer.address ? { address: input.buyer.address } : {}),
          },
          lines: input.lines,
          // ORCH-1016: trip intake answers → orders.intake_form_data.
          ...(input.intakeFormData && input.intakeFormData.length > 0
            ? { intake_form_data: input.intakeFormData }
            : {}),
          ...(input.taxCalculationId ? { taxCalculationId: input.taxCalculationId } : {}),
          ...(input.idempotencyKey !== undefined
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
        },
      },
    );

    if (error) {
      const message = await extractFunctionError(
        error,
        "Couldn't start checkout. Tap to try again.",
      );
      return {
        outcome: "failed",
        message,
      };
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
      // On iOS 26 the 404 manifests as the native RCTPromiseResolveBlock
      // firing twice, which RN's TurboModule bridge logs as "tried to
      // resolve a promise more than once".
      //
      // We re-pass merchantIdentifier + urlScheme because initStripe
      // REPLACES the prior SDK config (it does NOT merge). Values mirror
      // the StripeProvider mount at app-mobile/app/_layout.tsx:72-75; if
      // either changes, both call sites must change together. We skip
      // the re-init if either field is missing (defensive — the edge
      // function should always send them on requires_payment, but a
      // future non-Connect platform-direct PI shape falls through cleanly).
      if (data.publishableKey && data.stripeAccountId) {
        await initStripe({
          publishableKey: data.publishableKey,
          stripeAccountId: data.stripeAccountId,
          merchantIdentifier: "merchant.com.mingla.app.v2",
          urlScheme: "com.mingla.app.v2",
        });
      } else {
        console.warn(
          "[nativeCheckoutFlow] requires_payment missing publishableKey or stripeAccountId — skipping per-PI initStripe; PaymentSheet confirm may fail with 404 if PI is on a connected account",
          {
            hasPublishableKey: Boolean(data.publishableKey),
            hasStripeAccountId: Boolean(data.stripeAccountId),
          },
        );
      }

      const initResult = await initPaymentSheet({
        merchantDisplayName: MERCHANT_DISPLAY_NAME,
        paymentIntentClientSecret: data.clientSecret,
        // ORCH-0829-B: returnURL is required by Stripe for any payment
        // method that redirects (Apple Pay, iDEAL, Klarna, etc.). Without
        // it, Stripe SDK logs a warning and those methods are silently
        // hidden from the PaymentSheet. Scheme matches `app.json:scheme`
        // and the iOS bundle id (`com.mingla.app.v2`). Path segment
        // `stripe-redirect` is arbitrary; Stripe just needs SOME URL to
        // navigate back to.
        returnURL: "com.mingla.app.v2://stripe-redirect",
        // ORCH-0844 A-3 — Connect direct-charge Customer + ephemeralKey.
        // Both are paired-or-absent per the edge function contract; when
        // either is null the sheet opens in guest mode (no saved-PM UI),
        // which is the intentional non-fatal fallback for transient
        // Stripe customers-API failures.
        ...(data.customerId && data.customerEphemeralKeySecret
          ? {
              customerId: data.customerId,
              customerEphemeralKeySecret: data.customerEphemeralKeySecret,
            }
          : {}),
        // ORCH-0849 HOTFIX (2026-05-15): explicit applePay + googlePay
        // config blocks are REQUIRED for the wallet buttons to render in
        // PaymentSheet. Setting the merchant identifier on initStripe
        // (StripeNativeProvider) only registers the binding; the actual
        // per-sheet exposure of Apple Pay / Google Pay happens HERE. Per
        // Stripe React Native docs:
        //   https://docs.stripe.com/payments/accept-a-payment?platform=react-native
        // "To accept Apple Pay or Google Pay, you must enable them in
        // your PaymentSheet configuration."
        // merchantCountryCode is the country where the platform is based
        // (Mingla is a US-incorporated LLC; connected accounts use
        // direct charges with Stripe-Account header, so the platform
        // country is what Stripe checks for the wallet eligibility).
        applePay: {
          merchantCountryCode: "US",
        },
        googlePay: {
          merchantCountryCode: "US",
          testEnv: isStripeGooglePayTestEnv(),
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
      // for the finalized order (or trust the realtime calendar subscription
      // to pick up the new ticket entry).
      return { outcome: "succeeded", orderId: data.checkoutSessionId };
    }

    // 2c. META-ORCH-1076 — Paystack (NGN). Open Paystack's hosted checkout in
    // an in-app browser, then poll the server for the finalized order.
    if (data.kind === "requires_paystack_redirect") {
      // openAuthSessionAsync resolves on the redirect to callback_url?trxref=…
      // (or on cancel/dismiss). We do NOT read payment state from the result —
      // the webhook is the source of truth; we always poll the server.
      try {
        await WebBrowser.openAuthSessionAsync(
          data.authorizationUrl,
          // Paystack's success callback (the in-app browser intercepts + closes
          // on the redirect to this prefix). The server is the truth source.
          "https://business.usemingla.com/pay/callback",
        );
      } catch (err) {
        console.warn("[nativeCheckoutFlow] paystack browser error", err);
        // Still poll — the buyer may have paid before the browser errored.
      }

      // Poll ticket-checkout-status until the order finalizes (or timeout).
      const orderId = await pollPaystackOrder(
        data.checkoutSessionId,
        data.buyerStatusToken,
      );
      if (orderId) {
        return { outcome: "succeeded", orderId };
      }
      return {
        outcome: "failed",
        message:
          "We couldn't confirm your payment yet. If you completed it, your tickets will appear shortly.",
      };
    }

    // 2d. Web redirect from a native client is a server/client mismatch.
    return {
      outcome: "failed",
      message: "Unexpected web checkout response on native client.",
    };
  };
};
