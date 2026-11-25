/**
 * #4490 P6-3 — memberships for the guest, pure: the member read
 * (`membership_get`), the words for each state (Active · Payment due ·
 * Paused · Left, plus joining), the join path, the first period's total with
 * the venue's VAT, the member's price block from a quote, which member this
 * device knows at a venue, and every refusal in plain words. No React.
 *
 * The device keeps the member token next to the booking tokens (keyed by the
 * membership id; `venueOfferBookingTokens`) and remembers which membership
 * belongs to which venue page, so checkout can offer "I'm a member".
 */
import {
  isVenueOfferBookingToken,
  readVenueOfferBookingToken,
} from "../../../utils/venueOfferBookingTokens";
import { parsePlanCharge, type VenuePlanCharge } from "@mingla/brand-rendering/venueValues";

export type GuestMemberStatus = "pending" | "active" | "payment_due" | "grace" | "lapsed" | "paused" | "requested" | "declined" | "cancelled";

/** A by-request join never opens the payment provider before Host approval. */
export function membershipJoinNeedsPayment(
  joinMode: "instant" | "request",
  resultStatus: string | null,
): boolean {
  return joinMode === "instant" && resultStatus !== "requested";
}

/** Benefits and member prices start only after the first period is paid. */
export function membershipBenefitsAvailable(status: GuestMemberStatus): boolean {
  return status === "active" || status === "payment_due" || status === "grace";
}

export interface GuestMember {
  subscriptionId: string;
  status: GuestMemberStatus;
  memberCode: string | null;
  memberName: string;
  /** #4490 fix 3 (N87) — the member's own email (their own view only). */
  memberEmail?: string | null;
  plan: {
    id: string;
    name: string;
    priceMinor: number;
    currencyCode: string;
    inclusions: string[];
    entryIncluded: boolean;
    roomHours: number;
    guestPasses: number;
    discountBps: number;
    discountKinds: string[];
    hourOfferingIds: string[];
    entryOfferingId: string | null;
    period: "month" | "year";
    joinMode: "instant" | "request";
  };
  terms: { minMonths: number | null; noticeDays: number | null; graceDays: number | null; renewalNoticeDays: number | null };
  venue: { id: string; name: string; slug: string | null; brandSlug: string | null; brandName: string | null; timezone: string };
  startOn: string | null;
  startedAt: string | null;
  activeUntil: string | null;
  /** Start of the month now paid (null before the first payment). */
  currentPeriodStart: string | null;
  renewsOn: string | null;
  renewalEmailOn: string | null;
  canCheckIn: boolean;
  assignedSpace: { id: string; name: string } | null;
  requestReplyBy: string | null;
  paymentDue: {
    periodId: string;
    /** #4490 06-W4 fix 1 (W4-N2): what the payment page charges (VAT and fees included). */
    amountMinor: number;
    /** The server's breakdown of that amount (`issue_4490_member_charge`); null from an older server. */
    charge: VenuePlanCharge | null;
    currencyCode: string;
    periodStart: string;
    periodEnd: string;
    dueAt: string | null;
    graceEndsAt: string | null;
    paying: boolean;
  } | null;
  leaving: { endsAt: string; by: string | null } | null;
  pausing: { from: string; by: string | null } | null;
  paused: { since: string | null; by: string | null } | null;
  endedAt: string | null;
  endReason: "left" | "cancelled_by_venue" | "not_paid" | null;
  credits: { roomHoursLeft: number; roomHoursPerMonth: number; guestPassesLeft: number; guestPassesPerMonth: number };
  inToday: boolean;
  canLeave: boolean;
  canStay: boolean;
  canPause: boolean;
  canResume: boolean;
  version: number;
  createdAt: string | null;
  pass: { qrPayload: string; valid: boolean } | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown, fallback = 0): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const STATUSES: readonly GuestMemberStatus[] = ["pending", "active", "payment_due", "grace", "lapsed", "paused", "requested", "declined", "cancelled"];

/** The member read (guest view); null when it isn't one. */
export function parseGuestMember(raw: unknown): GuestMember | null {
  const m = obj(raw);
  if (typeof m.subscriptionId !== "string") return null;
  const plan = obj(m.plan);
  const terms = obj(m.terms);
  const venue = obj(m.venue);
  const credits = obj(m.credits);
  const due = m.paymentDue === null || m.paymentDue === undefined ? null : obj(m.paymentDue);
  const leaving = m.leaving === null || m.leaving === undefined ? null : obj(m.leaving);
  const pausing = m.pausing === null || m.pausing === undefined ? null : obj(m.pausing);
  const paused = m.paused === null || m.paused === undefined ? null : obj(m.paused);
  const pass = m.pass === null || m.pass === undefined ? null : obj(m.pass);
  const status = str(m.status) as GuestMemberStatus;
  const reason = str(m.endReason);
  return {
    subscriptionId: m.subscriptionId,
    status: STATUSES.includes(status) ? status : "pending",
    memberCode: strOrNull(m.memberCode),
    memberName: str(m.memberName, "Member"),
    memberEmail: typeof m.memberEmail === "string" && m.memberEmail.length > 0 ? m.memberEmail : null,
    plan: {
      id: str(plan.id),
      name: str(plan.name, "Membership"),
      priceMinor: num(plan.priceMinor),
      currencyCode: str(plan.currencyCode, "NGN"),
      inclusions: strings(plan.inclusions),
      entryIncluded: plan.entryIncluded === true,
      roomHours: num(plan.roomHours),
      guestPasses: num(plan.guestPasses),
      discountBps: num(plan.discountBps),
      discountKinds: strings(plan.discountKinds),
      hourOfferingIds: strings(plan.hourOfferingIds),
      entryOfferingId: strOrNull(plan.entryOfferingId),
      period: plan.interval === "year" ? "year" : "month",
      joinMode: plan.joinMode === "request" ? "request" : "instant",
    },
    terms: {
      minMonths: numOrNull(terms.minMonths),
      noticeDays: numOrNull(terms.noticeDays),
      graceDays: numOrNull(terms.graceDays),
      renewalNoticeDays: numOrNull(terms.renewalNoticeDays),
    },
    venue: {
      id: str(venue.id),
      name: str(venue.name, "the venue"),
      slug: strOrNull(venue.slug),
      brandSlug: strOrNull(venue.brandSlug),
      brandName: strOrNull(venue.brandName),
      timezone: str(venue.timezone, "Africa/Lagos"),
    },
    startOn: strOrNull(m.startOn),
    startedAt: strOrNull(m.startedAt),
    activeUntil: strOrNull(m.activeUntil),
    currentPeriodStart: m.currentPeriod === null || m.currentPeriod === undefined ? null : strOrNull(obj(m.currentPeriod).start),
    renewsOn: strOrNull(m.renewsOn),
    renewalEmailOn: strOrNull(m.renewalEmailOn),
    canCheckIn: m.canCheckIn === true,
    assignedSpace:
      m.assignedSpace === null || m.assignedSpace === undefined
        ? null
        : { id: str(obj(m.assignedSpace).id), name: str(obj(m.assignedSpace).name) },
    requestReplyBy: strOrNull(m.requestReplyBy),
    paymentDue:
      due === null
        ? null
        : {
            periodId: str(due.periodId),
            amountMinor: num(due.amountMinor),
            charge: parsePlanCharge(due),
            currencyCode: str(due.currencyCode, "NGN"),
            periodStart: str(due.periodStart),
            periodEnd: str(due.periodEnd),
            dueAt: strOrNull(due.dueAt),
            graceEndsAt: strOrNull(due.graceEndsAt),
            paying: due.paying === true,
          },
    leaving: leaving === null ? null : { endsAt: str(leaving.endsAt), by: strOrNull(leaving.by) },
    pausing: pausing === null ? null : { from: str(pausing.from), by: strOrNull(pausing.by) },
    paused: paused === null ? null : { since: strOrNull(paused.since), by: strOrNull(paused.by) },
    endedAt: strOrNull(m.endedAt),
    endReason: reason === "left" || reason === "cancelled_by_venue" || reason === "not_paid" ? reason : null,
    credits: {
      roomHoursLeft: num(credits.roomHoursLeft),
      roomHoursPerMonth: num(credits.roomHoursPerMonth),
      guestPassesLeft: num(credits.guestPassesLeft),
      guestPassesPerMonth: num(credits.guestPassesPerMonth),
    },
    inToday: m.inToday === true,
    canLeave: m.canLeave === true,
    canStay: m.canStay === true,
    canPause: m.canPause === true,
    canResume: m.canResume === true,
    version: num(m.version, 1),
    createdAt: strOrNull(m.createdAt),
    pass: pass === null || typeof pass.qrPayload !== "string" ? null : { qrPayload: pass.qrPayload, valid: pass.valid === true },
  };
}

// ---------------------------------------------------------------- dates

/** "Tue 1 Dec" (or "Tue 1 Dec 2027") in the venue's zone. */
export function memberDayWords(
  iso: string | null | undefined,
  timeZone: string,
  options: { year?: boolean; weekday?: boolean } = {},
): string | null {
  if (iso === null || iso === undefined || iso.length === 0) return null;
  const plain = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = plain ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      ...(options.weekday === false ? {} : { weekday: "short" as const }),
      day: "numeric",
      month: "short",
      ...(options.year === true ? { year: "numeric" as const } : {}),
      timeZone: plain ? "UTC" : timeZone,
    })
      .format(d)
      .replace(",", "");
  } catch {
    return d.toDateString();
  }
}

/** A period shows both years when its endpoints are in different years. */
export function memberPeriodRangeWords(
  start: string | null | undefined,
  end: string | null | undefined,
  timeZone: string,
  options: { weekday?: boolean; separator?: string } = {},
): string | null {
  if (start === null || start === undefined || end === null || end === undefined) return null;
  const year = (iso: string): string | null => {
    const plain = /^\d{4}-\d{2}-\d{2}$/.test(iso);
    const d = plain ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: plain ? "UTC" : timeZone }).format(d);
    } catch {
      return null;
    }
  };
  const includeYear = year(start) !== year(end);
  const from = memberDayWords(start, timeZone, { weekday: options.weekday, year: includeYear });
  const to = memberDayWords(end, timeZone, { weekday: options.weekday, year: includeYear });
  return from !== null && to !== null ? `${from}${options.separator ?? " to "}${to}` : null;
}

/** "December" for the month a payment covers. */
export function monthWords(iso: string | null | undefined, timeZone: string): string | null {
  if (iso === null || iso === undefined || iso.length === 0) return null;
  const plain = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = plain ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: plain ? "UTC" : timeZone }).format(d);
  } catch {
    return null;
  }
}

/** "4 hours", "1 hour", "30 minutes". */
export function hoursLeftWords(hours: number): string {
  if (!(hours > 0)) return "0 hours";
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.round(hours * 4) / 4;
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} ${h === 1 ? "hour" : "hours"}`;
}

// ---------------------------------------------------------------- states

export interface GuestMemberState {
  /** Guest words per the contract: Active · Payment due · Paused · Left (+ joining). */
  label: "Active" | "Payment due" | "Paused" | "Left" | "Not started" | "Requested" | "Declined";
  tone: "success" | "warning" | "error" | "neutral";
  title: string;
  line: string;
}

export function guestMemberState(m: GuestMember): GuestMemberState {
  const tz = m.venue.timezone;
  const period = m.plan.period;
  const day = (iso: string | null | undefined): string =>
    memberDayWords(iso ?? null, tz, { year: period === "year" }) ?? "soon";
  switch (m.status) {
    case "pending":
      return {
        label: "Not started",
        tone: "warning",
        title: `Pay your first ${period} to start`,
        line: `Your membership starts as soon as the first ${period} is paid.`,
      };
    case "requested":
      return {
        label: "Requested",
        tone: "neutral",
        title: "Request sent",
        line: `${m.venue.name} will reply${m.requestReplyBy !== null ? ` by ${day(m.requestReplyBy)}` : " before you pay"}.`,
      };
    case "declined":
      return {
        label: "Declined",
        tone: "neutral",
        title: `${m.venue.name} can't take you on this plan right now`,
        line: "No payment was taken.",
      };
    case "active":
      if (m.leaving !== null) {
        return { label: "Active", tone: "neutral", title: `You're leaving on ${day(m.leaving.endsAt)}`, line: "Your pass works as usual until then, and nothing more is owed." };
      }
      if (m.pausing !== null) {
        return { label: "Active", tone: "neutral", title: `Pausing on ${day(m.pausing.from)}`, line: `Your pass works until then. No payment email goes out for the next ${period}.` };
      }
      return { label: "Active", tone: "success", title: "You're a member", line: `Paid until ${day(m.activeUntil)}.` };
    case "payment_due":
    case "grace":
      return {
        label: "Payment due",
        tone: "warning",
        title: `This ${period}'s payment is due`,
        line: `You can still come in until ${day(m.paymentDue?.graceEndsAt)}. Pay to keep your place.`,
      };
    case "lapsed":
      return {
        label: "Paused",
        tone: "error",
        title: `Paused: this ${period} isn't paid`,
        line: "Your pass won't open the door until you pay. Pay and it starts again at once.",
      };
    case "paused":
      return {
        label: "Paused",
        tone: "neutral",
        title: "Your membership is paused",
        line: m.paymentDue !== null ? `Pay for a ${period} and it starts again at once.` : `It starts again when you pay for a new ${period}.`,
      };
    case "cancelled":
      return {
        label: "Left",
        tone: "neutral",
        title: m.endReason === "not_paid" ? "This membership closed" : "Your membership has ended",
        line:
          m.endReason === "not_paid"
            ? `The first ${period} was never paid. You can join again from the venue's page.`
            : m.endReason === "cancelled_by_venue"
              ? `${m.venue.name} ended it on ${day(m.endedAt)}.`
              : `It ended on ${day(m.endedAt)}. Thank you for being a member.`,
      };
    default: {
      const never: never = m.status;
      return { label: "Active", tone: "neutral", title: String(never), line: "" };
    }
  }
}

/** What the pay button says for the member's state. */
export function payLabel(m: GuestMember, totalWords: string | null): string {
  const amount = totalWords !== null ? ` ${totalWords}` : "";
  if (m.status === "pending") return `Pay${amount} and start`;
  if (m.status === "requested" || m.status === "declined") return "No payment due";
  if (m.status === "lapsed" || m.status === "paused") return `Pay${amount} to start again`;
  return `Pay${amount}`;
}

// ---------------------------------------------------------------- money

export interface VenueVat {
  mode: "added" | "included" | "none";
  ratePct: number;
}

// #4490 06-W4 fix 1 (W4-N2): `monthTotal` (VAT worked out in the browser) is
// gone. A plan's base, VAT and total are the server's (`plan.charge`,
// `paymentDue`), the same numbers the payment page charges.

/** "7.5%" */
export function pctWords(pct: number): string {
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/** What a plan gives, as short lines (the Plans pane and the join page). */
export function planGiveLines(p: {
  entryIncluded: boolean;
  roomHours: number;
  guestPasses: number;
  discountBps: number;
  discountKinds: readonly string[];
  inclusions: readonly string[];
  period: "month" | "year";
}): string[] {
  const kindWords: Record<string, string> = {
    entry: "entry",
    group_package: "group packages",
    private_hire: "private hire",
    by_the_hour: "rooms by the hour",
  };
  const out: string[] = [];
  if (p.entryIncluded) out.push("Free entry, any day we're open");
  if (p.roomHours > 0) out.push(`${hoursLeftWords(p.roomHours)} of meeting rooms a ${p.period}`);
  if (p.entryIncluded && p.guestPasses > 0) out.push(`${p.guestPasses} guest ${p.guestPasses === 1 ? "pass" : "passes"} a ${p.period}`);
  if (p.discountBps > 0 && p.discountKinds.length > 0) {
    out.push(`${Math.round(p.discountBps / 100)}% off ${p.discountKinds.map((k) => kindWords[k] ?? k).join(", ")}`);
  }
  for (const l of p.inclusions) if (!out.includes(l)) out.push(l);
  return out;
}

/** The three plain lines on joining: today, each period, and a skipped period. */
export function howYouPayLines(input: { period: "month" | "year"; firstPeriod: string | null; renewalNoticeDays: number; graceDays: number; minMonths: number; noticeDays: number }): { title: string; body: string }[] {
  const period = input.period;
  const leave =
    period === "year"
      ? `You can leave after the first year${input.noticeDays > 0 ? ` with ${input.noticeDays} days' notice` : ""}.`
      : input.minMonths > 1
      ? `You can leave after ${input.minMonths} months${input.noticeDays > 0 ? ` with ${input.noticeDays} days' notice` : ""}.`
      : input.noticeDays > 0
        ? `Leave any time with ${input.noticeDays} days' notice.`
        : "Leave any time.";
  return [
    { title: "Today", body: input.firstPeriod !== null ? `You pay for ${input.firstPeriod}.` : `You pay for your first ${period}.` },
    { title: `Each ${period} after`, body: `We email you a link ${input.renewalNoticeDays} days before. Pay it and the ${period} is yours. Nothing renews by itself.` },
    {
      title: `Skip a ${period}`,
      body: `${input.graceDays > 0 ? `You can still come in for ${input.graceDays} days, then your membership pauses until it's paid.` : "Your membership pauses until it's paid."} ${leave}`,
    },
  ];
}

// ---------------------------------------------------------------- the member's price in a quote

export interface MemberQuoteBlock {
  applied: boolean;
  reason: string | null;
  planName: string | null;
  period: "month" | "year";
  includedMinor: number;
  discountMinor: number;
  roomHoursUsed: number;
  guestPassesUsed: number;
  freeAdmissions: number;
  roomHoursLeftAfter: number | null;
}

export function parseMemberQuote(raw: unknown): MemberQuoteBlock | null {
  const r = obj(raw);
  if (r.member === undefined || r.member === null) return null;
  const m = obj(r.member);
  return {
    applied: m.applied === true,
    reason: strOrNull(m.reason),
    planName: strOrNull(m.planName),
    period: m.period === "year" ? "year" : "month",
    includedMinor: num(m.includedMinor),
    discountMinor: num(m.discountMinor),
    roomHoursUsed: num(m.roomHoursUsed),
    guestPassesUsed: num(m.guestPassesUsed),
    freeAdmissions: num(m.freeAdmissions),
    roomHoursLeftAfter: numOrNull(m.roomHoursLeftAfter),
  };
}

/** "Uses 2 of your 4 hours this month/year." */
export function memberUseLine(b: MemberQuoteBlock, money: (minor: number) => string): string | null {
  if (!b.applied) return b.reason === "nothing_included" ? "Your plan doesn't cover this booking, so it's the usual price." : null;
  const parts: string[] = [];
  if (b.roomHoursUsed > 0) {
    const before = b.roomHoursLeftAfter !== null ? b.roomHoursLeftAfter + b.roomHoursUsed : null;
    parts.push(before !== null ? `Uses ${hoursLeftWords(b.roomHoursUsed)} of your ${hoursLeftWords(before)} this ${b.period}` : `Uses ${hoursLeftWords(b.roomHoursUsed)} of your included hours`);
  }
  if (b.freeAdmissions > 0) parts.push(b.freeAdmissions === 1 ? "Your entry is free" : `${b.freeAdmissions} free entries`);
  if (b.guestPassesUsed > 0) parts.push(`${b.guestPassesUsed} guest ${b.guestPassesUsed === 1 ? "pass" : "passes"} used`);
  if (b.discountMinor > 0) parts.push(`Member price saves ${money(b.discountMinor)}`);
  return parts.length > 0 ? `${parts.join(". ")}.` : null;
}

// ---------------------------------------------------------------- this device

const VENUE_MEMBER_PREFIX = "mingla.visit.member.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const store = (): Storage | null => {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Remember that this device holds a membership at this venue page. */
export function rememberVenueMember(brandSlug: string, venueSlug: string, subscriptionId: string): void {
  if (!UUID.test(subscriptionId)) return;
  try {
    store()?.setItem(`${VENUE_MEMBER_PREFIX}${brandSlug}/${venueSlug}`, subscriptionId.toLowerCase());
  } catch {
    // storage blocked: checkout simply won't offer the member's price
  }
}

export function forgetVenueMember(brandSlug: string, venueSlug: string): void {
  try {
    store()?.removeItem(`${VENUE_MEMBER_PREFIX}${brandSlug}/${venueSlug}`);
  } catch {
    // nothing to forget
  }
}

/** The membership this device holds at a venue (with its token), or null. */
export function readVenueMember(brandSlug: string, venueSlug: string): { subscriptionId: string; token: string } | null {
  try {
    const id = store()?.getItem(`${VENUE_MEMBER_PREFIX}${brandSlug}/${venueSlug}`) ?? null;
    if (id === null || !UUID.test(id)) return null;
    const token = readVenueOfferBookingToken(id);
    return token !== null && isVenueOfferBookingToken(token) ? { subscriptionId: id, token } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- paths

export function planJoinPath(brandSlug: string, venueSlug: string, planId: string): string {
  return `/b/${encodeURIComponent(brandSlug)}/v/${encodeURIComponent(venueSlug)}/book/${planId}?k=plan`;
}

export function memberPagePath(subscriptionId: string): string {
  return `/visit/plan/${subscriptionId}`;
}

// ---------------------------------------------------------------- refusals

const ERRORS: Readonly<Record<string, string>> = {
  membership_token_required: "Open your member page from the link in your membership email.",
  membership_not_found: "We couldn't find this membership. Open it from the link in your membership email.",
  plan_not_found: "This plan isn't on sale any more.",
  plan_full: "This plan is full right now. Ask the venue when a place opens.",
  membership_already_member: "You're already a member on this plan.",
  membership_member_invalid: "Check your name, email and phone number.",
  membership_start_invalid: "Pick a start day from today up to 60 days ahead.",
  membership_invalid: "Something in that wasn't right. Try again.",
  membership_ended: "This membership has ended.",
  membership_already_leaving: "You're already leaving at the end of your paid month.",
  membership_not_leaving: "You're not leaving, so there's nothing to undo.",
  membership_cannot_pause: "Your membership can't be paused right now.",
  membership_not_paused: "Your membership isn't paused.",
  membership_nothing_to_pay: "Nothing is owed right now. You're paid up.",
  offer_payment_already_pending: "A payment for this month is already open. Finish it, or check whether it went through.",
  // #4490 06-W4 fix 1 (W4-N3): another device is paying this month another way right now.
  offer_payment_mode_conflict: "Something changed while we were saving. Try again.",
  offer_payment_already_paid: "This month is already paid.",
  membership_payment_details_rejected: "The payment page didn't accept these details. Check your email address and try again.",
  membership_payment_unavailable: "Online payment isn't available right now. Try again in a few minutes.",
  membership_payment_ambiguous: "We couldn't confirm the payment page opened. Check your email before trying again.",
  offer_bank_not_ready: "This venue can't take payments online yet. Ask them how to pay.",
  offers_not_enabled: "Joining online isn't open yet.",
  member_not_active: "Your membership isn't active, so the member price can't be used. You can book at the usual price.",
  member_wrong_venue: "Your membership is for a different venue.",
  member_credits_used_up: "Your included hours for this month were used meanwhile. Check the price again.",
  rate_limited: "Too many tries. Wait a minute and try again.",
  invalid_request: "Something in that wasn't right. Try again.",
  membership_request_failed: "That didn't go through. Check your connection and try again.",
};

export function memberGuestErrorCopy(code: string | null | undefined, period: "month" | "year" = "month"): string {
  if (code === null || code === undefined) return ERRORS.membership_request_failed as string;
  if (code === "membership_already_leaving") return `You're already leaving at the end of your paid ${period}.`;
  if (code === "offer_payment_already_pending") return `A payment for this ${period} is already open. Finish it, or check whether it went through.`;
  if (code === "offer_payment_already_paid") return `This ${period} is already paid.`;
  if (code === "member_credits_used_up") return `Your included hours for this ${period} were used meanwhile. Check the price again.`;
  return ERRORS[code] ?? (ERRORS.membership_request_failed as string);
}
