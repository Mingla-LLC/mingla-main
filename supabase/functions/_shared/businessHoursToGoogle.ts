// ─────────────────────────────────────────────────────────────────────────────
// businessHoursToGoogle.ts — ORCH-1068 [business-authored venues render on deck]
//
// Single source of truth for converting the Mingla business-wizard hours ARRAY
// shape into the canonical Google Places v1 regularOpeningHours OBJECT shape that
// every consumer hours reader (discover-cards filterByDateTime, curatedStopHours,
// generate-curated-experiences, personHeroCards) already understands.
//
// WHY: the business authoring pipeline persists `place_pool.opening_hours` as a
// top-level array `[{weekday,isClosed,openTime,closeTime}]` (BrandHourEntry —
// `mingla-business/src/types/brand.ts:336`, `venueBrandHours.ts:2`), whereas the
// consumer deck reads the Google object `{periods:[{open:{day,hour,minute},…}],…}`.
// An array satisfies neither `.periods` nor the lowercase-day text keys, so the
// venue is treated as "no hours" → excluded from the open-now filter
// (INVESTIGATION F-1). This converter normalizes-at-write + powers the backfill +
// is the defensive reader's safety net.
//
// CRITICAL weekday translation (INVESTIGATION F-2, LOCKED): business `weekday` is
// 0=Monday…6=Sunday; Google `day` is 0=Sunday…6=Saturday. day = (weekday + 1) % 7.
//
// External docs (COMMS-0003):
//  - Google Places v1 OpeningHours / periods / Point.day (0=Sunday):
//    https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#openinghours
//    https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#point
//    ("day: A number from 0–6, corresponding to the days of the week, starting on
//     Sunday. 0 is Sunday." hour 0–23, minute 0–59.)
// ─────────────────────────────────────────────────────────────────────────────

/** Input: the business wizard array shape (BrandHourEntry-like). */
export interface BusinessHourRow {
  /** 0 = Monday … 6 = Sunday (Mingla business convention — brand.ts:336). */
  weekday: number;
  isClosed?: boolean;
  /** "HH:MM" or "HH:MM:SS"; null/empty when closed. */
  openTime?: string | null;
  closeTime?: string | null;
}

/** Output: the canonical Google Places v1 regularOpeningHours subset the deck reads. */
export interface GoogleOpeningHours {
  /** Always null — open-now is computed downstream per the user's tz/time
   *  (Constitution #12: never bake a stale boolean). */
  openNow: boolean | null;
  periods: Array<{
    open: { day: number; hour: number; minute: number };
    close: { day: number; hour: number; minute: number };
  }>;
  /** Human strings in Mon→Sun order ("Monday: 7:00 AM – 8:00 PM" / "Sunday: Closed").
   *  Display-only; never parsed by the open-hours gate. */
  weekdayDescriptions: string[];
}

const DAY_LABELS_MON_FIRST = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

/** 0=Mon..6=Sun (business) → 0=Sun..6=Sat (Google). day = (weekday + 1) % 7.
 *  (INVESTIGATION F-2 — non-negotiable.) */
export function businessWeekdayToGoogleDay(weekday: number): number {
  return ((Math.trunc(weekday) % 7) + 8) % 7; // tolerant of any int; ((w%7)+1)%7 == ((w%7)+8)%7
}

/** "HH:MM[:SS]" → {hour, minute}; returns null on unparseable/empty. */
export function parseHm(t: string | null | undefined): { hour: number; minute: number } | null {
  if (typeof t !== 'string') return null;
  const trimmed = t.trim();
  if (trimmed === '') return null;
  const m = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** True iff value is the business array shape (an Array whose elements look like
 *  BrandHourEntry — at least one object carrying a numeric `weekday`). An empty
 *  array is treated as a business array (it normalizes to periods:[] = always
 *  closed / no data), but a Google object is NOT an array → false (pass-through). */
export function isBusinessHoursArray(value: unknown): value is BusinessHourRow[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  return value.every(
    (row) =>
      row !== null &&
      typeof row === 'object' &&
      typeof (row as { weekday?: unknown }).weekday === 'number',
  );
}

function formatHm12(hm: { hour: number; minute: number }): string {
  const ampm = hm.hour < 12 ? 'AM' : 'PM';
  let h12 = hm.hour % 12;
  if (h12 === 0) h12 = 12;
  const mm = hm.minute.toString().padStart(2, '0');
  return `${h12}:${mm} ${ampm}`;
}

/**
 * Convert the business hours array → Google v1 GoogleOpeningHours.
 *
 * LOCKED rules (SPEC §4.1):
 *  - `day = (weekday + 1) % 7` (F-2).
 *  - An `isClosed:true` row contributes NO period (absence = closed, matching Google).
 *  - Rows with unparseable open/close times are skipped (no period).
 *  - `openNow` is always null (computed downstream per user tz).
 *  - Overnight (`close <= open`, e.g. 18:00→02:00): one period with
 *    `open.day = googleDay`, `close.day = (googleDay + 1) % 7`, close.hour/minute
 *    from closeTime. The deck's evalPeriods already does `closeH += 24` when
 *    `closeH <= openH` and matches a period by its `open.day`, so this is compatible.
 *  - Same-day range: `close.day === open.day`.
 *  - `weekdayDescriptions`: 7 strings in Mon→Sun order (display-only).
 *  - periods === [] when every row is closed/unparseable.
 */
export function businessHoursToGoogleOpeningHours(rows: BusinessHourRow[]): GoogleOpeningHours {
  const periods: GoogleOpeningHours['periods'] = [];
  // Build a Mon→Sun lookup for the human descriptions (last row wins per weekday).
  const descByWeekday = new Map<number, string>();

  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.weekday !== 'number') continue;
    const weekday = ((Math.trunc(row.weekday) % 7) + 7) % 7; // clamp to 0..6 (Mon..Sun)

    if (row.isClosed) {
      descByWeekday.set(weekday, `${DAY_LABELS_MON_FIRST[weekday]}: Closed`);
      continue;
    }

    const open = parseHm(row.openTime);
    const close = parseHm(row.closeTime);
    if (!open || !close) {
      // No usable time → contributes no period; describe as Closed for honesty.
      if (!descByWeekday.has(weekday)) {
        descByWeekday.set(weekday, `${DAY_LABELS_MON_FIRST[weekday]}: Closed`);
      }
      continue;
    }

    const googleDay = businessWeekdayToGoogleDay(weekday);
    // Overnight iff close is at-or-before open in same-day terms (e.g. 18:00→02:00,
    // or 09:00→09:00 treated as a 24h wrap). Equal times → treat as overnight wrap
    // so a full-day "09:00–09:00" doesn't collapse to a zero-length period.
    const openMinutes = open.hour * 60 + open.minute;
    const closeMinutes = close.hour * 60 + close.minute;
    const isOvernight = closeMinutes <= openMinutes;
    const closeDay = isOvernight ? (googleDay + 1) % 7 : googleDay;

    periods.push({
      open: { day: googleDay, hour: open.hour, minute: open.minute },
      close: { day: closeDay, hour: close.hour, minute: close.minute },
    });
    descByWeekday.set(
      weekday,
      `${DAY_LABELS_MON_FIRST[weekday]}: ${formatHm12(open)} – ${formatHm12(close)}`,
    );
  }

  const weekdayDescriptions: string[] = [];
  for (let w = 0; w < 7; w++) {
    weekdayDescriptions.push(descByWeekday.get(w) ?? `${DAY_LABELS_MON_FIRST[w]}: Closed`);
  }

  return { openNow: null, periods, weekdayDescriptions };
}

/**
 * Normalize whatever the authoring wizard handed us into the canonical Google
 * object for the `place_pool.opening_hours` write (SPEC §4.2):
 *  - null/undefined           → null (unchanged).
 *  - business array shape      → businessHoursToGoogleOpeningHours(...).
 *  - already a Google object   → pass through unchanged (claim-existing rows).
 *  - any other shape           → null (defensive; logged by caller).
 */
export function normalizeBusinessHoursForPool(input: unknown): GoogleOpeningHours | null {
  if (input === null || input === undefined) return null;
  if (isBusinessHoursArray(input)) {
    return businessHoursToGoogleOpeningHours(input);
  }
  if (typeof input === 'object' && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.periods)) {
      // Already Google-shaped — pass through unchanged.
      return input as unknown as GoogleOpeningHours;
    }
  }
  return null;
}
