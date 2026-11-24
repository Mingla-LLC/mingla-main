/**
 * DateField — the Host app's calendar date control.
 * Issue #1503 [stay-date-pickers] (origin), reworked for #4523 [one-calendar].
 *
 * Since #4523 this is a thin wrapper over `@mingla/calendar`'s CalendarField,
 * so every Host surface (iOS, Android, web) shows the same Mingla calendar:
 * changing month never closes it, a day tap commits once and closes. The OS
 * date spinner / inline picker and the browser `<input type="date">` this file
 * used to render are gone.
 *
 * VALUE CONTRACT (unchanged): `value` and `onChangeValue` are ALWAYS a
 * venue/operator-local calendar date `YYYY-MM-DD`, or `""` for unset. A `Date`
 * never crosses this boundary.
 *
 * BUNDLE: this file is the eager half. The whole calendar feature (field,
 * surface, Host config) loads through the ONE React.lazy below, so none of
 * @mingla/calendar is imported eagerly by the Host screens that use DateField.
 *
 * INVARIANT: I-4523-DATES-ARE-PICKED (declared in the strict-grep gate).
 */

import { lazyHostField } from "./HostCalendarPlaceholder";
import type { DateFieldProps } from "./hostCalendarFieldProps";

export type { DateFieldProps } from "./hostCalendarFieldProps";

export const DateField = lazyHostField<DateFieldProps>(
  (m) => m.DateBody,
  "Choose a date",
);

export default DateField;
