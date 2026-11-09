/**
 * openingHoursUtils.ts
 *
 * Parses weekday_text strings from Google Places API and computes
 * whether a place is currently open.
 *
 * When `utcOffsetMinutes` is provided (from Google Places API), the
 * check uses the venue's actual local time. When absent (legacy cards),
 * falls back to device local time — correct when user and venue share
 * a timezone (the common case for Mingla's location-based experience).
 *
 * The stale `open_now` / `isOpenNow` field from Google is completely
 * ignored — this utility is the single source of truth for open/closed.
 */

type Meridiem = 'AM' | 'PM';

/**
 * Parse a time string like "9:00 AM" into minutes since midnight.
 * Google weekday descriptions sometimes omit the first meridiem in ranges
 * such as "10:00 - 5:00 PM" or "5:00 - 10:00 PM"; callers may pass an
 * inferred period for that first endpoint.
 */
function parseTimeToMinutes(timeStr: string, inferredPeriod?: Meridiem | null): number | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = (match[3]?.toUpperCase() ?? inferredPeriod ?? null) as Meridiem | null;
  if (!period) return null;
  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;
  return hours * 60 + minutes;
}

function explicitMeridiem(timeStr: string): Meridiem | null {
  const match = timeStr.trim().match(/\b(AM|PM)$/i);
  return match ? (match[1].toUpperCase() as Meridiem) : null;
}

function clockHour(timeStr: string): number | null {
  const match = timeStr.trim().match(/^(\d{1,2}):\d{2}/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  return Number.isFinite(hour) && hour >= 1 && hour <= 12 ? hour : null;
}

function inferOpenPeriod(openPart: string, closePart: string): Meridiem | null {
  if (explicitMeridiem(openPart)) return null;

  const closePeriod = explicitMeridiem(closePart);
  const openHour = clockHour(openPart);
  const closeHour = clockHour(closePart);
  if (!closePeriod || openHour == null || closeHour == null) return null;

  if (closePeriod === 'PM') {
    if (openHour === 12) return 'PM';
    // Noon-close shorthand ("9:00 - 12:00 PM") means the opening hour is AM,
    // not an overnight 9 PM -> noon range.
    if (closeHour === 12) return 'AM';
    // Google commonly writes "10:00 - 5:00 PM" for 10 AM to 5 PM, while
    // "5:00 - 10:00 PM" means an evening range.
    return openHour > closeHour ? 'AM' : 'PM';
  }

  // Morning close with an omitted opening meridiem is usually an overnight
  // range, e.g. "9:00 - 1:00 AM". If the hours don't imply overnight, keep it
  // as same-morning.
  if (openHour === 12) return 'AM';
  return openHour > closeHour ? 'PM' : 'AM';
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Determines if a place is currently open by parsing weekday_text lines.
 *
 * Handles these known formats from Google:
 *   "Monday: 9:00 AM – 10:00 PM"
 *   "Monday: 9:00 AM – 12:00 AM"  (crosses midnight)
 *   "Monday: Open 24 hours"
 *   "Monday: Closed"
 *   "Monday: 11:00 AM – 2:00 PM, 5:00 PM – 10:00 PM"  (multiple ranges)
 *
 * @returns true (open), false (closed), or null (cannot determine)
 */
// RELIABILITY: isPlaceOpenAt checks a SPECIFIC datetime, not the current time.
// Schedule validation MUST use isPlaceOpenAt(hours, selectedDateTime) — checking
// current time would wrongly block scheduling for a future open time, or allow
// scheduling for a time when the place is closed.
/**
 * Checks if a place is open at a specific date/time.
 * Returns true (open), false (closed), or null (cannot determine — no hours data).
 *
 * #4347 wave 3 follow-up — ONE overnight-hours model. This is the yes/no
 * projection of `getOpenStatusAt`: the same day parser (`parseDayRanges`), the
 * same venue clock and the same merged intervals. So an overnight range is
 * attributed to the night it starts on: "Saturday: 6:00 PM – 2:00 AM" is open
 * at Sunday 01:00 (Saturday night still running) and a Friday 01:00 is decided
 * by THURSDAY's line, not Friday's evening range. Before this, the schedule
 * check read only the arrival day's own line and refused a 01:00 arrival the
 * sheet showed as "Open until 2am".
 *
 * Unknown stays unknown: no line (or no readable range) for the target day →
 * null. One difference from `getOpenStatusAt`, on purpose: an unreadable or
 * missing PREVIOUS day only means "no carry-over from last night" here, not
 * "unknown", so a record that lists only the target day still gets a verdict
 * (the schedule safety check has always decided those).
 */
export function isPlaceOpenAt(
  weekdayText: string[] | undefined | null,
  targetDate: Date,
  utcOffsetMinutes?: number | null,
): boolean | null {
  if (!weekdayText || weekdayText.length === 0) return null;
  const { day, now } = venueClock(targetDate, utcOffsetMinutes);
  const built = openIntervalsAround(weekdayText, day, false);
  if (built === null) return null;
  return built.merged.some(([open, close]) => open <= now && now < close);
}

/**
 * #4347 wave 1 — the deck card's open-status fact: "Open until 11pm",
 * "Closes in 30 min", "Opens 9am". Same parser as `isPlaceOpenAt`, but it
 * answers WHEN, not just whether.
 *
 *   { kind: 'open', closesAtMinute, minutesLeft }  open, more than the
 *                                                  closing-soon window left
 *   { kind: 'closing', closesAtMinute, minutesLeft } open, closes inside it
 *   { kind: 'open24h' }                            open round the clock
 *   { kind: 'closed', opensAtMinute, opensDayOffset } next opening, if any
 *   { kind: 'closed', opensAtMinute: null, ... }   closed, no opening in 7 days
 *   null                                           hours unknown: show nothing
 *
 * Minutes are venue-local minutes of the day (0..1439). `opensDayOffset` is 0
 * for later today, 1 for tomorrow, and so on. Never fabricated: any day the
 * parser cannot read makes the whole answer null rather than a guess.
 */
export type OpenStatus =
  | { kind: 'open' | 'closing'; closesAtMinute: number; minutesLeft: number }
  | { kind: 'open24h' }
  | { kind: 'closed'; opensAtMinute: number | null; opensDayOffset: number | null };

interface DayRanges {
  readonly allDay: boolean;
  readonly ranges: ReadonlyArray<readonly [number, number]>;
}

function parseDayRanges(weekdayText: readonly string[], dayIndex: number): DayRanges | null {
  const dayName = DAY_NAMES[((dayIndex % 7) + 7) % 7].toLowerCase();
  const line = weekdayText.find((entry) => {
    const colon = entry.indexOf(':');
    return colon !== -1 && entry.substring(0, colon).trim().toLowerCase() === dayName;
  });
  if (!line) return null;
  const hours = line.substring(line.indexOf(':') + 1).trim();
  if (!hours) return null;
  if (/^closed$/i.test(hours)) return { allDay: false, ranges: [] };
  if (/^open\s+24\s+hours?$/i.test(hours)) return { allDay: true, ranges: [[0, 1440]] };
  const ranges: Array<readonly [number, number]> = [];
  for (const range of hours.split(/,\s*/)) {
    const parts = range.split(/\s+[–\-]\s+/);
    if (parts.length !== 2) continue;
    const open = parseTimeToMinutes(parts[0], inferOpenPeriod(parts[0], parts[1]));
    const close = parseTimeToMinutes(parts[1]);
    if (open === null || close === null) continue;
    ranges.push([open, close <= open ? close + 1440 : close]);
  }
  return ranges.length > 0 ? { allDay: false, ranges } : null;
}

/** Venue-local day of week and minute of day for `targetDate`. */
function venueClock(targetDate: Date, utcOffsetMinutes?: number | null): { day: number; now: number } {
  if (utcOffsetMinutes != null) {
    const local = new Date(targetDate.getTime() + utcOffsetMinutes * 60_000);
    return { day: local.getUTCDay(), now: local.getUTCHours() * 60 + local.getUTCMinutes() };
  }
  return { day: targetDate.getDay(), now: targetDate.getHours() * 60 + targetDate.getMinutes() };
}

/**
 * Every opening from yesterday (an overnight range still running) through
 * seven days ahead, as merged absolute minutes from the start of today. null
 * when today's line is unreadable — or yesterday's, when `yesterdayRequired`.
 */
function openIntervalsAround(
  weekdayText: readonly string[],
  day: number,
  yesterdayRequired: boolean,
): { merged: Array<[number, number]>; allDayToday: boolean } | null {
  const intervals: Array<[number, number]> = [];
  let allDayToday = false;
  for (let offset = -1; offset <= 7; offset += 1) {
    const parsed = parseDayRanges(weekdayText, day + offset);
    if (parsed === null) {
      // Today (and, for the status line, yesterday) must be readable; a later
      // unreadable day only limits how far ahead "Opens …" can look.
      if (offset === 0 || (offset === -1 && yesterdayRequired)) return null;
      continue;
    }
    if (offset === 0 && parsed.allDay) allDayToday = true;
    for (const [open, close] of parsed.ranges) {
      intervals.push([open + offset * 1440, close + offset * 1440]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  // Merge touching ranges so "Open 24 hours" next to an overnight range reads
  // as one long opening, not a close at midnight.
  const merged: Array<[number, number]> = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([interval[0], interval[1]]);
  }
  return { merged, allDayToday };
}

export function getOpenStatusAt(
  weekdayText: readonly string[] | undefined | null,
  targetDate: Date,
  utcOffsetMinutes?: number | null,
  closingSoonMinutes = 60,
): OpenStatus | null {
  if (!weekdayText || weekdayText.length === 0) return null;
  const { day, now } = venueClock(targetDate, utcOffsetMinutes);
  const built = openIntervalsAround(weekdayText, day, true);
  if (built === null) return null;
  const { merged, allDayToday } = built;

  const current = merged.find(([open, close]) => open <= now && now < close);
  if (current) {
    const minutesLeft = current[1] - now;
    if (allDayToday && minutesLeft >= 1440) return { kind: 'open24h' };
    return {
      kind: minutesLeft <= closingSoonMinutes ? 'closing' : 'open',
      closesAtMinute: ((current[1] % 1440) + 1440) % 1440,
      minutesLeft,
    };
  }
  const next = merged.find(([open]) => open > now);
  if (!next) return { kind: 'closed', opensAtMinute: null, opensDayOffset: null };
  return {
    kind: 'closed',
    opensAtMinute: ((next[0] % 1440) + 1440) % 1440,
    opensDayOffset: Math.floor(next[0] / 1440),
  };
}

/**
 * Backward-compatible wrapper — checks if a place is open right now.
 */
export function isPlaceOpenNow(
  weekdayText: string[] | undefined | null,
  utcOffsetMinutes?: number | null,
): boolean | null {
  return isPlaceOpenAt(weekdayText, new Date(), utcOffsetMinutes);
}

/**
 * Extracts a weekday_text string array from any of the openingHours shapes
 * used across the codebase (Recommendation, CuratedStop, etc.)
 *
 * Supported shapes:
 *   - string[]  (weekday_text directly)
 *   - { weekday_text: string[] }
 *   - { lines: string[] }  (parsed format from ActionButtons/ProposeDateTimeModal)
 *   - Record<string, string>  (curated stop format: { monday: "9:00 AM – 10:00 PM" })
 *   - JSON string (possibly double-encoded)
 *   - null / undefined
 */
export function extractWeekdayText(
  openingHours:
    | string
    | { open_now?: boolean; weekday_text?: string[] }
    | {
        // [ORCH-0649] Google Places v1 — 85.6% of place_pool rows as of 2026-04-23.
        openNow?: boolean;
        periods?: unknown[];
        nextOpenTime?: string;
        nextCloseTime?: string;
        weekdayDescriptions?: string[];
      }
    | { lines?: string[] }
    | Record<string, string>
    | string[]
    | null
    | undefined
): string[] | null {
  if (openingHours == null) return null;

  // Array of strings — check if they look like weekday_text
  if (Array.isArray(openingHours)) {
    if (openingHours.length === 0) return null;
    // Check if first element contains a day name followed by ":"
    if (typeof openingHours[0] === 'string' && hasDayPrefix(openingHours[0])) {
      return openingHours as string[];
    }
    return null;
  }

  // Object with weekday_text array
  if (typeof openingHours === 'object') {
    const obj = openingHours as Record<string, unknown>;

    if (Array.isArray(obj.weekday_text) && obj.weekday_text.length > 0) {
      // [CRITICAL — ORCH-0649] Defensive guard for the deckService.ts:184-187
      // pre-fix shape mismatch. Pre-OTA clients persisted weekday_text arrays
      // whose entries were Object.entries() of Google v1 (PascalCase keys).
      // If we detect this pattern, return null so the consumer hides the
      // section instead of rendering "OpenNow: false" / "Periods: [object Object]"
      // raw. The SQL backfill (orch_0649_backfill_saved_card_opening_hours)
      // is the durable fix; this guard handles any cached row that escapes.
      const looksBroken = (obj.weekday_text as string[]).some((line) =>
        typeof line === 'string' && (
          line.startsWith('OpenNow:') ||
          line.startsWith('Periods:') ||
          line.startsWith('NextOpenTime:') ||
          line.startsWith('NextCloseTime:') ||
          line.startsWith('WeekdayDescriptions:')
        )
      );
      if (looksBroken) return null;
      return obj.weekday_text as string[];
    }

    // Google Places v1 API format (camelCase)
    if (Array.isArray(obj.weekdayDescriptions) && obj.weekdayDescriptions.length > 0) {
      return obj.weekdayDescriptions as string[];
    }

    if ('lines' in obj && Array.isArray(obj.lines) && obj.lines.length > 0) {
      const lines = obj.lines as string[];
      if (typeof lines[0] === 'string' && hasDayPrefix(lines[0])) {
        return lines;
      }
      return null;
    }

    // Record<string, string> where keys are day names (curated stop format)
    if (isDayNameRecord(obj)) {
      return dayRecordToWeekdayText(obj as Record<string, string>);
    }

    return null;
  }

  // JSON string — try to parse (up to 2 attempts for double-encoding)
  if (typeof openingHours === 'string') {
    const trimmed = openingHours.trim();
    if (trimmed === '' || trimmed === '""') return null;

    let value: unknown = openingHours;
    let attempts = 0;
    while (typeof value === 'string' && attempts < 2) {
      try {
        value = JSON.parse(value);
        attempts++;
      } catch {
        break;
      }
    }

    // If parsing produced a non-string, recurse with the parsed value
    if (typeof value !== 'string') {
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return extractWeekdayText(value as string[] | Record<string, string>);
      }
      return null;
    }

    // Plain string with newlines or semicolons
    const lines = value.split(/\n|;/).map((s) => s.trim()).filter((s) => s.length > 0);
    if (lines.length > 0 && hasDayPrefix(lines[0])) {
      return lines;
    }

    return null;
  }

  return null;
}

/** Check if a string starts with a day name followed by ":" */
function hasDayPrefix(str: string): boolean {
  const lower = str.toLowerCase();
  return DAY_NAMES.some((day) => lower.startsWith(day.toLowerCase() + ':'));
}

/** Check if an object has lowercase day-name keys */
function isDayNameRecord(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  const dayNamesLower = DAY_NAMES.map((d) => d.toLowerCase());
  return keys.some((key) => dayNamesLower.includes(key.toLowerCase()));
}

/** Convert { monday: "9:00 AM – 10:00 PM" } to ["Monday: 9:00 AM – 10:00 PM"] */
function dayRecordToWeekdayText(record: Record<string, string>): string[] | null {
  const dayNamesLower = DAY_NAMES.map((d) => d.toLowerCase());
  const result: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const idx = dayNamesLower.indexOf(key.toLowerCase());
    if (idx !== -1 && typeof value === 'string') {
      result.push(`${DAY_NAMES[idx]}: ${value}`);
    }
  }
  return result.length > 0 ? result : null;
}
