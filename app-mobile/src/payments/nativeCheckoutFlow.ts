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
import { buildApplePayCartItems } from "./applePayCartItem";
// issue #2229 [raw checkout error tokens] — the ONE owner of native buyer copy.
// extractFunctionError returns the server's MACHINE TOKEN; nothing here may put
// that on a screen.
import {
  CHECKOUT_NO_HANDOFF_MESSAGE,
  nativeCheckoutErrorMessage,
} from "./checkoutErrorMessages";

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
  // ORCH-1072: the chosen experience occurrence (event_dates.id). Forwarded to
  // ticket-checkout-create so a recurring/multi-date experience books the right
  // date. Omitted for events/trips/one-off → request shape byte-identical.
  eventDateId?: string | null;
  // ORCH-1016: trip intake answers ride the existing ticket-checkout-create body
  // key → orders.intake_form_data. The key is already supported server-side
  // (ticket-checkout-create reads it for trip checkouts); this just forwards it
  // from the native consumer path. No new edge-fn contract.
  intakeFormData?: Array<{
    ticket_type_id: string;
    schema_version_id: string;
    answers: Record<string, unknown>;
  }>;
  // ORCH-1130 [public trip page payment-structure] / DISC-1130-A consent fix —
  // the buyer's explicit pay-full vs pay-over-time choice for a plan trip.
  // Forwarded as the `payment_plan_choice` body key (already accepted by
  // ticket-checkout-create). When the trip has a plan the caller MUST pass an
  // explicit "full" | "installments" — NEVER omit, or the server defaults to
  // 'auto' (deposit-only) with no buyer consent. No-plan trips omit the key →
  // request shape stays byte-identical (the edge-fn default path is untouched).
  paymentPlanChoice?: "full" | "installments";
  // ORCH-1244 (Apple Guideline 4.9) — the on-screen product name (event / trip /
  // experience title) the caller is purchasing. Becomes the Apple Pay summary
  // line label so the sheet shows the PRODUCT, not the bare company name. The
  // calling detail screen always has this (it's the title on screen). Optional
  // for back-compat; an empty/missing value falls back to "Ticket" — NEVER
  // "Mingla". Client-only: NOT sent to the edge function.
  displayTitle?: string;
}

export type NativeCheckoutOutcome =
  | { outcome: "succeeded"; orderId: string }
  | { outcome: "canceled" }
  | {
      outcome: "failed";
      /**
       * ALWAYS buyer-facing copy (issue #2229). Never a server token — every
       * server error on this path goes through `nativeCheckoutErrorMessage`.
       */
      message: string;
      /**
       * issue #2229 — the bounded server token behind `message`, for callers
       * that must BRANCH on the reason (the Experience screen re-opens its
       * occurrence picker on a stale date). Callers display `message`; they
       * never display this.
       */
      token?: string | null;
    };

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
      returnUrl: string;
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

/**
 * issue #2227 [paystack payment page] — ONE create per checkout, structurally.
 *
 * The Paystack page this cart was already sent to, held IN MEMORY for the app's
 * lifetime so the buyer's next tap on the SAME cart re-opens the page they were
 * already given instead of asking the server for a second checkout (which the
 * server correctly refuses with 409 `checkout_in_progress`). This is the native
 * shape of what #2188 (`39b5147e9`) built on web against a cart fingerprint.
 *
 * MEMORY ONLY — never AsyncStorage, never a persisted store. A Paystack
 * authorization URL is a bearer capability to a payment page; persisting it
 * would leave a live payment link on disk after the app closes.
 *
 * Keyed by eventId (so a refusal for THIS event can find it) and matched on a
 * fingerprint of what is actually being bought, so a held URL can only ever be
 * replayed for the SAME purchase. Change the tickets, the buyer, the day or the
 * payment-plan choice and the fingerprint moves, the held URL stops matching,
 * and a fresh create runs — correct, because that is a different purchase with
 * a different server-side idempotency key.
 */
interface HeldPaystackHandoff {
  fingerprint: string;
  authorizationUrl: string;
  checkoutSessionId: string;
  buyerStatusToken: string;
  cachedAt: number;
}

/**
 * `ticket-checkout-create` sets the session's `p_expires_at` to now + 15 min.
 * An entry older than that can no longer be paid, so it is deleted rather than
 * served — a dead payment page is worse than no offer at all.
 */
const PAYSTACK_HANDOFF_TTL_MS = 15 * 60 * 1000;

const heldPaystackHandoffs = new Map<string, HeldPaystackHandoff>();

const checkoutFingerprint = (input: NativeCheckoutInput): string =>
  JSON.stringify({
    eventId: input.eventId,
    eventDateId: input.eventDateId ?? null,
    email: input.buyer.email.trim().toLowerCase(),
    phone: input.buyer.phone.trim(),
    lines: input.lines.map((line) => [line.ticketTypeId, line.quantity]),
    paymentPlanChoice: input.paymentPlanChoice ?? null,
    intakeFormData: input.intakeFormData ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  });

/** The live held hand-off for an event, or null. Expired entries are deleted. */
const readHeldHandoff = (eventId: string): HeldPaystackHandoff | null => {
  const held = heldPaystackHandoffs.get(eventId);
  if (held === undefined) return null;
  if (Date.now() - held.cachedAt >= PAYSTACK_HANDOFF_TTL_MS) {
    heldPaystackHandoffs.delete(eventId);
    return null;
  }
  return held;
};

const holdHandoff = (eventId: string, held: HeldPaystackHandoff): void => {
  heldPaystackHandoffs.set(eventId, held);
};

/** The order finalized (or the buyer moved on) — the held page is spent. */
const clearHeldHandoff = (eventId: string): void => {
  heldPaystackHandoffs.delete(eventId);
};

/**
 * issue #2227 QA F-3 — Constitution #6, *logout clears everything*.
 *
 * A Paystack authorization URL is a BEARER CAPABILITY to a live payment page,
 * scoped to one buyer (the fingerprint carries their email and phone). The
 * header above refuses to put it on disk for exactly that reason; memory that
 * outlives the session it belongs to is the same argument one step weaker. So
 * every hold — for every event — dies with the session.
 *
 * Called from `performPrivateAuthCleanup`, which is the single funnel for
 * sign-out, account switch and JWT expiry.
 */
export const clearAllHeldHandoffs = (): void => {
  heldPaystackHandoffs.clear();
};

/**
 * Send the buyer to Paystack, then poll the server for the finalized order.
 *
 * Used both for a freshly created checkout AND for replaying a held one, so
 * both paths get identical browser handling and identical polling.
 */
async function followPaystackHandoff(
  eventId: string,
  authorizationUrl: string,
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<NativeCheckoutOutcome> {
  let opened: WebBrowser.WebBrowserResult;
  try {
    // #2227 — DO NOT change this back to openAuthSessionAsync with an https redirect.
    // The server's returnUrl is https://host.usemingla.com/..., and expo-web-browser
    // >= 15 selects ASWebAuthenticationSession(callback: .https(...)) on iOS >= 17.4,
    // which REQUIRES a `webcredentials:` Associated Domain the app does not have.
    // iOS destroys the session in <100ms and logs it as "cancelled by user", so the
    // buyer never sees Paystack. Proven 2026-08-18; see issue #2227.
    // Invariant: I-PROPOSED-NATIVE-BROWSER-NO-HTTPS-AUTHSESSION.
    opened = await WebBrowser.openBrowserAsync(authorizationUrl);
  } catch (err) {
    // #2227 F-2 — openBrowserAsync throws only for an invalid URL or an
    // unavailable module, i.e. states in which the page was PROVABLY never
    // shown. The buyer cannot have paid, so do NOT walk into a 25-second poll
    // they cannot win: tell them now.
    console.warn("[nativeCheckoutFlow] paystack browser did not open", err);
    return { outcome: "failed", message: CHECKOUT_NO_HANDOFF_MESSAGE };
  }

  // iOS refuses to present when another in-app browser session is already open.
  // Same fact as a throw: the buyer never saw Paystack. Never poll on it.
  if (opened.type === WebBrowser.WebBrowserResultType.LOCKED) {
    return { outcome: "failed", message: CHECKOUT_NO_HANDOFF_MESSAGE };
  }

  // Any other resolution (dismiss / cancel / opened) is indistinguishable from
  // "the buyer closed the page after paying", so the server decides — the
  // webhook is the truth source and the poll is what waits for it.
  const orderId = await pollPaystackOrder(checkoutSessionId, buyerStatusToken);
  if (orderId) {
    clearHeldHandoff(eventId);
    return { outcome: "succeeded", orderId };
  }
  return {
    outcome: "failed",
    message:
      "We couldn't confirm your payment yet. If you completed it, your tickets will appear shortly.",
  };
}

async function preflightPaymentSheet(
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke<{ status?: string }>(
    "ticket-checkout-status",
    { body: { checkoutSessionId, buyerStatusToken, preflight: true } },
  );
  return error == null && data?.status === "present_allowed";
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

    const fingerprint = checkoutFingerprint(input);

    // issue #2227 — if this exact cart has already been handed a Paystack page,
    // RE-OPEN THAT ONE. The server refuses a second create for a cart with a
    // live provider attempt (409 `checkout_in_progress`) and it is right to;
    // re-following the URL we were already given is what the buyer actually
    // wants, and it is what makes "Reopen it to finish" true without a second
    // control. Structurally: one checkout produces exactly one create call
    // (#2188's property, carried onto native).
    const heldForCart = readHeldHandoff(input.eventId);
    if (heldForCart !== null && heldForCart.fingerprint === fingerprint) {
      return await followPaystackHandoff(
        input.eventId,
        heldForCart.authorizationUrl,
        heldForCart.checkoutSessionId,
        heldForCart.buyerStatusToken,
      );
    }

    // 1. Create the checkout session on the server.
    const { data, error } = await supabase.functions.invoke<CheckoutCreateResponse>(
      "ticket-checkout-create",
      {
        body: {
          eventId: input.eventId,
          surface: "native",
          returnContract: "host_v1",
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
          // ORCH-1072: forward the chosen occurrence only when present — the
          // edge fn validates it (future + belongs to event + not sold out) and
          // persists it; absent → unchanged single-date path.
          ...(input.eventDateId ? { eventDateId: input.eventDateId } : {}),
          // ORCH-1130 / DISC-1130-A — forward the explicit pay-full vs
          // pay-over-time choice for plan trips. Omitted when absent (no-plan
          // trips) → byte-identical request, edge-fn default 'auto' path
          // untouched for the 99% non-plan case.
          ...(input.paymentPlanChoice
            ? { payment_plan_choice: input.paymentPlanChoice }
            : {}),
          ...(input.idempotencyKey !== undefined
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
        },
      },
    );

    if (error) {
      // issue #2229 — read the HTTP status off error.context BEFORE
      // extractFunctionError: that helper CONSUMES the Response body and a body
      // can only be read once. Status is a property, not the stream.
      const status =
        (error as { context?: { status?: number } })?.context?.status ?? null;
      const raw = await extractFunctionError(error, "");
      const token = raw.length > 0 ? raw : null;
      // #2227 QA F-1 — NO held page is offered back here. The refusal path has
      // no access to the cart fingerprint that the replay path above matches
      // on, so anything handed back from here could be the page for a DIFFERENT
      // cart (page A for 1x GA, offered to a cart now holding 3x VIP) — the
      // exact hazard the fingerprint exists to prevent. The replay above is the
      // ONLY way a held page is ever re-opened, and it is fingerprint-gated.
      // If a resume affordance is ever wanted on this path it gets built
      // against the fingerprint from the start, with its own spec.
      return {
        outcome: "failed",
        message: nativeCheckoutErrorMessage(token, status),
        token,
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
      clearHeldHandoff(input.eventId);
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
        // ORCH-1244 (Apple Guideline 4.9): pass an explicit cartItems whose
        // label is the PRODUCT (event/trip/experience title) so the Apple Pay
        // summary line shows the product, not the bare company name "Mingla".
        // Without this, Stripe defaults the total line's label to
        // merchantDisplayName ("Mingla") — the violation Apple flagged. Empty
        // title → "Ticket" fallback, never the merchant name.
        applePay: {
          merchantCountryCode: "US",
          cartItems: buildApplePayCartItems(
            input.displayTitle,
            data.totalCents,
            "Ticket",
          ),
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

      // #1930: this is a final Mingla status check, not authorization of the
      // Stripe SDK's later confirm. A closure can still race after this point;
      // server finalize/reversal remains authoritative.
      if (
        !await preflightPaymentSheet(
          data.checkoutSessionId,
          data.buyerStatusToken,
        )
      ) {
        return {
          outcome: "failed",
          message: "This sale is no longer available.",
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
      clearHeldHandoff(input.eventId);
      return { outcome: "succeeded", orderId: data.checkoutSessionId };
    }

    // 2c. META-ORCH-1076 — Paystack (NGN). Open Paystack's hosted checkout in
    // an in-app browser, then poll the server for the finalized order.
    if (data.kind === "requires_paystack_redirect") {
      // Hold the page BEFORE opening it: if the browser cannot present, or the
      // buyer closes it and taps again, the next tap re-opens THIS page instead
      // of creating a second checkout the server would refuse.
      //
      // `data.returnUrl` is deliberately NOT passed to the browser — see the
      // protective comment on followPaystackHandoff. The server still needs it
      // for Paystack's own callback_url and for the buyer-web rail; it is only
      // the NATIVE redirect-interception argument that was fatal.
      holdHandoff(input.eventId, {
        fingerprint,
        authorizationUrl: data.authorizationUrl,
        checkoutSessionId: data.checkoutSessionId,
        buyerStatusToken: data.buyerStatusToken,
        cachedAt: Date.now(),
      });
      return await followPaystackHandoff(
        input.eventId,
        data.authorizationUrl,
        data.checkoutSessionId,
        data.buyerStatusToken,
      );
    }

    // 2d. Web redirect from a native client is a server/client mismatch.
    return {
      outcome: "failed",
      message: "Unexpected web checkout response on native client.",
    };
  };
};
