/**
 * #4523 — Host date-and-time field. Same contract style as `DateField`:
 * wall-clock strings in, wall-clock strings out (date `YYYY-MM-DD`, time
 * `HH:mm`), never a `Date`. The calendar loads on first use (see
 * `lazyHostField`); this file imports nothing from @mingla/calendar eagerly.
 */
import { lazyHostField } from "./HostCalendarPlaceholder";
import type { HostDateTimeFieldProps } from "./hostCalendarFieldProps";

export type { HostDateTimeFieldProps } from "./hostCalendarFieldProps";

export const HostDateTimeField = lazyHostField<HostDateTimeFieldProps>(
  (m) => m.DateTimeBody,
  "Choose date and time",
);
