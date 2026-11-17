// issue #4420 wave 2 (D-S6) — every `stay_*` refusal a guest can meet, in
// plain words with ONE next step. The server's codes are data; a guest never
// reads "stay inventory changed". An unknown code gets the fallback and the
// caller reports the code to analytics (`stay_guest_error_shown`), never on
// screen.
//
// Pure: no React, no app imports (I-MOR-0827-PACKAGE-ISOLATION).

export type StayGuestErrorAction =
  | "choose_another_room"
  | "review_rooms"
  | "review_total"
  | "message_property"
  | "resume_payment"
  | "check_again"
  | "pay_again"
  | "pick_earlier_dates"
  | "change_dates"
  | "match_dates"
  | "add_room"
  | "refresh"
  | "see_brand"
  | "try_again"
  | "sign_in_other_email";

export interface StayGuestErrorCopy {
  title: string;
  body: string;
  action: StayGuestErrorAction;
  actionLabel: string;
}

export interface StayGuestErrorContext {
  /** The property's name ("Glass House"). */
  stayName?: string | null;
  /** The brand's name, for "See {brand}'s page". */
  brandName?: string | null;
  /** The room that just sold ("Deluxe King"). */
  roomName?: string | null;
  /** The last bookable date, already formatted ("Sat 12 Dec 2026"). */
  horizonDate?: string | null;
}

const stayLabel = (ctx: StayGuestErrorContext): string => {
  const name = ctx.stayName?.trim();
  return name !== undefined && name.length > 0 ? name : "This Stay";
};

export const STAY_GUEST_FALLBACK_COPY: StayGuestErrorCopy = {
  title: "Something went wrong on our side",
  body: "Nothing was charged. Try again, or message the property.",
  action: "try_again",
  actionLabel: "Try again",
};

type CopyBuilder = (ctx: StayGuestErrorContext) => StayGuestErrorCopy;

const COPY: Record<string, CopyBuilder> = {
  stay_inventory_changed: (ctx) => ({
    title:
      ctx.roomName !== undefined && ctx.roomName !== null && ctx.roomName.trim().length > 0
        ? `Someone just booked ${ctx.roomName.trim()}`
        : "Someone just booked that room",
    body: "Your other rooms are still held and nothing was charged. Pick another room or change your dates.",
    action: "choose_another_room",
    actionLabel: "Choose another room",
  }),
  stay_search_changed: () => ({
    title: "Availability changed",
    body: "Availability changed while you were choosing. We refreshed the rooms.",
    action: "review_rooms",
    actionLabel: "Review rooms",
  }),
  stay_cart_changed: () => ({
    title: "Availability changed",
    body: "Availability changed while you were choosing. We refreshed the rooms.",
    action: "review_rooms",
    actionLabel: "Review rooms",
  }),
  stay_quote_expired: () => ({
    title: "Your price hold ended",
    body: "Here is the current total.",
    action: "review_total",
    actionLabel: "Review new total",
  }),
  stay_bank_not_ready: (ctx) => ({
    title: `${stayLabel(ctx)} can't take payments online yet`,
    body: "Nothing is held. Message them to book.",
    action: "message_property",
    actionLabel: "Message the property",
  }),
  stay_rail_not_enabled: (ctx) => ({
    title: `${stayLabel(ctx)} can't take payments online yet`,
    body: "Nothing is held. Message them to book.",
    action: "message_property",
    actionLabel: "Message the property",
  }),
  stay_payment_already_pending: () => ({
    title: "Payment already started",
    body: "You already started paying for this booking. Finish that payment first.",
    action: "resume_payment",
    actionLabel: "Resume payment",
  }),
  stay_payment_ambiguous: () => ({
    title: "We're still confirming your payment",
    body: "Don't pay again. We'll email you within 10 minutes.",
    action: "check_again",
    actionLabel: "Check again",
  }),
  stay_payment_resume_unavailable: () => ({
    title: "That payment page closed",
    body: "You left before you finished. You have not been charged.",
    action: "pay_again",
    actionLabel: "Pay again",
  }),
  stay_date_outside_horizon: (ctx) => ({
    title:
      ctx.horizonDate !== undefined && ctx.horizonDate !== null
        ? `${stayLabel(ctx)} takes bookings up to ${ctx.horizonDate}.`
        : `${stayLabel(ctx)} isn't taking bookings that far ahead.`,
    body: "Pick dates a little sooner.",
    action: "pick_earlier_dates",
    actionLabel: "Pick earlier dates",
  }),
  stay_too_long: () => ({
    title: "Stays can be up to 365 nights.",
    body: "Pick a shorter stay.",
    action: "change_dates",
    actionLabel: "Change dates",
  }),
  stay_room_dates_must_match: () => ({
    title: "Every room in one booking needs the same dates.",
    body: "Set the same check-in and check-out for each room.",
    action: "match_dates",
    actionLabel: "Match dates",
  }),
  stay_dependent_place_requires_room: () => ({
    title: "This place is for overnight guests.",
    body: "Add a room first.",
    action: "add_room",
    actionLabel: "Add a room",
  }),
  stay_version_conflict: () => ({
    title: "This booking changed in another tab.",
    body: "Refresh to see the latest.",
    action: "refresh",
    actionLabel: "Refresh",
  }),
  stay_idempotency_conflict: () => ({
    title: "This booking changed in another tab.",
    body: "Refresh to see the latest.",
    action: "refresh",
    actionLabel: "Refresh",
  }),
  stay_offering_not_found: (ctx) => ({
    title: `${stayLabel(ctx)} isn't taking bookings right now.`,
    body: "Its rooms may open again soon.",
    action: "see_brand",
    actionLabel:
      ctx.brandName !== undefined && ctx.brandName !== null && ctx.brandName.trim().length > 0
        ? `See ${ctx.brandName.trim()}'s page`
        : "See the host's page",
  }),
  stay_public_offering_invalid: (ctx) => ({
    title: `${stayLabel(ctx)} isn't taking bookings right now.`,
    body: "Its rooms may open again soon.",
    action: "see_brand",
    actionLabel:
      ctx.brandName !== undefined && ctx.brandName !== null && ctx.brandName.trim().length > 0
        ? `See ${ctx.brandName.trim()}'s page`
        : "See the host's page",
  }),
  stay_payment_link_expired: () => ({
    title: "This payment link has expired",
    body: "Ask the property for a new link. You have not been charged.",
    action: "message_property",
    actionLabel: "Message the property",
  }),
  stay_payment_link_not_found: () => ({
    title: "We couldn't find this payment link",
    body: "Check the link, or ask the property to send it again.",
    action: "try_again",
    actionLabel: "Try again",
  }),
  stay_payment_link_not_actionable: () => ({
    title: "This payment link can't be used any more",
    body: "The booking has moved on. Message the property if you need help.",
    action: "message_property",
    actionLabel: "Message the property",
  }),
  stay_group_other_contact: () => ({
    title: "This booking is under another email",
    body: "Sign in with that email to see it and pay.",
    action: "sign_in_other_email",
    actionLabel: "Sign in with that email",
  }),
};

/** True when the code has its own copy (false ⇒ the fallback was used). */
export const stayGuestErrorKnown = (code: string): boolean =>
  Object.prototype.hasOwnProperty.call(COPY, code);

/** Every code with its own copy, for tests and analytics. */
export const STAY_GUEST_ERROR_CODES: readonly string[] = Object.keys(COPY);

export const stayGuestErrorCopy = (
  code: string,
  ctx: StayGuestErrorContext = {},
): StayGuestErrorCopy => {
  const build = stayGuestErrorKnown(code) ? COPY[code] : undefined;
  return build !== undefined ? build(ctx) : STAY_GUEST_FALLBACK_COPY;
};

/** One line for a banner: "Title. Body" (the title's own stop kept). */
export const stayGuestErrorLine = (
  code: string,
  ctx: StayGuestErrorContext = {},
): string => {
  const copy = stayGuestErrorCopy(code, ctx);
  const title = /[.!?]$/.test(copy.title) ? copy.title : `${copy.title}.`;
  return `${title} ${copy.body}`;
};
