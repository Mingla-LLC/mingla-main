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
 * ORCH-1157 Round-7 [doors pill] — device-locale-aware doors time formatter.
 *
 * Unlike `formatTimeLabelInTz` (forced 12h, drops `:00` minutes — used by the
 * date line), this ALWAYS shows minutes and respects the DEVICE'S 12h/24h
 * preference:
 *   - device on 12h → "1:00 PM"
 *   - device on 24h → "13:00"
 *
 * Mechanism: `toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })`
 * with an UNDEFINED locale resolves to the device locale + its 24-hour-clock
 * setting on Hermes (native) and the OS locale in the browser (buyer web). The
 * `locale` param exists ONLY so tests can pin a clock ("en-US" → 12h,
 * "sv-SE" → 24h); production passes undefined. AM/PM uppercased for parity with
 * the date line. Returns null on any invalid instant (never fabricates).
 */
const formatDoorsTimeInTz = (
  utc: string,
  tz: string,
  locale?: string,
): string | null => {
  try {
    const d = new Date(utc);
    if (Number.isNaN(d.getTime())) return null;
    // Detect the device's 12h/24h preference from the resolved format. 24h →
    // zero-padded "HH:MM" ("13:00", "04:00"); 12h → "H:MM AM/PM" ("1:00 PM").
    const is24h =
      new Intl.DateTimeFormat(locale, { hour: "numeric" })
        .resolvedOptions().hour12 === false;
    return d
      .toLocaleTimeString(locale, {
        hour: is24h ? "2-digit" : "numeric",
        minute: "2-digit",
        timeZone: tz,
      })
      .replace(/\bam\b/gi, "AM")
      .replace(/\bpm\b/gi, "PM");
  } catch {
    return null;
  }
};

/**
 * ORCH-1157 [rsvp-public-redesign] Issue 4 — doors-open / doors-close labels for
 * the public RSVP page. Seth-locked: events already carry start_at + end_at
 * (event_dates) → reuse those, NO new field/schema. "Doors open" = start_at,
 * "Doors close" = end_at, formatted in the event's IANA timezone.
 *
 * ORCH-1157 Round-7: the time is now device-locale-aware (12h → "1:00 PM",
 * 24h → "13:00") via `formatDoorsTimeInTz` and always carries minutes — replacing
 * the bare-hour output ("13") the date-line label produced. REAL-DATA-ONLY:
 * `close` is null when masterEndAtUtc is absent (no fabricated close — rule 9).
 * Returns `{ open: null, close: null }` when there is no start instant.
 *
 * @param locale test-only clock override ("en-US" 12h / "sv-SE" 24h); production
 *   passes undefined → device locale + device 24-hour-clock setting.
 */
export const formatEventDoorsTimes = (
  masterStartAtUtc: string | null | undefined,
  masterEndAtUtc: string | null | undefined,
  timezone: string | null | undefined,
  locale?: string,
): { open: string | null; close: string | null } => {
  const tz = timezone !== null && timezone !== undefined && timezone.length > 0
    ? timezone
    : "UTC";
  const open =
    masterStartAtUtc !== null && masterStartAtUtc !== undefined
      ? formatDoorsTimeInTz(masterStartAtUtc, tz, locale)
      : null;
  const close =
    masterEndAtUtc !== null && masterEndAtUtc !== undefined
      ? formatDoorsTimeInTz(masterEndAtUtc, tz, locale)
      : null;
  return { open, close };
};

/**
 * issue #2135 [multi-date public day picker] — the short day label for ONE
 * materialised `event_dates` occurrence, e.g. "Sat 22 Aug", rendered in the
 * event's IANA timezone.
 *
 * Lives here, not in the component, because I-14 makes this file the single
 * owner of event date display (never a local ISO-to-label formatter in a
 * component). Returns null on an unparseable instant — NEVER a fabricated
 * label (Constitution #9); callers omit the affordance instead.
 */
export const formatOccurrenceDayLabel = (
  startAtUtc: string | null | undefined,
  timezone: string | null | undefined,
): string | null => {
  if (typeof startAtUtc !== "string" || startAtUtc.length === 0) return null;
  if (Number.isNaN(new Date(startAtUtc).getTime())) return null;
  const tz =
    typeof timezone === "string" && timezone.length > 0 ? timezone : "UTC";
  return formatShortDateInTz(startAtUtc, tz);
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

// ═══════════════════════════════════════════════════════════════════════════
// issue #2209 — RENDERING A PUBLISHED EVENT'S REAL DAYS.
//
// THE BUG. A published multi-date event's days live in `event_dates` and reach
// the client as OCCURRENCES (`PublicEventDetail.occurrences`, #2160/#2161).
// `MultiDateEntry[]` is a DIFFERENT thing: it is the ORGANISER'S DRAFT, read
// out of `theme.business_event.multiDates`, and the public projection
// deliberately strips it. So on the buyer-web public page a two-day event
// arrived with `whenMode === "multi_date"` and `multiDates === null`, and
// `formatDraftDateLine`/`formatDraftDateSubline` correctly reported what they
// were given: "Date TBD" and "Multi-date (no dates yet)". The formatters were
// not wrong — nobody had ever taught this file that a LIVE event's days come
// from somewhere else.
//
// The helpers below are that second source, and they live HERE because I-14
// makes this file the single owner of event date display. `formatOccurrenceLine`
// in particular is the SAME label MultiDateDayChooser renders on its day rows —
// that component now calls this instead of keeping a private copy, so the
// eyebrow and the picker cannot drift apart.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One materialised occurrence, structurally. Declared here rather than imported
 * so this display module keeps zero dependencies on the service layer
 * (`PublicEventOccurrence` satisfies it by structure — TypeScript is
 * structural, so no import and no cycle).
 */
export interface OccurrenceDateLike {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
}

/**
 * "Sat 22 Aug · 11 AM – 6 PM" for ONE occurrence, degrading to
 * "Sat 22 Aug · 11 AM" when there is no end instant and to "Sat 22 Aug" when
 * there is no start time. Returns NULL — never a fabricated label — when the
 * start instant is unparseable (Constitution #9); callers decide what to say.
 */
export const formatOccurrenceLine = (
  occurrence: OccurrenceDateLike,
  fallbackTimezone: string | null | undefined,
): string | null => {
  const tz =
    typeof occurrence.timezone === "string" && occurrence.timezone.length > 0
      ? occurrence.timezone
      : typeof fallbackTimezone === "string" && fallbackTimezone.length > 0
        ? fallbackTimezone
        : "UTC";
  const day = formatOccurrenceDayLabel(occurrence.startAt, tz);
  if (day === null) return null;
  const { open, close } = formatEventDoorsTimes(
    occurrence.startAt,
    occurrence.endAt,
    tz,
  );
  if (open === null) return day;
  return close === null ? `${day} · ${open}` : `${day} · ${open} – ${close}`;
};

/**
 * "2 dates · first Sat 22 Aug" — the occurrence-backed twin of
 * `formatMultiDateSummary`, word-for-word identical in shape so the two
 * sources of the same sub-line read the same to a guest.
 *
 * Returns null when NO occurrence has a parseable start, so the caller can
 * fall back to the draft formatters (which say "Multi-date (no dates yet)")
 * rather than print a count of days it cannot name.
 */
export const formatOccurrenceSummary = (
  occurrences: readonly OccurrenceDateLike[],
  fallbackTimezone: string | null | undefined,
): string | null => {
  const first = occurrences.find(
    (o) =>
      formatOccurrenceDayLabel(
        o.startAt,
        o.timezone.length > 0 ? o.timezone : (fallbackTimezone ?? "UTC"),
      ) !== null,
  );
  if (first === undefined) return null;
  const firstShort = formatOccurrenceDayLabel(
    first.startAt,
    first.timezone.length > 0 ? first.timezone : (fallbackTimezone ?? "UTC"),
  );
  const n = occurrences.length;
  return `${n} ${n === 1 ? "date" : "dates"} · first ${firstShort}`;
};

/**
 * The event's REAL days, ordered and readable, as display lines.
 *
 * Chronological by measurement, not by trust: the readers already order them
 * (pg_direct_event_checkout_bundle / pg_public_event_by_slug both ORDER BY
 * start_at, id), but a cache, a mock or a future transport must not be able to
 * reorder what a guest reads. Unreadable instants are DROPPED, never guessed.
 *
 * issue #2338 — extracted so `resolvePublicEventDateDisplay` (public page) and
 * `resolveChosenDaysLine` (checkout) share ONE derivation. There is no second
 * copy of this loop anywhere, which is the whole point: three surfaces have now
 * disagreed about the same event's days.
 */
const readableOccurrenceLines = (
  event: EventDateLike,
  occurrences: readonly OccurrenceDateLike[],
): string[] =>
  occurrences
    .map((o) => ({ ms: new Date(o.startAt).getTime(), o }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms)
    .map((x) => formatOccurrenceLine(x.o, event.timezone))
    .filter((line): line is string => line !== null);

/**
 * The eyebrow date block for a PUBLIC event page.
 *
 * REAL DAYS WIN, DRAFT ENTRIES STAY AUTHORITATIVE WHERE THEY EXIST, AND
 * NOTHING ELSE MOVES. The occurrence-backed branch is taken ONLY when all three
 * hold:
 *
 *   1. the event is `multi_date` — a single or recurring event is untouched,
 *   2. it carries NO draft `multiDates` — the organiser's own preview surfaces
 *      still render their draft entries, unchanged,
 *   3. at least one occurrence has a parseable start instant.
 *
 * Miss any one and this returns EXACTLY what `formatDraftDateLine` /
 * `formatDraftDateSubline` / `formatDraftDatesList` returned before #2209 — so
 * a single-date page is byte-identical, and a multi-date event that genuinely
 * has no materialised days still degrades honestly to "Date TBD" +
 * "Multi-date (no dates yet)" instead of inventing a schedule.
 */
export const resolvePublicEventDateDisplay = (
  event: EventDateLike,
  occurrences: readonly OccurrenceDateLike[],
): { dateLine: string; dateSubline: string | null; datesList: string[] } => {
  const draft = {
    dateLine: formatDraftDateLine(event),
    dateSubline: formatDraftDateSubline(event),
    datesList: formatDraftDatesList(event),
  };
  if (event.whenMode !== "multi_date" || event.multiDates !== null) return draft;
  const lines = readableOccurrenceLines(event, occurrences);
  if (lines.length === 0) return draft;
  const subline = formatOccurrenceSummary(occurrences, event.timezone);
  return {
    dateLine: lines[0],
    dateSubline: subline ?? draft.dateSubline,
    datesList: lines,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// issue #2338 — NAMING THE DAYS A GUEST ACTUALLY BOUGHT.
//
// THIRD TIME. #2161: the days were fetched through a reader that could not see
// them. #2209: the days were on the payload and the route never passed them.
// #2338: the days were on the payload AND in the cart, and the confirmation
// screen called `formatDraftDateLine(event)` — which reads `multiDates`, the
// organiser's draft, which the public reader strips — so a guest who had just
// chosen 29 + 30 August read "Date TBD" over their own order.
//
// WHY THE FIX IS HERE AND NOT ON THE SCREEN. #2160 answered the same question
// ("which days did this guest pick?") with a PRIVATE `chosenDayLabel` useMemo
// inside `app/checkout/[eventId]/index.tsx`. That is a fourth date formatter
// living outside the file I-14 makes the single owner of event date display,
// and it is exactly why the confirmation screen could not reuse it: it was not
// reachable. It now lives here, `index.tsx` calls it, and the two steps of one
// checkout cannot word the same day differently.
//
// WHAT THIS CANNOT FIX. The DATA still arrives per-surface: every screen has to
// obtain the occurrence list and the chosen id set for itself. This file owns
// the STRING, not the delivery — see `issue-2338-checkout-day-line-owner.mjs`,
// which is the part that fails when a screen stops being handed the days.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * "Sat 29 Aug + Sun 30 Aug" — the day(s) a guest chose, worded EXACTLY as
 * #2160 worded them on the way into checkout:
 *
 *   1 day    → "Sat 29 Aug"
 *   2 days   → "Sat 29 Aug + Sun 30 Aug"
 *   3+ days  → "3 days · Sat 29 Aug – Mon 31 Aug"
 *
 * Returns NULL — never a fabricated day (Constitution #9) — when nothing was
 * chosen, when no chosen id matches a known occurrence, or when ANY chosen day
 * has an unparseable start instant. A caller that gets null must fall back to
 * the event's own date line; it must not name a day it could not read.
 *
 * Chronological by MEASUREMENT, not by trust — same rule as
 * `resolvePublicEventDateDisplay`: the readers already ORDER BY start_at, but a
 * cache, a mock or a future transport must not be able to reorder what a guest
 * reads.
 */
export const formatChosenDaysLabel = (
  occurrences: readonly OccurrenceDateLike[],
  chosenIds: readonly string[],
  fallbackTimezone?: string | null,
): string | null => {
  if (chosenIds.length === 0) return null;
  const chosen = occurrences
    .filter((o) => chosenIds.includes(o.id))
    .map((o) => ({ ms: new Date(o.startAt).getTime(), o }))
    .sort((a, b) => a.ms - b.ms)
    .map(({ o }) =>
      formatOccurrenceDayLabel(
        o.startAt,
        typeof o.timezone === "string" && o.timezone.length > 0
          ? o.timezone
          : (fallbackTimezone ?? null),
      ),
    );
  if (chosen.length === 0) return null;
  if (chosen.some((label) => label === null)) return null;
  const parts = chosen as string[];
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} + ${parts[1]}`;
  return `${parts.length} days · ${parts[0]} – ${parts[parts.length - 1]}`;
};

/**
 * The date line for a CHECKOUT surface — the cart step and the order summary
 * on the confirmation screen.
 *
 * THE GUEST'S OWN DAYS WIN. Failing that, the event's real days. Failing that,
 * whatever the draft formatters said before #2338 — which is "Date TBD" only
 * when the event genuinely has no readable date at all.
 *
 *   1. `chosenIds` name readable occurrences → those days, in #2160's wording.
 *   2. otherwise → `resolvePublicEventDateDisplay(event, occurrences).dateLine`,
 *      which is the SAME line the public event page shows. For a single or
 *      recurring event, for an event whose draft `multiDates` survived, and for
 *      a multi-date event with no materialised occurrence, that helper returns
 *      `formatDraftDateLine(event)` VERBATIM — so every one of those summaries
 *      is byte-identical to what it printed before this function existed.
 *
 * Step 2 deliberately does NOT claim the guest bought day one: it prints the
 * event's date line, the same string they read on the page they came from, and
 * says nothing about the order. Naming the guest's actual days is step 1's job
 * and step 1 is reached whenever the chosen set survived to the screen.
 */
export const resolveChosenDaysLine = (
  event: EventDateLike,
  occurrences: readonly OccurrenceDateLike[],
  chosenIds: readonly string[],
): string => {
  const chosen = formatChosenDaysLabel(occurrences, chosenIds, event.timezone);
  if (chosen !== null) return chosen;
  // Step 2 is `resolvePublicEventDateDisplay(...).dateLine` BY CONSTRUCTION —
  // the same two branches on the same predicate, over the same shared
  // `readableOccurrenceLines`. It is spelled out rather than delegated for one
  // reason: that helper also computes the sub-line and the full day list, and
  // the recurring sub-line expands the recurrence rule. A checkout screen that
  // used to call only `formatDraftDateLine` must not start evaluating work it
  // never renders — widening what a summary line can throw on is not a fix.
  if (event.whenMode !== "multi_date" || event.multiDates !== null) {
    return formatDraftDateLine(event);
  }
  const lines = readableOccurrenceLines(event, occurrences);
  return lines.length > 0 ? lines[0] : formatDraftDateLine(event);
};
