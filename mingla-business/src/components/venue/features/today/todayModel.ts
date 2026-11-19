/**
 * #4490 P2-5 — the venue's day in plain words (pure): Today, the Overview
 * tiles, Check-in and the Hub card all read `issue_4490_venue_day` through
 * these helpers so their numbers agree.
 */
import type { VenueDay, VenueDayBooking } from "../../../../types/venueOffers";
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
  takenMinor: number;
  takenAtGateMinor: number;
  currencyCode: string | null;
}

const PAID_STATES = new Set(["confirmed", "partially_cancelled"]);

export function dayNumbers(day: VenueDay): DayNumbers {
  const pool = day.pools[0] ?? null;
  const paid = day.bookings.filter((b) => PAID_STATES.has(b.state));
  const gate = paid.filter((b) => b.paymentCollection === "property");
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
    takenMinor: paid.reduce((s, b) => s + b.totalMinor, 0),
    takenAtGateMinor: gate.reduce((s, b) => s + b.totalMinor, 0),
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
  if (b.source === "gate" || b.source === "gate_sale") return "Gate sale";
  return "Bought online";
}
