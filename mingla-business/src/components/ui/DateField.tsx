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

export interface DateFieldProps {
  /** Visible label rendered above the control. */
  label: string;
  /** `YYYY-MM-DD`, or `""` for unset. Never a Date. */
  value: string;
  /** Fires with `YYYY-MM-DD` (or `""` when cleared on web). */
  onChangeValue: (value: string) => void;
  /** Required — this replaces a labelled input. */
  accessibilityLabel: string;
  /** Optional inclusive lower bound, `YYYY-MM-DD`. */
  min?: string;
  /** Optional inclusive upper bound, `YYYY-MM-DD`. */
  max?: string;
  /** Placeholder shown when `value` is `""`. */
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  testID?: string;
  /**
   * IANA zone the date is in (brand or venue zone). Drives "today" and the
   * zone line in the calendar footer.
   */
  timeZone?: string;
}

export const DateField = lazyHostField<DateFieldProps>(
  () => import("./HostCalendarBody").then((m) => ({ default: m.DateBody })),
  "Choose a date",
);

export default DateField;
