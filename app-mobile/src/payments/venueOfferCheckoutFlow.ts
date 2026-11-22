/**
 * #4490 Explorer W4 — the venue offer checkout's state, as a pure reducer.
 *
 * Modelled on `nativeCheckoutFlow.ts`'s phases (creating → opening the payment
 * page → confirming), for the five venue kinds: Entry, Group package, Private
 * hire, By the hour (each `venue-offers`: quote → hold → pay → confirm_return)
 * and Plan (`membership_join` → `venue-membership-pay-link` pay →
 * confirm_return). The sheet (`VenueOfferCheckoutSheet`) renders from this
 * state and runs the server calls; nothing here touches the network.
 *
 * Phases (one sheet session):
 *
 *   choosing ─ quote_start ─▶ quoting ─ quote_ok ─▶ review
 *   review ─ hold_start ─▶ holding ─ hold_ok ─▶ paying | booked (free) | requested (hire)
 *   choosing (plan) ─ join_start ─▶ joining ─ join_ok ─▶ review (the server's amount due) | booked | requested
 *   paying ─ pay_ok ─▶ awaiting_payment ─ payment_closed ─▶ confirming
 *   confirming ─ confirm_done ─▶ booked | review (+ "Payment didn't go through")
 *                                | pending | choosing (+ "Your hold ran out")
 *   any step ─ step_failed ─▶ error (plain words + Try again; the same key)
 *   any step ─ step_failed (session gone) / session_lost ─▶ signed_out
 *                                (Sign in again; the checkout is kept in memory)
 *
 * Money and security rules (spec 06 W4) this module owns:
 *  1. No price is computed here: `quote` and `booking` hold the server's own
 *     numbers, and nothing derives an amount from another.
 *  2. Idempotency: one `cartKey` per sheet session; one key per server step,
 *     kept in state and reused on a retry of that same step; a new key only
 *     when the step's inputs change (`keyForStep`). After a payment that did
 *     not go through, "Try again" is a new attempt (`payAttempt` moves), so
 *     `pay` gets a new key (the server settles the earlier attempt first).
 *  5. Payment failed / not paid → back to Review with the §6 line; still
 *     pending after the polls → the pending state; hold expired → back to the
 *     choose step.
 *  6. Server codes become §6 words (`venueCheckoutNoticeFor`); an unmapped code
 *     is "Something went wrong. Try again." with Try again, never the code.
 *  7. Free (`totalMinor = 0`): `hold` confirms; no payment page.
 */

export type VenueCheckoutKind = "entry" | "group_package" | "private_hire" | "by_the_hour" | "plan";

/** The server steps that carry an idempotency key. */
export type VenueCheckoutStep = "quote" | "hold" | "join" | "pay";

export type VenueCheckoutPhase =
  | "choosing"
  | "quoting"
  | "review"
  | "holding"
  | "joining"
  | "paying"
  | "awaiting_payment"
  | "confirming"
  | "booked"
  | "requested"
  | "pending"
  | "error"
  /**
   * #4490 06-W4 fix 2 (W4-D1; spec 06 §13 item 5): the session ended. The
   * sheet shows Sign in again (never the generic line, never a Try again that
   * cannot work) and keeps the checkout in memory for that account.
   */
  | "signed_out";

export type VenuePayMode = "deposit" | "full";

export type VenuePaymentProvider = "paystack" | "stripe";

/** A step's key and the inputs it was made for. */
export interface VenueStepKey {
  readonly key: string;
  readonly inputs: string;
}

/** The server's quote, as the sheet needs it (every number is the server's). */
export interface VenueCheckoutQuoteRef {
  readonly quoteId: string;
  readonly currencyCode: string;
  readonly totalMinor: number;
  /** Pay modes the server allows for this quote ("full" only when absent). */
  readonly payModes: readonly VenuePayMode[];
  /** The server's deposit amount when "deposit" is allowed. */
  readonly depositMinor: number | null;
}

/** The held booking (or plan), as the server returned it. */
export interface VenueCheckoutBookingRef {
  /** `stay_reservation_groups.id` for an offer; the subscription id for a plan. */
  readonly id: string;
  readonly version: number;
  readonly state: string;
  readonly totalMinor: number;
  readonly amountDueNowMinor: number;
  readonly holdUntil: string | null;
}

export type VenueCheckoutNoticeCode =
  | "payment_failed"
  | "hold_expired"
  | "paused"
  | "cap"
  | "offline"
  | "selection"
  | "guest"
  | "generic";

export interface VenueCheckoutNotice {
  readonly code: VenueCheckoutNoticeCode;
  readonly message: string;
}

export interface VenueCheckoutState {
  readonly kind: VenueCheckoutKind;
  readonly phase: VenueCheckoutPhase;
  /** One per sheet session (spec 06 W4 rule 2). */
  readonly cartKey: string;
  /** The step-1 choices as one stable string; null until something is chosen. */
  readonly choice: string | null;
  readonly quote: VenueCheckoutQuoteRef | null;
  readonly booking: VenueCheckoutBookingRef | null;
  readonly payMode: VenuePayMode | null;
  /** Moves after a payment that did not go through: the next `pay` is a new attempt. */
  readonly payAttempt: number;
  readonly keys: Readonly<Partial<Record<VenueCheckoutStep, VenueStepKey>>>;
  readonly provider: VenuePaymentProvider | null;
  /** The step that failed (Try again repeats it with the same key). */
  readonly failedStep: VenueCheckoutStep | null;
  readonly notice: VenueCheckoutNotice | null;
  /** Where the sheet opened: the choose step, or straight at Pay (from Purchases). */
  readonly openedAt: "choose" | "pay";
}

export type VenueCheckoutAction =
  | { type: "choose"; choice: string }
  | { type: "quote_start"; freshKey: string }
  | { type: "quote_ok"; quote: VenueCheckoutQuoteRef }
  | { type: "set_pay_mode"; payMode: VenuePayMode }
  | { type: "hold_start"; freshKey: string; guest: string }
  | { type: "hold_ok"; booking: VenueCheckoutBookingRef; mode: "instant" | "request" }
  | { type: "join_start"; freshKey: string; guest: string }
  | { type: "join_ok"; booking: VenueCheckoutBookingRef; mode: "instant" | "request" }
  | { type: "pay_start"; freshKey: string }
  | { type: "pay_ok"; provider: VenuePaymentProvider }
  | { type: "payment_closed" }
  | { type: "confirm_done"; outcome: VenueConfirmOutcome; booking?: VenueCheckoutBookingRef | null }
  | {
      type: "step_failed";
      step: VenueCheckoutStep;
      code: string;
      venueName: string;
      /** The shared buyer-web words for a guest-fixable code (`venueOfferErrorCopy`). */
      selectionMessage?: string;
    }
  | { type: "retry"; freshKey: string }
  | { type: "back_to_choose" }
  | { type: "back_to_review" }
  /**
   * #4490 06-W4 fix 1 (W4-N4): after signing in again, the held booking (or
   * plan) re-read with the new session; null when it could not be found.
   */
  | { type: "resumed"; booking: VenueCheckoutBookingRef | null; now: number }
  /** #4490 06-W4 fix 2 (W4-D1): the app's session ended (signed out, or another account) with the sheet open. */
  | { type: "session_lost" };

/**
 * What a `confirm_return` round said. `confirmed` covers the server answering
 * `offer_payment_already_paid` (re-read and confirmed); `pending` is "still
 * checking after the polls"; `failed` / `not_paid` are the provider's own
 * answer; `expired` is the hold running out before payment.
 */
export type VenueConfirmOutcome = "confirmed" | "failed" | "not_paid" | "pending" | "expired";

// ─── keys ─────────────────────────────────────────────────────────────────

/**
 * A v4 uuid from the platform's secure source (the app's own rule in
 * `utils/mergeMessages`), with a Math.random fallback where none exists.
 * Matches the server's key pattern `^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$`.
 */
export function venueCheckoutUuid(): string {
  const c = (globalThis as {
    crypto?: { randomUUID?: () => string; getRandomValues?: (b: Uint8Array) => Uint8Array };
  }).crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The server's cart key pattern is `[A-Za-z0-9_-]{32,64}`: a uuid without dashes. */
export function venueCheckoutCartKey(uuid: string = venueCheckoutUuid()): string {
  return uuid.replace(/-/g, "");
}

/**
 * The key for a step: the one already held when it was made for the same
 * inputs (a retry), otherwise the fresh candidate. Pure.
 */
export function keyForStep(
  keys: Readonly<Partial<Record<VenueCheckoutStep, VenueStepKey>>>,
  step: VenueCheckoutStep,
  inputs: string,
  freshKey: string,
): VenueStepKey {
  const held = keys[step];
  return held !== undefined && held.inputs === inputs ? held : { key: freshKey, inputs };
}

/** What each step's key is made for. */
export function stepInputs(state: VenueCheckoutState, step: VenueCheckoutStep, guest = ""): string {
  switch (step) {
    case "quote":
      return state.choice ?? "";
    case "hold":
      return `${state.quote?.quoteId ?? ""}|${guest}`;
    case "join":
      return `${state.choice ?? ""}|${guest}`;
    case "pay":
      return `${state.booking?.id ?? ""}|${state.booking?.version ?? 0}|${state.payMode ?? "server"}|${state.payAttempt}`;
    default: {
      const never: never = step;
      return never;
    }
  }
}

// ─── copy (spec 06 §6, exact) ───────────────────────────────────────────

export const VENUE_CHECKOUT_COPY = {
  review: "Review",
  sendRequest: "Send request",
  halfNow: "Half now",
  allNow: "All now",
  booked: "You're booked",
  paymentFailed: "Payment didn't go through. You haven't been charged.",
  holdExpired: "Your hold ran out. Pick a time again.",
  pending: "We're checking your payment. This can take a minute.",
  seeInPurchases: "See in Purchases",
  paused: "Bookings are paused here right now. Try again later.",
  generic: "Something went wrong. Try again.",
  /** The existing buyer-web line for a change under the guest's feet (`stale_write`). */
  changed: "Something changed while we were saving. Try again.",
  offline: "You're offline. Check your connection and try again.",
  tryAgain: "Try again",
  /**
   * #4490 06-W4 fix 2 (W4-R1): the existing buyer-web line (PackageForm) when
   * the balance date has passed and the deposit is folded into one payment.
   */
  fullNowClose: "This day is close, so it's paid in full now.",
  empty: "Nothing to book here right now.",
  soldOut: "Sold out",
} as const;

export const payLabel = (totalText: string): string => `Pay ${totalText}`;

export const requestSentLine = (venueName: string): string =>
  `Request sent. ${venueName} will reply soon. Nothing to pay until they do.`;

export const capLine = (venueName: string): string =>
  `This is more than we can take in one payment. Book fewer places or contact ${venueName}.`;

/**
 * Codes the guest can fix on the choose step or in their details. Their words
 * are the shared buyer-web words (`venueOfferErrorCopy`, one owner), passed in
 * by the caller on the action so this module stays pure and package-free.
 */
export const VENUE_SELECTION_CODES: ReadonlySet<string> = new Set([
  "offer_sold_out",
  "offer_window_unavailable",
  "offer_option_unavailable",
  "offer_wrong_weekday",
  "offer_wrong_time",
  "offer_guests_out_of_range",
  "offer_day_closed",
  "offer_too_soon",
  "offer_too_far",
  "offer_quote_not_found",
  "offer_quote_expired",
  "offer_changed",
  "offer_answer_required",
  "offer_extra_unavailable",
  "offer_pay_mode_unavailable",
  "offer_space_taken",
  "offer_capacity_conflict",
  "offer_length_invalid",
  "offer_not_found",
  "plan_not_found",
]);

/**
 * #4490 06-W4 fix 2 (W4-D1): the answers that mean the session is gone, not
 * that the step failed. `auth_invalid` is the edge's 401 when the bearer's
 * session no longer exists (revoked, signed out on another device, refresh
 * token expired); `auth_session_missing` is the app's own "no session" (the
 * client dropped it, or the store says nobody is signed in); a booking or
 * member token being required means the call went out without a user (the
 * app never holds those tokens, spec 06 W4 rule 3).
 */
export const VENUE_SESSION_LOST_CODES: ReadonlySet<string> = new Set([
  "auth_invalid",
  "auth_session_missing",
  "booking_token_required",
  "membership_token_required",
]);

export const isVenueSessionLostCode = (code: string): boolean => VENUE_SESSION_LOST_CODES.has(code);

export const VENUE_GUEST_CODES: ReadonlySet<string> = new Set([
  "offer_guest_invalid",
  "offer_guest_email_required",
  "offer_payment_details_rejected",
  "membership_payment_details_rejected",
  "buyer_email_undeliverable",
]);

/**
 * A server code → the words on the sheet. §6 first (paused, cap, hold ran
 * out, offline); the guest-fixable codes keep the shared buyer-web words
 * (`selectionCopy`); every other code is the generic line. Never a raw code.
 */
export function venueCheckoutNoticeFor(
  code: string,
  venueName: string,
  selectionCopy: (code: string) => string = () => VENUE_CHECKOUT_COPY.generic,
): VenueCheckoutNotice {
  if (code === "offers_not_enabled") return { code: "paused", message: VENUE_CHECKOUT_COPY.paused };
  if (code === "offer_amount_too_large") return { code: "cap", message: capLine(venueName) };
  if (code === "offer_hold_expired") return { code: "hold_expired", message: VENUE_CHECKOUT_COPY.holdExpired };
  if (code === "offline") return { code: "offline", message: VENUE_CHECKOUT_COPY.offline };
  // #4490 06-W4 fix 1 (W4-N3): another device is paying this booking another way.
  if (code === "offer_payment_mode_conflict") return { code: "generic", message: VENUE_CHECKOUT_COPY.changed };
  if (VENUE_SELECTION_CODES.has(code)) return { code: "selection", message: selectionCopy(code) };
  if (VENUE_GUEST_CODES.has(code)) return { code: "guest", message: selectionCopy(code) };
  return { code: "generic", message: VENUE_CHECKOUT_COPY.generic };
}

// ─── the reducer ──────────────────────────────────────────────────────────

export function initialVenueCheckoutState(
  kind: VenueCheckoutKind,
  cartKey: string,
  resume?: { booking: VenueCheckoutBookingRef; payMode: VenuePayMode | null } | null,
): VenueCheckoutState {
  const base: VenueCheckoutState = {
    kind,
    phase: "choosing",
    cartKey,
    choice: null,
    quote: null,
    booking: null,
    payMode: null,
    payAttempt: 0,
    keys: {},
    provider: null,
    failedStep: null,
    notice: null,
    openedAt: "choose",
  };
  if (resume === undefined || resume === null) return base;
  // From Purchases: "Pay to hold your date" (deposit) or "Pay the rest".
  return { ...base, phase: "review", booking: resume.booking, payMode: resume.payMode, openedAt: "pay" };
}

const IN_FLIGHT_FOR: Record<VenueCheckoutStep, VenueCheckoutPhase> = {
  quote: "quoting",
  hold: "holding",
  join: "joining",
  pay: "paying",
};

/** True while a server step or the payment page is in flight (no dismiss, no double tap). */
export function isVenueCheckoutBusy(state: VenueCheckoutState): boolean {
  return (
    state.phase === "quoting" ||
    state.phase === "holding" ||
    state.phase === "joining" ||
    state.phase === "paying" ||
    state.phase === "awaiting_payment" ||
    state.phase === "confirming"
  );
}

/** The pay mode a `pay` call sends: the guest's pick, or none (the server decides). */
export function effectivePayMode(state: VenueCheckoutState): VenuePayMode | null {
  if (state.payMode !== null) return state.payMode;
  const modes = state.quote?.payModes ?? [];
  return modes.includes("deposit") && modes.includes("full") ? "deposit" : null;
}

export function venueOfferCheckoutReducer(
  state: VenueCheckoutState,
  action: VenueCheckoutAction,
): VenueCheckoutState {
  switch (action.type) {
    case "choose": {
      if (state.phase !== "choosing" && state.phase !== "review" && state.phase !== "error") return state;
      if (action.choice === state.choice) return state;
      // New inputs: the quote, any hold and their keys belong to the old
      // choice. The plan's join key is kept only for the same choice.
      return {
        ...state,
        phase: "choosing",
        choice: action.choice,
        quote: null,
        booking: state.openedAt === "pay" ? state.booking : null,
        payMode: null,
        keys: {},
        provider: null,
        failedStep: null,
        notice: null,
      };
    }
    case "quote_start": {
      if (state.choice === null || isVenueCheckoutBusy(state)) return state;
      if (state.phase !== "choosing" && state.phase !== "review" && state.phase !== "error") return state;
      return {
        ...state,
        phase: "quoting",
        keys: { ...state.keys, quote: keyForStep(state.keys, "quote", stepInputs(state, "quote"), action.freshKey) },
        failedStep: null,
        notice: state.notice?.code === "payment_failed" ? state.notice : null,
      };
    }
    case "quote_ok": {
      if (state.phase !== "quoting") return state;
      const changed = state.quote !== null && state.quote.quoteId !== action.quote.quoteId;
      return {
        ...state,
        phase: "review",
        quote: action.quote,
        // A new quote is a new hold input; a pay mode the new quote does not allow is dropped.
        payMode: state.payMode !== null && action.quote.payModes.includes(state.payMode) ? state.payMode : null,
        keys: changed ? { quote: state.keys.quote } : state.keys,
      };
    }
    case "set_pay_mode": {
      if (state.phase !== "review") return state;
      const allowed = state.quote?.payModes ?? (state.openedAt === "pay" ? ["deposit", "full"] : []);
      if (!allowed.includes(action.payMode)) return state;
      return { ...state, payMode: action.payMode };
    }
    case "hold_start": {
      if (state.phase !== "review" && !(state.phase === "error" && state.failedStep === "hold")) return state;
      if (state.quote === null) return state;
      return {
        ...state,
        phase: "holding",
        keys: { ...state.keys, hold: keyForStep(state.keys, "hold", stepInputs(state, "hold", action.guest), action.freshKey) },
        failedStep: null,
        notice: null,
      };
    }
    case "join_start": {
      if (state.kind !== "plan") return state;
      if (state.phase !== "choosing" && state.phase !== "review" && !(state.phase === "error" && state.failedStep === "join")) {
        return state;
      }
      if (state.choice === null) return state;
      return {
        ...state,
        phase: "joining",
        keys: { ...state.keys, join: keyForStep(state.keys, "join", stepInputs(state, "join", action.guest), action.freshKey) },
        failedStep: null,
        notice: null,
      };
    }
    case "join_ok": {
      if (state.phase !== "joining") return state;
      const booking = action.booking;
      if (action.mode === "request" || booking.state === "requested" || booking.state === "request_pending") {
        return { ...state, phase: "requested", booking };
      }
      if (booking.state === "active" || booking.state === "confirmed") return { ...state, phase: "booked", booking };
      // #4490 06-W4 fix 1 (W4-N2): the guest sees the server's amount due
      // (VAT included) on Review before the payment page opens; Pay starts it.
      return { ...state, phase: "review", booking };
    }
    case "hold_ok": {
      if (state.phase !== "holding") return state;
      const booking = action.booking;
      // Rule 7: free (or confirmed at once): no payment page.
      if (booking.state === "confirmed" || booking.state === "active" || booking.totalMinor === 0) {
        return { ...state, phase: "booked", booking };
      }
      if (action.mode === "request" || booking.state === "request_pending" || booking.state === "pending_approval") {
        return { ...state, phase: "requested", booking };
      }
      return { ...state, phase: "paying", booking };
    }
    case "pay_start": {
      if (state.booking === null) return state;
      const fromOk =
        state.phase === "paying" ||
        state.phase === "review" ||
        (state.phase === "error" && state.failedStep === "pay");
      if (!fromOk) return state;
      const withMode = { ...state, payMode: state.payMode ?? effectivePayMode(state) };
      return {
        ...withMode,
        phase: "paying",
        keys: { ...state.keys, pay: keyForStep(state.keys, "pay", stepInputs(withMode, "pay"), action.freshKey) },
        failedStep: null,
        notice: null,
      };
    }
    case "pay_ok": {
      if (state.phase !== "paying") return state;
      return { ...state, phase: "awaiting_payment", provider: action.provider };
    }
    case "payment_closed": {
      if (state.phase !== "awaiting_payment" && state.phase !== "paying") return state;
      return { ...state, phase: "confirming" };
    }
    case "confirm_done": {
      if (state.phase !== "confirming" && state.phase !== "paying" && state.phase !== "awaiting_payment") return state;
      const booking = action.booking ?? state.booking;
      switch (action.outcome) {
        case "confirmed":
          return { ...state, phase: "booked", booking, notice: null };
        case "failed":
        case "not_paid":
          // Rule 5: back to Review; "Try again" is a NEW payment attempt.
          return {
            ...state,
            phase: "review",
            booking,
            payAttempt: state.payAttempt + 1,
            provider: null,
            notice: { code: "payment_failed", message: VENUE_CHECKOUT_COPY.paymentFailed },
          };
        case "pending":
          return { ...state, phase: "pending", booking };
        case "expired":
          return expiredState(state);
        default: {
          const never: never = action.outcome;
          return never;
        }
      }
    }
    case "step_failed": {
      if (state.phase !== IN_FLIGHT_FOR[action.step] && !(action.step === "pay" && state.phase === "awaiting_payment")) {
        return state;
      }
      if (action.code === "offer_hold_expired" && state.openedAt === "choose") return expiredState(state);
      // #4490 06-W4 fix 2 (W4-D1): a lost session is not a failed step.
      if (isVenueSessionLostCode(action.code)) {
        return { ...state, phase: "signed_out", failedStep: action.step, provider: null, notice: null };
      }
      return {
        ...state,
        phase: "error",
        failedStep: action.step,
        notice: venueCheckoutNoticeFor(
          action.code,
          action.venueName,
          () => action.selectionMessage ?? VENUE_CHECKOUT_COPY.generic,
        ),
      };
    }
    case "retry": {
      if (state.phase !== "error" || state.failedStep === null) return state;
      // Back to the step's own in-flight phase with the SAME key (inputs unchanged).
      const step = state.failedStep;
      const held = state.keys[step];
      return {
        ...state,
        phase: IN_FLIGHT_FOR[step],
        keys:
          held !== undefined
            ? state.keys
            : { ...state.keys, [step]: { key: action.freshKey, inputs: stepInputs(state, step) } },
        failedStep: null,
        notice: null,
      };
    }
    case "back_to_choose": {
      if (isVenueCheckoutBusy(state) || state.openedAt === "pay") return state;
      return { ...state, phase: "choosing", failedStep: null, notice: state.notice?.code === "hold_expired" ? state.notice : null };
    }
    case "resumed": {
      if (state.booking === null) return state;
      const b = action.booking;
      if (b === null) return lostHold(state);
      const holdLive = b.holdUntil === null || Date.parse(b.holdUntil) > action.now;
      if (state.openedAt === "pay") {
        // From Purchases ("Pay to hold your date", "Pay the rest"): still owed → Pay again.
        const owes = b.amountDueNowMinor > 0 &&
          ["approved_payment_required", "instant_payment_pending", "confirmed", "partially_cancelled"].includes(b.state);
        if (owes && holdLive) return { ...state, phase: "review", booking: b, failedStep: null };
        if (b.state === "confirmed") return { ...state, phase: "booked", booking: b, notice: null };
        return lostHold(state);
      }
      if (b.state === "confirmed" || b.state === "active") return { ...state, phase: "booked", booking: b, notice: null };
      if (b.state === "request_pending" || b.state === "requested") return { ...state, phase: "requested", booking: b, notice: null };
      const payable = ["instant_payment_pending", "approved_payment_required", "pending", "payment_due", "grace"].includes(b.state);
      if (payable && holdLive) return { ...state, phase: "review", booking: b, failedStep: null };
      return lostHold(state);
    }
    case "session_lost": {
      // Finished (booked, request sent) or already signed out: nothing to keep.
      if (state.phase === "booked" || state.phase === "requested" || state.phase === "signed_out") return state;
      const inFlight = (Object.keys(IN_FLIGHT_FOR) as VenueCheckoutStep[]).find((s) => IN_FLIGHT_FOR[s] === state.phase) ??
        (state.phase === "awaiting_payment" || state.phase === "confirming" ? "pay" : state.failedStep);
      return { ...state, phase: "signed_out", failedStep: inFlight ?? null, provider: null, notice: null };
    }
    case "back_to_review": {
      if (state.phase !== "error" || (state.quote === null && state.booking === null)) return state;
      return { ...state, phase: "review", failedStep: null };
    }
    default: {
      const never: never = action;
      return never;
    }
  }
}

/** The hold ran out while signed out: the choose step with the §6 line (picks are kept by the sheet), or from Purchases the line on Pay. */
function lostHold(state: VenueCheckoutState): VenueCheckoutState {
  if (state.openedAt === "choose") return expiredState(state);
  return { ...state, phase: "error", failedStep: "pay", notice: { code: "hold_expired", message: VENUE_CHECKOUT_COPY.holdExpired } };
}

/**
 * #4490 06-W4 fix 1 (W4-N4): the state a checkout resumes with after the
 * guest signs in again (same account). A step that was in flight when the
 * session ended goes back to where the guest can press it again with the
 * same keys (the server replays a step it already did); a held booking stays
 * in state and is re-read before Pay (`resumed`). Pure.
 */
export function resumedVenueCheckoutState(state: VenueCheckoutState): VenueCheckoutState {
  const back = (phase: VenueCheckoutPhase): VenueCheckoutState => ({ ...state, phase, failedStep: null, provider: null, notice: null });
  switch (state.phase) {
    case "quoting":
    case "joining":
      return back("choosing");
    case "holding":
      return back(state.quote !== null ? "review" : "choosing");
    case "paying":
    case "awaiting_payment":
    case "confirming":
      return back(state.booking !== null ? "review" : state.quote !== null ? "review" : "choosing");
    case "error":
    case "signed_out":
      return back(state.booking !== null || state.quote !== null ? "review" : "choosing");
    default:
      return state;
  }
}

function expiredState(state: VenueCheckoutState): VenueCheckoutState {
  // Rule 5: "Your hold ran out. Pick a time again." back to step 1; the old
  // quote, hold and keys are spent.
  return {
    ...state,
    phase: "choosing",
    quote: null,
    booking: null,
    payMode: null,
    keys: {},
    provider: null,
    failedStep: null,
    notice: { code: "hold_expired", message: VENUE_CHECKOUT_COPY.holdExpired },
  };
}

/** The step the sheet is on for its three-dash progress (1 choose, 2 review, 3 pay/done). */
export function venueCheckoutProgress(state: VenueCheckoutState): 1 | 2 | 3 {
  switch (state.phase) {
    case "choosing":
    case "quoting":
      return 1;
    case "review":
    case "holding":
    case "joining":
    case "error":
    case "signed_out":
      return state.quote === null && state.booking === null && state.openedAt === "choose" ? 1 : 2;
    default:
      return 3;
  }
}
