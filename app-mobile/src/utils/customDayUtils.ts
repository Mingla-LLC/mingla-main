/**
 * Shared utilities for custom day calculations.
 * Used by PersonHolidayView.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Returns the number of days until the next occurrence of a custom day.
 * Auto-advances to next year if the date has already passed this year.
 * Returns 0 if the date is today.
 */
export function getCustomDayDaysAway(month: number, day: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();
  let next = new Date(thisYear, month - 1, day);
  next.setHours(0, 0, 0, 0);
  if (next < today) {
    next = new Date(thisYear + 1, month - 1, day);
    next.setHours(0, 0, 0, 0);
  }
  return Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns the commemoration year number (e.g., Year 3 for a 2023 event in 2026).
 * Accounts for whether the date has already passed this year.
 */
export function getCommemorationYear(originalYear: number, month: number, day: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();
  const thisYearDate = new Date(thisYear, month - 1, day);
  thisYearDate.setHours(0, 0, 0, 0);
  let year = thisYear - originalYear;
  if (thisYearDate < today) {
    year = thisYear + 1 - originalYear;
  }
  return year;
}

/**
 * Formats a custom day date as "Month Day" (e.g., "March 14").
 */
export function formatCustomDayDate(month: number, day: number): string {
  return `${MONTHS[month - 1]} ${day}`;
}
