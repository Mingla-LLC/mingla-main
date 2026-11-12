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
 *      <StripeNativeProvider> mount in the checkout payment route wrapper.
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

import {
  isStripeGooglePayTestEnv,
  useStripePaymentSheet,
} from "@mingla/payments-native";
import { initStripe } from "@stripe/stripe-react-native";
// META-ORCH-1076 [Paystack Africa] — in-app browser for the Paystack hosted
// checkout redirect (mirror of app-mobile). We never parse payment state from
// the redirect; we poll ticket-checkout-status (driven by the verified
// charge.success webhook — the source of truth).
//   https://paystack.com/docs/guides/using_the_paystack_checkout_in_a_mobile_webview/
import * as WebBrowser from "expo-web-browser";

import { supabase } from "../services/supabase";
// issue #3281 — server refusals are mapped to buyer copy, never shown raw.
import {
  checkoutRefusalRaiseMessage,
  readEdgeRefusal,
} from "../services/checkoutErrorCopy";
import {
  PAID_CHECKOUT_FAILED_MESSAGE,
  paidCheckoutErrorMessage,
} from "../services/ticketCheckoutService";
import { ticketCheckoutReviewFromError } from "../services/ticketCheckoutReview";
// issue #3281 (bundle 6b) — the Paystack page this purchase was already sent to.
import { waitForPaymentPageClosed } from "@mingla/payments-native/paymentPageReturn";
import {
  clearHeldHandoff,
  dropHeldHandoff,
  handoffElapsedMs,
  handoffGeneration,
  handoffLifetimeMs,
  holdHandoff,
  isHandoffLive,
  monotonicNow,
  readHeldHandoff,
  tightenHandoffLifetime,
  type HeldPaystackHandoff,
} from "./paystackHeldHandoff";
import type { TicketCheckoutReview } from "@mingla/offering-rendering/discountQuote";
// issue #3281 — checkout contract v2: per-line plan choice, dates and extras,
// one attempt id per logical submission. Same shared normalizer buyer web uses.
import {
  isCheckoutAttemptId,
  normalizeCheckoutV2Lines,
  TICKET_CHECKOUT_CONTRACT_VERSION,
  type CheckoutAddOnRequest,
  type CheckoutLinePlanChoice,
} from "@mingla/offering-rendering/ticketCheckoutContract";
// ORCH-1246 (Apple 4.9) — Apple Pay sheet must show the product, not the company.
import { buildApplePayCartItems } from "./applePayCartItems";

/**
 * issue #3281 — one cart line. v1 (trip / experience) reads ticket and
 * quantity only; v2 (event tickets) also reads the line's plan choice, its
 * per-date quantities and its extras.
 */
export interface NativeCheckoutLine {
  ticketTypeId: string;
  quantity: number;
  paymentPlanChoice?: CheckoutLinePlanChoice;
  byDate?: Readonly<Record<string, number>>;
  addOns?: readonly CheckoutAddOnRequest[];
}

export interface NativeCheckoutInput {
  eventId: string;
  lines: NativeCheckoutLine[];
  /**
   * issue #3281 — checkout contract v2 (event tickets). When set, the request
   * carries `checkoutAttemptId`, `purchaseTermsAccepted` and per-line
   * `paymentPlanChoice` / `byDate` / `addOns`, and never the scalar
   * `payment_plan_choice`. Absent → the v1 body, byte-identical (trip and
   * experience checkout).
   */
  checkoutContractVersion?: typeof TICKET_CHECKOUT_CONTRACT_VERSION;
  /** issue #3281 — v2 only: the cart's attempt id (same id across retries). */
  checkoutAttemptId?: string;
  /** issue #3281 — v2 only: must be true, or nothing is sent. */
  purchaseTermsAccepted?: boolean;
  /** issue #3281 — private ticket link the guest arrived through, if any. */
  ticketLinkToken?: string;
  buyer: {
    name: string;
    email: string;
    phone: string;
    marketingOptIn?: boolean;
    // ORCH-1130 Fix #2 — buyer address is OPTIONAL. Tax is venue-sourced
    // server-side (events.venue_tax_address); the buyer never types an
    // address (MINGLA-WIDE all-in / WYSIWYP). Retained optional only for
    // backward compat with older callers; the server ignores it.
    address?: {
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      postal: string;
      country: string;
    };
  };
  paymentPlanChoice?: "full" | "installments";
  idempotencyKey?: string;
  taxCalculationId?: string | null;
  discountCode?: string | null;
  /** #3872 — current callers always pass both; optional for pre-R1 call sites. */
  quoteDigest?: string;
  quoteListDigest?: string;
  /**
   * ORCH-1138 Leg 3 — the chosen experience occurrence's event_dates.id (adaptive
   * Reserve picker). Forwarded ONLY when present → byte-identical request on the
   * single/no-date path. The edge fn already validates + binds it.
   */
  eventDateId?: string;
  /**
   * issue #3281 — the guest's chosen day SET (#2160) for a multi-date or
   * recurring event. Same field name and shape buyer web
   * (`ticketCheckoutService.createTicketCheckout`) and the consumer app send,
   * and that `ticket-checkout-create` reads (`body.eventDateIds`). Forwarded
   * ONLY when non-empty, so a single-date request stays byte-identical.
   */
  eventDateIds?: readonly string[];
  /** issue #3281 — open-daily booked start (ISO). Omitted when absent. */
  bookedStartAt?: string;
  /** issue #3281 R2 — block hire end (ISO). Omitted when absent. */
  bookedEndAt?: string;
  /** issue #3281 R2 — guest party size. Omitted when absent. */
  partySize?: number;
  /**
   * ORCH-1246 (Apple 4.9) — the on-screen event/trip/experience title, threaded
   * from the checkout route so the Apple Pay sheet's line item shows the PRODUCT
   * (not the company / merchantDisplayName). Optional: when absent/empty the
   * applePay cartItem falls back to a neutral label (e.g. "Ticket") — NEVER the
   * company name.
   */
  displayTitle?: string;
}

export type NativeCheckoutOutcome =
  | { outcome: "succeeded"; orderId: string }
  | { outcome: "canceled" }
  | { outcome: "failed"; message: string; review?: TicketCheckoutReview };

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
    }
  // META-ORCH-1076 [Paystack Africa] — Nigerian (NGN) brands. Mirror of the
  // app-mobile consumer arm; the in-app browser opens Paystack hosted checkout
  // and we poll the server for the finalized order.
  | {
      kind: "requires_paystack_redirect";
      checkoutSessionId: string;
      buyerStatusToken: string;
      authorizationUrl: string;
      returnUrl: string;
      /** issue #3281 (bundle 6c) — seconds left on the session (newer servers). */
      expiresInSeconds?: number;
      reference: string;
      totalCents: number;
      currency: string;
    };

const MERCHANT_DISPLAY_NAME = "Mingla";

// META-ORCH-1076 — bounded poll for the Paystack order (webhook is the truth;
// the redirect is unreliable). ~25s budget at 1.5s intervals. Mirror of the
// app-mobile consumer helper.
const PAYSTACK_POLL_INTERVAL_MS = 1500;
const PAYSTACK_POLL_MAX_ATTEMPTS = 17;

/**
 * issue #2264 — the return-leg copy, declared HERE because this app has no
 * `checkoutErrorMessages.ts` (#2229 scoped it to app-mobile).
 *
 * These four strings are BYTE-IDENTICAL to app-mobile's
 * `src/payments/checkoutErrorMessages.ts` constants of the same names, and the
 * parity test `src/payments/__tests__/native_checkout_flow_parity.test.ts`
 * fails if they ever drift. Change one, change both.
 */
const CHECKOUT_ABANDONED_MESSAGE =
  "You closed the payment page before paying, so no tickets were issued. You have not been charged — reopen the payment page to finish, or start again.";

const CHECKOUT_PAYMENT_FAILED_MESSAGE =
  "Your payment didn't go through, so no tickets were issued. You have not been charged — please try again.";

const CHECKOUT_PAYMENT_MISMATCH_MESSAGE =
  "Your payment came back with a different amount or currency than this order, so no tickets were issued. If money left your account, contact support@usemingla.com before paying again.";

const CHECKOUT_AWAITING_CONFIRMATION_MESSAGE =
  "Paystack hasn't confirmed this payment yet. If you completed it, your tickets will arrive here and by email within a few minutes — don't pay again. If nothing arrives, contact support@usemingla.com.";

// issue #3281 — v2 needs the guest's acceptance before anything is sent.
const CHECKOUT_TERMS_REQUIRED_MESSAGE =
  "Accept the terms on the previous step to continue. You have not been charged.";

const CHECKOUT_UNAVAILABLE_MESSAGE =
  "This sale is no longer available — the organiser may have paused or changed this event. You have not been charged.";

// issue #3281 (bundle 6b) — byte-identical to app-mobile's constants of the same
// names; the parity test pins them.
const CHECKOUT_NO_HANDOFF_MESSAGE =
  "We couldn't open the secure payment page. You have not been charged — please try again.";

// issue #3281 (bundle 6b) — Host-app only: an earlier payment for this order
// (a Paystack page or a payment sheet) is still open on the server and cannot
// be reopened from here. Paystack sessions last 15 minutes.
const CHECKOUT_IN_PROGRESS_NATIVE_MESSAGE =
  "Your last payment for this order hasn't finished yet. If you paid, your tickets will arrive here and by email within a few minutes — don't pay again. If you didn't, try again in up to 15 minutes.";

// issue #3281 (bundle 6b) — Host-app only: the held page could not be checked
// before reopening it, so it was not opened.
const CHECKOUT_RECHECK_FAILED_MESSAGE =
  "We couldn't check your payment page just now, so we didn't reopen it. Check your connection and try again.";

// issue #3281 (bundle 6c) — Host-app only: the held or new page's session had
// run out before the page could be opened. A held page may already have been
// paid (the payment can still be settling), so this never says "not charged"
// or invites paying again without that warning.
const CHECKOUT_PAGE_EXPIRED_MESSAGE =
  "This payment page has expired, so we didn't reopen it. If you already paid, your tickets will arrive here and by email within a few minutes — don't pay again. If you didn't, start the payment again.";

const CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE =
  "We couldn't issue your tickets for this sale. If your payment went through, we're sorting it out and will email you — please don't pay again. Contact support@usemingla.com and we'll pick it up from there.";

/**
 * issue #2264 — map `ticket-checkout-status`'s TERMINAL token to buyer copy.
 * Mirror of app-mobile's `nativePaystackReturnMessage`. TOTAL by construction:
 * the final return is unconditional, so an unrecognised code degrades to
 * "we don't know yet" rather than to a false certainty about the buyer's money.
 */
const paystackReturnMessage = (code: string | null): string => {
  if (code === "paystack_charge_abandoned") return CHECKOUT_ABANDONED_MESSAGE;
  if (code === "paystack_charge_failed") return CHECKOUT_PAYMENT_FAILED_MESSAGE;
  if (code === "paystack_payment_mismatch") {
    return CHECKOUT_PAYMENT_MISMATCH_MESSAGE;
  }
  if (code === "checkout_unavailable") return CHECKOUT_UNAVAILABLE_MESSAGE;
  return CHECKOUT_AWAITING_CONFIRMATION_MESSAGE;
};

/**
 * issue #2264 — the three things the server can actually tell us, kept
 * DISTINCT. The prior `Promise<string | null>` collapsed "the buyer never paid"
 * and "no order yet" into the same `null`, which is the whole defect.
 */
type PaystackPollOutcome =
  | { kind: "finalized"; orderId: string }
  | { kind: "terminal"; code: string | null }
  /**
   * issue #3281 (bundle 6b) — the server REFUSED the sale: HTTP 409 (the
   * session was revoked, or the payment is being reversed), or
   * `checkout_unavailable` at HTTP 200 (#2198's `paid_reversal_pending`). No
   * tickets will be issued; the held page must not be reopened. Mirror of
   * Explorer's `refused` kind.
   */
  | { kind: "refused" }
  | { kind: "timeout" };

/** What ONE `ticket-checkout-status` read told us. */
type CheckoutStatusReading =
  | Exclude<PaystackPollOutcome, { kind: "timeout" }>
  /** The server answered and the payment is simply not settled yet. */
  | { kind: "pending" }
  /** No usable answer: a thrown call, an HTTP error other than 409, no body. */
  | { kind: "no_answer" };

async function readCheckoutStatusOnce(
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<CheckoutStatusReading> {
  let data:
    | { status?: string; order: { orderId: string } | null; error?: string }
    | null
    | undefined;
  let error: unknown = null;
  try {
    // #2264 — the response type MUST declare `status` and `error`. The
    // previous generic named only `order`, so TypeScript hid the very fields
    // the server was sending.
    ({ data, error } = await supabase.functions.invoke<{
      status?: string;
      order: { orderId: string } | null;
      error?: string;
    }>("ticket-checkout-status", {
      body: { checkoutSessionId, buyerStatusToken },
    }));
  } catch (err) {
    // Transport failure is NOT an answer.
    console.warn(
      "[nativeCheckoutFlow:business] checkout-status poll failed",
      err,
    );
    data = null;
    error = null;
  }
  // A finalized order OUTRANKS any status string.
  const orderId = data?.order?.orderId;
  if (orderId) return { kind: "finalized", orderId };
  // #2264 — the server ALREADY answered this. ticket-checkout-status runs
  // #2198's Paystack verify on every poll and returns
  // { status:"failed", order:null, error:"paystack_charge_abandoned" } at HTTP 200
  // for a buyer who left without paying. Reading only `order` is what made the
  // app tell an unpaid buyer "we couldn't confirm your payment" after 25 seconds.
  // Do not narrow this response type again.
  // Invariant: I-PROPOSED-CHECKOUT-STATUS-ANSWER-NOT-DISCARDED.
  if (data?.status === "failed") {
    // #2264 — `checkout_unavailable` here is a sale being reversed under a
    // payment: a refusal, never a page to reopen.
    if (data.error === "checkout_unavailable") return { kind: "refused" };
    return { kind: "terminal", code: data.error ?? null };
  }
  // A 409 is the server refusing the sale. Without this the buyer waited out
  // the whole budget for a sale that was already refused.
  if (
    error != null &&
    (error as { context?: { status?: number } })?.context?.status === 409
  ) {
    return { kind: "refused" };
  }
  if (error == null && typeof data?.status === "string") {
    return { kind: "pending" };
  }
  return { kind: "no_answer" };
}

async function pollPaystackOrder(
  checkoutSessionId: string,
  buyerStatusToken: string,
  /**
   * issue #3281 (bundle 6c) — the page may still be open (Android split
   * screen). Paystack says `abandoned` / `failed` from initialize onward, so
   * those are not answers then: only a finalized order, a refusal or a
   * mismatch (money moved) end the wait.
   */
  pageMayBeOpen = false,
): Promise<PaystackPollOutcome> {
  for (let attempt = 0; attempt < PAYSTACK_POLL_MAX_ATTEMPTS; attempt++) {
    const reading = await readCheckoutStatusOnce(
      checkoutSessionId,
      buyerStatusToken,
    );
    const stillPaying =
      pageMayBeOpen &&
      reading.kind === "terminal" &&
      reading.code !== "paystack_payment_mismatch";
    if (
      reading.kind !== "no_answer" &&
      reading.kind !== "pending" &&
      !stillPaying
    ) {
      return reading;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, PAYSTACK_POLL_INTERVAL_MS),
    );
  }
  return { kind: "timeout" };
}

/**
 * issue #3281 (bundle 6b) — before a HELD page is reopened, ask the server
 * whether it may still be paid. Returns null when it may; otherwise the
 * outcome to show, having dropped the page if the answer was definitive.
 *
 *   1. One status read: an order that already finalized is returned as the
 *      success it is; a refusal (revoked, or a payment being reversed) drops
 *      the page.
 *   2. The #1930 preflight: the same admission check the payment sheet runs
 *      before presenting. A sale the organiser paused or cancelled since the
 *      page was issued is refused here, before the buyer can pay into it.
 *
 * Either read getting no usable answer (offline, a server error, an empty
 * body) keeps the page but does not open it: we could not prove it is still
 * payable, or that it was not already paid.
 */
async function revalidateHeldHandoff(
  eventId: string,
  handoff: HeldPaystackHandoff,
  generation: number,
): Promise<NativeCheckoutOutcome | null> {
  const reading = await readCheckoutStatusOnce(
    handoff.checkoutSessionId,
    handoff.buyerStatusToken,
  );
  if (reading.kind === "finalized") {
    clearHeldHandoff(eventId, generation);
    return { outcome: "succeeded", orderId: reading.orderId };
  }
  if (reading.kind === "refused") {
    clearHeldHandoff(eventId, generation);
    return { outcome: "failed", message: CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE };
  }
  if (
    reading.kind === "terminal" &&
    reading.code === "paystack_payment_mismatch"
  ) {
    clearHeldHandoff(eventId, generation);
    return { outcome: "failed", message: paystackReturnMessage(reading.code) };
  }
  // No usable answer: the preflight checks admission, not payment, so it
  // cannot stand in for this read. Keep the page; do not open it.
  if (reading.kind === "no_answer") {
    return { outcome: "failed", message: CHECKOUT_RECHECK_FAILED_MESSAGE };
  }
  let preflight: {
    data: { status?: string; expiresInSeconds?: unknown } | null;
    error: unknown;
  };
  // issue #3281 (bundle 6d) — how old the page was when we asked; the
  // server's seconds left count from no earlier than this.
  const elapsedAtAsk = handoffElapsedMs(handoff);
  try {
    preflight = await supabase.functions.invoke<{ status?: string }>(
      "ticket-checkout-status",
      {
        body: {
          checkoutSessionId: handoff.checkoutSessionId,
          buyerStatusToken: handoff.buyerStatusToken,
          preflight: true,
        },
      },
    );
  } catch (err) {
    console.warn(
      "[nativeCheckoutFlow:business] held page preflight failed",
      err,
    );
    return { outcome: "failed", message: CHECKOUT_RECHECK_FAILED_MESSAGE };
  }
  if (preflight.error == null && preflight.data?.status === "present_allowed") {
    // issue #3281 (bundle 6c) — the server's own seconds left. The hold was
    // timed on this device; if the create's expiry read failed, or the
    // session was an older one reused, the real limit can be shorter.
    // bundle 6d: the hold is shortened to match (never lengthened), and the
    // live check right before opening enforces it.
    tightenHandoffLifetime(
      handoff,
      preflight.data.expiresInSeconds,
      elapsedAtAsk,
    );
    if (!isHandoffLive(handoff)) {
      dropHeldHandoff(eventId, handoff.fingerprint, generation);
      return { outcome: "failed", message: CHECKOUT_PAGE_EXPIRED_MESSAGE };
    }
    return null;
  }
  const status =
    (preflight.error as { context?: { status?: number } } | null)?.context
      ?.status ?? null;
  // issue #3281 (bundle 6d) — a refusal proves only that the page will not
  // reopen, not that no earlier payment went through (one can settle between
  // the status read and this check), so the copy never says "not charged".
  if (status === 403 || status === 404) {
    // The session is gone or is not this buyer's: the page is spent.
    clearHeldHandoff(eventId, generation);
    return { outcome: "failed", message: CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE };
  }
  if (status === 409) {
    // Not admitted right now: the organiser paused or cancelled the sale, or
    // the provider attempt is not ready. The page is NOT dropped (a sale can
    // be resumed) and NOT opened; every later tap re-checks first. A failed
    // check is a 503 and falls to the copy below.
    return { outcome: "failed", message: CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE };
  }
  return { outcome: "failed", message: CHECKOUT_RECHECK_FAILED_MESSAGE };
}

/**
 * issue #3281 (bundle 6b) — send the buyer to Paystack, then poll the server
 * for the finalized order. Used for a fresh checkout AND for reopening a held
 * page, so both get identical browser handling and polling. Mirror of
 * Explorer's `followPaystackHandoff`.
 */
async function followPaystackHandoff(
  eventId: string,
  handoff: HeldPaystackHandoff,
  generation: number,
): Promise<NativeCheckoutOutcome> {
  // issue #3281 (bundle 6c) — re-checked right before opening: the deadline
  // can pass during the re-check's network calls, and a fresh session can
  // arrive with no time left. An expired page is never opened.
  if (!isHandoffLive(handoff)) {
    // Only THIS purchase's page ran out; other carts' pages stay held.
    dropHeldHandoff(eventId, handoff.fingerprint, generation);
    return { outcome: "failed", message: CHECKOUT_PAGE_EXPIRED_MESSAGE };
  }
  let opened: WebBrowser.WebBrowserResult;
  try {
    // #2227 — openBrowserAsync, NOT openAuthSessionAsync. The redirect
    // argument here was the server's https returnUrl, which makes
    // expo-web-browser >= 15 ask iOS >= 17.4 for an
    // ASWebAuthenticationSession .https callback; that requires a
    // `webcredentials:` Associated Domain the app does not have, so iOS
    // destroyed the session in <100ms and logged "cancelled by user" — the
    // buyer never saw Paystack. The server still needs returnUrl for
    // Paystack's own callback_url and for the web rail; only this native
    // interception argument was fatal. Never reintroduce it.
    // Invariant: I-PROPOSED-NATIVE-BROWSER-NO-HTTPS-AUTHSESSION.
    opened = await WebBrowser.openBrowserAsync(handoff.authorizationUrl);
  } catch (err) {
    // #2227 F-2 — openBrowserAsync throws only for an invalid URL or an
    // unavailable module: the page was provably never shown, so the buyer
    // cannot have paid. Say so now instead of a 25-second poll they cannot
    // win. The page stays held, so the next tap tries to open it again.
    console.warn("[nativeCheckoutFlow:business] paystack browser error", err);
    return { outcome: "failed", message: CHECKOUT_NO_HANDOFF_MESSAGE };
  }
  // iOS refuses to present while another in-app browser is open. Same fact as
  // a throw: the buyer never saw Paystack. Never poll on it.
  if (opened?.type === WebBrowser.WebBrowserResultType.LOCKED) {
    return { outcome: "failed", message: CHECKOUT_NO_HANDOFF_MESSAGE };
  }
  // issue #3281 (bundle 6c) — on Android the browser call returns `opened`
  // while the buyer is still on the page; wait until they are back before
  // asking the server (the poll-after-close invariant below).
  const pageReturn = await waitForPaymentPageClosed(opened);
  // Signed out while the buyer was away: nothing below belongs to whoever is
  // signed in now.
  if (handoffGeneration() !== generation) return { outcome: "canceled" };

  // #2264 F-6 — this poll runs ONLY after the browser has closed, and that
  // ordering is load-bearing. Paystack reports a transaction as `abandoned`
  // from initialize onward, before the buyer has typed anything, so a poll
  // running concurrently with an OPEN browser would tell a paying buyer they
  // walked away. #2250's auto-close needs a concurrent poll: when it lands,
  // it must ignore the terminal token until the browser is confirmed closed.
  // Invariant: I-PROPOSED-PAYSTACK-ABANDONED-ONLY-AFTER-BROWSER-CLOSES.
  const poll = await pollPaystackOrder(
    handoff.checkoutSessionId,
    handoff.buyerStatusToken,
    pageReturn === "unconfirmed",
  );
  if (handoffGeneration() !== generation) return { outcome: "canceled" };
  if (poll.kind === "finalized") {
    clearHeldHandoff(eventId, generation);
    return { outcome: "succeeded", orderId: poll.orderId };
  }
  if (poll.kind === "refused") {
    // Reopening the page would ask the buyer to pay into a refused sale.
    clearHeldHandoff(eventId, generation);
    return { outcome: "failed", message: CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE };
  }
  if (poll.kind === "terminal" && poll.code === "paystack_payment_mismatch") {
    // Money moved and the server already failed the session: reopening the
    // page would invite a second payment.
    clearHeldHandoff(eventId, generation);
    return { outcome: "failed", message: paystackReturnMessage(poll.code) };
  }
  // The page is DELIBERATELY kept on the remaining arms (#2264). An abandoned
  // or failed charge leaves the session live and the page payable, and the
  // abandoned copy tells the buyer to reopen it. After a timeout the buyer may
  // have paid; Paystack refuses a second charge on the same reference.
  if (poll.kind === "terminal") {
    return { outcome: "failed", message: paystackReturnMessage(poll.code) };
  }
  return { outcome: "failed", message: CHECKOUT_AWAITING_CONFIRMATION_MESSAGE };
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

// ORCH-0849: business merchant identifier + URL scheme. Must match the
// Stripe Dashboard registration AND the <StripeNativeProvider> mount in
// StripeProviderWrapper.native.tsx AND the Stripe plugin entry in
// mingla-business/app.json. If any of these three drift, Apple Pay
// silently disappears from PaymentSheet (NOT a crash post-ORCH-0844 —
// just absent). CI gate i-stripe-paymentsheet-parity.mjs verifies the
// three locations agree.
// ORCH-0849 HOTFIX (round 4, 2026-05-16): runtime merchantIdentifier
// MUST match the in-app-payments entitlement baked into the iOS build
// (driven by app.json's @stripe/stripe-react-native plugin merchantIdentifier
// at app.json:99). That value is `merchant.com.sethogieva.minglabusiness`
// because that's what's actually registered with Apple Developer + has the
// Stripe Apple Pay Payment Processing Certificate uploaded. Any other value
// here makes iOS reject Apple Pay at sheet-confirm time (sheet opens, stalls,
// never resolves) — operator-observed live behavior on 2026-05-16.
// URL scheme matches the iOS bundleIdentifier (com.sethogieva.minglabusiness)
// for return-URL deep links.
const BUSINESS_MERCHANT_IDENTIFIER = "merchant.com.sethogieva.minglabusiness";
const BUSINESS_URL_SCHEME = "com.sethogieva.minglabusiness";

/**
 * issue #3281 — map a `ticket-checkout-create` refusal to BUYER COPY.
 *
 * The previous extractor returned the server's `error` token verbatim, so a
 * guest saw `event_date_choice_required` in red under the Pay button. Now:
 *   1. read the status / bounded token / detail with the SAME reader buyer web
 *      uses (`readEdgeRefusal`);
 *   2. an RPC raise token (in `error` or `detail`) gets its specific sentence
 *      from `checkoutErrorCopy.ts`;
 *   3. everything else goes through the web paid mapper, which is TOTAL and
 *      falls back to a generic "you have not been charged" sentence.
 * The raw token, the raw detail and the framework message are never returned.
 */
async function nativeCheckoutRefusalMessage(err: unknown): Promise<string> {
  const refusal = await readEdgeRefusal(err);
  // issue #3281 (bundle 6b) — the shared copy points at "the payment window",
  // which on this app is only true while the page is held. Reaching here means
  // it is not (the app restarted, or the hold expired), so say what is true.
  if (refusal.code === "checkout_in_progress") {
    return CHECKOUT_IN_PROGRESS_NATIVE_MESSAGE;
  }
  const raise = checkoutRefusalRaiseMessage(refusal.code, refusal.detail);
  if (raise !== undefined) return raise;
  return paidCheckoutErrorMessage({
    status: refusal.status,
    code: refusal.code,
    detail: refusal.detail,
  });
}

/** issue #3281 — mirror of app-mobile's `normalizedEventDateIds`. */
const normalizedEventDateIds = (input: NativeCheckoutInput): string[] =>
  (input.eventDateIds ?? []).filter(
    (id) => typeof id === "string" && id.length > 0,
  );

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

    // issue #3281 — v2 fails CLOSED before any network call: no terms, no
    // attempt id, a scalar plan choice or a line the shared normalizer refuses
    // means nothing is sent and nothing can be charged.
    const isCheckoutV2 =
      input.checkoutContractVersion === TICKET_CHECKOUT_CONTRACT_VERSION;
    let v2Lines: ReturnType<typeof normalizeCheckoutV2Lines> | null = null;
    if (isCheckoutV2) {
      if (input.purchaseTermsAccepted !== true) {
        return { outcome: "failed", message: CHECKOUT_TERMS_REQUIRED_MESSAGE };
      }
      if (
        !isCheckoutAttemptId(input.checkoutAttemptId) ||
        input.paymentPlanChoice !== undefined
      ) {
        return { outcome: "failed", message: PAID_CHECKOUT_FAILED_MESSAGE };
      }
      v2Lines = normalizeCheckoutV2Lines(
        input.lines.map((line) => ({
          ticketTypeId: line.ticketTypeId,
          quantity: line.quantity,
          paymentPlanChoice: line.paymentPlanChoice,
          ...(line.byDate !== undefined ? { byDate: line.byDate } : {}),
          ...(line.addOns !== undefined ? { addOns: line.addOns } : {}),
        })),
      );
      if (!v2Lines.ok) {
        return { outcome: "failed", message: PAID_CHECKOUT_FAILED_MESSAGE };
      }
    }

    // 1. Create the checkout session on the server. The request is built
    // first because it is also the purchase's fingerprint: the identical
    // request is the only one that may reopen a held Paystack page.
    const createBody = {
      eventId: input.eventId,
      surface: "native",
      returnContract: "host_v1",
      ...(isCheckoutV2
        ? {
            checkoutContractVersion: TICKET_CHECKOUT_CONTRACT_VERSION,
            checkoutAttemptId: input.checkoutAttemptId,
            purchaseTermsAccepted: true,
          }
        : {}),
      ...(input.ticketLinkToken !== undefined &&
      input.ticketLinkToken.length > 0
        ? { ticketLinkToken: input.ticketLinkToken }
        : {}),
      buyer: {
        name: input.buyer.name,
        email: input.buyer.email,
        phone: input.buyer.phone,
        marketingOptIn: true, // #4273: buying opts in
        // ORCH-1130 Fix #2 — only forward an address if a (legacy) caller
        // still supplies one. The server ignores it (tax is venue-sourced);
        // the no-address create computes the same all-in total.
        ...(input.buyer.address ? { address: input.buyer.address } : {}),
      },
      // issue #3281 — v2 sends the normalized lines (plan choice, dates,
      // extras); v1 keeps its body unchanged.
      lines: v2Lines?.ok ? v2Lines.lines : input.lines,
      ...(input.discountCode ? { discountCode: input.discountCode } : {}),
      quoteDigest: input.quoteDigest ?? null,
      quoteListDigest: input.quoteListDigest ?? null,
      ...(input.taxCalculationId
        ? { taxCalculationId: input.taxCalculationId }
        : {}),
      ...(!isCheckoutV2 && input.paymentPlanChoice !== undefined
        ? { payment_plan_choice: input.paymentPlanChoice }
        : {}),
      ...(input.idempotencyKey !== undefined
        ? { idempotencyKey: input.idempotencyKey }
        : {}),
      // ORCH-1138 Leg 3 — chosen occurrence ONLY when present (byte-identical
      // on null). The edge fn validates the eventDateId FK (investigation Q5).
      ...(input.eventDateId !== undefined && input.eventDateId.length > 0
        ? { eventDateId: input.eventDateId }
        : {}),
      // issue #3281 — the chosen day SET. Without it a multi-date or
      // recurring event is refused with `event_date_choice_required`
      // (#3313). Empty => omitted => byte-identical single-date request.
      ...(normalizedEventDateIds(input).length > 0
        ? { eventDateIds: normalizedEventDateIds(input) }
        : {}),
      ...(input.bookedStartAt !== undefined && input.bookedStartAt.length > 0
        ? { bookedStartAt: input.bookedStartAt }
        : {}),
      ...(input.bookedEndAt !== undefined && input.bookedEndAt.length > 0
        ? { bookedEndAt: input.bookedEndAt }
        : {}),
      ...(typeof input.partySize === "number" &&
      Number.isFinite(input.partySize) &&
      input.partySize >= 1
        ? { partySize: Math.floor(input.partySize) }
        : {}),
    };

    // issue #3281 (bundle 6b) — this exact purchase was already sent to a
    // Paystack page: reopen THAT page. The server refuses a second create for
    // it (409 `checkout_in_progress`), and the abandoned-page copy tells the
    // buyer to reopen the page; this is what makes that sentence true. Mirror
    // of Explorer's #2227 replay.
    //
    // The buyer's display name is left out: the server's session key does not
    // read it (v1), and v2's attempt id already changes with it. Leaving it in
    // would send a name-only edit to a create the server refuses as in
    // progress, which is the stuck state this exists to fix.
    const fingerprint = JSON.stringify({
      ...createBody,
      buyer: { ...createBody.buyer, name: undefined },
    });
    const generation = handoffGeneration();
    const heldForCart = readHeldHandoff(input.eventId, fingerprint);
    if (heldForCart !== null) {
      const refused = await revalidateHeldHandoff(
        input.eventId,
        heldForCart,
        generation,
      );
      // Signed out while we were checking: whatever the check found (even a
      // finalized order) belongs to that session, never to whoever is here now.
      if (handoffGeneration() !== generation) return { outcome: "canceled" };
      if (refused !== null) return refused;
      return await followPaystackHandoff(
        input.eventId,
        heldForCart,
        generation,
      );
    }

    // Taken BEFORE the create: the server starts the session's 15 minutes when
    // it writes the row, so the hold must never outlive it.
    const requestedAt = Date.now();
    const requestedAtMono = monotonicNow();
    const { data, error } =
      await supabase.functions.invoke<CheckoutCreateResponse>(
        "ticket-checkout-create",
        { body: createBody },
      );

    if (error) {
      const refusal = await readEdgeRefusal(error);
      const review = ticketCheckoutReviewFromError(
        {
          code: refusal.code,
          detail: refusal.detail,
          reviewQuote: refusal.quote ?? null,
        },
        null,
      );
      const message = await nativeCheckoutRefusalMessage(error);
      return {
        outcome: "failed",
        message,
        ...(review !== null ? { review } : {}),
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
      // issue #3281 (bundle 6b) — this event is bought: an older cart's held
      // Paystack page is spent too (Explorer parity).
      clearHeldHandoff(input.eventId, generation);
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
      // StripeNativeProvider mount in the payment route wrapper; if
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
          // ORCH-1246 (Apple 4.9): supply an explicit line item so the Apple Pay
          // sheet shows the PRODUCT (event/trip/experience title), not the
          // company. Without cartItems, PaymentSheet defaults the total line to
          // merchantDisplayName ("Mingla"). Fallback "Ticket" — never the company.
          cartItems: buildApplePayCartItems(
            input.displayTitle,
            data.totalCents,
            "Ticket",
          ),
        },
        googlePay: {
          merchantCountryCode: "US",
          testEnv: isStripeGooglePayTestEnv(data.publishableKey),
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

      // #1930: fail closed before presenting. Stripe still confirms client-side,
      // so server finalize/reversal owns any closure-after-preflight race.
      if (
        !(await preflightPaymentSheet(
          data.checkoutSessionId,
          data.buyerStatusToken,
        ))
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
      // for the finalized order.
      clearHeldHandoff(input.eventId, generation); // #3281 6b — Explorer parity
      return { outcome: "succeeded", orderId: data.checkoutSessionId };
    }

    // 2c. META-ORCH-1076 — Paystack (NGN). Open Paystack's hosted checkout in
    // an in-app browser, then poll the server for the finalized order.
    if (data.kind === "requires_paystack_redirect") {
      // Signed out while the create was in flight: this page and its status
      // token belong to the previous session. Never hold or open it.
      if (handoffGeneration() !== generation) return { outcome: "canceled" };
      // issue #3281 (bundle 6b) — held BEFORE the browser opens, so a buyer
      // who closes the page and taps Pay again reopens this same page.
      const handoff: HeldPaystackHandoff = {
        fingerprint,
        authorizationUrl: data.authorizationUrl,
        checkoutSessionId: data.checkoutSessionId,
        buyerStatusToken: data.buyerStatusToken,
        cachedAt: requestedAt,
        cachedAtMono: requestedAtMono,
        lifetimeMs: handoffLifetimeMs(data.expiresInSeconds),
      };
      holdHandoff(input.eventId, handoff);
      return await followPaystackHandoff(input.eventId, handoff, generation);
    }

    // 2d. Web redirect from a native client is a server/client mismatch
    // post-ORCH-0849 (business no longer requests surface: "mobile-web").
    return {
      outcome: "failed",
      message: "Unexpected web checkout response on native client.",
    };
  };
};
