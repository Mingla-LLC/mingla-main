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

import React, { Suspense } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, type } from "../../constants/designSystem";

const DateFieldBody = React.lazy(() => import("./DateFieldBody"));

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

export function DateField(props: DateFieldProps): React.ReactElement {
  return (
    <Suspense fallback={<DateFieldPlaceholder {...props} />}>
      <DateFieldBody {...props} />
    </Suspense>
  );
}

/** Same row, inert, while the calendar chunk loads (it starts loading on mount). */
function DateFieldPlaceholder({ label, placeholder = "Choose a date", disabled = false, hasError = false, testID }: DateFieldProps): React.ReactElement {
  return (
    <View style={styles.host}>
      <Text style={styles.label}>{label}</Text>
      <View
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: true, disabled: true }}
        testID={testID === undefined ? undefined : `${testID}-loading`}
        style={[styles.row, hasError ? styles.rowError : null, disabled ? styles.rowDisabled : null]}
      >
        <Text style={styles.rowPlaceholder}>{placeholder}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: 2 },
  label: { ...type.small, color: color.text2 },
  row: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  rowError: { borderColor: color.errorText },
  rowDisabled: { opacity: 0.45 },
  rowPlaceholder: { fontSize: 16, color: color.text4 },
});

export default DateField;
