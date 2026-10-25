// Issue #4063 — the copy authority for purchase_message emails.
// Rendering and data lookup live elsewhere; this module only selects the
// approved subject, heading, promise, claim-block and button vocabulary.

export type PurchaseCopyTemplate =
  | "ticket_confirmed"
  | "trip_booked"
  | "experience_booked"
  | "rsvp_on_list"
  | "rsvp_promoted"
  | "rsvp_pending"
  | "rsvp_waitlisted"
  | "rsvp_maybe"
  | "rsvp_not_going"
  | "rsvp_declined"
  | "rsvp_removed"
  | "event_reminder"
  | "reservation_booked"
  | "reservation_changed"
  | "reservation_cancelled"
  | "reservation_reminder"
  | "waitlist_spot"
  | "payment_dunning"
  | "payment_paid"
  | "payment_reminder"
  | "traveler_update"
  | "recovery"
  | "refund_issued"
  | "order_cancelled"
  | "refund_status"
  | "chip_in_receipt"
  | "ticket_sent";

export type PurchaseNoun = "ticket" | "booking" | "pass" | "receipt";

export interface PurchaseCopyInput {
  template: PurchaseCopyTemplate;
  title?: string | null;
  date?: string | null;
  time?: string | null;
  dayWord?: "today" | "tonight" | "tomorrow" | null;
  firstName?: string | null;
  claimed?: boolean;
  quantity?: number;
  noun?: PurchaseNoun;
  venue?: string | null;
  amount?: string | null;
  brand?: string | null;
  ticketType?: string | null;
  expiry?: string | null;
  zoneLabel?: string | null;
  retryDate?: string | null;
  installmentNumber?: number | null;
  atRisk?: boolean;
  friendlyError?: string | null;
  cancelKind?: "refund" | "self" | "plain";
  orderCancelKind?: "free" | "refund_known" | "refund_to_follow";
  refundKind?: "standard" | "self_cancel" | "host_cancel";
  partialRefund?: boolean;
  refundState?:
    | "provider_pending"
    | "processed"
    | "failed_retryable"
    | "needs_attention"
    | "failed_terminal";
  subjectLabel?: string | null;
  message?: string | null;
  travelerHasRefillUrl?: boolean;
  sender?: string | null;
  sameLocalDate?: boolean;
  isTrip?: boolean;
}

export interface PurchaseEmailCopy {
  subject: string;
  preheader: string;
  heading: string;
  promise: string;
  claimBlock: boolean;
  buttonLabel: string | null;
}

function required(value: string | null | undefined, name: string): string {
  const text = typeof value === "string"
    ? Array.from(value).map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029
        ? " "
        : char;
    }).join("").replace(/\s+/g, " ").trim()
    : "";
  if (text.length === 0) throw new Error(`purchase_copy_missing_${name}`);
  return text;
}

function givenName(value: string | null | undefined): string | null {
  const first = value?.trim().split(/\s+/)[0] ?? "";
  if (first.length === 0) return null;
  return Array.from(first).slice(0, 20).join("");
}

function personalized(base: string, name: string | null | undefined): string {
  const first = givenName(name);
  return first === null ? `${base}.` : `${base}, ${first}.`;
}

function inApp(noun: PurchaseNoun, claimed: boolean, quantity = 1): string {
  const word = noun === "ticket" && quantity > 1 ? "tickets" : noun;
  return claimed
    ? `Your ${word} ${quantity > 1 ? "are" : "is"} in your Mingla app.`
    : `Your ${word} ${quantity > 1 ? "are" : "is"} waiting in the Mingla app.`;
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function copy(
  subject: string,
  heading: string,
  promise: string,
  claimBlock: boolean,
  buttonLabel: string | null,
  preheader = promise,
): PurchaseEmailCopy {
  return { subject, heading, promise, claimBlock, buttonLabel, preheader };
}

export function purchaseEmailCopy(input: PurchaseCopyInput): PurchaseEmailCopy {
  const title = () => required(input.title, "title");
  const date = () => required(input.date, "date");
  const time = () => required(input.time, "time");
  const venue = () => required(input.venue, "venue");
  const amount = () => required(input.amount, "amount");
  const brand = () => required(input.brand, "brand");
  const noun = input.noun ?? "ticket";
  const claimed = input.claimed === true;

  switch (input.template) {
    case "ticket_confirmed":
    case "ticket_sent":
      return copy(
        `You're in: ${title()}, ${date()}`,
        personalized("You're in", input.firstName),
        inApp("ticket", claimed, input.quantity),
        true,
        "Get my tickets",
      );
    case "trip_booked":
    case "experience_booked":
      return copy(
        `You're booked: ${title()}, ${date()}`,
        personalized("You're booked", input.firstName),
        inApp("booking", claimed),
        true,
        "Get my booking",
      );
    case "rsvp_on_list":
      return copy(
        `You're on the list: ${title()}, ${date()}`,
        personalized("You're on the list", input.firstName),
        inApp("pass", claimed),
        true,
        "Get my pass",
      );
    case "rsvp_promoted":
      return copy(
        `You're in: ${title()}`,
        personalized("You're on the list", input.firstName),
        inApp("pass", claimed),
        true,
        "Get my pass",
      );
    case "rsvp_pending":
      return copy(
        `Request sent: ${title()}, ${date()}`,
        "Request sent.",
        "We'll text and email you when the host says yes.",
        false,
        null,
      );
    case "rsvp_waitlisted":
      return copy(
        `You're on the waitlist: ${title()}, ${date()}`,
        "You're on the waitlist.",
        "We'll text and email you if a spot opens.",
        false,
        null,
      );
    case "rsvp_maybe":
      return copy(
        `We saved your Maybe: ${title()}`,
        "Maybe saved.",
        "Change it any time from your invite.",
        false,
        null,
      );
    case "rsvp_not_going":
      return copy(
        `Your RSVP for ${title()}`,
        "RSVP updated.",
        "We've let the host know you can't make it.",
        false,
        null,
      );
    case "rsvp_declined":
      return copy(
        `Your RSVP for ${title()}`,
        "Not this time.",
        "The host couldn't fit you in this time.",
        false,
        null,
      );
    case "rsvp_removed":
      return copy(
        `Your RSVP for ${title()}`,
        "RSVP removed.",
        `The host removed your RSVP for ${title()}, ${date()}.`,
        false,
        null,
      );
    case "event_reminder": {
      const dayWord = required(input.dayWord, "day_word");
      const subject = dayWord === "tomorrow"
        ? `Tomorrow: ${title()} at ${time()}`
        : `${titleCase(dayWord)}: ${title()} at ${time()}`;
      return copy(
        subject,
        `See you ${dayWord}.`,
        inApp(noun, claimed),
        true,
        noun === "booking" ? "Get my booking" : "Get my tickets",
      );
    }
    case "reservation_booked":
      return copy(
        `Booked: ${venue()}, ${date()} at ${time()}`,
        personalized("You're booked", input.firstName),
        inApp("booking", claimed),
        true,
        "Get my booking",
      );
    case "reservation_changed":
      return copy(
        input.sameLocalDate
          ? `Changed: ${venue()}, now ${time()}`
          : `Changed: ${venue()}, now ${date()} at ${time()}`,
        "Booking changed.",
        "Your booking in the app is already updated.",
        true,
        "Get my booking",
      );
    case "reservation_cancelled": {
      const promise = input.cancelKind === "refund"
        ? `${venue()} cancelled your booking. Your ${amount()} refund is on its way.`
        : input.cancelKind === "self"
        ? `You cancelled your booking for ${date()}, ${time()}.`
        : `Your booking for ${date()}, ${time()} was cancelled. Questions? Reply to this email.`;
      return copy(
        `Cancelled: ${venue()}, ${date()}`,
        "Booking cancelled.",
        promise,
        false,
        null,
      );
    }
    case "reservation_reminder": {
      const dayWord = required(input.dayWord, "day_word");
      return copy(
        `${titleCase(dayWord)}: ${venue()} at ${time()}`,
        `See you ${dayWord}.`,
        inApp("booking", claimed),
        true,
        "Get my booking",
      );
    }
    case "waitlist_spot":
      return copy(
        `A spot opened: ${title()}, ${date()}`,
        "A spot opened.",
        `We're holding ${input.quantity ?? 1} ${
          required(input.ticketType, "ticket_type")
        } for you until ${required(input.expiry, "expiry")} (${
          required(input.zoneLabel, "zone_label")
        }).`,
        false,
        "Book my spot",
      );
    case "payment_dunning":
      return copy(
        `Action needed: payment for ${title()}`,
        input.atRisk
          ? "Your booking is at risk."
          : "Payment didn't go through.",
        input.atRisk
          ? `We tried your card 3 times. Contact ${brand()} to keep your spot.`
          : `${
            required(input.friendlyError, "friendly_error")
          } We'll try again on ${required(input.retryDate, "retry_date")}.`,
        false,
        `Contact ${brand()}`,
      );
    case "payment_paid":
      return copy(
        `Paid in full: ${title()}`,
        "All paid up.",
        "Your spot is fully confirmed.",
        false,
        "Get my booking",
      );
    case "payment_reminder":
      return copy(
        `Payment due ${date()}: ${title()}`,
        "Payment due soon.",
        `Your next payment of ${amount()} is due ${date()}.`,
        false,
        "Get my booking",
      );
    case "traveler_update":
      return copy(
        `Update needed: traveler details for ${title()}`,
        "Update needed.",
        required(input.message, "message"),
        false,
        input.travelerHasRefillUrl ? "Update details" : "Get my booking",
      );
    case "recovery":
      return copy(
        `Your ${noun} for ${title()} is in the Mingla app`,
        "It's waiting for you.",
        `Your ${noun} is waiting in the Mingla app.`,
        true,
        noun === "pass" ? "Get my pass" : "Get my tickets",
      );
    case "refund_issued": {
      const promise = input.refundKind === "self_cancel"
        ? `Following your cancellation, we've refunded ${amount()} to your original payment method.`
        : input.refundKind === "host_cancel"
        ? `${brand()} cancelled ${title()} and refunded ${amount()} to your original payment method.`
        : `${brand()} has refunded ${amount()} to your original payment method.`;
      return copy(
        `Refund of ${amount()} for ${title()}`,
        "Refund on its way.",
        promise,
        false,
        input.partialRefund ? "Get my tickets" : null,
      );
    }
    case "order_cancelled": {
      const base = `Your ticket for ${title()}, ${date()} is cancelled.`;
      const promise = input.orderCancelKind === "refund_known"
        ? `${base} Your ${amount()} refund is on its way.`
        : input.orderCancelKind === "refund_to_follow"
        ? `${base} Any payment will be refunded.`
        : base;
      return copy(
        `Cancelled: ${title()}`,
        input.isTrip ? "Booking cancelled." : "Order cancelled.",
        promise,
        false,
        null,
      );
    }
    case "refund_status": {
      const words = {
        provider_pending: "processing",
        processed: "processed",
        failed_retryable: "delayed",
        needs_attention: "action needed",
        failed_terminal: "under review",
      } as const;
      const state = words[input.refundState ?? "failed_terminal"];
      return copy(
        `Refund ${state}: ${required(input.subjectLabel, "subject_label")}`,
        "Refund update.",
        required(input.message, "message"),
        false,
        input.refundState === "needs_attention" ? "Continue refund" : null,
      );
    }
    case "chip_in_receipt":
      return copy(
        `Thanks for chipping in to ${title()}`,
        "Thank you.",
        `Your ${amount()} gift is confirmed. This is a thank-you, not a bill.`,
        false,
        null,
      );
  }
}
