/**
 * @mingla/calendar — the one Mingla calendar (#4523).
 *
 * Consumers import DEEP specifiers (`@mingla/calendar/CalendarField`,
 * `@mingla/calendar/core/calendarDate`) so the lazy surface chunk stays out of
 * the eager bundle. This barrel is types plus pure helpers only: it re-exports
 * no component value, which keeps a stray `import { ... } from "@mingla/calendar"`
 * from pulling the surface into `__common` (the bundle-deferral gate pins this).
 */
export type {
  CalendarCommon,
  CalendarConfig,
  CalendarDate,
  CalendarIconName,
  CalendarLabels,
  CalendarPrimitives,
  CalendarSheetProps,
  CalendarTokens,
  DateTimeValue,
  RangeUnit,
  RangeValue,
  WallTime,
} from "./types";
export {
  addDays,
  addMonths,
  addYears,
  compareDates,
  diffDays,
  todayInZone,
} from "./core/calendarDate";
export { nights } from "./core/rangeRules";
