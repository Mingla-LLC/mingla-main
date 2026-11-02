/**
 * Issue #3355 P8 — trip date parsing only.
 *
 * This module used to build a `create_trip` call that agent-chat placed in
 * the loop's read-only pre-pass, where a write can never run (audit D-16:
 * the model saw "create_trip is unavailable" and improvised). Trips are now
 * created by the flow engine's create_trip flow (ariFlows/offerings/trip.ts)
 * behind the owner's confirmation; with the engine off the model proposes
 * `create_trip` itself. What stays here is the parser that flow uses.
 *
 * Calendar days are plain `YYYY-MM-DD` values: a trip runs from the first
 * day to the last day, whatever the time zone (stored like the Host wizard,
 * calendarDate.ts).
 */

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH =
  "(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\\.?";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
const YEAR = "(?:,?\\s+(20\\d{2}))?";
const TO = "\\s*(?:to|until|till|through|thru|-|–|—)\\s*";

function monthOf(word: string | undefined): number | null {
  if (!word) return null;
  return MONTHS[word.replace(".", "").toLowerCase()] ?? null;
}

/** `YYYY-MM-DD`, or null when the day does not exist (31 Feb). */
export function isoCalendarDate(
  year: number,
  month: number,
  day: number,
): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${
    String(day).padStart(2, "0")
  }`;
}

type Parts = {
  startDay: number;
  startMonth: number;
  endDay: number;
  endMonth: number;
  startYear: number | null;
  endYear: number | null;
};

function rangeParts(text: string): Parts | null {
  // "8 to 10 January [2027]", "8–10 Jan"
  let m = new RegExp(`\\b${DAY}${TO}${DAY}\\s+${MONTH}${YEAR}\\b`, "i")
    .exec(text);
  if (m) {
    const month = monthOf(m[3]);
    if (month) {
      return {
        startDay: Number(m[1]),
        startMonth: month,
        endDay: Number(m[2]),
        endMonth: month,
        startYear: null,
        endYear: m[4] ? Number(m[4]) : null,
      };
    }
  }
  // "30 December [2026] to 2 January [2027]"
  m = new RegExp(
    `\\b${DAY}\\s+${MONTH}(?:,?\\s+(20\\d{2}))?${TO}${DAY}\\s+${MONTH}${YEAR}\\b`,
    "i",
  ).exec(text);
  if (m) {
    const startMonth = monthOf(m[2]);
    const endMonth = monthOf(m[5]);
    if (startMonth && endMonth) {
      return {
        startDay: Number(m[1]),
        startMonth,
        endDay: Number(m[4]),
        endMonth,
        startYear: m[3] ? Number(m[3]) : null,
        endYear: m[6] ? Number(m[6]) : null,
      };
    }
  }
  // "January 8, 2027 through January 10, 2027", "Dec 30 to Jan 2"
  m = new RegExp(
    `\\b${MONTH}\\s+${DAY}(?:,?\\s+(20\\d{2}))?${TO}${MONTH}\\s+${DAY}${YEAR}\\b`,
    "i",
  ).exec(text);
  if (m) {
    const startMonth = monthOf(m[1]);
    const endMonth = monthOf(m[4]);
    if (startMonth && endMonth) {
      return {
        startDay: Number(m[2]),
        startMonth,
        endDay: Number(m[5]),
        endMonth,
        startYear: m[3] ? Number(m[3]) : null,
        endYear: m[6] ? Number(m[6]) : null,
      };
    }
  }
  // "January 8 to 10[, 2027]"
  m = new RegExp(`\\b${MONTH}\\s+${DAY}${TO}${DAY}${YEAR}\\b`, "i").exec(text);
  if (m) {
    const month = monthOf(m[1]);
    if (month) {
      return {
        startDay: Number(m[2]),
        startMonth: month,
        endDay: Number(m[3]),
        endMonth: month,
        startYear: null,
        endYear: m[4] ? Number(m[4]) : null,
      };
    }
  }
  return null;
}

/**
 * The first and last calendar day the owner gave ("from 8 to 10 January",
 * "Jan 8–10, 2027", "2027-01-08 to 2027-01-10"). Without a year, the next
 * time that start comes round (today counts). Null when the words hold no
 * complete range, the last day is before the first, or the start is past.
 */
export function parseTripDateRange(
  text: string,
  now: Date = new Date(),
): { start_date: string; end_date: string } | null {
  const today = now.toISOString().slice(0, 10);
  const iso = [...text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)]
    .map((match) =>
      isoCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
    );
  let start: string | null = null;
  let end: string | null = null;
  if (iso.length === 2) {
    [start, end] = iso;
  } else {
    const parts = rangeParts(text);
    if (!parts) return null;
    const wraps = parts.endMonth < parts.startMonth;
    const explicit = parts.startYear ??
      (parts.endYear !== null ? parts.endYear - (wraps ? 1 : 0) : null);
    let year = explicit ?? now.getUTCFullYear();
    start = isoCalendarDate(year, parts.startMonth, parts.startDay);
    if (explicit === null && start && start < today) {
      year += 1;
      start = isoCalendarDate(year, parts.startMonth, parts.startDay);
    }
    end = isoCalendarDate(
      parts.endYear ?? (wraps ? year + 1 : year),
      parts.endMonth,
      parts.endDay,
    );
  }
  if (!start || !end || end < start || start < today) return null;
  return { start_date: start, end_date: end };
}
