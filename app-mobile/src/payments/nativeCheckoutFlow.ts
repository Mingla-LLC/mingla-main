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
    };

const MERCHANT_DISPLAY_NAME = "Mingla";

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
      const message = await extractFunctionError(
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
        // ORCH-0844 A-4 — allowsDelayedPaymentMethods dropped (redundant
        // under ORCH-0837 payment_method_types: ['card']; the PI itself
        // enforces card-only).
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

    // 2c. Web redirect from a native client is a server/client mismatch.
    return {
      outcome: "failed",
      message: "Unexpected web checkout response on native client.",
    };
  };
};
