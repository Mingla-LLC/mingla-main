import { supabase } from "./supabase";
// issue #2337 — the free rail's guest copy, its bounded-token mapper and the
// transport-refusal readers live in a dependency-free module so a Deno test can
// drive the REAL edge handler and the REAL mapper in one process. Re-exported
// below so every existing import site is untouched.
import {
  codeOf,
  httpStatusOf,
  readEdgeRefusal,
} from "./checkoutErrorCopy";
import type { BuyerDetails, CartLine, OrderResult } from "../components/checkout/CartContext";
// ISSUE-865 WP-C — thread the first-party ad click_id (captured on the public
// page) into checkout-create so the post-finalize conversion send can link the
// order to its campaign. Web-only source (native returns null → field omitted).
import {
  getStoredClickAttribution,
  getStoredSiteAttribution,
} from "../analytics/webAnalytics";

export interface TicketCheckoutCreateInput {
  eventId: string;
  buyer: BuyerDetails;
  lines: CartLine[];
  /**
   * issue #2150 — the buyer status token from THIS guest's earlier submit for
   * this event, when the browser still holds one.
   *
   * Sent only so an anonymous guest resubmitting an identical FREE reservation
   * can PROVE the completed reservation is theirs and be handed their existing
   * order and passes back. Without it the server still refuses to mint a
   * duplicate, but declines to disclose the order — email + phone + cart are
   * knowledge, not possession, and must never be enough to obtain someone's QR
   * code. Omitted when absent so every other request stays byte-identical.
   */
  buyerStatusToken?: string;
  /**
   * ORCH-0790 / ORCH-0839-B: discriminator for the checkout surface.
   *  - "native" — DEPRECATED in mingla-business as of ORCH-0839-B (2026-05-14).
   *    Older app builds may still send this; the edge function preserves the
   *    PaymentIntent path for backward compat but mingla-business no longer
   *    requests it.
   *  - "web" — web buyer; redirects via window.location.assign to a Stripe-
   *    hosted Checkout Session and returns to https://.../confirm?cs=...
   *  - "mobile-web" — NEW. mingla-business mobile (iOS + Android) buyer; opens
   *    the Stripe-hosted Checkout Session via
   *    expo-web-browser.openAuthSessionAsync and intercepts the
   *    mingla-business:// return-URL custom scheme.
   */
  surface?: "native" | "web" | "mobile-web";
  /**
   * ORCH-0915 — trip checkout buyer choice for tiers that have a payment
   * plan configured. Omitted by legacy callers/event checkout so the edge/RPC
   * keep their backward-compatible "auto" behavior.
   */
  paymentPlanChoice?: "full" | "installments";
  /**
   * ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake answers when the
   * trip has intake schemas. One entry per tier in the cart that has a schema
   * with ≥1 required question; the edge function gates HTTP 400
   * `intake_form_required` (with `missing_question_ids`) and HTTP 409
   * `intake_schema_stale` (with `current_schema_version_id`).
   *
   * Shape mirrors `intakeSchemaService.IntakeFormData`:
   *   { ticket_type_id, schema_version_id, answers: {[questionId]: value} }
   *
   * Typed as `unknown[]` here to avoid a service↔service circular import;
   * callers pass typed `IntakeFormData[]`. Omitting is safe for events +
   * trips without schemas.
   */
  intakeFormData?: unknown[];
  /**
   * ORCH-1138 Leg 3 — the chosen experience occurrence's event_dates.id, when
   * the buyer picked a slot from the adaptive Reserve picker
   * (recurring/multi-date/open-daily). The edge fn (ticket-checkout-create)
   * already validates + binds it (investigation Q5). OMITTED on the
   * single/no-date path so the request stays byte-identical to today.
   */
  eventDateId?: string;
  /**
   * issue #2160 [multi-day multi-select] — the days the guest chose on a
   * multi-date EVENT, as a SIBLING of `lines` rather than a per-line field.
   *
   * `lines` keeps its exact wire shape, which is what keeps
   * `order_line_items.total_cents = quantity x unit_price_cents` true in BOTH
   * pricing modes; the server applies the one per-mode multiplier. OMITTED when
   * empty so the request is byte-identical to today for every single-date
   * event, trip, RSVP and experience.
   */
  eventDateIds?: readonly string[];
}

export interface TicketCheckoutRequiresPayment {
  kind: "requires_payment";
  checkoutSessionId: string;
  buyerStatusToken: string;
  totalCents: number;
  currency: string;
  clientSecret: string;
  paymentIntentId: string;
  publishableKey: string | null;
}

// ORCH-0790: web buyers redirect to a Stripe-hosted Checkout Session page.
// The host app is expected to assign window.location to hostedCheckoutUrl
// and to persist {checkoutSessionId, buyerStatusToken} to sessionStorage
// before redirect so the confirm screen can resume polling after Stripe's
// success_url returns the buyer to /checkout/{eventId}/confirm.
export interface TicketCheckoutRequiresWebRedirect {
  kind: "requires_web_redirect";
  checkoutSessionId: string;
  buyerStatusToken: string;
  hostedCheckoutUrl: string;
  totalCents: number;
  currency: string;
}

export interface TicketCheckoutFreeCompleted {
  kind: "free_completed";
  orderId: string;
  checkoutSessionId: string;
  buyerStatusToken?: string;
  eventId: string;
  paymentStatus: "paid";
  totalCents: number;
  currency: string;
  /** ORCH-0804 — Stripe Tax amount in cents. 0 on free / door sales and on
   * orders where the brand isn't registered for tax in the buyer's
   * jurisdiction. Source: orders.tax_amount_cents persisted by
   * stripeWebhookRouter.handleCheckoutSessionCompleted from
   * session.total_details.amount_tax. */
  taxAmountCents?: number;
  tickets: OrderResult["tickets"];
  notificationStatus: OrderResult["notificationStatus"];
}

/**
 * issue #2188 [paid-checkout-redirect] — the Paystack arm of
 * `ticket-checkout-create` (supabase/functions/ticket-checkout-create/index.ts
 * :1225-1236). It has existed since META-ORCH-1076 and every OTHER buyer
 * surface consumes it (PublicEventPage chip-in, stay, venue reservation, the
 * order pad, both native checkout flows) — but it was never added to THIS
 * union, so the event-checkout payment screen could not see it and treated a
 * perfectly good Paystack hand-off as a failure.
 *
 * The redirect field is `authorizationUrl`, NOT Stripe's `hostedCheckoutUrl`.
 * Nothing outside `ticketCheckoutProviderHandoff` below may branch on which
 * one is present (Constitution #2 — one owner per truth).
 */
export interface TicketCheckoutRequiresPaystackRedirect {
  kind: "requires_paystack_redirect";
  checkoutSessionId: string;
  buyerStatusToken: string;
  /** Paystack's hosted payment page. The guest MUST be sent here. */
  authorizationUrl: string;
  /** Where Paystack returns the guest (…/confirm?cs=paystack&csi=…&bst=…). */
  returnUrl: string;
  reference: string;
  totalCents: number;
  currency: string;
}

/**
 * issue #2150 — the reservation already exists and this caller did not prove it
 * is theirs. Deliberately carries NO `orderId`, NO `checkoutSessionId`, NO
 * tickets and NO QR payload: the idempotency key is derived from the event, the
 * buyer's email and phone and the cart, all of which someone who merely KNOWS
 * the guest can type in, so disclosure requires possession of the buyer status
 * token. Nothing was minted — the server declined to tombstone regardless.
 */
export interface TicketCheckoutFreeAlreadyReserved {
  kind: "free_already_reserved";
  eventId: string;
}

export type TicketCheckoutCreateResult =
  | TicketCheckoutRequiresPayment
  | TicketCheckoutFreeAlreadyReserved
  | TicketCheckoutRequiresWebRedirect
  | TicketCheckoutRequiresPaystackRedirect
  | TicketCheckoutFreeCompleted;

export interface TicketCheckoutStatusResult {
  checkoutSessionId: string;
  status: string;
  order: Omit<TicketCheckoutFreeCompleted, "kind"> | null;
  /** issue #2198 — bounded reason on a terminal Paystack verify result. */
  error?: string | null;
}

/**
 * ORCH-0852 — bulletproof confirmation. Shape mirrors TicketCheckoutStatusResult
 * but `status` is a narrower union surfaced from ticket-checkout-confirm.
 * Reuses the same `order` shape so existing render paths interoperate.
 */
export interface TicketCheckoutConfirmResult {
  checkoutSessionId: string;
  status: "paid" | "pending" | "failed" | "expired";
  order: Omit<TicketCheckoutFreeCompleted, "kind"> | null;
  /**
   * issue #2198 — the bounded reason a `failed` confirm carries, derived
   * server-side from Paystack's verify response. Fed straight to
   * `paidCheckoutErrorMessage`, so the buyer is told what happened instead of
   * watching "Confirming your tickets…" forever.
   */
  error?: string | null;
}

export const FINALIZATION_BACKOFF_MS = [1000, 1500, 2000, 3000, 4000, 5000] as const;

const centsFromMajor = (value: number): number => Math.round(value * 100);

/**
 * issue #2101 [named-buyer checkout] — the stable access-denial tokens the
 * server returns before any session, capacity, provider or free-ticket work.
 * Mapping only: this file adds NO policy logic and NO second decision path.
 *
 * `sign_in_required` (HTTP 401) means the sale is restricted and the caller is
 * anonymous. `checkout_restricted` (HTTP 403) is the single indistinguishable
 * answer for every other access denial, so it never reveals list membership.
 */
export const TICKET_CHECKOUT_ACCESS_ERRORS = [
  "sign_in_required",
  "checkout_restricted",
] as const;

export type TicketCheckoutAccessError =
  (typeof TICKET_CHECKOUT_ACCESS_ERRORS)[number];

/** Supabase function errors are plain objects; the token rides `message`. */
export const ticketCheckoutAccessError = (
  error: unknown,
): TicketCheckoutAccessError | null => {
  const message =
    typeof error === "string"
      ? error
      : typeof (error as { message?: unknown })?.message === "string"
        ? ((error as { message: string }).message)
        : "";
  for (const token of TICKET_CHECKOUT_ACCESS_ERRORS) {
    if (message.includes(token)) return token;
  }
  return null;
};

/**
 * issue #2136 [free-ticket checkout] / issue #2337 — the guest-facing copy for a
 * free reservation that did not complete, and the mapper that chooses it.
 *
 * MOVED, NOT CHANGED IN OWNERSHIP. The definitions now live in
 * `./checkoutErrorCopy.ts`, which imports nothing, so the Deno suite for
 * `ticket-checkout-create` can exercise the real mapper against the real edge
 * handler's real 409 responses instead of a transcription of them. Re-exported
 * here so `buyer.tsx`, the #2136 suite and the #2150 suite keep importing from
 * exactly where they always did.
 *
 * #2337's rule: the mapper keys on the BOUNDED TOKEN, never on the status
 * alone. `httpStatusOf(error) === 409` used to be the first and only question
 * asked, and 409 is what the server answers for twelve distinct free-rail
 * conflicts — including `free_reservation_already_exists`, which means the guest
 * already HOLDS the ticket they were being told no longer existed.
 */
export {
  FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
  FREE_CHECKOUT_CONFLICT_MESSAGE,
  FREE_CHECKOUT_FAILED_MESSAGE,
  FREE_CHECKOUT_INTAKE_STALE_MESSAGE,
  FREE_CHECKOUT_MESSAGES,
  FREE_CHECKOUT_SOLD_OUT_MESSAGE,
  FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  // issue #2511 — the honest "we do not know" terminal arm.
  FREE_CHECKOUT_UNKNOWN_MESSAGE,
  FREE_RESERVATION_ALREADY_EXISTS_TOKEN,
  freeCheckoutErrorMessage,
  isFreeReservationAlreadyExists,
  TICKET_CAPACITY_EXCEEDED_TOKEN,
} from "./checkoutErrorCopy";
export type { CheckoutRefusal } from "./checkoutErrorCopy";

/**
 * issue #2136 — the server's `free_completed` envelope is only trustworthy when
 * it carries at least one issued ticket. `biz_ticket_checkout_finalize` has an
 * idempotent-replay arm that answers `{outcome,orderId}` with no tickets, and
 * before #2136 the Edge also relabelled a NO-ORDER finalize as `free_completed`.
 * A confirmation screen for a ticket that does not exist is strictly worse than
 * a visible error, so the client refuses the envelope rather than rendering it.
 */
/**
 * issue #2150 — narrow the "you already hold this" answer. Kept separate from
 * `isCompletedFreeOrder` on purpose: this result must never reach the confirm
 * screen, because there is no order payload to render.
 */
export const isFreeAlreadyReserved = (
  result: TicketCheckoutCreateResult,
): result is TicketCheckoutFreeAlreadyReserved =>
  result.kind === "free_already_reserved";

export const isCompletedFreeOrder = (
  result: TicketCheckoutCreateResult,
): result is TicketCheckoutFreeCompleted =>
  result.kind === "free_completed" &&
  typeof result.orderId === "string" &&
  result.orderId.length > 0 &&
  Array.isArray(result.tickets) &&
  result.tickets.length > 0;

/**
 * issue #2188 [paid-checkout-redirect] — THE hand-off resolver.
 *
 * The server answers a paid create with a redirect the guest must follow. WHICH
 * FIELD carries that redirect depends on the brand's provider: Stripe brands
 * send `hostedCheckoutUrl`, Nigerian (Paystack) brands send `authorizationUrl`.
 * This function is the ONLY place in the client allowed to know that. Callers
 * ask "where do I send the guest?" and get one answer or null.
 *
 * WHY IT EXISTS. `app/checkout/[eventId]/payment.tsx` used to hard-require
 * Stripe's shape (`kind !== "requires_web_redirect"` → throw). On a Paystack
 * brand the server had already created the session, already initialised the
 * Paystack transaction and already handed back the authorization URL — and the
 * client threw all of it away and showed an error. The guest then tapped Pay
 * again, which is the 409 in the #2188 edge log: the server correctly refusing
 * a second checkout for a cart that already had one in flight.
 *
 * Returns null ONLY when there is genuinely nowhere to send the guest (a native
 * PaymentSheet envelope, a free order, or a redirect field that came back
 * empty). Null is a real failure and callers must surface it — never retry.
 */
export interface TicketCheckoutProviderHandoff {
  checkoutSessionId: string;
  buyerStatusToken: string;
  /** The provider-hosted payment page. Follow it; do not create again. */
  redirectUrl: string;
}

const usableHandoff = (
  checkoutSessionId: string,
  buyerStatusToken: string,
  redirectUrl: string | null | undefined,
): TicketCheckoutProviderHandoff | null =>
  typeof redirectUrl === "string" &&
  redirectUrl.length > 0 &&
  typeof checkoutSessionId === "string" &&
  checkoutSessionId.length > 0
    ? { checkoutSessionId, buyerStatusToken, redirectUrl }
    : null;

export const ticketCheckoutProviderHandoff = (
  result: TicketCheckoutCreateResult,
): TicketCheckoutProviderHandoff | null => {
  if (result.kind === "requires_web_redirect") {
    return usableHandoff(
      result.checkoutSessionId,
      result.buyerStatusToken,
      result.hostedCheckoutUrl,
    );
  }
  if (result.kind === "requires_paystack_redirect") {
    return usableHandoff(
      result.checkoutSessionId,
      result.buyerStatusToken,
      result.authorizationUrl,
    );
  }
  return null;
};

/**
 * issue #2188 — the shape `invokeOrThrow` throws.
 *
 * `supabase.functions.invoke` reports every handled server refusal as one
 * opaque `FunctionsHttpError` whose `.message` is the literal string
 * "Edge Function returned a non-2xx status code". The HTTP status lives on
 * `.context` (a `Response`) and the bounded token lives in that response's JSON
 * body — and the old `throw new Error(error.message)` discarded BOTH.
 *
 * That single line is why `ticketCheckoutAccessError` was exported but could
 * never fire (recorded during #2136), and why `freeCheckoutErrorMessage`'s
 * `httpStatusOf` always saw null: by the time either ran, the status and the
 * token were already gone. Copy alone could not have fixed that.
 */
export interface TicketCheckoutInvokeError extends Error {
  /** HTTP status of the refusal, when the transport exposed one. */
  status: number | null;
  /** The bounded `error` token from the response body, e.g. `checkout_in_progress`. */
  code: string | null;
  /**
   * issue #2337 — the response body's `detail`, when it carried one.
   *
   * ADDITIVE. It exists for exactly one reason: `ticket-checkout-create`
   * answers a create-session RPC raise as
   * `{error:"checkout_session_failed", detail: sessionError.message}`, and
   * `ticket_capacity_exceeded` — the ONE refusal on the free rail that really
   * does mean "there are no tickets left" — is only visible in that detail.
   * Discarding it is why the client could not tell a sold-out sale from a
   * plumbing failure, and therefore called everything sold out.
   *
   * NEVER RENDERED. It is a raw database message; it is matched against a known
   * constant and nothing else.
   */
  detail: string | null;
}

/**
 * issue #2511 item 7 — HOW LONG WE WAIT, AND HOW LONG BEFORE WE TRY AGAIN.
 *
 * There was no timeout at all. A request that never answered left the guest on
 * a spinner indefinitely, on exactly the connections where that is most likely:
 * Nigerian mobile data inside the Instagram in-app browser.
 */
const CHECKOUT_TIMEOUT_MS = 20_000;
const CHECKOUT_RETRY_DELAY_MS = 700;

/**
 * issue #2511 item 7 — IS THIS WORTH TRYING AGAIN?
 *
 * A handled server refusal always carries an HTTP status: `invokeOrThrow` reads
 * it off the `FunctionsHttpError`'s `Response`. A transport failure — DNS, a
 * dropped connection, CORS, our own timeout below — never does. So a NULL status
 * is the discriminator for "we never got an answer".
 *
 * 4xx is a DECISION and is never retried: sold out is still sold out, and
 * hammering it would only produce the same refusal twice. 5xx is retried because
 * it is usually transient and the retry is idempotent anyway.
 */
const isWorthRetrying = (error: unknown): boolean => {
  const status = httpStatusOf(error);
  if (status === null) return true;
  return status >= 500;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * issue #2511 item 7 — a timeout that LOOKS like a transport failure.
 *
 * Deliberately carries no `status`, so it flows through `isWorthRetrying` above
 * and through the copy mappers exactly as a dropped connection does. A guest
 * whose request timed out is in precisely the same position as one whose reply
 * was lost: the reservation may or may not exist, and the honest sentence is the
 * same one.
 *
 * The underlying request is NOT aborted. It may still be completing on the
 * server, and that is fine — the retry below reuses the same idempotency key, so
 * a first attempt that lands is RETURNED by the second, never duplicated.
 */
const withTimeout = async <T>(work: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("checkout_request_timed_out")),
      CHECKOUT_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * issue #2511 item 7 — RETRY ONCE, SAFELY.
 *
 * WHY THIS CANNOT DUPLICATE A RESERVATION. The server derives the idempotency
 * key from the request body alone — `checkoutIdempotencyKey({eventId,
 * buyerEmail, buyerPhoneE164, lines, paymentPlanChoice, eventDateIds})`. Sending
 * the SAME body therefore produces the SAME key, and #2150's exemption returns
 * the already-completed free session rather than minting a second one. So the
 * retry is safe BY CONSTRUCTION, not by hoping the first attempt failed.
 *
 * That is the whole point: before this, a lost reply was a lost sale, and the
 * guest's only recourse was to change a field and submit again — which produced
 * a NEW key and a genuine duplicate. Three guests did exactly that on We Go
 * Again (#2462). Item 6 stopped us lying about it; this stops the loss.
 *
 * ONE retry, not a loop: if the second attempt also cannot reach the server the
 * problem is the connection, and a third request helps nobody while making a
 * thundering herd worse.
 */
const invokeWithRetry = async (
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> => {
  try {
    return await withTimeout(
      supabase.functions.invoke(functionName, { body }) as Promise<
        { data: unknown; error: unknown }
      >,
    );
  } catch (transportError) {
    if (!isWorthRetrying(transportError)) throw transportError;
    await sleep(CHECKOUT_RETRY_DELAY_MS);
    return await withTimeout(
      supabase.functions.invoke(functionName, { body }) as Promise<
        { data: unknown; error: unknown }
      >,
    );
  }
};

/**
 * issue #2511 item 7 — RETRY IS OPT-IN, PER CALL SITE, ON PURPOSE.
 *
 * The first cut of this change put the retry inside the shared helper, which
 * silently changed `ticket-checkout-confirm` too — the PAID finalize path, which
 * carries its own ORCH-0852 contracts about how a 502 must propagate. CI caught
 * it (`T-0852-ADV-2`, `T-0852-4`). That was an over-reach: the reasoning about
 * idempotency was done for CREATE and applied to everything.
 *
 * So retry is now requested explicitly, and only `ticket-checkout-create` asks
 * for it — the one call whose idempotency key is derived from the request body
 * and is therefore provably safe to repeat. Status, confirm and dispatch keep
 * byte-identical behaviour.
 */
interface InvokeOptions {
  /** Repeat ONCE on a transport failure or 5xx. Safe only where the server
   *  derives an idempotency key from the body. */
  readonly retryOnTransportFailure?: boolean;
}

const invokeOrThrow = async <T>(
  functionName: string,
  body: Record<string, unknown>,
  options: InvokeOptions = {},
): Promise<T> => {
  const retrying = options.retryOnTransportFailure === true;
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = retrying
      ? await invokeWithRetry(functionName, body)
      : ((await supabase.functions.invoke(functionName, { body })) as {
        data: unknown;
        error: unknown;
      }));
  } catch (transportError) {
    // Both attempts failed to reach the server. Surface it in the shape the
    // mappers already understand: no status, no token — "we do not know".
    throw transportError;
  }
  // issue #2511 — a 5xx comes back as a HANDLED error, not a throw, so the
  // retry decision has to be made here too, not only in the catch above.
  if (retrying && error !== null && error !== undefined && isWorthRetrying(error)) {
    await sleep(CHECKOUT_RETRY_DELAY_MS);
    ({ data, error } = await invokeWithRetry(functionName, body));
  }
  if (error) {
    // issue #2188 — carry the status + bounded token forward. `.message` is
    // deliberately UNCHANGED so no existing caller's behaviour shifts; the new
    // fields are additive and are what the copy mappers read.
    const refusal = await readEdgeRefusal(error);
    // issue #2511 — `error` is now `unknown` (the retry path widened it), so the
    // framework message is read defensively. The STRING IS UNCHANGED for every
    // shape supabase-js actually produces; #2188's contract that `.message` keeps
    // its original value is preserved exactly.
    const frameworkMessage =
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : String(error);
    const failure = new Error(frameworkMessage) as TicketCheckoutInvokeError;
    failure.status = refusal.status;
    failure.code = refusal.code;
    // issue #2337 — the detail rides along too. Without it the free mapper
    // cannot distinguish `ticket_capacity_exceeded` from any other
    // `checkout_session_failed`, and a sold-out sale and a broken RPC read
    // identically to the guest.
    failure.detail = refusal.detail;
    throw failure;
  }
  return data as T;
};

/**
 * issue #2188 — the guest-facing copy for a PAID checkout that did not hand off.
 *
 * Pure and total: it never returns a raw framework string, so the buyer can
 * never again be shown "Edge Function returned a non-2xx status code". Every
 * sentence says what happened AND whether money moved — a guest must never be
 * left wondering whether they have been charged.
 *
 * This is the call site `ticketCheckoutAccessError` was written for and never
 * had. The access tokens are matched through it (not re-listed here) so the
 * #2101 contract keeps exactly one owner.
 */
export const PAID_CHECKOUT_IN_PROGRESS_MESSAGE =
  "You already have a payment in progress for this order. Finish it in the payment window, or wait about a minute and try again — you have not been charged twice.";

export const PAID_CHECKOUT_UNAVAILABLE_MESSAGE =
  "This sale is no longer available — the organizer may have paused or changed this event. You have not been charged.";

export const PAID_CHECKOUT_SIGN_IN_MESSAGE =
  "This sale is restricted. Sign in with an approved Mingla account to complete this purchase. You have not been charged.";

export const PAID_CHECKOUT_RESTRICTED_MESSAGE =
  "The organizer has limited this sale to specific Mingla accounts, so this purchase can't be completed here. You have not been charged.";

export const PAID_CHECKOUT_UPDATE_APP_MESSAGE =
  "Update the Mingla app to complete this payment. You have not been charged.";

export const PAID_CHECKOUT_NO_HANDOFF_MESSAGE =
  "We couldn't open the secure payment page. You have not been charged — please try again.";

export const PAID_CHECKOUT_FAILED_MESSAGE =
  "We couldn't start your payment. You have not been charged — please try again.";

/**
 * issue #2198 [paystack-return-verify] — the RETURN leg's outcomes.
 *
 * #2188's messages all describe a checkout that never handed off. These three
 * describe a checkout that DID reach the provider and came back with an answer,
 * which is a different set of facts and needs different copy. They are matched
 * here, in the one mapper, rather than in a second decision path.
 *
 * The tokens are produced server-side by `ticket-checkout-confirm` /
 * `ticket-checkout-status` from Paystack's OWN verify response
 * (`data.status`) — never from a query parameter.
 */
export const PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE =
  "Your payment didn't go through, so no tickets were issued. You have not been charged — please try again.";

export const PAID_CHECKOUT_PAYMENT_ABANDONED_MESSAGE =
  "You left the payment page before the payment finished, so no tickets were issued. You have not been charged — please try again.";

/**
 * The mismatch case is the ONE where money may genuinely have moved, so it must
 * never say "you have not been charged". The server has already failed the
 * session closed and written an audit row.
 */
export const PAID_CHECKOUT_PAYMENT_MISMATCH_MESSAGE =
  "Your payment came back with a different amount or currency than this order, so no tickets were issued. If money left your account, contact support@usemingla.com before paying again.";

export const paidCheckoutErrorMessage = (error: unknown): string => {
  const code = codeOf(error);
  const status = httpStatusOf(error);

  // #2101 access denials, matched through their single owner.
  const access = ticketCheckoutAccessError(code ?? error);
  if (access === "sign_in_required" || status === 401) {
    return PAID_CHECKOUT_SIGN_IN_MESSAGE;
  }
  if (access === "checkout_restricted" || status === 403) {
    return PAID_CHECKOUT_RESTRICTED_MESSAGE;
  }
  if (code === "upgrade_required" || status === 426) {
    return PAID_CHECKOUT_UPDATE_APP_MESSAGE;
  }
  if (code === "checkout_in_progress") return PAID_CHECKOUT_IN_PROGRESS_MESSAGE;
  if (code === "checkout_unavailable") return PAID_CHECKOUT_UNAVAILABLE_MESSAGE;
  // #2198 — the return leg's verified outcomes. Ahead of the bare-409 fallback
  // because these carry a real, specific reason and must never be softened into
  // "wait about a minute and try again".
  if (code === "paystack_charge_failed") {
    return PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE;
  }
  if (code === "paystack_charge_abandoned") {
    return PAID_CHECKOUT_PAYMENT_ABANDONED_MESSAGE;
  }
  if (code === "paystack_payment_mismatch") {
    return PAID_CHECKOUT_PAYMENT_MISMATCH_MESSAGE;
  }
  // A 409 whose body we could not read still means "the server refused because
  // of the state of this sale", which is the recoverable, in-progress case far
  // more often than not — and it is the ONLY one where telling the guest to
  // wait rather than retry immediately is the right instruction.
  if (status === 409) return PAID_CHECKOUT_IN_PROGRESS_MESSAGE;
  // Copy this module already owns must pass through unchanged.
  const message = typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message
    : "";
  if (
    message === PAID_CHECKOUT_NO_HANDOFF_MESSAGE ||
    message === PAID_CHECKOUT_FAILED_MESSAGE
  ) {
    return message;
  }
  return PAID_CHECKOUT_FAILED_MESSAGE;
};

export const createTicketCheckout = async (
  input: TicketCheckoutCreateInput,
): Promise<TicketCheckoutCreateResult> =>
  invokeOrThrow<TicketCheckoutCreateResult>("ticket-checkout-create", {
    eventId: input.eventId,
    returnContract: "host_v1",
    buyer: input.buyer,
    lines: input.lines.map((line) => ({
      ticketTypeId: line.ticketTypeId,
      quantity: line.quantity,
      expectedUnitPriceCents: centsFromMajor(line.unitPrice),
    })),
    // ORCH-0790: omit surface when undefined so the edge function applies its
    // own "native" default — older mobile builds never send this field.
    ...(input.surface !== undefined ? { surface: input.surface } : {}),
    ...(input.paymentPlanChoice !== undefined
      ? { payment_plan_choice: input.paymentPlanChoice }
      : {}),
    // ORCH-0880 [Tr5 Traveler Intake Forms]: forward per-tier intake answers
    // when present. Edge function gates required-question completeness +
    // schema-version freshness per Phase 2 ticket-checkout-create §164-256.
    // Omit when empty so non-intake flows preserve byte-identical request shape.
    ...(input.intakeFormData !== undefined && input.intakeFormData.length > 0
      ? { intake_form_data: input.intakeFormData }
      : {}),
    // ORCH-1138 Leg 3 — forward the chosen occurrence ONLY when present so the
    // single/no-date checkout request stays byte-identical to today. The edge fn
    // already accepts `eventDateId` (investigation Q5); never sent on the null path.
    ...(input.eventDateId !== undefined && input.eventDateId.length > 0
      ? { eventDateId: input.eventDateId }
      : {}),
    // issue #2160 — forward the chosen day SET only when non-empty, so an empty
    // set produces a request body byte-identical to today. The edge fn
    // validates the set, derives the payout anchor server-side and passes it to
    // the RPC, which owns the pricing mode and the multiplier.
    ...(input.eventDateIds !== undefined && input.eventDateIds.length > 0
      ? { eventDateIds: [...input.eventDateIds] }
      : {}),
    // ISSUE-865 WP-C — forward the captured ad click_id ONLY when present, so
    // the request stays byte-identical for non-ad traffic. The edge fn persists
    // it on ticket_checkout_sessions.attribution_click_id (WP-B threading).
    ...(getStoredClickAttribution().clickId !== null
      ? { attribution_click_id: getStoredClickAttribution().clickId }
      : {}),
    // #2830 — the public-site token is opaque, short-lived and web-only. It is
    // never treated as buyer authority; checkout binds its digest to the
    // resulting order after the existing money/idempotency decisions succeed.
    ...(getStoredSiteAttribution() !== null
      ? { site_attribution_token: getStoredSiteAttribution() }
      : {}),
    // issue #2150 — forward the guest's own buyer status token ONLY when the
    // browser holds one, so a first submit and every paid request stay
    // byte-identical. It is the possession proof that lets an anonymous guest
    // be handed their EXISTING free order back instead of a duplicate.
    ...(input.buyerStatusToken !== undefined && input.buyerStatusToken.length > 0
      ? { buyerStatusToken: input.buyerStatusToken }
      : {}),
  }, {
    // issue #2511 item 7 — THE ONLY CALL THAT OPTS IN.
    //
    // Safe here and ONLY here: the edge function derives the idempotency key
    // from this body alone, so an identical repeat returns the same reservation
    // instead of minting a second. Status, confirm and dispatch deliberately do
    // NOT opt in — confirm in particular carries ORCH-0852 contracts about how a
    // 502 must propagate, and retrying it would change the paid finalize path.
    retryOnTransportFailure: true,
  });

export const getTicketCheckoutStatus = async (
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<TicketCheckoutStatusResult> =>
  invokeOrThrow<TicketCheckoutStatusResult>("ticket-checkout-status", {
    checkoutSessionId,
    buyerStatusToken,
  });

export const preflightTicketCheckout = async (
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<boolean> => {
  try {
    const result = await invokeOrThrow<{ status?: string }>(
      "ticket-checkout-status",
      { checkoutSessionId, buyerStatusToken, preflight: true },
    );
    return result.status === "present_allowed";
  } catch {
    return false;
  }
};

/**
 * ORCH-0852 — synchronous confirmation. Replaces `pollTicketCheckoutStatus`
 * on the buyer's success path. The server calls Stripe directly + invokes
 * the idempotent `biz_ticket_checkout_finalize` RPC so the order is
 * guaranteed to exist (or known-pending/failed) by the time this resolves.
 *
 * Callers should treat:
 *  - status === "paid" + order !== null  → render full order
 *  - status === "pending"                → fall through to a Realtime
 *    subscription on ticket_checkout_sessions.order_id; webhook backup
 *    will eventually populate it.
 *  - status === "failed" | "expired"     → surface error state.
 *  - thrown error                        → treat as transient; fall through
 *    to Realtime; webhook backup will still complete the order.
 */
export const confirmTicketCheckout = async (
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<TicketCheckoutConfirmResult> =>
  invokeOrThrow<TicketCheckoutConfirmResult>("ticket-checkout-confirm", {
    checkoutSessionId,
    buyerStatusToken,
  });

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const pollTicketCheckoutStatus = async (
  checkoutSessionId: string,
  buyerStatusToken: string,
  statusFetcher = getTicketCheckoutStatus,
  waitFor = wait,
): Promise<TicketCheckoutStatusResult | null> => {
  let latest: TicketCheckoutStatusResult | null = null;
  for (const delayMs of FINALIZATION_BACKOFF_MS) {
    latest = await statusFetcher(checkoutSessionId, buyerStatusToken);
    if (latest.order !== null) return latest;
    await waitFor(delayMs);
  }
  latest = await statusFetcher(checkoutSessionId, buyerStatusToken);
  return latest.order !== null ? latest : null;
};

export const resendTicketConfirmation = async (
  orderId: string,
): Promise<void> => {
  await invokeOrThrow("ticket-confirmation-dispatch", { orderId });
};
