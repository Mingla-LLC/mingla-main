// ===========================================================================
// #4490 P2 — the guest's venue booking messages (entry passes):
//   venue_booking_confirmed · venue_booking_cancelled · venue_refund_state
//   P3: venue_balance_due · venue_balance_overdue · venue_booking_changed ·
//       venue_balance_paid
//   P4 (private hire requests): venue_request_received ·
//       venue_payment_required · venue_hold_expiring · venue_request_declined
//       · venue_request_expired (guest) and venue_request_action_needed (the
//       venue's people: no guest link, no guest contact in the copy)
// ---------------------------------------------------------------------------
// The outbox row carries ids only (venue_group_id, venue_id, reference,
// amount). `notify-outbox-drain` adds the words at send time from the booking
// itself (`venueBookingEmailFacts`), and the private booking link travels in
// the dispatch body only (see venueOfferVisitLink.ts), never in this copy.
//
// Copy rules: plain words, the numbers, one button; no raw codes, no payment
// provider names.
// ===========================================================================

export const VENUE_BOOKING_CATEGORIES = new Set([
  "venue_booking_confirmed",
  "venue_booking_cancelled",
  "venue_refund_state",
  "venue_balance_due",
  "venue_balance_overdue",
  "venue_booking_changed",
  "venue_balance_paid",
  "venue_request_received",
  "venue_payment_required",
  "venue_hold_expiring",
  "venue_request_declined",
  "venue_request_expired",
  "venue_request_action_needed",
  // #4490 Explorer W2: the day-before and two-hours-before visit reminders.
  "venue_visit_reminder",
]);

/** Messages to the venue's own people (never carry the guest's booking link). */
export const VENUE_HOST_CATEGORIES = new Set(["venue_request_action_needed"]);
export const isVenueHostCategory = (key: string): boolean =>
  VENUE_HOST_CATEGORIES.has(key);

export const isVenueBookingCategory = (key: string): boolean =>
  VENUE_BOOKING_CATEGORIES.has(key);

type Json = Record<string, unknown>;
const isJson = (v: unknown): v is Json =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : "";
const minor = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v;
  if (typeof v === "string" && /^-?\d{1,16}$/.test(v)) return Number(v);
  return null;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Thu 19 Nov" from `2026-11-19` (a calendar date, no time zone maths). */
export function venueEmailDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return "";
  return `${WEEKDAYS[(d.getUTCDay() + 6) % 7]} ${Number(m[3])} ${
    MONTHS[Number(m[2]) - 1]
  }`;
}

/** "₦15,050" (whole) or "₦15,050.50"; the currency's own minor exponent. */
/** "17:00" in the venue's zone; "" when unknown. */
export function venueEmailTime(iso: string, timezone: string): string {
  const at = Date.parse(iso);
  if (!iso || Number.isNaN(at)) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone || "Africa/Lagos",
    }).format(new Date(at));
  } catch {
    return "";
  }
}

/** #4490 Explorer W1: the app link display ("usemingla.com/c/K7Q2MX…"), or "". */
export function venueAppLinkDisplay(payload: Record<string, unknown>): string {
  const v = payload.venue_app_link_display;
  return typeof v === "string" && /^usemingla\.com\/c\/[0-9A-Z]{10}$/.test(v)
    ? v
    : "";
}

export function venueEmailMoney(amountMinor: number, currency: string): string {
  const code = currency.toUpperCase().slice(0, 3);
  try {
    const digits =
      new Intl.NumberFormat("en", { style: "currency", currency: code })
        .resolvedOptions().maximumFractionDigits ?? 2;
    const whole = amountMinor % 10 ** digits === 0;
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: whole ? 0 : digits,
    }).format(amountMinor / 10 ** digits);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${code}`;
  }
}

/**
 * The words a venue booking email needs, read from the booking projection
 * (`issue_4490_booking_projection`) at send time. Names and dates only: no
 * guest contact, no token.
 */
export function venueBookingEmailFacts(
  projection: unknown,
  payload: Json,
): Json {
  if (!isJson(projection)) return {};
  const venue = isJson(projection.venue) ? projection.venue : {};
  const offer = isJson(projection.offer) ? projection.offer : {};
  const win = isJson(projection.window) ? projection.window : {};
  const passes = Array.isArray(projection.passes) ? projection.passes : [];
  const firstPass = passes.find(isJson) as Json | undefined;
  const lines = Array.isArray(projection.lines)
    ? projection.lines.filter(isJson)
    : [];
  const guests = minor(firstPass?.admits) ??
    lines.reduce((n, l) => n + (minor(l.guests) ?? 0), 0);
  const currency = text(projection.currencyCode) || text(payload.currency) ||
    "NGN";
  const amountMinor = minor(payload.amount_cents);
  return {
    venue_name: text(venue.name),
    offer_name: text(offer.name),
    visit_date: venueEmailDate(text(win.localDate)),
    // #4490 Explorer W1: the start time in the venue's zone, for the text.
    visit_time: venueEmailTime(text(win.startsAt), text(venue.timezone)),
    guests,
    id_check_label: text(firstPass?.idCheckLabel),
    id_check_count: minor(firstPass?.idCheckCount) ?? 0,
    refunded: venueEmailMoney(minor(projection.refundedMinor) ?? 0, currency),
    refunded_minor: minor(projection.refundedMinor) ?? 0,
    paid_minor: minor(projection.paidMinor) ?? 0,
    // #4490 P3: what is still owed and by when, read at send time.
    balance: venueEmailMoney(minor(projection.balanceDueMinor) ?? 0, currency),
    balance_minor: minor(projection.balanceDueMinor) ?? 0,
    balance_due_date: typeof projection.balanceDueAt === "string"
      ? venueEmailDate(projection.balanceDueAt.slice(0, 10))
      : "",
    ...(amountMinor !== null
      ? { amount: venueEmailMoney(amountMinor, currency) }
      : {}),
    // #4490 P4: the hire's place, the hold clock and the venue's answer.
    ...hireFacts(projection, currency),
  };
}

const venueLocalTime = (iso: string, timezone: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d).replace(",", "");
  } catch {
    return "";
  }
};

function hireFacts(projection: Json, currency: string): Json {
  const hire = isJson(projection.hire) ? projection.hire : null;
  if (!hire) return {};
  const venue = isJson(projection.venue) ? projection.venue : {};
  const tz = text(venue.timezone);
  const holdUntil = text(projection.holdUntil) ||
    text(projection.paymentDeadline);
  const dueNow = minor(projection.amountDueNowMinor);
  return {
    place_name: text(hire.placeName),
    session_label: text(hire.sessionLabel),
    hold_until_text: holdUntil ? venueLocalTime(holdUntil, tz) : "",
    reply_hours: minor(hire.replyWithinHours) ?? 0,
    decline_reason: text(hire.declineReason),
    host_note: text(hire.hostNote),
    closed_reason: text(hire.closedReason),
    due_now: dueNow !== null && dueNow > 0
      ? venueEmailMoney(dueNow, currency)
      : "",
    guests: minor(hire.guests) ?? 0,
  };
}

export interface VenueBookingMessage {
  push: { title: string; body: string };
  email: { subject: string; body: string };
  sms: string;
}

const guestsWord = (n: number): string =>
  `${n} ${n === 1 ? "guest" : "guests"}`;

export function renderVenueBookingMessage(
  categoryKey: string,
  payload: Json,
): VenueBookingMessage {
  const venue = text(payload.venue_name) || "the venue";
  const offer = text(payload.offer_name) || "Entry";
  const date = text(payload.visit_date);
  const ref = text(payload.public_reference);
  const amount = text(payload.amount);
  const guests = minor(payload.guests) ?? 0;
  const on = date ? ` on ${date}` : "";
  const refLine = ref ? ` Booking ${ref}.` : "";

  if (categoryKey === "venue_booking_confirmed") {
    const who = guests > 0 ? ` for ${guestsWord(guests)}` : "";
    const idLabel = text(payload.id_check_label);
    const idCount = minor(payload.id_check_count) ?? 0;
    const idLine = idLabel
      ? `\n\nBring a valid ${idLabel}${
        idCount > 0 ? ` for ${guestsWord(idCount)}` : ""
      }. It's checked at the gate.`
      : "";
    const body = `Your ${offer} at ${venue}${on} is confirmed${who}.${refLine}${
      amount ? ` You paid ${amount}.` : ""
    } One pass lets everyone in: show its code at the gate.${idLine}`;
    return {
      push: {
        title: `You're in at ${venue}`,
        body: `${offer}${on}${who}. Your pass is ready.`,
      },
      email: { subject: `You're in: ${offer} at ${venue}${on}`, body },
      // #4490 Explorer W1 (§6): with the app link, the text carries it.
      sms: venueAppLinkDisplay(payload)
        ? `Mingla: ${venue}, ${
          [date, text(payload.visit_time)].filter(Boolean).join(" ")
        }. Your pass is in the Mingla app: ${venueAppLinkDisplay(payload)}`
        : `${venue}: you're in${on}.${refLine} Your pass is in your email.`,
    };
  }
  if (categoryKey === "venue_visit_reminder") {
    // #4490 Explorer W2 (spec 06 §6): "{venue} tomorrow at {time}" /
    // "{venue} in 2 hours"; body "Your pass is in Purchases."
    const time = text(payload.visit_time);
    const soon = text(payload.reminder_reason) === "2h";
    const when = soon
      ? "in 2 hours"
      : time
      ? `tomorrow at ${time}`
      : "tomorrow";
    const title = `${venue} ${when}`;
    return {
      push: { title, body: "Your pass is in Purchases." },
      email: {
        subject: title,
        body:
          `Your ${offer} at ${venue} is ${when}.${refLine} Your pass is in Purchases in the Mingla app.`,
      },
      sms: `${venue}: your booking is ${when}.${refLine}`,
    };
  }
  if (categoryKey === "venue_booking_cancelled") {
    const refunded = minor(payload.refunded_minor) ?? 0;
    const paid = minor(payload.paid_minor) ?? 0;
    const money = refunded > 0
      ? ` ${
        text(payload.refunded)
      } is on its way back to the card or account you paid with. Banks usually take a few working days.`
      : paid > 0
      ? " Under the terms you agreed, nothing was refunded."
      : " Nothing was charged.";
    const body =
      `Your ${offer} at ${venue}${on} is cancelled.${refLine}${money}`;
    return {
      push: {
        title: `${venue} booking cancelled`,
        body: `${offer}${on} is cancelled.`,
      },
      email: { subject: `Your ${venue} booking is cancelled`, body },
      sms: `${venue}: your booking${on} is cancelled.${refLine}`,
    };
  }
  if (
    categoryKey === "venue_balance_due" ||
    categoryKey === "venue_balance_overdue"
  ) {
    const balance = text(payload.balance) || amount;
    const due = text(payload.balance_due_date);
    const overdue = categoryKey === "venue_balance_overdue";
    const body = overdue
      ? `The rest of your ${offer} at ${venue}${on} was due${
        due ? ` on ${due}` : ""
      }.${refLine} ${
        balance ? `${balance} is still to pay. ` : ""
      }Pay it from your booking page, or talk to ${venue}.`
      : `The rest of your ${offer} at ${venue}${on} is due${
        due ? ` by ${due}` : " soon"
      }.${refLine} ${
        balance ? `${balance} is left to pay. ` : ""
      }You can pay it from your booking page.`;
    return {
      push: {
        title: overdue ? `${venue}: balance overdue` : `${venue}: balance due`,
        body: balance ? `${balance} left to pay${on}.` : `Balance due${on}.`,
      },
      email: {
        subject: overdue
          ? `Your ${venue} balance is overdue`
          : `Your ${venue} balance is due${due ? ` by ${due}` : ""}`,
        body,
      },
      sms: `${venue}: the rest of your booking${on} is ${
        overdue ? "overdue" : "due soon"
      }.${refLine} Pay from your booking page.`,
    };
  }
  if (categoryKey === "venue_booking_changed") {
    const balanceMinor = minor(payload.balance_minor) ?? 0;
    const body = `Your ${offer} at ${venue} has changed${
      date ? `: it is now on ${date}` : ""
    }${guests > 0 ? ` for ${guestsWord(guests)}` : ""}.${refLine}${
      balanceMinor > 0 ? ` ${text(payload.balance)} is left to pay.` : ""
    } Your pass shows the new details.`;
    return {
      push: { title: `${venue} booking changed`, body: `${offer}${on}.` },
      email: { subject: `Your ${venue} booking has changed`, body },
      sms: `${venue}: your booking changed${on}.${refLine}`,
    };
  }
  if (categoryKey === "venue_balance_paid") {
    const balanceMinor = minor(payload.balance_minor) ?? 0;
    const body = `Thank you: ${
      amount || "your payment"
    } for your ${offer} at ${venue}${on} is received.${refLine} ${
      balanceMinor > 0
        ? `${text(payload.balance)} is still to pay.`
        : "Nothing more to pay."
    }`;
    return {
      push: { title: `Payment received by ${venue}`, body: `${offer}${on}.` },
      email: { subject: `Payment received: ${offer} at ${venue}`, body },
      sms: `${venue}: payment received.${refLine}`,
    };
  }
  // #4490 P4 — private hire requests.
  const place = text(payload.place_name) || offer;
  const holdText = text(payload.hold_until_text);
  if (categoryKey === "venue_request_received") {
    const hours = minor(payload.reply_hours) ?? 0;
    const body = `Your request for ${place} at ${venue}${on}${
      guests > 0 ? ` for ${guestsWord(guests)}` : ""
    } is sent.${refLine} Nothing to pay yet. ${venue} replies${
      hours > 0 ? ` within ${hours} hours` : " soon"
    }; if they say yes, you pay the deposit to hold your date.`;
    return {
      push: { title: `Request sent to ${venue}`, body: `${place}${on}.` },
      email: { subject: `Your request to ${venue} is sent`, body },
      sms: `${venue}: your request${on} is sent. Nothing to pay yet.${refLine}`,
    };
  }
  if (categoryKey === "venue_request_action_needed") {
    const nextInLine = text(payload.reminder_reason) === "next_in_line";
    const body = nextInLine
      ? `${place}${on} is free again and a request was waiting for it.${refLine} Open Requests to answer it.`
      : `New request for ${place}${on}${
        guests > 0 ? ` for ${guestsWord(guests)}` : ""
      }.${refLine} Open Requests to answer it before the reply deadline.`;
    return {
      push: {
        title: nextInLine
          ? "A request is next in line"
          : "New request to answer",
        body: `${place}${on}.`,
      },
      email: {
        subject: nextInLine
          ? `${place} is free: a request is next in line`
          : `New request: ${place}${on}`,
        body,
      },
      sms: `Mingla: a request for ${venue}${on} needs an answer.${refLine}`,
    };
  }
  if (
    categoryKey === "venue_payment_required" ||
    categoryKey === "venue_hold_expiring"
  ) {
    const due = text(payload.due_now) || amount;
    const expiring = categoryKey === "venue_hold_expiring";
    const note = text(payload.host_note);
    const body = `${
      expiring
        ? `Your hold on ${place} at ${venue}${on} ends soon.`
        : `${venue} said yes to ${place}${on}.`
    }${refLine} ${place} is held for you${
      holdText ? ` until ${holdText}` : ""
    }. Pay ${due || "the deposit"} to make it yours.${
      note && !expiring ? `\n\n${venue} says: ${note}` : ""
    }`;
    return {
      push: {
        title: expiring ? `${venue}: your hold ends soon` : `${venue} said yes`,
        body: `Pay ${due || "the deposit"} to hold ${place}${on}.`,
      },
      email: {
        subject: expiring
          ? `Your hold on ${place} ends soon`
          : `${venue} said yes: pay to hold your date`,
        body,
      },
      sms: `${venue}: ${
        expiring ? "your hold ends soon" : "they said yes"
      }${on}. Pay from your booking page.${refLine}`,
    };
  }
  if (categoryKey === "venue_request_declined") {
    const reason = text(payload.decline_reason);
    const body = `${venue} can't do ${place}${on}.${refLine}${
      reason ? ` They said: ${reason}.` : ""
    } Nothing was charged. Your booking page shows any other dates they offered.`;
    return {
      push: { title: `${venue} can't do that date`, body: `${place}${on}.` },
      email: { subject: `${venue} can't do that date`, body },
      sms: `${venue}: they can't do that date. Nothing was charged.${refLine}`,
    };
  }
  if (categoryKey === "venue_request_expired") {
    const why = text(payload.reminder_reason);
    const body = why === "not_paid"
      ? `Your hold on ${place} at ${venue}${on} ended before it was paid.${refLine} Nothing was charged. You can ask again from the venue page.`
      : why === "released"
      ? `${venue} let go of the hold on ${place}${on}.${refLine} Nothing was charged.`
      : `${venue} didn't reply to your request for ${place}${on} in time.${refLine} Nothing was charged, and they've been told. You can ask again.`;
    return {
      push: {
        title: `${venue}: request closed`,
        body: `${place}${on}. Nothing was charged.`,
      },
      email: { subject: `Your request to ${venue} has closed`, body },
      sms:
        `${venue}: your request${on} has closed. Nothing was charged.${refLine}`,
    };
  }
  // venue_refund_state
  const body = `${
    amount || "Your refund"
  } for your ${offer} at ${venue}${on} is on its way back to the card or account you paid with.${refLine} Banks usually take a few working days to show it.`;
  return {
    push: {
      title: `Refund from ${venue}`,
      body: `${amount || "Your refund"} is on its way back to you.`,
    },
    email: { subject: `Your refund from ${venue}`, body },
    // SMS stays GSM-7 (no currency symbols).
    sms: `${venue}: your refund is on its way back to you.${refLine}`,
  };
}
