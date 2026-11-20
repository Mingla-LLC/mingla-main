/**
 * #4490 P2-5 — the venue's day in plain words (pure): Today, the Overview
 * tiles, Check-in and the Hub card all read `issue_4490_venue_day` through
 * these helpers so their numbers agree.
 */
import type { VenueDay, VenueDayBooking, VenueDayMoneyParts } from "../../../../types/venueOffers";
import { dayDateLabel } from "../../../ui/fieldModels";

export interface DayNumbers {
  /** Guests checked in today (passes). */
  inNow: number;
  /** Guests on today's valid passes not yet in. */
  toArrive: number;
  /** Today's day limit (first pool), or null without one. */
  dailyLimit: number | null;
  keptForWalkIns: number | null;
  walkInLeft: number | null;
  onlineLeft: number | null;
  soldToday: number;
  soldAtGate: number;
  /** Bookings waiting on payment (held online). */
  waiting: number;
  currencyCode: string | null;
}

export function dayNumbers(day: VenueDay): DayNumbers {
  const pool = day.pools[0] ?? null;
  return {
    inNow: day.checkIn.admitted,
    toArrive: Math.max(0, day.checkIn.expected - day.checkIn.admitted),
    dailyLimit: pool?.dailyLimit ?? null,
    keptForWalkIns: pool?.keptForWalkIns ?? null,
    walkInLeft: pool?.walkInLeft ?? null,
    onlineLeft: pool?.onlineLeft ?? null,
    soldToday: day.offers.reduce((s, o) => s + o.sold, 0),
    soldAtGate: pool?.soldAtGate ?? 0,
    waiting: day.bookings.filter((b) => b.state === "instant_payment_pending").length,
    currencyCode: day.bookings.find((b) => b.currencyCode !== null)?.currencyCode ?? null,
  };
}

/** "Thu 19 Nov · 12 of 400 in" / "Thu 19 Nov · closed today". */
export function dayHeadline(day: VenueDay): string {
  const date = day.localDate.length > 0 ? dayDateLabel(day.localDate) : "Today";
  if (day.closed) return `${date} · closed today`;
  const n = dayNumbers(day);
  if (n.dailyLimit !== null) return `${date} · ${n.inNow} of ${n.dailyLimit.toLocaleString("en-GB")} in`;
  return `${date} · ${n.inNow} in`;
}

export function bookingStateLabel(b: VenueDayBooking): { label: string; variant: "ok" | "warn" | "info" | "muted" | "error" } {
  if (b.state === "cancelled") return { label: "Cancelled", variant: "error" };
  if (b.state === "instant_payment_pending") return { label: "Not paid yet", variant: "warn" };
  if (b.state === "reconciliation_required") return { label: "Checking payment", variant: "warn" };
  if (b.guests > 0 && b.admittedCount >= b.guests) return { label: "In", variant: "ok" };
  if (b.admittedCount > 0) return { label: `${b.admittedCount} of ${b.guests} in`, variant: "info" };
  return { label: "To arrive", variant: "muted" };
}

export function bookingSourceLabel(b: VenueDayBooking): string {
  if (b.paymentCollection === "property") return "Paid at the gate";
  // #4490 07-E: a gate sale is booking_source 'walk_in' (pay-by-code included);
  // a cancelled one used to read "Bought online".
  if (b.source === "walk_in" || b.source === "gate" || b.source === "gate_sale") {
    return b.state === "cancelled" ? "Gate sale · cancelled" : "Gate sale";
  }
  return "Bought online";
}

// ---------------------------------------------------------------------------
// #4490 07-E — Today's money: two honest numbers, both the server's.
// ---------------------------------------------------------------------------

export type TodayMoneyTile = "paidIn" | "forToday";

/** Tile titles and subs; other days read "that day". */
export function todayMoneyCopy(tile: TodayMoneyTile, isToday: boolean): { label: string; sub: string } {
  if (tile === "paidIn") {
    return isToday
      ? { label: "Paid in today", sub: "Money received today, for any date" }
      : { label: "Paid in that day", sub: "Money received that day, for any date" };
  }
  return isToday
    ? { label: "For today's bookings", sub: "Paid so far for bookings dated today" }
    : { label: "For that day's bookings", sub: "Paid so far for bookings dated that day" };
}

/** The detail sheet's lines, in the approved order; refunds read as minus. */
export function todayMoneyRows(
  parts: VenueDayMoneyParts,
  tile: TodayMoneyTile = "paidIn",
): Array<{ key: keyof VenueDayMoneyParts; label: string; minor: number; negative: boolean }> {
  const rows: Array<{ key: keyof VenueDayMoneyParts; label: string; minor: number; negative: boolean }> = [
    { key: "online", label: "Online", minor: parts.online, negative: false },
    { key: "atVenue", label: "At the venue", minor: parts.atVenue, negative: false },
    { key: "members", label: "Members", minor: parts.members, negative: false },
    { key: "tableDeposits", label: "Table deposits", minor: parts.tableDeposits, negative: false },
    { key: "refunded", label: "Refunded", minor: parts.refunded, negative: true },
  ];
  // N137: memberships are never part of a booking dated that day.
  return tile === "forToday" ? rows.filter((r) => r.key !== "members") : rows;
}

// #4490 P3 — balances still to collect on a day (group package deposits).
export function dayBalances(day: VenueDay, now: number = Date.now()): { count: number; owedMinor: number; overdue: number } {
  const owing = day.bookings.filter((b) => b.state === "confirmed" && (b.balanceDueMinor ?? 0) > 0);
  return {
    count: owing.length,
    owedMinor: owing.reduce((s, b) => s + (b.balanceDueMinor ?? 0), 0),
    overdue: owing.filter((b) => b.balanceDueAt != null && Date.parse(b.balanceDueAt) < now).length,
  };
}

/** The calendar day `delta` days from `date` ("YYYY-MM-DD"). */
export function shiftDay(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
