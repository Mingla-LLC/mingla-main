/**
 * [ORCH-0696] Parse Ticketmaster event date + time strings into a Date object.
 *
 * TM date formats vary widely:
 *   "Fri Nov 7"           — short day + month + day
 *   "November 7, 2026"    — long month + day + year
 *   "11/07/2026"          — numeric MM/DD/YYYY
 *   "Tomorrow"            — relative (NOT supported — returns null)
 *   "TBA"                 — placeholder (returns null)
 *
 * Time formats:
 *   "8:00 PM" / "8 PM"    — 12-hour with AM/PM
 *   "20:00"               — 24-hour
 *   "TBA" / "Doors at 7"  — non-numeric (returns null)
 *
 * Strategy: defensive native `Date` parsing. Returns `null` on any failure
 * rather than fabricating a date. Caller surfaces the failure to the user
 * via Alert (per spec §5.2.5).
 *
 * NOT a full date library — for fancier parsing, swap in `date-fns` or
 * `dayjs` later. Today this serves the "Add to Calendar" use case where
 * a TBA fallback is correct UX.
 */
export function parseEventDateTime(
  dateStr: string | undefined | null,
  timeStr: string | undefined | null
): Date | null {
  if (!dateStr || typeof dateStr !== "string") return null;

  const trimmedDate = dateStr.trim();
  const trimmedTime = (timeStr || "").trim();

  // Reject obviously non-parseable placeholders
  if (/^(tba|tbd|tomorrow|today|n\/a)$/i.test(trimmedDate)) return null;

  // Strategy 1: try native Date parser on the combined string
  const combined = trimmedTime ? `${trimmedDate} ${trimmedTime}` : trimmedDate;
  let parsed = new Date(combined);
  if (!isNaN(parsed.getTime())) {
    // Sanity check: year must be plausible (>= 2020, <= 2100). Native Date
    // happily accepts e.g. "Fri Nov 7" → year 2001 if that's what locale infers.
    const year = parsed.getFullYear();
    if (year >= 2020 && year <= 2100) {
      return parsed;
    }
    // Year is implausibly old — likely "Fri Nov 7" without year. Re-try with
    // current year inferred.
    const now = new Date();
    const inferredYear = now.getFullYear();
    parsed = new Date(`${trimmedDate} ${inferredYear} ${trimmedTime}`.trim());
    if (!isNaN(parsed.getTime())) {
      const inferredParsed = parsed.getFullYear();
      if (inferredParsed >= 2020 && inferredParsed <= 2100) {
        // If the inferred date is in the past, bump to next year (events are forward-looking)
        if (parsed.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
          parsed.setFullYear(inferredParsed + 1);
        }
        return parsed;
      }
    }
    return null;
  }

  // Strategy 2: defensive year inference (same as above) for raw date-only
  const now = new Date();
  parsed = new Date(`${trimmedDate} ${now.getFullYear()} ${trimmedTime}`.trim());
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    if (year >= 2020 && year <= 2100) {
      if (parsed.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
        parsed.setFullYear(year + 1);
      }
      return parsed;
    }
  }

  return null;
}
