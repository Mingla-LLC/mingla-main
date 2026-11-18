/**
 * #4490 P1-9 — date and window wording for hours and special days (pure).
 */
import type { HoursWindow } from "../../../services/venueFeaturesService";
import { hoursWeekIssue } from "../../../utils/venueBrandHours";

/** "6:00 PM" from "18:00" (same wording as TimeField; kept RN-free here). */
export function timeLabel(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return "";
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "PM" : "AM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${match[2]} ${suffix}`;
}

function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return null;
  // Local noon: never shifts a day across time zones.
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thursday 25 December" (the close-a-day confirm). */
export function longDateLabel(iso: string): string {
  const d = parseIsoDate(iso);
  if (d === null) return "this day";
  return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

/** "Thu 25 Dec". */
export function shortDateLabel(iso: string): string {
  const d = parseIsoDate(iso);
  if (d === null) return iso;
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** "12:00 PM to 4:00 PM, 6:00 PM until 00:00" style summary of windows. */
export function windowsSummary(windows: readonly HoursWindow[]): string {
  if (windows.length === 0) return "Closed";
  return windows
    .map((w) =>
      w.close === "00:00"
        ? `${timeLabel(w.open)} until 00:00`
        : `${timeLabel(w.open)} to ${timeLabel(w.close)}${w.close <= w.open ? " (next day)" : ""}`,
    )
    .join(", ");
}

export interface SpecialDayDraft {
  localDate: string;
  isClosed: boolean;
  windows: HoursWindow[];
  label: string;
}

export function specialDayIssue(draft: SpecialDayDraft, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.localDate)) return "Pick a date.";
  if (draft.localDate < today) return "Pick today or a later date.";
  if (draft.label.trim().length > 60) return "Keep the name to 60 characters.";
  if (draft.isClosed) return null;
  if (draft.windows.length === 0) return "Add at least one window, or switch on Closed.";
  const [first, ...rest] = draft.windows;
  return hoursWeekIssue([
    {
      weekday: 0,
      isClosed: false,
      openTime: first?.open ?? null,
      closeTime: first?.close ?? null,
      extraWindows: rest.map((w) => ({ openTime: w.open, closeTime: w.close })),
    },
  ]);
}

