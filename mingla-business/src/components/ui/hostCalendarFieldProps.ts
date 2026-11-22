/**
 * #4523 — props of the three Host calendar fields, in one type-only leaf.
 *
 * The field owners (`DateField`, `HostCalendarFields`, `HostDateRangeField`)
 * lazily import `HostCalendarBody`, and the body needs these props. Declaring
 * them here keeps that a one-way edge (no require cycle) and costs no bundle
 * bytes: this module holds types only, so Metro emits nothing for it.
 */
import type { HostFieldBase } from "./HostCalendarPlaceholder";

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

export interface HostDateTimeFieldProps extends HostFieldBase {
  /** `{ date: "YYYY-MM-DD" | "", time: "HH:mm" | "" }`. */
  value: { date: string; time: string };
  onChangeValue: (value: { date: string; time: string }) => void;
  /** Optional field: Clear commits "no value" through this. */
  onClear?: () => void;
  accessibilityLabel: string;
  min?: string;
  max?: string;
  /** Applies on the `min` day only. */
  minTime?: string;
  maxTime?: string;
  timeStepMinutes?: 5 | 15 | 30;
  timeZone?: string;
}

export interface HostDateRangeFieldProps extends HostFieldBase {
  /** `YYYY-MM-DD` both ends; "" while not chosen. */
  value: { start: string; end: string };
  onChangeValue: (value: { start: string; end: string }) => void;
  accessibilityLabel: string;
  min?: string;
  max?: string;
  timeZone?: string;
  /** A one-day range may be picked (a day trip); default false. */
  allowSameDay?: boolean;
}
