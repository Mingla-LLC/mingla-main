/**
 * #4523 — calendar date arithmetic on "YYYY-MM-DD" wall-clock strings.
 *
 * Every function here goes through Date.UTC and never builds a local-time
 * Date, so no device zone and no DST change can move a day (the defect the
 * old Explorer CalendarGrid had). Pure TS: no React, no DOM, no RN.
 */

/** "YYYY-MM-DD". An unset value is "" at the component edge, never here. */
export type CalendarDate = string;

export interface YearMonthDay {
  readonly y: number;
  readonly m: number; // 1-12
  readonly d: number; // 1-31
}

const MS_PER_DAY = 86_400_000;
const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseCalendarDate(value: string): YearMonthDay | null {
  const match = PATTERN.exec(value);
  if (match === null) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isCalendarDate(value: string): boolean {
  return parseCalendarDate(value) !== null;
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

export function formatCalendarDate(parts: YearMonthDay): CalendarDate {
  return `${pad(parts.y, 4)}-${pad(parts.m, 2)}-${pad(parts.d, 2)}`;
}

function fromUtcMs(ms: number): CalendarDate {
  const date = new Date(ms);
  return formatCalendarDate({
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  });
}

function toUtcMs(value: CalendarDate): number {
  const parts = parseCalendarDate(value);
  if (parts === null) throw new RangeError(`calendar: not a YYYY-MM-DD date: "${value}"`);
  return Date.UTC(parts.y, parts.m - 1, parts.d);
}

export function addDays(value: CalendarDate, days: number): CalendarDate {
  return fromUtcMs(toUtcMs(value) + days * MS_PER_DAY);
}

/** Adds calendar months, clamping the day to the target month's length. */
export function addMonths(value: CalendarDate, months: number): CalendarDate {
  const parts = parseCalendarDate(value);
  if (parts === null) throw new RangeError(`calendar: not a YYYY-MM-DD date: "${value}"`);
  const index = parts.y * 12 + (parts.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12 + 12) % 12 + 1;
  return formatCalendarDate({ y, m, d: Math.min(parts.d, daysInMonth(y, m)) });
}

export function addYears(value: CalendarDate, years: number): CalendarDate {
  return addMonths(value, years * 12);
}

/** Negative when a is before b, 0 when equal, positive when after. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole days from `start` to `end` (end - start). Nights of a stay. */
export function diffDays(end: CalendarDate, start: CalendarDate): number {
  return Math.round((toUtcMs(end) - toUtcMs(start)) / MS_PER_DAY);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(value: CalendarDate): number {
  return new Date(toUtcMs(value)).getUTCDay();
}

export function startOfMonth(value: CalendarDate): CalendarDate {
  const parts = parseCalendarDate(value);
  if (parts === null) throw new RangeError(`calendar: not a YYYY-MM-DD date: "${value}"`);
  return formatCalendarDate({ y: parts.y, m: parts.m, d: 1 });
}

export function sameMonth(a: CalendarDate, b: CalendarDate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * Today's date in an IANA zone, never the device zone (Constitution #12).
 * `now` is injectable so a test can pin the instant.
 */
export function todayInZone(timeZone: string, now: Date = new Date()): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) throw new RangeError(`calendar: no ${type} for zone ${timeZone}`);
    return Number(part.value);
  };
  return formatCalendarDate({ y: pick("year"), m: pick("month"), d: pick("day") });
}
