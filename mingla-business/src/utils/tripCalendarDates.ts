/**
 * #4420 — a trip's dates are CALENDAR DATES stored as UTC midnight
 * ("2027-01-15 00:00:00+00"); a trip has no timezone of its own. Formatting the
 * instant in the viewer's timezone pulls it back a day west of UTC, which is
 * how the trip checkout said "Jan 14" while the public trip page
 * (@mingla/offering-rendering formatTripDateRange, META-ORCH-1174 Leg A.4)
 * said "Jan 15". Every short trip date line reads the stored Y-M-D at UTC.
 */
import { normalizeTimestampIso } from "@mingla/offering-rendering";

const SHORT_DAY: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
};

/** "Jan 15", or null when the value is missing or unparseable. */
export function formatTripCalendarDay(
  raw: string | null | undefined,
  locale?: string,
): string | null {
  const iso = normalizeTimestampIso(raw ?? null);
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, SHORT_DAY).format(date);
}

/** "Jan 15 – Jan 18" (one day when both match), "" when there is no start. */
export function formatTripCalendarRange(
  startRaw: string | null | undefined,
  endRaw: string | null | undefined,
  locale?: string,
): string {
  const start = formatTripCalendarDay(startRaw, locale);
  if (start === null) return "";
  const end = formatTripCalendarDay(endRaw, locale);
  if (end === null || end === start) return start;
  return `${start} – ${end}`;
}
