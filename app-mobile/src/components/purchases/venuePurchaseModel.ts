/**
 * #4490 Explorer W2 — venue bookings (passes), plans and waitlist places in
 * Purchases. PURE: parsers for the three server reads, their Purchases
 * timeline sources, and the words each state shows. No React, no network.
 *
 * Money is always the server's (minor units) and goes through the Purchases
 * money text (`purchaseMoneyText`, the list's formatter, so a row and its
 * detail read the same amount the same way); dates are the venue's own day and time
 * (day-first, 24-hour). Wording follows the web booking, member and waitlist
 * pages so a guest reads the same sentence on both.
 */
import {
  currencyExponent,
  entryDateLabel,
  guestsText,
  parseEntryBooking,
  passProgressLine,
  venueClock,
  type EntryBooking,
} from "@mingla/brand-rendering/venueOffers/entryModel";
import { purchaseMoneyText } from "../../utils/purchaseMoney";

type Json = Record<string, unknown>;
const isJson = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): Json => (isJson(v) ? v : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : typeof v === "string" && /^-?\d{1,16}$/.test(v) ? Number(v) : null;

// ═══════════════════════════════════════════════════════════════════════════
// Venue bookings (`issue_4490_my_offer_bookings`, `venue-offers get`)
// ═══════════════════════════════════════════════════════════════════════════

export interface VenueBookingExtra {
  name: string;
  qty: number;
  amountMinor: number;
}

export interface VenueBookingPlace {
  placeName: string | null;
  layout: string | null;
  sessionLabel: string | null;
  from: string | null;
  to: string | null;
  guests: number | null;
  damageDepositMinor: number | null;
}

export interface VenueBooking extends EntryBooking {
  offerKind: string;
  createdAt: string | null;
  balanceDueMinor: number;
  balanceDueAt: string | null;
  paidAtVenueMinor: number;
  paymentDeadline: string | null;
  hire: VenueBookingPlace | null;
  hour: VenueBookingPlace | null;
  extras: VenueBookingExtra[];
  canChangeGuests: boolean;
  guestChangeUntil: string | null;
  exponent: number;
  /** #4490 W4: the pay modes the server allows now, with its amounts (empty once confirmed). */
  payModes: Array<{ mode: "deposit" | "full"; amountMinor: number }>;
  /**
   * #4490 06-W4 fix 2 (W4-R1): the server's reason an offer that takes a
   * deposit asks for everything now (`fullNowReason`); null otherwise.
   */
  fullNowReason: VenueFullNowReason | null;
}

export type VenueFullNowReason = "balance_due_passed" | "deposit_covers_total";

function place(raw: unknown): VenueBookingPlace | null {
  if (!isJson(raw)) return null;
  return {
    placeName: str(raw.placeName),
    layout: str(raw.layout),
    sessionLabel: str(raw.sessionLabel),
    from: str(raw.bookedFrom),
    to: str(raw.bookedTo),
    guests: int(raw.guests),
    damageDepositMinor: int(raw.damageDepositMinor),
  };
}

/** One venue booking (the booking projection). Null when it isn't one. */
export function parseVenueBooking(raw: unknown): VenueBooking | null {
  const base = parseEntryBooking(raw);
  if (base === null || !isJson(raw)) return null;
  const rules = obj(raw.changeRules);
  const extras: VenueBookingExtra[] = [];
  for (const e of Array.isArray(raw.extras) ? raw.extras : []) {
    if (!isJson(e)) continue;
    const name = str(e.name);
    const amount = int(e.amountMinor);
    if (name === null || amount === null) continue;
    extras.push({ name, qty: int(e.qty) ?? 1, amountMinor: amount });
  }
  const offer = obj(raw.offer);
  return {
    ...base,
    offerKind: str(raw.offerKind) ?? str(offer.kind) ?? "entry",
    createdAt: str(raw.createdAt),
    balanceDueMinor: int(raw.balanceDueMinor) ?? 0,
    balanceDueAt: str(raw.balanceDueAt),
    paidAtVenueMinor: int(raw.paidAtVenueMinor) ?? 0,
    paymentDeadline: str(raw.paymentDeadline),
    hire: place(raw.hire),
    hour: place(raw.hour),
    extras,
    canChangeGuests: rules.canChangeGuests === true,
    guestChangeUntil: str(rules.guestChangeUntil),
    exponent: currencyExponent(base.currencyCode),
    payModes: (Array.isArray(raw.payModes) ? raw.payModes : []).flatMap((m) => {
      if (!isJson(m) || (m.mode !== "deposit" && m.mode !== "full")) return [];
      const amount = int(m.amountMinor);
      return amount === null ? [] : [{ mode: m.mode, amountMinor: amount }];
    }),
    fullNowReason:
      raw.fullNowReason === "balance_due_passed" || raw.fullNowReason === "deposit_covers_total" ? raw.fullNowReason : null,
  };
}

export function parseVenueBookings(raw: unknown): VenueBooking[] {
  if (!Array.isArray(raw)) throw new Error("venue_bookings_shape");
  return raw.flatMap((row) => {
    const parsed = parseVenueBooking(row);
    return parsed === null ? [] : [parsed];
  });
}

/** When the visit starts and ends (the first slice; a hire's booked time). */
export function venueBookingSpan(b: VenueBooking): { startsAt: string | null; endsAt: string | null } {
  const pass = b.passes[0];
  return {
    startsAt: b.window?.startsAt || b.hire?.from || b.hour?.from || pass?.validFrom || b.createdAt,
    endsAt: b.window?.endsAt || b.hire?.to || b.hour?.to || pass?.validTo || null,
  };
}

const FINISHED_BOOKING_STATES = new Set(["cancelled", "declined", "request_expired"]);
export const isFinishedVenueBooking = (state: string): boolean => FINISHED_BOOKING_STATES.has(state);

/** The pass can be shown at the door: a confirmed booking with a scannable pass. */
export function venueBookingDoorPass(b: VenueBooking): { passId: string; qrPayload: string } | null {
  if (b.state !== "confirmed" && b.state !== "partially_cancelled") return null;
  const pass = b.passes.find((p) => p.status === "valid" && p.qrPayload !== null);
  return pass === undefined || pass.qrPayload === null ? null : { passId: pass.passId, qrPayload: pass.qrPayload };
}

/** The state badge words. */
export function venueBookingStateLabel(state: string): string {
  switch (state) {
    case "confirmed":
      return "Confirmed";
    case "partially_cancelled":
      return "Partly cancelled";
    case "cancelled":
      return "Cancelled";
    case "request_pending":
      return "Requested";
    case "approved_payment_required":
      return "Pay to hold your date";
    case "declined":
      return "Declined";
    case "request_expired":
      return "Request closed";
    case "instant_payment_pending":
    case "finalizing":
      return "Payment pending";
    case "reconciliation_required":
      return "Checking payment";
    default:
      return "Booking";
  }
}

/** "Sat 21 Nov · 12:00 to 17:00" in the venue's zone, or the day alone. */
export function venueBookingWhenLine(b: VenueBooking): string | null {
  const tz = b.venue.timezone;
  const span = venueBookingSpan(b);
  if (span.startsAt === null) return null;
  const day = venueDay(span.startsAt, tz);
  const from = venueClock(span.startsAt, tz);
  const to = span.endsAt !== null ? venueClock(span.endsAt, tz) : null;
  const time = from !== null && to !== null ? `${from} to ${to}` : from;
  return [day, time].filter((v): v is string => v !== null && v.length > 0).join(" · ") || null;
}

/** "Day 3 of 10 · valid until Sat 16 Jan" for a multi-day pass, else null. */
export const venueBookingProgress = (b: VenueBooking): string | null => passProgressLine(b.passes[0]);

/** W2-N17: the guest change button, singular or plural ("Change to 1 guest"). */
export const venueGuestChangeLabel = (guests: number): string => `Change to ${guestsText(guests)}`;

/** A booking always keeps at least one guest. */
export const VENUE_MIN_GUESTS = 1;
/** Carried-over check: "−" is disabled (visibly) at the minimum, never a dead tap. */
export const venueGuestsCanDecrease = (guests: number): boolean => guests > VENUE_MIN_GUESTS;

export function venueBookingGuests(b: VenueBooking): number {
  return b.passes[0]?.admits ?? b.hire?.guests ?? b.hour?.guests ?? b.lines.reduce((n, l) => n + l.guests, 0);
}

export interface VenueMoneyRow {
  label: string;
  value: string;
}

/** Paid, paid at the venue, left to pay (with its date) and refunded: server numbers only. */
export function venueBookingMoneyRows(b: VenueBooking): VenueMoneyRow[] {
  const money = (minor: number): string => purchaseMoneyText(minor, b.currencyCode, b.exponent) ?? "—";
  const rows: VenueMoneyRow[] = [{ label: "Total", value: money(b.totalMinor) }];
  if (b.paidMinor > 0) rows.push({ label: "Paid", value: money(b.paidMinor) });
  if (b.paidAtVenueMinor > 0) rows.push({ label: "Paid at the venue", value: money(b.paidAtVenueMinor) });
  if (b.balanceDueMinor > 0) {
    const due = b.balanceDueAt !== null ? venueDay(b.balanceDueAt, b.venue.timezone) : null;
    rows.push({ label: due !== null ? `Left to pay by ${due}` : "Left to pay", value: money(b.balanceDueMinor) });
  }
  if (b.state === "approved_payment_required" && b.amountDueNowMinor > 0) {
    rows.push({ label: "Pay to hold your date", value: money(b.amountDueNowMinor) });
  }
  // W2-N35: the server's refundedMinor counts refunds still being sent
  // (submitted, processing) as well as finished ones, so the row says "Refund"
  // (Purchases' existing word), never "Refunded" before the money has moved.
  if (b.refundedMinor > 0) rows.push({ label: "Refund", value: money(b.refundedMinor) });
  return rows;
}

/**
 * #4490 W4 — what the guest can pay in the app now, with the server's
 * amounts: an approved private hire's "Pay to hold your date" (the deposit or
 * the whole, as the server allows) or a confirmed booking's "Pay the rest"
 * (the balance; the server picks the amount). Null when nothing is owed now.
 * The button opens the native checkout sheet straight at Pay.
 */
export interface VenueBookingPayAction {
  label: "Pay to hold your date" | "Pay the rest";
  /** The server's amount due now (the deposit when one is offered). */
  amountMinor: number;
  payOptions: Array<{ mode: "deposit" | "full"; amountMinor: number }>;
  /** #4490 06-W4 fix 2 (W4-R1): why everything is due now, when only "full" is offered. */
  fullNowReason: VenueFullNowReason | null;
}

export function venueBookingPayAction(b: VenueBooking): VenueBookingPayAction | null {
  if (b.paymentCollection !== null && b.paymentCollection !== "mingla") return null;
  if (b.state === "approved_payment_required" && b.amountDueNowMinor > 0) {
    const deposit = b.payModes.find((m) => m.mode === "deposit");
    return {
      label: "Pay to hold your date",
      amountMinor: deposit?.amountMinor ?? b.amountDueNowMinor,
      payOptions: b.payModes.length > 1 ? b.payModes : [],
      fullNowReason: deposit === undefined ? b.fullNowReason : null,
    };
  }
  if ((b.state === "confirmed" || b.state === "partially_cancelled") && b.balanceDueMinor > 0) {
    return { label: "Pay the rest", amountMinor: b.balanceDueMinor, payOptions: [], fullNowReason: null };
  }
  return null;
}

/** Extras and a hire's damage deposit, each with the server's amount. */
export function venueBookingExtraRows(b: VenueBooking): VenueMoneyRow[] {
  const money = (minor: number): string => purchaseMoneyText(minor, b.currencyCode, b.exponent) ?? "—";
  const rows = b.extras.map((e) => ({ label: e.qty > 1 ? `${e.name} × ${e.qty}` : e.name, value: money(e.amountMinor) }));
  const deposit = b.hire?.damageDepositMinor ?? null;
  if (deposit !== null && deposit > 0) rows.push({ label: "Damage deposit (refundable)", value: money(deposit) });
  return rows;
}

const LAYOUT_WORDS: Readonly<Record<string, string>> = {
  banquet: "Banquet",
  theatre: "Theatre",
  classroom: "Classroom",
  cabaret: "Cabaret",
  boardroom: "Boardroom",
  standing: "Standing",
  u_shape: "U-shape",
  reception: "Reception",
};

/** "The Lounge Side · Banquet · Full day" for a hire or a room by the hour. */
export function venueBookingPlaceLine(b: VenueBooking): string | null {
  const p = b.hire ?? b.hour;
  if (p === null) return null;
  const layout = p.layout === null ? null : LAYOUT_WORDS[p.layout] ?? p.layout.replaceAll("_", " ");
  const parts = [p.placeName, layout, p.sessionLabel].filter((v): v is string => v !== null && v.length > 0);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The venue's own calendar day ("Sat 21 Nov") of an instant. */
export function venueDay(iso: string, timeZone: string | null): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    return entryDateLabel(parts);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Plans (`issue_4490_my_memberships`, `venue-offers membership_get`)
// ═══════════════════════════════════════════════════════════════════════════

export type VenueMemberStatus =
  | "pending"
  | "active"
  | "payment_due"
  | "grace"
  | "lapsed"
  | "paused"
  | "requested"
  | "declined"
  | "cancelled";

const MEMBER_STATUSES: readonly VenueMemberStatus[] = [
  "pending",
  "active",
  "payment_due",
  "grace",
  "lapsed",
  "paused",
  "requested",
  "declined",
  "cancelled",
];

export interface VenueMember {
  subscriptionId: string;
  status: VenueMemberStatus;
  planName: string;
  period: "month" | "year";
  memberCode: string | null;
  venue: { id: string | null; name: string; slug: string | null; brandSlug: string | null; brandName: string | null; timezone: string };
  activeUntil: string | null;
  renewsOn: string | null;
  createdAt: string | null;
  startedAt: string | null;
  assignedSpace: string | null;
  paymentDue: { amountMinor: number; currencyCode: string; graceEndsAt: string | null } | null;
  leavingOn: string | null;
  pausingFrom: string | null;
  endedAt: string | null;
  endReason: string | null;
  declineReason: string | null;
  canLeave: boolean;
  canPause: boolean;
  canResume: boolean;
  canStay: boolean;
  pass: { qrPayload: string; valid: boolean } | null;
  version: number;
}

export function parseVenueMember(raw: unknown): VenueMember | null {
  if (!isJson(raw) || typeof raw.subscriptionId !== "string") return null;
  const plan = obj(raw.plan);
  const venue = obj(raw.venue);
  const due = isJson(raw.paymentDue) ? raw.paymentDue : null;
  const status = str(raw.status) as VenueMemberStatus | null;
  const pass = isJson(raw.pass) && typeof raw.pass.qrPayload === "string" ? raw.pass : null;
  return {
    subscriptionId: raw.subscriptionId,
    status: status !== null && MEMBER_STATUSES.includes(status) ? status : "pending",
    planName: str(plan.name) ?? "Membership",
    period: plan.interval === "year" ? "year" : "month",
    memberCode: str(raw.memberCode),
    venue: {
      id: str(venue.id),
      name: str(venue.name) ?? "the venue",
      slug: str(venue.slug),
      brandSlug: str(venue.brandSlug),
      brandName: str(venue.brandName),
      timezone: str(venue.timezone) ?? "Africa/Lagos",
    },
    activeUntil: str(raw.activeUntil),
    renewsOn: str(raw.renewsOn),
    createdAt: str(raw.createdAt),
    startedAt: str(raw.startedAt),
    assignedSpace: isJson(raw.assignedSpace) ? str(raw.assignedSpace.name) : null,
    paymentDue:
      due === null
        ? null
        : { amountMinor: int(due.amountMinor) ?? 0, currencyCode: str(due.currencyCode) ?? "NGN", graceEndsAt: str(due.graceEndsAt) },
    leavingOn: isJson(raw.leaving) ? str(raw.leaving.endsAt) : null,
    pausingFrom: isJson(raw.pausing) ? str(raw.pausing.from) : null,
    endedAt: str(raw.endedAt),
    endReason: str(raw.endReason),
    declineReason: str(raw.declineReason),
    canLeave: raw.canLeave === true,
    canPause: raw.canPause === true,
    canResume: raw.canResume === true,
    canStay: raw.canStay === true,
    pass: pass === null ? null : { qrPayload: pass.qrPayload as string, valid: pass.valid === true },
    version: int(raw.version) ?? 1,
  };
}

export function parseVenueMembers(raw: unknown): VenueMember[] {
  if (!Array.isArray(raw)) throw new Error("venue_members_shape");
  return raw.flatMap((row) => {
    const parsed = parseVenueMember(row);
    return parsed === null ? [] : [parsed];
  });
}

/** "Sun 21 Nov" or, for a yearly plan, "Sun 21 Nov 2027" (venue zone). */
export function memberDay(iso: string | null, m: Pick<VenueMember, "period" | "venue">): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(m.period === "year" ? { year: "numeric" as const } : {}),
      timeZone: m.venue.timezone,
    })
      .format(d)
      .replace(",", "");
  } catch {
    return null;
  }
}

const LIVE_MEMBER = new Set<VenueMemberStatus>(["pending", "active", "payment_due", "grace", "paused", "requested"]);
export const isLiveVenueMember = (status: string): boolean => LIVE_MEMBER.has(status as VenueMemberStatus);

/** The plan's headline and line (the web member page's words). */
export function venueMemberState(m: VenueMember): { label: string; title: string; line: string } {
  const period = m.period;
  const day = (iso: string | null): string => memberDay(iso, m) ?? "";
  switch (m.status) {
    case "pending":
      return { label: "Not started", title: `Pay your first ${period} to start`, line: `Your membership starts as soon as the first ${period} is paid.` };
    case "requested":
      return { label: "Requested", title: "Request sent", line: `${m.venue.name} will reply soon. Nothing to pay until they do.` };
    case "declined":
      return { label: "Declined", title: `${m.venue.name} can't take you on this plan`, line: m.declineReason ?? "No payment was taken." };
    case "active":
      if (m.leavingOn !== null) {
        return { label: "Active", title: `You're leaving on ${day(m.leavingOn)}`, line: "Your pass works as usual until then, and nothing more is owed." };
      }
      if (m.pausingFrom !== null) {
        return { label: "Active", title: `Pausing on ${day(m.pausingFrom)}`, line: `Your pass works until then. No payment email goes out for the next ${period}.` };
      }
      return { label: "Active", title: "You're a member", line: `Paid until ${day(m.activeUntil)}.` };
    case "payment_due":
    case "grace":
      return {
        label: "Payment due",
        title: `This ${period}'s payment is due`,
        line: `You can still come in until ${day(m.paymentDue?.graceEndsAt ?? null)}. Pay to keep your place.`,
      };
    case "lapsed":
      return { label: "Paused", title: `Paused: this ${period} isn't paid`, line: "Your pass won't open the door until you pay. Pay and it starts again at once." };
    case "paused":
      return { label: "Paused", title: "Your membership is paused", line: `It starts again when you pay for a new ${period}.` };
    case "cancelled":
    default:
      return {
        label: "Left",
        title: m.endReason === "not_paid" ? "This membership closed" : "Your membership has ended",
        line: m.endReason === "not_paid" ? `The first ${period} was never paid. You can join again from the venue's page.` : `It ended on ${day(m.endedAt)}. Thank you for being a member.`,
      };
  }
}

/**
 * W2-N19: the date a plan's Purchases row is placed and shown by. A live plan
 * goes by what comes next (renewal, else paid-until, else the payment's last
 * day, else when it was joined); an ended plan by when it ended.
 */
export function venueMemberListDate(m: VenueMember): string | null {
  if (isLiveVenueMember(m.status)) {
    return m.renewsOn ?? m.activeUntil ?? m.paymentDue?.graceEndsAt ?? m.startedAt ?? m.createdAt;
  }
  return m.endedAt ?? m.activeUntil ?? m.startedAt ?? m.createdAt;
}

/** W2-N19: the row's date line: "Paid until Sun 21 Nov 2027" while active, else the plan's headline. */
export function venueMemberListLine(m: VenueMember): string {
  if (m.status === "active" && m.leavingOn === null && m.pausingFrom === null) {
    const until = memberDay(m.activeUntil, m);
    if (until !== null) return `Paid until ${until}`;
  }
  return venueMemberState(m).title;
}

/** Renew (pay on the web) is offered only when something is owed and payable. */
export function venueMemberCanRenew(m: VenueMember): boolean {
  return m.status === "pending" || m.status === "payment_due" || m.status === "grace" || m.status === "lapsed";
}

/** "ABC DEF": the short door code as the pass and door show it. */
export function memberCodeWords(code: string | null): string | null {
  if (code === null || !/^[2-9A-HJ-NP-Z]{6}$/.test(code)) return null;
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Waitlist places (`issue_4490_my_waitlist_entries`, `venue-waitlist get`)
// ═══════════════════════════════════════════════════════════════════════════

export interface VenueWaitlistPlace {
  id: string;
  venueId: string | null;
  venueName: string;
  brandSlug: string | null;
  venueSlug: string | null;
  partySize: number;
  desiredDate: string | null;
  desiredFrom: string | null;
  desiredTo: string | null;
  status: string;
  createdAt: string | null;
  timezone: string;
  startsAt: string | null;
}

export function parseVenueWaitlistPlaces(raw: unknown): VenueWaitlistPlace[] {
  if (!Array.isArray(raw)) throw new Error("venue_waitlist_shape");
  return raw.flatMap((row): VenueWaitlistPlace[] => {
    if (!isJson(row) || typeof row.id !== "string") return [];
    return [
      {
        id: row.id,
        venueId: str(row.venueId),
        venueName: str(row.venueName) ?? "the venue",
        brandSlug: str(row.brandSlug),
        venueSlug: str(row.venueSlug),
        partySize: int(row.partySize) ?? 1,
        desiredDate: str(row.desiredDate),
        desiredFrom: str(row.desiredFrom),
        desiredTo: str(row.desiredTo),
        status: str(row.status) ?? "waiting",
        createdAt: str(row.createdAt),
        timezone: str(row.timezone) ?? "Africa/Lagos",
        startsAt: str(row.startsAt),
      },
    ];
  });
}

const OPEN_WAITLIST = new Set(["waiting", "notified"]);
export const isOpenWaitlistPlace = (status: string): boolean => OPEN_WAITLIST.has(status);

/** The waitlist page's headline and line (the web page's words). */
export function venueWaitlistState(p: Pick<VenueWaitlistPlace, "status" | "venueName" | "partySize" | "desiredFrom" | "desiredTo">): {
  label: string;
  title: string;
  line: string;
} {
  const venue = p.venueName;
  switch (p.status) {
    case "notified":
      return { label: "Table ready", title: "A table is ready", line: `${venue} is ready for you. Head to the host stand and give your name.` };
    case "converted":
      return { label: "Booked", title: "You're booked", line: `Your waitlist place became a booking at ${venue}.` };
    case "lost":
      return { label: "Left", title: "You left the waitlist", line: `${venue} won't contact you about this one.` };
    case "expired":
      return { label: "Ended", title: "This waitlist place ended", line: "The time passed. Join again if you'd still like a table." };
    case "waiting":
    default: {
      const range = p.desiredFrom !== null && p.desiredTo !== null ? ` between ${p.desiredFrom.slice(0, 5)} and ${p.desiredTo.slice(0, 5)}` : "";
      return { label: "Waiting", title: "You're on the waitlist", line: `We'll tell you as soon as a table for ${p.partySize} opens${range}.` };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The detail screen when there is nothing to show (W2-N16)
// ═══════════════════════════════════════════════════════════════════════════

const VENUE_NOUN: Readonly<Record<"venue_booking" | "venue_membership" | "venue_waitlist", string>> = {
  venue_booking: "pass",
  venue_membership: "plan",
  venue_waitlist: "waitlist place",
};

/**
 * A venue id that is not this account's (or not real) is a not-found, said
 * with the item's own noun and no blame on the connection; a read that failed
 * is a load error with Retry (the pass's own load-error words).
 */
export function venueDetailMissingCopy(
  kind: "venue_booking" | "venue_membership" | "venue_waitlist",
  reason: "not_found" | "load_failed",
): { title: string; body: string | null; retry: boolean } {
  const noun = VENUE_NOUN[kind];
  if (reason === "load_failed") {
    return { title: `We couldn't load your ${noun}.`, body: "Check your connection and try again.", retry: true };
  }
  return { title: `This ${noun} isn't on your account.`, body: null, retry: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// Server codes → plain words (never a raw code)
// ═══════════════════════════════════════════════════════════════════════════

const MEMBER_ERRORS: Readonly<Record<string, string>> = {
  membership_token_required: "Open your member page from the link in your membership email.",
  membership_not_found: "We couldn't find this membership. Open it from the link in your membership email.",
  membership_nothing_to_pay: "There's nothing to pay on this plan right now.",
  membership_payment_unavailable: "We couldn't open the payment page. Try again.",
  membership_payment_details_rejected: "The payment page didn't accept these details. Check your email address and try again.",
  offer_payment_already_pending: "A payment for this plan is already in progress. Give it a minute, then check again.",
  offer_payment_already_paid: "That payment went through already. We've refreshed your plan.",
  waitlist_not_found: "We couldn't find this waitlist place. It may have ended.",
  rate_limited: "Too many tries in a short time. Wait a minute, then try again.",
};

export function venueMemberErrorCopy(code: string | null | undefined): string {
  if (typeof code === "string" && code in MEMBER_ERRORS) return MEMBER_ERRORS[code];
  return "Something went wrong. Try again.";
}
