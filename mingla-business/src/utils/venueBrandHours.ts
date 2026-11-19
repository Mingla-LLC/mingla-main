/**
 * Ve1 — helpers for `brand_hours` rows (weekday 0 = Monday … 6 = Sunday).
 */

import type { BrandHourEntry, BrandHourWindow } from "../types/brand";

/** Default Mon–Sat 9am–5pm, Sun closed (product can tune copy in wizard). */
export function defaultBrandHoursWeek(): BrandHourEntry[] {
  const rows: BrandHourEntry[] = [];
  for (let w = 0; w <= 5; w++) {
    rows.push({
      weekday: w,
      openTime: "09:00",
      closeTime: "17:00",
      isClosed: false,
    });
  }
  rows.push({ weekday: 6, openTime: null, closeTime: null, isClosed: true });
  return rows;
}

/** Build JSON array for `biz_create_venue_brand_pending_review` `p_hours`. */
export function brandHoursToRpcPayload(
  entries: BrandHourEntry[],
): Array<Record<string, unknown>> {
  // #4490 — a week with any split shift is sent in the windows shape
  // ({weekday, windows:[{open,close}], is_closed}); every other week keeps the
  // pre-#4490 shape byte-for-byte (old servers, the create wizard, Ari).
  if (entries.some((e) => !e.isClosed && (e.extraWindows?.length ?? 0) > 0)) {
    return entries.map((e) => ({
      weekday: e.weekday,
      is_closed: e.isClosed,
      windows: e.isClosed ? [] : dayWindows(e).map((w) => ({
        open: hm(w.openTime),
        close: hm(w.closeTime),
      })),
    }));
  }
  return entries.map((e) => ({
    weekday: e.weekday,
    open_time: e.openTime ?? "",
    close_time: e.closeTime ?? "",
    is_closed: e.isClosed,
  }));
}

/** "HH:MM" from "HH:MM" or "HH:MM:SS" ("" when unset). */
function hm(value: string | null): string {
  return (value ?? "").slice(0, 5);
}

/**
 * All of a day's windows, earliest open first. #4490 N16: a second window
 * typed earlier than the first ("17:00–00:00" then "11:00–15:00") used to be
 * kept out of order on the review and in what was saved.
 */
export function dayWindows(entry: BrandHourEntry): BrandHourWindow[] {
  const windows = [
    { openTime: entry.openTime, closeTime: entry.closeTime },
    ...(entry.extraWindows ?? []),
  ];
  const at = (w: BrandHourWindow): number => minutesOf(w.openTime) ?? Number.MAX_SAFE_INTEGER;
  return windows.map((w, i) => ({ w, i })).sort((a, b) => at(a.w) - at(b.w) || a.i - b.i).map((x) => x.w);
}

/** The same day with its windows in order (window 0 = the earliest). Pure. */
export function withOrderedWindows(entry: BrandHourEntry): BrandHourEntry {
  if (entry.isClosed || (entry.extraWindows?.length ?? 0) === 0) return entry;
  const [first, ...rest] = dayWindows(entry);
  return { ...entry, openTime: first.openTime, closeTime: first.closeTime, extraWindows: rest };
}

function minutesOf(value: string | null): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(value ?? "");
  if (m === null) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** [open, close) in minutes since midnight; a close at or before the open runs past midnight. */
export function windowBounds(w: BrandHourWindow): [number, number] | null {
  const open = minutesOf(w.openTime);
  const close = minutesOf(w.closeTime);
  if (open === null || close === null) return null;
  return [open, close + (close <= open ? 1440 : 0)];
}

/**
 * #4490 — the first problem in a week of hours, in host words, or null.
 * Mirrors the server: every open window needs both times, open and close
 * differ, at most four windows a day, and a day's windows never overlap.
 */
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function hoursWeekIssue(entries: readonly BrandHourEntry[]): string | null {
  for (const entry of entries) {
    if (entry.isClosed) continue;
    // #4490 N7: every message names the day, so the host knows where to look.
    const day = DAY_NAMES[entry.weekday] ?? "A day";
    const windows = dayWindows(entry);
    if (windows.length > 4) return `${day}: a day can have at most four windows.`;
    for (const w of windows) {
      if ((w.openTime ?? "").length === 0 || (w.closeTime ?? "").length === 0) {
        return `${day}: open and close times are required for open days.`;
      }
      if (hm(w.openTime) === hm(w.closeTime)) return `${day}: open and close can't be the same time.`;
    }
    const bounds = windows.map(windowBounds);
    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        const a = bounds[i];
        const b = bounds[j];
        if (a !== null && b !== null && a[0] < b[1] && b[0] < a[1]) {
          return `${day}: two windows overlap. Change one so they don't.`;
        }
      }
    }
  }
  return null;
}

function hm24(value: string | null | undefined): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec((value ?? "").trim());
  if (match === null) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/**
 * #4490 click-test D20/D23/D26 — one week of hours in the shape the editor
 * shows: times as "HH:mm" (the server returns "HH:mm:ss"), closed days with no
 * times or windows, extra windows always an array, rows in weekday order.
 */
export function normalizeHoursWeek(entries: readonly BrandHourEntry[]): BrandHourEntry[] {
  return [...entries]
    .sort((a, b) => a.weekday - b.weekday)
    .map((entry) =>
      entry.isClosed
        ? { weekday: entry.weekday, openTime: null, closeTime: null, isClosed: true, extraWindows: [] }
        : {
            weekday: entry.weekday,
            openTime: hm24(entry.openTime),
            closeTime: hm24(entry.closeTime),
            isClosed: false,
            extraWindows: (entry.extraWindows ?? []).map((w) => ({
              openTime: hm24(w.openTime),
              closeTime: hm24(w.closeTime),
            })),
          },
    );
}

/** True when two weeks show the same hours (seconds and empty windows ignored). */
export function sameHoursWeek(
  a: readonly BrandHourEntry[] | null,
  b: readonly BrandHourEntry[] | null,
): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(normalizeHoursWeek(a)) === JSON.stringify(normalizeHoursWeek(b));
}

/**
 * #4490 click-test D26 — what an hours form shows after the server answers.
 * The form keeps a `base` (the hours it was last in step with) and a `draft`.
 * A new server value replaces both while the host has no unsaved edits; with
 * unsaved edits only the base moves, so their typing is never wiped.
 */
export function reconcileHoursForm(
  form: { base: BrandHourEntry[] | null; draft: BrandHourEntry[] | null },
  server: readonly BrandHourEntry[],
): { base: BrandHourEntry[]; draft: BrandHourEntry[] } {
  const next = normalizeHoursWeek(server);
  const editing = form.draft !== null && form.base !== null && !sameHoursWeek(form.draft, form.base);
  return { base: next, draft: editing && form.draft !== null ? form.draft : next };
}
