/**
 * #4420 (R8 P15, mockup venue-detail__module-reservations-tables-r8) — the
 * Reservations "Tables" view: every table, grouped by zone, with who holds it
 * at one time on the selected day. Pure and read-only: it projects the
 * reservations and tables the module already loaded; no write, no new query.
 */
import type {
  Reservation,
  ReservationStatus,
  VenueTable,
} from "../../types/venueReservation";
import { venueDayKeyForInstant } from "./reservationCalendarModel";
import { groupTablesByZone } from "./venueTableZones";

export type TableSlotState = "free" | "booked" | "pending" | "seated" | "walkin";

export interface TableSlot {
  table: VenueTable;
  state: TableSlotState;
  /** The reservation holding the table at that time, if any. */
  reservation: Reservation | null;
}

export interface TableSlotZone {
  zone: string | null;
  label: string;
  slots: TableSlot[];
  freeCount: number;
}

/** The turn length when the venue has no turn time for the party (minutes). */
export const DEFAULT_TURN_MINUTES = 90;

/** Statuses that hold a table. Completed, no-show, cancelled and waitlisted do not. */
const HOLDING: ReadonlySet<ReservationStatus> = new Set<ReservationStatus>([
  "requested",
  "confirmed",
  "seated",
]);

/**
 * The turn length for a party from the venue's `turnTimes` ({ p2: 75, p4: 90 }):
 * the smallest bucket that fits the party, else the largest bucket, else 90.
 */
export function turnMinutesFor(
  partySize: number,
  turnTimes: Record<string, number> | null | undefined,
): number {
  const buckets = Object.entries(turnTimes ?? {})
    .map(([key, minutes]) => ({ size: Number(key.replace(/^p/, "")), minutes }))
    .filter((b) => Number.isFinite(b.size) && Number.isFinite(b.minutes) && b.minutes > 0)
    .sort((a, b) => a.size - b.size);
  if (buckets.length === 0) return DEFAULT_TURN_MINUTES;
  const fit = buckets.find((b) => b.size >= partySize);
  return (fit ?? buckets[buckets.length - 1]).minutes;
}

/** Minutes since midnight of an instant, in the venue's time zone. */
export function venueMinuteOfDay(instantIso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantIso));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return value("hour") * 60 + value("minute");
}

const stateFor = (reservation: Reservation): TableSlotState => {
  if (reservation.source === "walk_in") return "walkin";
  if (reservation.status === "seated") return "seated";
  if (reservation.status === "requested") return "pending";
  return "booked";
};

/**
 * Who holds each table at `minuteOfDay` on `dayKey` (venue time). A booking
 * holds its table from its start for its party's turn length.
 */
export function tableSlotsAt(input: {
  tables: readonly VenueTable[];
  reservations: readonly Reservation[];
  dayKey: string;
  minuteOfDay: number;
  timeZone: string;
  turnTimes?: Record<string, number> | null;
}): TableSlotZone[] {
  const holders = new Map<string, Reservation>();
  for (const r of input.reservations) {
    if (r.tableId === null || !HOLDING.has(r.status)) continue;
    let dayKey: string;
    try {
      dayKey = venueDayKeyForInstant(r.reservedFor, input.timeZone);
    } catch {
      continue;
    }
    if (dayKey !== input.dayKey) continue;
    const start = venueMinuteOfDay(r.reservedFor, input.timeZone);
    const end = start + turnMinutesFor(r.partySize, input.turnTimes);
    if (input.minuteOfDay < start || input.minuteOfDay >= end) continue;
    // Two holders on one table: the earlier start wins (it is seated first).
    const prior = holders.get(r.tableId);
    if (prior === undefined || prior.reservedFor > r.reservedFor) holders.set(r.tableId, r);
  }
  const active = input.tables.filter((t) => t.isActive);
  return groupTablesByZone(active).map((group) => {
    const slots = group.tables.map((table): TableSlot => {
      const reservation = holders.get(table.id) ?? null;
      return { table, reservation, state: reservation === null ? "free" : stateFor(reservation) };
    });
    return {
      zone: group.zone,
      label: group.label,
      slots,
      freeCount: slots.filter((s) => s.state === "free").length,
    };
  });
}

/** Steps a minute-of-day by `delta`, kept inside one day. */
export function stepMinuteOfDay(minuteOfDay: number, delta: number): number {
  return Math.min(23 * 60 + 30, Math.max(0, minuteOfDay + delta));
}

/** "7:00 PM" for a minute-of-day (the locale's own clock). */
export function formatMinuteOfDay(minuteOfDay: number): string {
  const date = new Date(Date.UTC(2000, 0, 1, Math.floor(minuteOfDay / 60), minuteOfDay % 60));
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** The opening time for the view: now (rounded down to 30) today, else 7:00 PM. */
export function defaultMinuteOfDay(isToday: boolean, nowMinute: number): number {
  return isToday ? Math.floor(nowMinute / 30) * 30 : 19 * 60;
}
