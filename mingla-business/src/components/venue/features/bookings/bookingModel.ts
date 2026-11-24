/**
 * #4490 P3-2 — one booking with its money, in plain words (pure; no React,
 * no services). Shared by the booking sheet, Today and Check-in so the same
 * booking reads the same everywhere. Money is minor units; the server works
 * out every total — this only formats it.
 */
import type {
  BookingChangeRow,
  BookingChangeSummary,
  DamageDepositState,
  HireTerms,
  OfflineMethod,
  VenueBookingDetail,
} from "../../../../types/venueOffers";
import { dayDateLabel } from "../../../ui/fieldModels";
import { money } from "../offers/offerMoney";

/** "Sat 28 Nov": bookings are close in time, so the year is left out. */
export function shortDay(iso: string): string {
  return dayDateLabel(iso).replace(/ \d{4}$/, "");
}

export const OFFLINE_METHODS: ReadonlyArray<{ key: OfflineMethod; label: string }> = [
  { key: "cash", label: "Cash" },
  { key: "transfer", label: "Transfer" },
  { key: "card_at_venue", label: "Card here" },
  { key: "other", label: "Other" },
];

export function methodLabel(method: string): string {
  switch (method) {
    case "cash":
      return "cash";
    case "transfer":
      return "bank transfer";
    case "card_at_venue":
      return "card at the venue";
    // #4490 08-O4 fix 1 (O4-T3): the part of a Till bill the table deposit paid.
    case "table_deposit":
      return "the table deposit on the bill";
    default:
      return "another way";
  }
}

/** "16:00" in the venue's own timezone. */
export function clockIn(iso: string | null, timezone: string): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  } catch {
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
}

/** The venue's calendar date of an instant ("2026-11-26"). */
export function dateIn(iso: string | null, timezone: string): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : d.toISOString().slice(0, 10);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** "Sat 28 Nov · 16:00 to 19:00". */
export function whenLine(b: Pick<VenueBookingDetail, "window" | "timezone">): string {
  if (b.window === null) return "No date";
  const start = clockIn(b.window.startsAt, b.timezone);
  const end = clockIn(b.window.endsAt, b.timezone);
  const day = shortDay(b.window.localDate);
  return start !== null && end !== null ? `${day} · ${start} to ${end}` : day;
}

export const BOOKING_STATE_WORDS: Readonly<Record<string, { label: string; variant: "ok" | "warn" | "info" | "muted" | "error" }>> = {
  confirmed: { label: "Confirmed", variant: "ok" },
  instant_payment_pending: { label: "Not paid yet", variant: "warn" },
  finalizing: { label: "Confirming payment", variant: "info" },
  reconciliation_required: { label: "Checking payment", variant: "warn" },
  partially_cancelled: { label: "Part cancelled", variant: "warn" },
  cancelled: { label: "Cancelled", variant: "error" },
  request_pending: { label: "To answer", variant: "info" },
  approved_payment_required: { label: "Waiting for deposit", variant: "warn" },
  // #4490 P4 — closed requests.
  declined: { label: "Declined", variant: "muted" },
  request_expired: { label: "Closed", variant: "muted" },
};

export function bookingStateWords(state: string): { label: string; variant: "ok" | "warn" | "info" | "muted" | "error" } {
  return BOOKING_STATE_WORDS[state] ?? { label: "Updating", variant: "muted" };
}

export function isOverdue(b: Pick<VenueBookingDetail, "balanceDueMinor" | "balanceDueAt">, now: number): boolean {
  if (b.balanceDueMinor <= 0 || b.balanceDueAt === null) return false;
  const due = Date.parse(b.balanceDueAt);
  return !Number.isNaN(due) && due < now;
}

/** "Due Thu 26 Nov" / "Overdue since Thu 26 Nov" / null when paid up. */
export function balanceDueLine(b: Pick<VenueBookingDetail, "balanceDueMinor" | "balanceDueAt" | "timezone" | "currencyCode">, now: number): string | null {
  if (b.balanceDueMinor <= 0) return null;
  const date = dateIn(b.balanceDueAt, b.timezone);
  const amount = money(b.balanceDueMinor, b.currencyCode);
  if (date === null) return `${amount} still to pay`;
  return isOverdue(b, now) ? `${amount} overdue since ${shortDay(date)}` : `${amount} due by ${shortDay(date)}`;
}

export interface MoneyRow {
  key: string;
  label: string;
  value: string;
  total?: boolean;
  muted?: boolean;
}

export function moneyRows(b: VenueBookingDetail): MoneyRow[] {
  const m = (minor: number): string => money(minor, b.currencyCode);
  const rows: MoneyRow[] = [{ key: "total", label: "Total", value: m(b.totalDueMinor) }];
  if (b.changes.some((c) => c.amountMinor !== 0)) {
    rows.push({ key: "booked", label: "Booked at", value: m(b.totalMinor), muted: true });
  }
  rows.push({ key: "online", label: "Paid online", value: m(b.paidOnlineMinor) });
  if (b.paidAtVenueMinor > 0) rows.push({ key: "venue", label: "Paid at the venue", value: m(b.paidAtVenueMinor) });
  if (b.refundedMinor > 0) rows.push({ key: "refunded", label: "Refunded", value: m(b.refundedMinor), muted: true });
  rows.push({ key: "balance", label: "Still to pay", value: m(Math.max(0, b.balanceDueMinor)), total: true });
  // #4490 P4 — a hire's refundable damage deposit sits inside the total.
  if (b.hire !== null && b.hire.damageDepositMinor > 0) {
    rows.push({ key: "damage", label: "Includes damage deposit (refundable)", value: m(b.hire.damageDepositMinor), muted: true });
  }
  return rows;
}

const HISTORY_WORDS: Readonly<Record<string, string>> = {
  stay_offer_hold_created: "Booked, waiting for payment",
  stay_payment_prepared: "Payment page opened",
  stay_reservation_confirmed: "Confirmed",
  stay_offer_balance_paid: "Balance paid online",
  stay_offer_changed: "Booking changed",
  stay_offer_paid_at_venue: "Money taken at the venue",
  stay_reservation_cancelled: "Cancelled",
  stay_offer_balance_due: "Payment reminder sent",
  stay_offer_balance_overdue: "Overdue notice sent",
  stay_refund_submitted: "Refund sent",
  stay_refund_succeeded: "Refund completed",
  stay_hold_expired: "Hold ran out",
  stay_offer_checked_in: "Checked in",
  stay_offer_deposit_released: "Damage deposit settled",
  stay_offer_deposit_held: "Damage deposit held",
};

export function historyTitle(type: string, by: string | null): string {
  const base = HISTORY_WORDS[type] ?? type.replace(/^stay_(offer_)?/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  if (by === "staff") return `${base} (by the venue)`;
  if (by === "guest" && type === "stay_offer_changed") return `${base} (by the guest)`;
  return base;
}

export function changeWords(c: BookingChangeRow, currency: string): string {
  const amount = c.amountMinor > 0 ? `, ${money(c.amountMinor, currency)} more` : c.refundMinor > 0 ? `, ${money(c.refundMinor, currency)} back` : "";
  if (c.kind === "change_guests" && c.fromGuests !== null && c.toGuests !== null) return `Guests ${c.fromGuests} → ${c.toGuests}${amount}`;
  if (c.kind === "move_date" && c.toDate !== null) {
    return `Moved${c.fromDate !== null ? ` from ${shortDay(c.fromDate)}` : ""} to ${shortDay(c.toDate)}${c.feeMinor > 0 ? `, ${money(c.feeMinor, currency)} fee` : amount}`;
  }
  if (c.kind === "add_extras") return `Added ${c.extras.map((e) => (e.qty > 1 ? `${e.qty} × ${e.name}` : e.name)).join(", ")}${amount}`;
  return `Changed${amount}`;
}

/** What a change does to the money, before the host confirms it. */
export function changePreviewWords(s: BookingChangeSummary): { title: string; body: string } {
  const m = (minor: number): string => money(minor, s.currencyCode);
  let title = "No change in price";
  if (s.amountMinor > 0) {
    const vat = s.taxDeltaMinor > 0 ? ` (${m(s.amountMinor - s.taxDeltaMinor)} + VAT ${m(s.taxDeltaMinor)})` : "";
    title = `${m(s.amountMinor)} more${vat}`;
  } else if (s.refundMinor > 0) {
    title = `${m(s.refundMinor)} back to the guest`;
  } else if (s.amountMinor < 0) {
    title = `${m(-s.amountMinor)} less`;
  }
  const parts: string[] = [];
  if (s.feeMinor > 0) parts.push(`Includes a ${m(s.feeMinor)} change fee.`);
  if (s.refundMinor > 0) parts.push(`${m(s.refundMinor)} goes back to the card or account they paid with.`);
  parts.push(`New total ${m(s.totalDueAfterMinor)}. Still to pay after this: ${m(Math.max(0, s.balanceAfterMinor))}.`);
  return { title, body: parts.join(" ") };
}

/** Plain words for the staff cancel preview. */
export function staffCancelWords(input: { paidMinor: number; refundMinor: number; keepMinor: number; paidAtVenueMinor: number; currency: string }): string {
  const m = (minor: number): string => money(minor, input.currency);
  const atVenue =
    input.paidAtVenueMinor > 0
      ? ` The ${m(input.paidAtVenueMinor)} taken at the venue isn't refunded here: give it back yourself if you agree to.`
      : "";
  if (input.paidMinor <= 0) return `Nothing was paid online, so nothing is refunded online. Their places are freed.${atVenue}`;
  if (input.refundMinor >= input.paidMinor) return `They paid ${m(input.paidMinor)} online and get all of it back.${atVenue}`;
  if (input.refundMinor <= 0) return `They paid ${m(input.paidMinor)} online. Under the terms nothing comes back.${atVenue}`;
  return `They paid ${m(input.paidMinor)} online. They get ${m(input.refundMinor)} back; ${m(input.keepMinor)} stays with the venue.${atVenue}`;
}

// ------------------------------------------------- #4490 P4 follow-ups (hire)

/**
 * The guest numbers a hire can change to: from its price row's smallest
 * group up to the row's largest (or the place's capacity when the venue
 * sells extra guests), as the server allows. Null when the row is unknown.
 */
export function hireGuestRangeFor(hire: Pick<HireTerms, "rows" | "extraGuestMinor"> | null, priceOptionId: string | null): { min: number; max: number } | null {
  if (hire === null || priceOptionId === null) return null;
  const row = hire.rows.find((r) => r.optionId === priceOptionId);
  if (row === undefined) return null;
  const max = hire.extraGuestMinor !== null && row.capacity > 0 ? Math.max(row.guestMax, row.capacity) : row.guestMax;
  return { min: row.guestMin, max };
}

/** The damage deposit in one pill and one line, and whether the hire has ended (return allowed). */
export function damageDepositWords(
  d: DamageDepositState,
  currency: string,
  timezone: string,
  now: number,
): { pill: string; variant: "ok" | "warn" | "info" | "muted" | "error"; body: string; ended: boolean } {
  const ended = d.hireEndsAt !== null && Date.parse(d.hireEndsAt) <= now;
  const day = (iso: string | null): string => (iso === null ? "" : shortDay(dateIn(iso, timezone) ?? iso.slice(0, 10)));
  switch (d.status) {
    case "due":
      return { pill: "Not paid yet", variant: "muted", body: `${money(d.amountMinor, currency)}, paid with the rest of the booking.`, ended };
    case "collected":
      return {
        pill: "Held",
        variant: "info",
        body:
          d.releaseAt !== null
            ? `${money(d.paidMinor, currency)} held. It goes back to the guest by itself on ${day(d.releaseAt)} unless you return it sooner or hold it.`
            : `${money(d.paidMinor, currency)} held.`,
        ended,
      };
    case "held_by_venue":
      return {
        pill: "Held by you",
        variant: "warn",
        body: `${money(d.paidMinor, currency)} held${d.heldReason !== null ? `: ${d.heldReason}` : ""}. It won't go back by itself.`,
        ended,
      };
    case "released": {
      const back = d.refundedMinor ?? 0;
      const kept = d.keptMinor ?? 0;
      const when = d.releasedAt !== null ? ` on ${day(d.releasedAt)}` : "";
      return {
        pill: kept > 0 ? "Partly returned" : "Returned",
        variant: kept > 0 ? "warn" : "ok",
        body:
          kept > 0
            ? `${money(back, currency)} returned${when}. Kept ${money(kept, currency)}${d.keptReason !== null ? `: ${d.keptReason}` : ""}.`
            : `${money(back, currency)} returned${when}.`,
        ended,
      };
    }
    default:
      return { pill: "None", variant: "muted", body: "", ended };
  }
}
