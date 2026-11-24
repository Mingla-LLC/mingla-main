import { compareDates, diffDays, type CalendarDate } from "./calendarDate";

export interface DraftRange {
  readonly start: CalendarDate | "";
  readonly end: CalendarDate | "";
}

export type RangeUnit = "nights" | "days";

/**
 * What a day tap does to a range draft:
 * - no start yet          -> becomes the start
 * - after the start       -> becomes the end (replacing an earlier end)
 * - before the start      -> becomes the new start, end cleared
 * - the same day as start -> clears the end, start stays; or, when the field
 *   allows a one-day range (`allowSameDay`: trip dates, day-unit pickers),
 *   ends the range on that same day. A stay (check-in / check-out) never does.
 */
export function nextRange(
  draft: DraftRange,
  tapped: CalendarDate,
  allowSameDay = false,
): DraftRange {
  if (draft.start === "") return { start: tapped, end: "" };
  const order = compareDates(tapped, draft.start);
  if (order > 0) return { start: draft.start, end: tapped };
  if (order < 0) return { start: tapped, end: "" };
  return { start: draft.start, end: allowSameDay ? draft.start : "" };
}

/** Nights between two dates (end - start). */
export function nights(start: CalendarDate, end: CalendarDate): number {
  return diffDays(end, start);
}

/** Days a range covers, both ends included. */
export function daysCovered(start: CalendarDate, end: CalendarDate): number {
  return diffDays(end, start) + 1;
}

export function clampToBounds(
  date: CalendarDate,
  min: CalendarDate | undefined,
  max: CalendarDate | undefined,
): CalendarDate {
  if (min !== undefined && compareDates(date, min) < 0) return min;
  if (max !== undefined && compareDates(date, max) > 0) return max;
  return date;
}

/** Length in the field's unit; minLength / maxLength are in that same unit. */
export function rangeLength(start: CalendarDate, end: CalendarDate, unit: RangeUnit): number {
  return unit === "nights" ? nights(start, end) : daysCovered(start, end);
}

export function isRangeComplete(
  draft: DraftRange,
  unit: RangeUnit,
  minLength?: number,
  maxLength?: number,
): boolean {
  if (draft.start === "" || draft.end === "") return false;
  const length = rangeLength(draft.start, draft.end, unit);
  if (minLength !== undefined && length < minLength) return false;
  if (maxLength !== undefined && length > maxLength) return false;
  return true;
}
