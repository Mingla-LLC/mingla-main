/**
 * Recurrence-rule helpers — preset → display label, expansion to dates,
 * RFC 5545 RRULE string emitter, weekday helpers.
 *
 * Per Cycle 4 spec §3.4.
 *
 * The RFC 5545 emit (`recurrenceRuleToRfc5545`) is unused in Cycle 4
 * (frontend-only — DEC-071) but exported so Cycle 9 backend integration
 * is one import away. [TRANSITIONAL] consumed by Cycle 9 publish edge fn.
 */

import type {
  RecurrenceRule,
  Weekday,
  SetPos,
} from "../store/draftEventStore";

const WEEKDAY_ORDER: ReadonlyArray<Weekday> = [
  "SU", "MO", "TU", "WE", "TH", "FR", "SA",
] as const;

const WEEKDAY_LONG: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

const SETPOS_LABEL: Record<SetPos, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
  [-1]: "last",
};

const ORDINAL_DOM = (n: number): string => {
  if (n >= 11 && n <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
};

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

/** Returns the weekday code (MO/TU/...) for an ISO YYYY-MM-DD date. */
export const weekdayOfIso = (iso: string): Weekday => {
  const d = parseIso(iso);
  const idx = d.getDay(); // 0=Sunday..6=Saturday
  return WEEKDAY_ORDER[idx];
};

/** Long human label for a weekday code. Used in error messages. */
export const formatWeekdayLong = (w: Weekday): string => WEEKDAY_LONG[w];

/** "1st", "2nd", "last" — for monthly_dow display. */
export const formatSetPos = (p: SetPos): string => SETPOS_LABEL[p];

/** "1st", "15th" — for monthly_dom display. */
export const formatDayOfMonth = (n: number): string => ORDINAL_DOM(n);

/**
 * Display label per preset. Examples:
 *   daily               → "Every day"
 *   weekly + MO         → "Every Monday"
 *   biweekly + MO       → "Every other Monday"
 *   monthly_dom + 15    → "Monthly on the 15th"
 *   monthly_dow + 1·MO  → "Monthly on the 1st Monday"
 *
 * `firstDate` is unused for label purposes today but reserved for future
 * "starting {date}" suffixing.
 */
export const formatRecurrenceLabel = (
  rule: RecurrenceRule,
  _firstDate: string,
): string => {
  switch (rule.preset) {
    case "daily":
      return "Every day";
    case "weekly":
      return rule.byDay !== undefined
        ? `Every ${formatWeekdayLong(rule.byDay)}`
        : "Weekly";
    case "biweekly":
      return rule.byDay !== undefined
        ? `Every other ${formatWeekdayLong(rule.byDay)}`
        : "Every 2 weeks";
    case "monthly_dom":
      return rule.byMonthDay !== undefined
        ? `Monthly on the ${formatDayOfMonth(rule.byMonthDay)}`
        : "Monthly (by day)";
    case "monthly_dow":
      return rule.byDay !== undefined && rule.bySetPos !== undefined
        ? `Monthly on the ${formatSetPos(rule.bySetPos)} ${formatWeekdayLong(rule.byDay)}`
        : "Monthly (by weekday)";
  }
};

/**
 * Termination summary. "4 occurrences" or "Until 31 Aug 2026".
 */
export const formatTermination = (rule: RecurrenceRule): string => {
  if (rule.termination.kind === "count") {
    const n = rule.termination.count;
    return n === 1 ? "1 occurrence" : `${n} occurrences`;
  }
  const d = parseIso(rule.termination.until);
  return `Until ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
};

const matchesPreset = (
  date: Date,
  rule: RecurrenceRule,
  firstDate: Date,
): boolean => {
  switch (rule.preset) {
    case "daily":
      return true;
    case "weekly":
    case "biweekly": {
      if (rule.byDay === undefined) return false;
      const targetDow = WEEKDAY_ORDER.indexOf(rule.byDay);
      if (date.getDay() !== targetDow) return false;
      if (rule.preset === "weekly") return true;
      // biweekly: only every other week from firstDate.
      const diffDays = Math.round(
        (date.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const weeks = Math.round(diffDays / 7);
      return weeks % 2 === 0;
    }
    case "monthly_dom": {
      if (rule.byMonthDay === undefined) return false;
      return date.getDate() === rule.byMonthDay;
    }
    case "monthly_dow": {
      if (rule.byDay === undefined || rule.bySetPos === undefined) return false;
      const targetDow = WEEKDAY_ORDER.indexOf(rule.byDay);
      if (date.getDay() !== targetDow) return false;
      // Find which occurrence of this weekday in the month this is.
      const dayOfMonth = date.getDate();
      const occurrenceIdx = Math.ceil(dayOfMonth / 7); // 1..5
      if (rule.bySetPos === -1) {
        // Last occurrence of this weekday in the month.
        const next = new Date(date);
        next.setDate(date.getDate() + 7);
        return next.getMonth() !== date.getMonth();
      }
      return occurrenceIdx === rule.bySetPos;
    }
  }
};

const HARD_CAP = 52;

/**
 * Expand a recurrence rule starting from firstDate to a Date[]. Capped
 * at 52 occurrences (matches recurrence.count max).
 *
 * The first emitted date IS firstDate (assumed to satisfy the rule —
 * validator enforces this with the `recurrence.dayMismatch` check).
 */
export const expandRecurrenceToDates = (
  rule: RecurrenceRule,
  firstDate: string,
): Date[] => {
  const start = parseIso(firstDate);
  const out: Date[] = [];

  // Termination caps
  const maxCount =
    rule.termination.kind === "count"
      ? Math.min(rule.termination.count, HARD_CAP)
      : HARD_CAP;
  const untilDate =
    rule.termination.kind === "until"
      ? parseIso(rule.termination.until)
      : null;

  // Walk forward day-by-day (cheap on bounded sets) checking match.
  // Always emit firstDate as occurrence 1 (validator already guarantees match).
  out.push(new Date(start));
  if (out.length >= maxCount) return out;

  // For daily: just emit consecutive days. For others: walk forward
  // testing each calendar day.
  const cursor = new Date(start);
  // Safety: prevent runaway loop even with bad input — cap at 5 years of days.
  let safety = 365 * 5;
  while (safety-- > 0 && out.length < maxCount) {
    cursor.setDate(cursor.getDate() + 1);
    if (untilDate !== null && cursor > untilDate) break;
    if (matchesPreset(cursor, rule, start)) {
      out.push(new Date(cursor));
    }
  }
  return out;
};

/**
 * Convert RecurrenceRule to RFC 5545 RRULE string.
 *
 * [TRANSITIONAL] consumed by Cycle 9 publish edge function. Unused in
 * Cycle 4 — kept exported so Cycle 9 backend wires up cleanly.
 *
 * Format:
 *   daily       → "FREQ=DAILY;COUNT=N" or "FREQ=DAILY;UNTIL=YYYYMMDDT000000Z"
 *   weekly      → "FREQ=WEEKLY;BYDAY=MO;COUNT=N"
 *   biweekly    → "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=N"
 *   monthly_dom → "FREQ=MONTHLY;BYMONTHDAY=15;COUNT=N"
 *   monthly_dow → "FREQ=MONTHLY;BYDAY=1MO;COUNT=N" (with BYSETPOS prefix in BYDAY)
 */
export const recurrenceRuleToRfc5545 = (
  rule: RecurrenceRule,
  _firstDate: string,
): string => {
  const parts: string[] = [];
  switch (rule.preset) {
    case "daily":
      parts.push("FREQ=DAILY");
      break;
    case "weekly":
      parts.push("FREQ=WEEKLY");
      if (rule.byDay !== undefined) parts.push(`BYDAY=${rule.byDay}`);
      break;
    case "biweekly":
      parts.push("FREQ=WEEKLY", "INTERVAL=2");
      if (rule.byDay !== undefined) parts.push(`BYDAY=${rule.byDay}`);
      break;
    case "monthly_dom":
      parts.push("FREQ=MONTHLY");
      if (rule.byMonthDay !== undefined) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
      break;
    case "monthly_dow":
      parts.push("FREQ=MONTHLY");
      if (rule.byDay !== undefined && rule.bySetPos !== undefined) {
        // RFC 5545 BYDAY accepts a numeric prefix: "1MO" = first Monday,
        // "-1FR" = last Friday.
        parts.push(`BYDAY=${rule.bySetPos}${rule.byDay}`);
      }
      break;
  }
  if (rule.termination.kind === "count") {
    parts.push(`COUNT=${rule.termination.count}`);
  } else {
    // RFC 5545 UNTIL: YYYYMMDDTHHMMSSZ — use end-of-day UTC for inclusive semantics.
    const u = rule.termination.until.replaceAll("-", "");
    parts.push(`UNTIL=${u}T235959Z`);
  }
  return parts.join(";");
};

// Suppress unused import warning for symbols only used as types.
void toIso;
