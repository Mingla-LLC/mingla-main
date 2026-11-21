import { parseCalendarDate, type CalendarDate } from "./calendarDate";
import type { RangeUnit } from "./rangeRules";

/** Every user-visible string. English defaults; Explorer passes t() values. */
export interface CalendarLabels {
  choose_date: string;
  choose_dates: string;
  choose_date_time: string;
  not_set: string;
  opens_calendar: string;
  previous_month: string;
  next_month: string;
  previous_year: string;
  next_year: string;
  previous_years: string;
  next_years: string;
  done: string;
  clear: string;
  close: string;
  unavailable: string;
  today: string;
  selected: string;
  range_start: string;
  range_end: string;
  in_range: string;
  pick_last_day: string;
  pick_time: string;
  time_heading: string;
  loading: string;
  dialog_title_date: string;
  dialog_title_dates: string;
  dialog_title_date_time: string;
  dialog_title_dob: string;
  /** "{n} night" / "{n} nights" */
  night_one: string;
  night_other: string;
  day_one: string;
  day_other: string;
  /** Joins a date and its time: "Fri 12 Mar 2027 at 19:00" */
  at: string;
  value_not_allowed: string;
}

export const DEFAULT_CALENDAR_LABELS: CalendarLabels = {
  choose_date: "Choose a date",
  choose_dates: "Choose dates",
  choose_date_time: "Choose date and time",
  not_set: "not set",
  opens_calendar: "Opens calendar",
  previous_month: "Previous month",
  next_month: "Next month",
  previous_year: "Previous year",
  next_year: "Next year",
  previous_years: "Previous years",
  next_years: "Next years",
  done: "Done",
  clear: "Clear",
  close: "Close",
  unavailable: "unavailable",
  today: "today",
  selected: "selected",
  range_start: "start",
  range_end: "end",
  in_range: "in range",
  pick_last_day: "pick the last day",
  pick_time: "Pick a time",
  time_heading: "Time",
  loading: "Loading calendar",
  dialog_title_date: "Choose a date",
  dialog_title_dates: "Choose dates",
  dialog_title_date_time: "Choose date and time",
  dialog_title_dob: "Date of birth",
  night_one: "{n} night",
  night_other: "{n} nights",
  day_one: "{n} day",
  day_other: "{n} days",
  at: "at",
  value_not_allowed: "This date is not available",
};

export function mergeLabels(partial: Partial<CalendarLabels> | undefined): CalendarLabels {
  return partial === undefined ? DEFAULT_CALENDAR_LABELS : { ...DEFAULT_CALENDAR_LABELS, ...partial };
}

function utcDate(value: CalendarDate): Date {
  const parts = parseCalendarDate(value);
  if (parts === null) throw new RangeError(`calendar: not a YYYY-MM-DD date: "${value}"`);
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
}

const fmt = (locale: string | undefined, options: Intl.DateTimeFormatOptions, date: Date): string =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);

/** "March 2027" */
export function monthTitle(year: number, month: number, locale?: string): string {
  return fmt(locale, { month: "long", year: "numeric" }, new Date(Date.UTC(year, month - 1, 1)));
}

/** Weekday initials for the grid header, starting on `weekStart`. */
export function weekdayInitials(weekStart: 0 | 1, locale?: string): string[] {
  // 2027-03-07 is a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    fmt(locale, { weekday: "narrow" }, new Date(Date.UTC(2027, 2, 7 + ((i + weekStart) % 7)))),
  );
}

/** "Friday 12 March 2027", spoken for a day cell. */
export function dayA11yLabel(value: CalendarDate, locale?: string): string {
  return fmt(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }, utcDate(value));
}

/** "Fri 12 Mar 2027" */
export function formatLongDate(value: CalendarDate, locale?: string): string {
  return fmt(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" }, utcDate(value));
}

function shortDayMonth(value: CalendarDate, locale?: string): string {
  return fmt(locale, { day: "numeric", month: "short" }, utcDate(value));
}

function weekdayShort(value: CalendarDate, locale?: string): string {
  return fmt(locale, { weekday: "short" }, utcDate(value));
}

export function countLabel(n: number, one: string, other: string): string {
  return (n === 1 ? one : other).replace("{n}", String(n));
}

export function lengthLabel(n: number, unit: RangeUnit, labels: CalendarLabels): string {
  return unit === "nights"
    ? countLabel(n, labels.night_one, labels.night_other)
    : countLabel(n, labels.day_one, labels.day_other);
}

/** "Fri 12 – Tue 16 Mar 2027 · 4 nights" (the same-month, same-year compact form). */
export function formatRangeLong(
  start: CalendarDate,
  end: CalendarDate,
  lengthText: string,
  locale?: string,
): string {
  const sameMonthAndYear = start.slice(0, 7) === end.slice(0, 7);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const startText = sameMonthAndYear
    ? `${weekdayShort(start, locale)} ${fmt(locale, { day: "numeric" }, utcDate(start))}`
    : sameYear
      ? `${weekdayShort(start, locale)} ${shortDayMonth(start, locale)}`
      : formatLongDate(start, locale);
  return `${startText} – ${formatLongDate(end, locale)} · ${lengthText}`;
}

/** "12 – 16 Mar" readout while a range is being picked. */
export function formatRangeShort(start: CalendarDate, end: CalendarDate, locale?: string): string {
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${fmt(locale, { day: "numeric" }, utcDate(start))} – ${shortDayMonth(end, locale)}`;
  }
  return `${shortDayMonth(start, locale)} – ${shortDayMonth(end, locale)}`;
}

/**
 * "Lagos time (WAT, UTC+1)" for the visible date, so a DST zone prints the
 * right offset. When the runtime lacks the Intl pieces the label falls back to
 * the plain zone id, which is still true.
 */
export function formatTimezoneLabel(timeZone: string, onDate: CalendarDate, locale?: string): string {
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  try {
    const instant = new Date(utcDate(onDate).getTime() + 12 * 3_600_000);
    const part = (style: "short" | "longOffset"): string | undefined =>
      new Intl.DateTimeFormat(locale ?? "en-GB", { timeZone, timeZoneName: style })
        .formatToParts(instant)
        .find((p) => p.type === "timeZoneName")?.value;
    const abbreviation = part("short");
    const offsetRaw = part("longOffset");
    if (abbreviation === undefined) return `${city} time`;
    const offset = formatOffset(offsetRaw);
    // ICU has no abbreviation for many zones and answers "GMT+1": that adds
    // nothing next to "UTC+1", so only a real abbreviation (WAT, BST) is shown.
    if (/^(GMT|UTC)/.test(abbreviation)) return offset === null ? `${city} time` : `${city} time (${offset})`;
    return offset === null ? `${city} time (${abbreviation})` : `${city} time (${abbreviation}, ${offset})`;
  } catch {
    // Intl timeZone data unavailable in this runtime: name the zone plainly.
    return timeZone;
  }
}

function formatOffset(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  if (raw === "GMT") return "UTC+0";
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (match === null) return null;
  const hours = String(Number(match[2]));
  return match[3] === undefined || match[3] === "00" ? `UTC${match[1]}${hours}` : `UTC${match[1]}${hours}:${match[3]}`;
}
