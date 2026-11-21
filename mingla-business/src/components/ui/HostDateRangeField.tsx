/**
 * #4522 / #4523 — the range field is owned by the trip builder chunk until a
 * second Host surface needs it. Keeping this owner separate prevents Metro
 * from adding a trip-only export to eager __common; the calendar body still
 * loads only when the field opens.
 */
import { lazyHostField } from "./HostCalendarPlaceholder";
import type { HostDateRangeFieldProps } from "./hostCalendarFieldProps";

export type { HostDateRangeFieldProps } from "./hostCalendarFieldProps";

/** A range of days (trip dates, stay dates). Stays open until Done. */
export const HostDateRangeField = lazyHostField<HostDateRangeFieldProps>(
  () => import("./HostCalendarBody").then((m) => ({ default: m.DateRangeBody })),
  "Choose start and end dates",
);
