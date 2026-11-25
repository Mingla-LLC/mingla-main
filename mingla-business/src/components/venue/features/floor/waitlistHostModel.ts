/**
 * #4490 P5-2 — what a guest who joined the waitlist online asked for, in words
 * ("Fri 21 Nov · 19:00–21:00", "Tonight"). Pure, unit-tested.
 */
import type { WaitlistEntry } from "../../../../types/venueReservation";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function waitlistDayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return `${WEEKDAY[at.getUTCDay()]} ${at.getUTCDate()} ${MONTH[at.getUTCMonth()]}`;
}

export function waitlistWantsLine(
  w: Pick<WaitlistEntry, "desiredDate" | "desiredFrom" | "desiredTo">,
  today: string = new Date().toISOString().slice(0, 10),
): string | null {
  if (w.desiredDate == null) return null;
  const day = waitlistDayLabel(w.desiredDate, today);
  if (w.desiredFrom != null && w.desiredTo != null) {
    return `Wants ${day} · ${w.desiredFrom.slice(0, 5)}–${w.desiredTo.slice(0, 5)}`;
  }
  return `Wants ${day} · any time`;
}
