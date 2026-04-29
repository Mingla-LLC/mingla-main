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

/**
 * Parse a time string like "9:00 AM" into minutes since midnight.
 * Returns null if the string cannot be parsed.
 */
function parseTimeToMinutes(timeStr: string): number | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;
  return hours * 60 + minutes;
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
 */
export function isPlaceOpenAt(
  weekdayText: string[] | undefined | null,
  targetDate: Date,
  utcOffsetMinutes?: number | null,
): boolean | null {
  if (!weekdayText || weekdayText.length === 0) return null;

  // When venue timezone offset is known, shift targetDate to venue local time.
  // Otherwise use targetDate as-is (device local time).
  let checkDate: Date;
  if (utcOffsetMinutes != null) {
    const utcMs = targetDate.getTime();
    const venueMs = utcMs + utcOffsetMinutes * 60_000;
    checkDate = new Date(venueMs);
    // Use UTC methods since we manually shifted to venue time
  } else {
    checkDate = targetDate;
  }

  const dayName = utcOffsetMinutes != null
    ? DAY_NAMES[checkDate.getUTCDay()]
    : DAY_NAMES[checkDate.getDay()];

  // Find the matching day's line (case-insensitive match on the day prefix before the colon)
  const dayLine = weekdayText.find((line) => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return false;
    return line.substring(0, colonIdx).trim().toLowerCase() === dayName.toLowerCase();
  });

  if (!dayLine) return null;

  // Extract hours portion (everything after the first ": ")
  const colonIdx = dayLine.indexOf(':');
  const hoursPortion = dayLine.substring(colonIdx + 1).trim();

  if (!hoursPortion) return null;

  // Special cases
  if (/^closed$/i.test(hoursPortion)) return false;
  if (/^open\s+24\s+hours?$/i.test(hoursPortion)) return true;

  // Split by ", " for multiple ranges (e.g. "11:00 AM – 2:00 PM, 5:00 PM – 10:00 PM")
  const ranges = hoursPortion.split(/,\s*/);
  const checkMinutes = utcOffsetMinutes != null
    ? checkDate.getUTCHours() * 60 + checkDate.getUTCMinutes()
    : checkDate.getHours() * 60 + checkDate.getMinutes();

  let allRangesFailedToParse = true;

  for (const range of ranges) {
    // Split by en-dash with spaces, or regular dash with spaces
    const parts = range.split(/\s+[–\-]\s+/);
    if (parts.length !== 2) continue;

    const openMinutes = parseTimeToMinutes(parts[0]);
    const closeMinutes = parseTimeToMinutes(parts[1]);

    if (openMinutes === null || closeMinutes === null) continue;

    allRangesFailedToParse = false;

    if (closeMinutes <= openMinutes) {
      // Crosses midnight: e.g. 8:00 PM – 2:00 AM
      if (checkMinutes >= openMinutes || checkMinutes < closeMinutes) {
        return true;
      }
    } else {
      // Normal range: e.g. 9:00 AM – 10:00 PM
      if (checkMinutes >= openMinutes && checkMinutes < closeMinutes) {
        return true;
      }
    }
  }

  // If every range failed to parse, we can't determine status
  if (allRangesFailedToParse) return null;

  // Parsed at least one range but none matched → closed
  return false;
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
