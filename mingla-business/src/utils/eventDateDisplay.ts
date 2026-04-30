/**
 * Centralised event date/time display helpers (I-14 — single source).
 *
 * NEVER implement local ISO-to-label formatters in event components.
 * Reuse the helpers below or extend this file with new ones.
 *
 * Replaces three duplicated implementations that previously lived in
 * CreatorStep2When.tsx, CreatorStep7Preview.tsx, and PreviewEventView.tsx
 * (HIDDEN-2 in Cycle 4 investigation — Constitution #2 lift).
 *
 * Per Cycle 4 spec §3.3.
 */

import type {
  DraftEvent,
  MultiDateEntry,
  RecurrenceRule,
} from "../store/draftEventStore";
import {
  expandRecurrenceToDates,
  formatRecurrenceLabel,
} from "./recurrenceRule";

const parseIso = (iso: string): Date => {
  const parts = iso.split("-");
  if (parts.length !== 3) return new Date(iso);
  return new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
    0, 0, 0, 0,
  );
};

const toIso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** "Mon 12 May" — short weekday + day + month abbreviated. */
export const formatShortDate = (iso: string): string => {
  const d = parseIso(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

/** "Monday 12 May 2026" — full weekday + day + month + year. */
export const formatLongDate = (iso: string): string => {
  const d = parseIso(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

/** "Mon 12 May · 21:00" — primary mini-card / hero / preview eyebrow. */
export const formatSingleDateLine = (
  date: string | null,
  doorsOpen: string | null,
): string => {
  if (date === null) return "Date TBD";
  const datePart = formatShortDate(date);
  if (doorsOpen === null) return datePart;
  return `${datePart} · ${doorsOpen}`;
};

/** "Repeats every Monday · 12 dates" — recurring mini-card sub-line. */
export const formatRecurringSummary = (
  rule: RecurrenceRule,
  firstDate: string,
): string => {
  const occurrences = expandRecurrenceToDates(rule, firstDate);
  const label = formatRecurrenceLabel(rule, firstDate);
  const n = occurrences.length;
  return `${label} · ${n} ${n === 1 ? "date" : "dates"}`;
};

/** "5 dates · first Mon 12 May" — multi-date mini-card sub-line. */
export const formatMultiDateSummary = (dates: MultiDateEntry[]): string => {
  if (dates.length === 0) return "No dates yet";
  const firstShort = formatShortDate(dates[0].date);
  return `${dates.length} ${dates.length === 1 ? "date" : "dates"} · first ${firstShort}`;
};

/**
 * Returns formatted "Monday 12 May 2026 · 21:00" strings for accordion
 * expand list — recurring mode (one per computed occurrence).
 */
export const formatRecurringDatesList = (
  rule: RecurrenceRule,
  firstDate: string,
  doorsOpen: string | null,
): string[] => {
  const dates = expandRecurrenceToDates(rule, firstDate);
  return dates.map((d) => {
    const longLabel = formatLongDate(toIso(d));
    return doorsOpen !== null ? `${longLabel} · ${doorsOpen}` : longLabel;
  });
};

/**
 * Returns formatted "Monday 12 May 2026 · 21:00" strings for accordion
 * expand list — multi-date mode (one per entry, chronological).
 */
export const formatMultiDateList = (entries: MultiDateEntry[]): string[] => {
  return entries.map(
    (e) => `${formatLongDate(e.date)} · ${e.startTime}`,
  );
};

/**
 * Returns the eyebrow date+time line for a draft regardless of mode.
 *
 * Single mode: the event date.
 * Recurring mode: first occurrence date.
 * Multi-date mode: first entry's date.
 * Falls back to "Date TBD" if no date is resolvable.
 */
export const formatDraftDateLine = (draft: DraftEvent): string => {
  if (draft.whenMode === "single") {
    return formatSingleDateLine(draft.date, draft.doorsOpen);
  }
  if (draft.whenMode === "recurring") {
    return formatSingleDateLine(draft.date, draft.doorsOpen);
  }
  // multi_date
  const first = draft.multiDates !== null ? draft.multiDates[0] : undefined;
  if (first === undefined) return "Date TBD";
  return formatSingleDateLine(first.date, first.startTime);
};

/**
 * Returns the secondary "pill" sub-line for recurring/multi-date modes.
 * Empty (null) for single mode.
 */
export const formatDraftDateSubline = (draft: DraftEvent): string | null => {
  if (draft.whenMode === "single") return null;
  if (draft.whenMode === "recurring") {
    if (draft.recurrenceRule === null || draft.date === null) {
      return "Recurring (incomplete)";
    }
    return formatRecurringSummary(draft.recurrenceRule, draft.date);
  }
  // multi_date
  if (draft.multiDates === null) return "Multi-date (no dates yet)";
  return formatMultiDateSummary(draft.multiDates);
};

/**
 * Returns the accordion-expand list for a draft (multi-mode only).
 * Returns empty array for single mode (no expansion needed).
 */
export const formatDraftDatesList = (draft: DraftEvent): string[] => {
  if (draft.whenMode === "single") return [];
  if (draft.whenMode === "recurring") {
    if (draft.recurrenceRule === null || draft.date === null) return [];
    return formatRecurringDatesList(
      draft.recurrenceRule,
      draft.date,
      draft.doorsOpen,
    );
  }
  // multi_date
  if (draft.multiDates === null) return [];
  return formatMultiDateList(draft.multiDates);
};
