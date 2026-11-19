/**
 * #4490 P4-2 — Requests (`rq`, `rq-quote`, `rq-approve`, `rq-wait`,
 * `rq-declined`, `rq-expired`, `rq-empty`) in plain words (pure; no React,
 * no services). Tabs map to booking states the way the server sorts them
 * (`issue_4490_requests_list`). Money is minor units; the server works out
 * every total — the quote preview only restates the server's own numbers
 * with the host's new price in place of the old one.
 */
import type {
  RequestCounts,
  RequestTab,
  VatMode,
  VenueRequest,
} from "../../../../types/venueOffers";
import { clockIn, dateIn, shortDay } from "../bookings/bookingModel";
import { money } from "../offers/offersModel";

export const REQUEST_TABS: ReadonlyArray<{ key: RequestTab; label: string }> = [
  { key: "to_answer", label: "To answer" },
  { key: "waiting_for_deposit", label: "Waiting for deposit" },
  { key: "confirmed", label: "Confirmed" },
  { key: "closed", label: "Closed" },
];

/** Which tab a booking state sits in (mirror of the server's mapping). */
export function tabForState(state: string): RequestTab {
  switch (state) {
    case "request_pending":
      return "to_answer";
    case "approved_payment_required":
    case "finalizing":
    case "instant_payment_pending":
      return "waiting_for_deposit";
    case "confirmed":
    case "partially_cancelled":
      return "confirmed";
    default:
      return "closed";
  }
}

export function countFor(tab: RequestTab, counts: RequestCounts | null): number {
  if (counts === null) return 0;
  switch (tab) {
    case "to_answer":
      return counts.toAnswer;
    case "waiting_for_deposit":
      return counts.waitingForDeposit;
    case "confirmed":
      return counts.confirmed;
    case "closed":
      return counts.closed;
    default: {
      const never: never = tab;
      return never;
    }
  }
}

/** "5 hours ago", "2 days ago", "just now". */
export function agoWords(iso: string | null, now: number): string | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** "19h", "2d", "45m": what's left until an instant (never negative). */
export function leftWords(iso: string | null, now: number): string | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const minutes = Math.round((at - now) / 60_000);
  if (minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** "Thu 20 Nov, 18:00" in the venue's timezone. */
export function momentWords(iso: string | null, timezone: string): string | null {
  const day = dateIn(iso, timezone);
  const clock = clockIn(iso, timezone);
  if (day === null) return null;
  return clock === null ? shortDay(day) : `${shortDay(day)}, ${clock}`;
}

/** "Sat 13 Dec · Full day" or "Sat 13 Dec · 12:00 to 00:00". */
export function requestDateLine(r: Pick<VenueRequest, "localDate" | "sessionLabel" | "startsAt" | "endsAt">, timezone: string): string {
  const day = r.localDate.length > 0 ? shortDay(r.localDate) : "No date";
  // #4490 P4 follow-up: "Hours you set" reads as the hours booked.
  if (r.sessionLabel !== null && r.sessionLabel !== "Hours you set") return `${day} · ${r.sessionLabel}`;
  const start = clockIn(r.startsAt, timezone);
  const end = clockIn(r.endsAt, timezone);
  return start !== null && end !== null ? `${day} · ${start} to ${end}` : day;
}

export type PillTone = "ok" | "warn" | "info" | "muted" | "error";

/** The one status pill on a request row. */
export function requestPill(r: VenueRequest, now: number): { label: string; variant: PillTone } {
  switch (r.state) {
    case "request_pending": {
      if (r.queue !== null && r.queue.releasedAt === null && !r.nextInLine) return { label: "Next in line", variant: "info" };
      if (r.nextInLine) return { label: "Free again", variant: "ok" };
      const left = leftWords(r.replyBy, now);
      return left === null ? { label: "Reply now", variant: "error" } : { label: `Reply in ${left}`, variant: "warn" };
    }
    case "approved_payment_required": {
      const left = leftWords(r.holdUntil, now);
      return left === null ? { label: "Hold ending", variant: "error" } : { label: `${left} left to pay`, variant: "warn" };
    }
    case "instant_payment_pending":
      return { label: "Paying now", variant: "info" };
    case "finalizing":
      return { label: "Confirming payment", variant: "info" };
    case "confirmed":
      return r.balanceMinor > 0 ? { label: "Balance due", variant: "warn" } : { label: "Paid", variant: "ok" };
    case "partially_cancelled":
      return { label: "Part cancelled", variant: "warn" };
    default:
      return { label: closedLabel(r.closedReason, r.state), variant: r.closedReason === "needs_checking" ? "warn" : "muted" };
  }
}

export function closedLabel(reason: VenueRequest["closedReason"], state: string): string {
  switch (reason) {
    case "declined":
      return "Declined";
    case "expired":
      return "Timed out";
    case "not_paid":
      return "Not paid in time";
    case "released":
      return "Hold released";
    case "withdrawn":
      return "Withdrawn";
    case "cancelled":
      return "Cancelled";
    case "needs_checking":
      return "Needs checking";
    default:
      return state === "declined" ? "Declined" : state === "cancelled" ? "Cancelled" : "Closed";
  }
}

/** The banner on a closed request: what happened and what the guest was told. */
export function closedWords(
  r: Pick<VenueRequest, "closedReason" | "state" | "guestName" | "declineReason">,
  replyHours: number,
): { title: string; body: string } {
  const first = r.guestName.split(" ")[0] ?? r.guestName;
  switch (r.closedReason) {
    case "declined":
      return {
        title: "You declined",
        body: `${first} was told${r.declineReason !== null ? `: “${r.declineReason}”` : ""}. Nothing was charged.`,
      };
    case "expired":
      return {
        title: `Nobody replied within ${replyHours} hours`,
        body: `${first} was told and can ask again. Nothing was charged.`,
      };
    case "not_paid":
      return { title: "The deposit wasn't paid in time", body: `The hold ran out and the space is free again. ${first} was told.` };
    case "released":
      return { title: "You released the hold", body: `The space is free again. ${first} was told. Nothing was charged.` };
    case "withdrawn":
      return { title: `${first} withdrew the request`, body: "Nothing was charged and nothing is held." };
    case "cancelled":
      return { title: "Cancelled", body: "The booking was cancelled. Any refund follows the terms saved on it." };
    case "needs_checking":
      return {
        title: "Needs checking",
        body: "A payment arrived after the hold ran out. Mingla is checking it; the money goes back if the date can't be kept.",
      };
    default:
      return { title: closedLabel(r.closedReason, r.state), body: "This request is closed." };
  }
}

/** What the space is doing that day, for a request still to answer. */
export function placeStatusWords(status: VenueRequest["placeStatus"]): { label: string; tone: "ok" | "warn" | "error" } | null {
  switch (status) {
    case "free":
      return { label: "Free that day", tone: "ok" };
    case "held":
      return { label: "On hold for someone else", tone: "warn" };
    case "taken":
      return { label: "Already booked", tone: "error" };
    default:
      return null;
  }
}

/** "On hold until Thu 20 Nov, 18:00". */
export function holdWords(holdUntil: string | null, timezone: string): string | null {
  const at = momentWords(holdUntil, timezone);
  return at === null ? null : `On hold until ${at}`;
}

export interface QuotePreview {
  totalMinor: number;
  vatMinor: number;
  depositMinor: number | null;
}

/**
 * The quote with a new hire price: the server's total with the old price
 * swapped for the new one (VAT moves with it when VAT is added on top).
 */
export function quotePreview(input: {
  totalDueMinor: number;
  hireMinor: number;
  newHireMinor: number;
  taxMinor: number;
  vatMode: VatMode | null;
  vatRateBps: number | null;
  damageDepositMinor: number;
  deposit: { kind: "none" | "percent" | "fixed"; value: number | null } | null;
}): QuotePreview {
  const added = input.vatMode === "added" && input.vatRateBps !== null && input.vatRateBps > 0;
  const rate = added ? (input.vatRateBps as number) / 10000 : 0;
  const delta = input.newHireMinor - input.hireMinor;
  const vatDelta = Math.round(input.newHireMinor * rate) - Math.round(input.hireMinor * rate);
  const totalMinor = Math.max(0, input.totalDueMinor + delta + vatDelta);
  const vatMinor = Math.max(0, input.taxMinor + vatDelta);
  let depositMinor: number | null = null;
  if (input.deposit !== null && input.deposit.kind === "percent" && input.deposit.value !== null) {
    depositMinor = Math.round(((totalMinor - input.damageDepositMinor) * input.deposit.value) / 10000);
  } else if (input.deposit !== null && input.deposit.kind === "fixed" && input.deposit.value !== null) {
    depositMinor = Math.min(input.deposit.value, totalMinor);
  }
  return { totalMinor, vatMinor, depositMinor };
}

/** "Send Chiamaka a quote for ₦7,632,500?" / "The Lounge Side is held … She pays ₦3,816,250 to lock Sat 13 Dec." */
export function approveWords(input: {
  guestName: string;
  placeName: string | null;
  localDate: string;
  totalMinor: number;
  depositMinor: number | null;
  currency: string;
  payWithinMinutes: number;
}): { title: string; body: string } {
  const first = input.guestName.split(" ")[0] ?? input.guestName;
  const hours = Math.round(input.payWithinMinutes / 60);
  const pay = input.depositMinor !== null && input.depositMinor < input.totalMinor ? money(input.depositMinor, input.currency) : money(input.totalMinor, input.currency);
  return {
    title: `Send ${first} a quote for ${money(input.totalMinor, input.currency)}?`,
    body: `${input.placeName ?? "The space"} is held for ${first} for ${hours} hours. ${first} pays ${pay} to lock ${input.localDate.length > 0 ? shortDay(input.localDate) : "the date"}. If ${first} doesn't, the hold ends by itself.`,
  };
}

/** The conflict dialog ("<Space> is on hold that day"), never a raw code. */
export function conflictWords(input: {
  code: string;
  placeName: string | null;
  localDate: string;
  guestName: string;
  blocker: { guestName: string | null; holdUntil: string | null } | null;
  capacity: { sold: number; limitAfterHire: number } | null;
  timezone: string;
}): { title: string; body: string } {
  const first = input.guestName.split(" ")[0] ?? input.guestName;
  const day = input.localDate.length > 0 ? shortDay(input.localDate) : "that day";
  if (input.code === "offer_capacity_conflict" && input.capacity !== null) {
    return {
      title: `${day} already has entry sold`,
      body: `${input.capacity.sold.toLocaleString("en-GB")} already have entry that day; the hire would leave room for ${input.capacity.limitAfterHire.toLocaleString("en-GB")}. Offer ${first} another date.`,
    };
  }
  const until = input.blocker !== null ? momentWords(input.blocker.holdUntil, input.timezone) : null;
  const who = input.blocker?.guestName ?? null;
  return {
    title: `${input.placeName ?? "The space"} is on hold that day`,
    body: `${who !== null ? `${who} has it for ${day}${until !== null ? ` until ${until}` : ""}. ` : ""}Approving ${first} for the same day would book it twice.`,
  };
}

/** Plain words for every staff refusal from `venue-offer-staff`. */
export function staffErrorCopy(code: string): string {
  switch (code) {
    case "offer_space_taken":
      return "That space is already held or booked at that time.";
    case "offer_capacity_conflict":
      return "Too much entry is already sold that day for this hire.";
    case "offer_queue_not_needed":
      return "The space is free now, so you can approve this request.";
    case "offer_hold_expired":
      return "The hold already ran out. We've loaded the latest.";
    case "offer_hold_not_extendable":
      return "The hire starts before that, so the hold can't run any longer.";
    case "offer_invalid_transition":
      return "This request already changed. We've loaded the latest.";
    case "offer_window_unavailable":
      return "That session has already started, so it can't be booked any more.";
    case "offer_payment_already_pending":
      return "The guest is paying right now, so the hold can't be released. Check again in a few minutes.";
    case "quote_edit_invalid":
      return "Check the new price.";
    case "decline_reason_required":
      return "Say why, in a few words (the guest sees it).";
    case "extend_hours_invalid":
      return "Pick 12, 24 or 48 more hours.";
    case "block_spaces_invalid":
      return "Pick the space to block.";
    case "block_range_invalid":
      return "A block must end after it starts, and last 31 days at most.";
    case "block_not_found":
      return "That block was already removed.";
    case "stale_write":
      return "Someone else changed this first. We've loaded the latest.";
    case "not_authorized":
      return "You don't have permission to answer requests at this venue. Ask a brand owner or admin.";
    case "offer_booking_not_found":
      return "This request was removed or isn't at this venue.";
    case "offer_idempotency_conflict":
    case "invalid_request":
      return "That didn't go through. Try again.";
    case "offers_not_enabled":
      return "Selling offers isn't switched on for your brand yet.";
    case "auth_required":
      return "Your sign-in ran out. Sign in again and try once more.";
    case "network":
      return "You're offline or the connection dropped. Try again.";
    default:
      return "That didn't go through. Try again in a moment.";
  }
}

/** The empty state of a tab. */
export function emptyWords(tab: RequestTab, replyHours: number): { title: string; body: string } {
  switch (tab) {
    case "to_answer":
      return { title: "Nothing to answer", body: `Private hire and group requests land here. You have ${replyHours} hours to reply to each.` };
    case "waiting_for_deposit":
      return { title: "Nobody owes a deposit", body: "When you approve a request, it waits here until the guest pays." };
    case "confirmed":
      return { title: "No confirmed bookings yet", body: "Paid requests show here, with any balance still to pay." };
    case "closed":
      return { title: "Nothing closed", body: "Declined, timed-out, withdrawn and cancelled requests show here." };
    default: {
      const never: never = tab;
      return never;
    }
  }
}
