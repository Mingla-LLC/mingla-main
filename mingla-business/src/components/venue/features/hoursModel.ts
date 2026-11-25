/**
 * #4490 P1-9 — date and window wording for hours and special days (pure).
 */
import type { HoursWindow } from "../../../services/venueFeaturesService";
import { hoursWeekIssue } from "../../../utils/venueBrandHours";

/** "18:00" from "18:00" or "18:00:00": venue hours read 24-hour, like the TimeField (#4490 D20/D21). */
export function timeLabel(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return "";
  return `${match[1]}:${match[2]}`;
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

/** "12:00–16:00, 18:00–02:00 (next day)" style summary of windows. */
export function windowsSummary(windows: readonly HoursWindow[]): string {
  if (windows.length === 0) return "Closed";
  return windows
    .map((w) => {
      const open = timeLabel(w.open);
      const close = timeLabel(w.close);
      if (close === "00:00") return `${open} until 00:00`;
      return `${open}–${close}${close <= open ? " (next day)" : ""}`;
    })
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


/** #4490 click-test D25 — what a closed day means for guests, feature-aware. */
export function closedDayCopy(tableReservationsOn: boolean): string {
  return tableReservationsOn
    ? "Guests see you as closed that day and can't book a table."
    : "Guests see you as closed that day.";
}

/**
 * #4490 N59/N66 — an editor's starting days and hours from the venue's
 * opening hours: the open days, and the most common first window among them
 * (earliest open on a tie). Null when no day is open, so the editor keeps its
 * own default. Pure.
 */
export function openingHoursDefault(
  hours: readonly { weekday: number; openTime: string | null; closeTime: string | null; isClosed: boolean }[] | null | undefined,
): { weekdays: number[]; open: string; close: string } | null {
  const open = (hours ?? []).filter((h) => !h.isClosed && h.openTime !== null && h.closeTime !== null);
  if (open.length === 0) return null;
  const counts = new Map<string, number>();
  for (const h of open) {
    const key = `${(h.openTime as string).slice(0, 5)}-${(h.closeTime as string).slice(0, 5)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const [o, c] = best.split("-");
  return {
    weekdays: [...new Set(open.map((h) => h.weekday))].sort((a, b) => a - b),
    open: o,
    close: c,
  };
}
