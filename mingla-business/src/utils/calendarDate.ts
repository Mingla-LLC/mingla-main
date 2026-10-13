/**
 * Issue #3801 — ONE owner for reading and writing CALENDAR DATES.
 *
 * A trip's start and end, and a payment plan's `fixed_date`, are calendar
 * days, not moments: "the trip starts on 12 November" is true in every
 * timezone. They are stored pinned to UTC (`2026-11-12T00:00:00.000Z`, an end
 * at `…T23:59:59.000Z`, or the bare `2026-10-29`).
 *
 * Reading such a value with the device's local clock moves it: a browser in
 * New York showed 11 November, and one east of UTC showed an end date a day
 * late. Every read here uses the UTC parts, so the day is the same everywhere.
 *
 * Do NOT use these for real instants (a booking deadline, "30 days after
 * booking", an order's due time). Those must be read in the viewer's zone.
 *
 * Pure: no React, no React Native.
 */

export interface CalendarDateParts {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The calendar day a stored value names. Accepts a bare `YYYY-MM-DD` or an ISO
 * timestamp pinned to UTC. Returns null for null, empty or unparseable input.
 */
export function readCalendarDate(
  value: string | null | undefined,
): CalendarDateParts | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const bare = DATE_ONLY.exec(trimmed);
  if (bare !== null) {
    const year = Number(bare[1]);
    const month = Number(bare[2]);
    const day = Number(bare[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return null;
    }
    return { year, month, day };
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

/** `YYYY-MM-DD` for a stored calendar date, or "" when there is none. */
export function calendarDateToInputValue(
  value: string | null | undefined,
): string {
  const parts = readCalendarDate(value);
  if (parts === null) return "";
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * Display text for a stored calendar date, in the viewer's language but never
 * in the viewer's timezone. Returns "" when there is no date.
 */
export function formatCalendarDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
  locale?: string,
): string {
  const parts = readCalendarDate(value);
  if (parts === null) return "";
  const atUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
    atUtc,
  );
}

/**
 * The value to hand a NATIVE date picker for a stored calendar date: a `Date`
 * whose LOCAL year/month/day equal the stored day. A native picker shows and
 * returns local days, so seeding it with the raw UTC instant showed the wrong
 * day west of UTC, and confirming without changing anything then wrote that
 * wrong day back.
 */
export function calendarDateToPickerDate(
  value: string | null | undefined,
): Date | null {
  const parts = readCalendarDate(value);
  if (parts === null) return null;
  // Local noon: no timezone's daylight-saving jump can push it to another day.
  return new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0);
}

/** `YYYY-MM-DD` for the LOCAL day a native picker returned. */
export function pickerDateToInputValue(picked: Date): string {
  return `${picked.getFullYear()}-${pad2(picked.getMonth() + 1)}-${pad2(picked.getDate())}`;
}

/** Today's LOCAL calendar day as `YYYY-MM-DD` (for a date input's `min`). */
export function todayInputValue(now: Date = new Date()): string {
  return pickerDateToInputValue(now);
}

/**
 * Store a calendar day (`YYYY-MM-DD`) pinned to UTC: the start of the day, or
 * the last second of it for an end date. Null for empty or invalid input.
 */
export function inputValueToCalendarIso(
  value: string,
  endOfDay: boolean,
): string | null {
  const parts = readCalendarDate(value.trim());
  if (parts === null || DATE_ONLY.exec(value.trim()) === null) return null;
  const time = endOfDay ? "23:59:59" : "00:00:00";
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${time}.000Z`;
}

/**
 * Store the LOCAL day a native picker returned as that calendar day at UTC.
 * Null when the picker handed back an invalid date.
 */
export function pickerDateToCalendarIso(
  picked: Date,
  endOfDay: boolean,
): string | null {
  if (Number.isNaN(picked.getTime())) return null;
  return inputValueToCalendarIso(pickerDateToInputValue(picked), endOfDay);
}
