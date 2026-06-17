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
 *
 * ORCH-0877 — widened to render event end-time on every surface that calls
 * these helpers. Cross-midnight events (10 PM Sat → 2 AM Sun) render with
 * weekday prefix on both sides; same-day events render as a single date
 * with inline time range. Smart-infer logic: when masterEndAtUtc is absent
 * (legacy persisted drafts), if endsAt time-of-day < doorsOpen time-of-day
 * we assume the event ends the next morning. Per SPEC_ORCH-0877 §4.5.
 */

import type {
  MultiDateEntry,
  RecurrenceRule,
  WhenMode,
} from "../store/draftEventStore";
import {
  expandRecurrenceToDates,
  formatRecurrenceLabel,
} from "./recurrenceRule";

/**
 * Structural type accepted by the `formatDraft*` helpers below.
 *
 * Both `DraftEvent` and `LiveEvent` (Cycle 6+) satisfy this shape.
 * Using a structural type lets these display helpers serve both the
 * organiser-side draft surfaces AND the buyer-side public page without
 * casts. Constitution #2 + I-14 — single source for date display.
 *
 * ORCH-0877 fields:
 *   - endsAt: HH:MM string at end of event in event's local timezone. Kept
 *     for back-compat with persisted Zustand drafts that pre-date masterEndAtUtc.
 *   - masterStartAtUtc + masterEndAtUtc: full UTC instants populated by
 *     server-projection mappers. When present these are the canonical source
 *     of truth and the smart-infer fallback is skipped.
 *   - timezone: IANA tz of the event for client-side cross-midnight day
 *     comparison via Intl.DateTimeFormat.
 */
export interface EventDateLike {
  whenMode: WhenMode;
  date: string | null;
  doorsOpen: string | null;
  endsAt: string | null;
  masterStartAtUtc?: string | null;
  masterEndAtUtc?: string | null;
  timezone: string | null;
  recurrenceRule: RecurrenceRule | null;
  multiDates: MultiDateEntry[] | null;
}

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

// ─── ORCH-0877 time formatting helpers ───────────────────────────────

/**
 * Convert "HH:MM" 24h to "H PM" or "H:MM AM" 12h-uppercase format.
 *   "22:00" → "10 PM", "02:30" → "2:30 AM", "00:00" → "12 AM"
 *
 * Returns null on malformed input. NEVER fabricates.
 */
const formatTimeLabel = (hhmm: string | null): string | null => {
  if (hhmm === null) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (m === null) return null;
  const h = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(minutes)) return null;
  if (h < 0 || h > 23 || minutes < 0 || minutes > 59) return null;
  const isPm = h >= 12;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const minuteSuffix = minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`;
  return `${h12}${minuteSuffix} ${isPm ? "PM" : "AM"}`;
};

/**
 * Decide whether endsAt time-of-day implies "next day" via smart-infer.
 * Returns true when endsAt time < doorsOpen time (same-day comparison).
 * Used as the fallback when masterEndAtUtc is absent.
 */
export const isEndsAtNextDay = (
  doorsOpen: string | null,
  endsAt: string | null,
): boolean => {
  if (doorsOpen === null || endsAt === null) return false;
  const dMatch = /^(\d{1,2}):(\d{2})$/.exec(doorsOpen);
  const eMatch = /^(\d{1,2}):(\d{2})$/.exec(endsAt);
  if (dMatch === null || eMatch === null) return false;
  const dMin = Number(dMatch[1]) * 60 + Number(dMatch[2]);
  const eMin = Number(eMatch[1]) * 60 + Number(eMatch[2]);
  return eMin <= dMin;
};

/**
 * Given a YYYY-MM-DD date string and a "next day" flag, return the
 * formatShortDate label for the resulting day (advancing by 1 day if
 * required). Used to render the end-side weekday on cross-midnight events
 * when only `date` + `endsAt` are known (legacy persisted drafts).
 */
const advanceShortDate = (iso: string, advance: boolean): string => {
  if (!advance) return formatShortDate(iso);
  const d = parseIso(iso);
  d.setDate(d.getDate() + 1);
  return formatShortDate(toIso(d));
};

/**
 * Calendar-day comparison in a target IANA timezone. Returns true when
 * the two UTC instants fall on different calendar days in `tz`. Used when
 * both masterStartAtUtc + masterEndAtUtc are populated.
 */
const isCrossCalendarDay = (
  startUtc: string,
  endUtc: string,
  tz: string,
): boolean => {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date(startUtc)) !== fmt.format(new Date(endUtc));
  } catch {
    return false;
  }
};

/**
 * Format a UTC instant as "Mon 12 May" short weekday in target tz.
 */
const formatShortDateInTz = (utc: string, tz: string): string | null => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: tz,
    }).format(new Date(utc));
  } catch {
    return null;
  }
};

/**
 * Format a UTC instant as "10 PM" / "2:30 AM" in target tz with uppercase AM/PM.
 *
 * en-GB defaults to 24h; we read the instant as a Date, pull HH from
 * `Intl.DateTimeFormat({ hour: '2-digit', hourCycle: 'h23' })` so we get
 * 00–23, then run the same 12h conversion the legacy `formatTimeLabel`
 * helper uses for HH:MM strings.
 */
const formatTimeLabelInTz = (utc: string, tz: string): string | null => {
  try {
    const date = new Date(utc);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? "";
    const hour = get("hour");
    const minute = get("minute");
    if (!hour || !minute) return null;
    return formatTimeLabel(
      `${hour === "24" ? "00" : hour}:${minute}`,
    );
  } catch {
    return null;
  }
};

/**
 * ORCH-1157 [rsvp-public-redesign] Issue 4 — doors-open / doors-close labels for
 * the public RSVP page. Seth-locked: events already carry start_at + end_at
 * (event_dates) → reuse those, NO new field/schema. "Doors open" = start_at,
 * "Doors close" = end_at, formatted in the event's IANA timezone (reuses the same
 * tz-aware 12h label the date line uses). REAL-DATA-ONLY: `close` is null when
 * masterEndAtUtc is absent (no fabricated close — Constitution rule 9).
 *
 * Returns `{ open: null, close: null }` when there is no start instant.
 */
export const formatEventDoorsTimes = (
  masterStartAtUtc: string | null | undefined,
  masterEndAtUtc: string | null | undefined,
  timezone: string | null | undefined,
): { open: string | null; close: string | null } => {
  const tz = timezone !== null && timezone !== undefined && timezone.length > 0
    ? timezone
    : "UTC";
  const open =
    masterStartAtUtc !== null && masterStartAtUtc !== undefined
      ? formatTimeLabelInTz(masterStartAtUtc, tz)
      : null;
  const close =
    masterEndAtUtc !== null && masterEndAtUtc !== undefined
      ? formatTimeLabelInTz(masterEndAtUtc, tz)
      : null;
  return { open, close };
};

/**
 * ORCH-0877 — Single-event date line. Renders one of three forms:
 *   1. Date TBD                              — when date is null
 *   2. "Sat 18 May · 10 PM"                  — when endsAt is null
 *   3. "Sat 18 May · 10 PM – 11 PM"          — same-day range
 *   4. "Sat 18 May · 10 PM – Sun 19 May · 2 AM" — cross-midnight range
 *
 * When `masterStartAtUtc` + `masterEndAtUtc` are both present they are the
 * source of truth (server-derived); otherwise fall back to smart-infer on
 * `date + doorsOpen + endsAt` (legacy persisted drafts).
 *
 * Per SPEC_ORCH-0877 §4.3 + ui-ux-pro-max preflight 2026-05-18:
 *   - en-dash "–" (U+2013) with regular single-spaces
 *   - uppercase AM/PM (post-process en-GB lowercase output)
 *   - same-day form omits the year
 *   - cross-midnight form prefixes weekday on both sides
 */
export const formatSingleDateLine = (
  date: string | null,
  doorsOpen: string | null,
  endsAt: string | null,
  masterStartAtUtc?: string | null,
  masterEndAtUtc?: string | null,
  timezone?: string | null,
): string => {
  if (date === null) return "Date TBD";
  const startLabel = formatShortDate(date);
  const doorsLabel = formatTimeLabel(doorsOpen);
  if (doorsLabel === null) return startLabel;
  if (endsAt === null) return `${startLabel} · ${doorsLabel}`;

  const endsLabel = formatTimeLabel(endsAt);
  if (endsLabel === null) return `${startLabel} · ${doorsLabel}`;

  // Preferred path — both server-derived UTC instants present. Use
  // timezone-aware calendar-day comparison to decide cross-midnight.
  if (
    masterStartAtUtc !== null &&
    masterStartAtUtc !== undefined &&
    masterEndAtUtc !== null &&
    masterEndAtUtc !== undefined &&
    timezone !== null &&
    timezone !== undefined &&
    timezone.length > 0
  ) {
    const crossDay = isCrossCalendarDay(masterStartAtUtc, masterEndAtUtc, timezone);
    if (crossDay) {
      const endDateLabel = formatShortDateInTz(masterEndAtUtc, timezone);
      const endTimeLabel = formatTimeLabelInTz(masterEndAtUtc, timezone);
      if (endDateLabel !== null && endTimeLabel !== null) {
        return `${startLabel} · ${doorsLabel} – ${endDateLabel} · ${endTimeLabel}`;
      }
    }
    return `${startLabel} · ${doorsLabel} – ${endsLabel}`;
  }

  // Legacy fallback — smart-infer cross-midnight from time-of-day comparison.
  if (isEndsAtNextDay(doorsOpen, endsAt)) {
    const endDateLabel = advanceShortDate(date, true);
    return `${startLabel} · ${doorsLabel} – ${endDateLabel} · ${endsLabel}`;
  }
  return `${startLabel} · ${doorsLabel} – ${endsLabel}`;
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
 * Returns formatted "Mon 12 May · 10 PM – 11 PM" strings for accordion
 * expand list — recurring mode (one per computed occurrence).
 *
 * ORCH-0877 — each occurrence inherits the parent (doorsOpen, endsAt)
 * time-of-day pair and applies smart-infer per-occurrence. Recurring
 * series that span DST boundaries are still rendered with the wall-clock
 * time-of-day the operator picked; the actual UTC instants are recomputed
 * at scan/lifecycle time via eventDateMath helpers.
 */
export const formatRecurringDatesList = (
  rule: RecurrenceRule,
  firstDate: string,
  doorsOpen: string | null,
  endsAt: string | null,
): string[] => {
  const dates = expandRecurrenceToDates(rule, firstDate);
  return dates.map((d) => {
    const isoForDay = toIso(d);
    return formatSingleDateLine(
      isoForDay,
      doorsOpen,
      endsAt,
      null,
      null,
      null,
    );
  });
};

/**
 * Returns formatted "Mon 12 May · 9 PM – 11 PM" strings for accordion
 * expand list — multi-date mode (one per entry, chronological).
 *
 * ORCH-0877 — per-entry smart-infer for cross-midnight events. Each entry
 * carries its own startTime + endTime.
 */
export const formatMultiDateList = (entries: MultiDateEntry[]): string[] => {
  return entries.map((e) =>
    formatSingleDateLine(e.date, e.startTime, e.endTime, null, null, null)
  );
};

/**
 * Returns the eyebrow date+time line for a draft regardless of mode.
 *
 * Single mode: the event date.
 * Recurring mode: first occurrence date.
 * Multi-date mode: first entry's date.
 * Falls back to "Date TBD" if no date is resolvable.
 *
 * ORCH-0877 — propagates the new endsAt + masterStartAtUtc + masterEndAtUtc
 * + timezone fields to the renderer so cross-midnight events display
 * correctly on every surface.
 */
export const formatDraftDateLine = (draft: EventDateLike): string => {
  if (draft.whenMode === "single" || draft.whenMode === "recurring") {
    return formatSingleDateLine(
      draft.date,
      draft.doorsOpen,
      draft.endsAt,
      draft.masterStartAtUtc ?? null,
      draft.masterEndAtUtc ?? null,
      draft.timezone,
    );
  }
  // multi_date
  const first = draft.multiDates !== null ? draft.multiDates[0] : undefined;
  if (first === undefined) return "Date TBD";
  return formatSingleDateLine(
    first.date,
    first.startTime,
    first.endTime,
    null,
    null,
    draft.timezone,
  );
};

/**
 * Returns the secondary "pill" sub-line for recurring/multi-date modes.
 * Empty (null) for single mode.
 */
export const formatDraftDateSubline = (draft: EventDateLike): string | null => {
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
export const formatDraftDatesList = (draft: EventDateLike): string[] => {
  if (draft.whenMode === "single") return [];
  if (draft.whenMode === "recurring") {
    if (draft.recurrenceRule === null || draft.date === null) return [];
    return formatRecurringDatesList(
      draft.recurrenceRule,
      draft.date,
      draft.doorsOpen,
      draft.endsAt,
    );
  }
  // multi_date
  if (draft.multiDates === null) return [];
  return formatMultiDateList(draft.multiDates);
};
