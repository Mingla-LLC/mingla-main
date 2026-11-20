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
 * INVARIANT: I-4523-DATES-ARE-PICKED (declared in the strict-grep gate).
 */

import { CalendarField } from "@mingla/calendar/CalendarField";
import React from "react";
import { Platform } from "react-native";

import { detectDeviceTimezone } from "../../utils/timezones";
import { HOST_CALENDAR_CONFIG } from "./calendarHostConfig";

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

export function DateField({
  label,
  value,
  onChangeValue,
  accessibilityLabel,
  min,
  max,
  placeholder,
  disabled = false,
  hasError = false,
  testID,
  // [TRANSITIONAL] falls back to the device zone — the seven current callers do
  // not pass a brand or venue zone yet; exit: each caller passes `timeZone`
  // (the #4523 later slices migrate them).
  timeZone = detectDeviceTimezone(),
}: DateFieldProps): React.ReactElement {
  return (
    <CalendarField
      label={label}
      accessibilityLabel={accessibilityLabel}
      value={value}
      onChange={onChangeValue}
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      invalid={hasError}
      testID={testID}
      timeZone={timeZone}
      clearable={Platform.OS === "web"}
      config={HOST_CALENDAR_CONFIG}
    />
  );
}

export default DateField;
