import {
  addDays,
  compareDates,
  daysInMonth,
  formatCalendarDate,
  weekdayOf,
  type CalendarDate,
} from "./calendarDate";

export interface GridCell {
  readonly date: CalendarDate;
  /** False for the leading / trailing days that belong to a neighbouring month. */
  readonly inMonth: boolean;
}

export interface DayBounds {
  readonly min?: CalendarDate;
  readonly max?: CalendarDate;
  readonly isDateDisabled?: (date: CalendarDate) => boolean;
}

/** A 6 x 7 grid for `month` (1-12). `weekStart` 0 = Sunday, 1 = Monday. */
export function monthMatrix(year: number, month: number, weekStart: 0 | 1): GridCell[][] {
  const first = formatCalendarDate({ y: year, m: month, d: 1 });
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const gridStart = addDays(first, -lead);
  const monthLength = daysInMonth(year, month);
  const rows: GridCell[][] = [];
  for (let r = 0; r < 6; r += 1) {
    const row: GridCell[] = [];
    for (let c = 0; c < 7; c += 1) {
      const offset = r * 7 + c;
      row.push({
        date: addDays(gridStart, offset),
        inMonth: offset >= lead && offset < lead + monthLength,
      });
    }
    rows.push(row);
  }
  return rows;
}

export function isDisabled(date: CalendarDate, bounds: DayBounds): boolean {
  if (bounds.min !== undefined && compareDates(date, bounds.min) < 0) return true;
  if (bounds.max !== undefined && compareDates(date, bounds.max) > 0) return true;
  return bounds.isDateDisabled?.(date) === true;
}
