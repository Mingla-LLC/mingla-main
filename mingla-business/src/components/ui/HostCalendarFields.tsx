/**
 * #4523 — Host date-and-time field. Same contract style as `DateField`:
 * wall-clock strings in, wall-clock strings out (date `YYYY-MM-DD`, time
 * `HH:mm`), never a `Date`. The calendar loads on first use (see
 * `lazyHostField`); this file imports nothing from @mingla/calendar eagerly.
 */
import { lazyHostField, type HostFieldBase } from "./HostCalendarPlaceholder";

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

export const HostDateTimeField = lazyHostField<HostDateTimeFieldProps>(
  () => import("./HostCalendarBody").then((m) => ({ default: m.DateTimeBody })),
  "Choose date and time",
);

export interface HostDateRangeFieldProps extends HostFieldBase {
  /** `YYYY-MM-DD` both ends; "" while not chosen. */
  value: { start: string; end: string };
  onChangeValue: (value: { start: string; end: string }) => void;
  accessibilityLabel: string;
  min?: string;
  max?: string;
  timeZone?: string;
}

/** A range of days (trip dates, stay dates). Stays open until Done. */
export const HostDateRangeField = lazyHostField<HostDateRangeFieldProps>(
  () => import("./HostCalendarBody").then((m) => ({ default: m.DateRangeBody })),
  "Choose start and end dates",
);
