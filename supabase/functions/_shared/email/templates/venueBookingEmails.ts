// ===========================================================================
// #4490 P2 — the guest's venue booking messages (entry passes):
//   venue_booking_confirmed · venue_booking_cancelled · venue_refund_state
//   P3: venue_balance_due · venue_balance_overdue · venue_booking_changed ·
//       venue_balance_paid
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
]);

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
      sms: `${venue}: you're in${on}.${refLine} Your pass is in your email.`,
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
