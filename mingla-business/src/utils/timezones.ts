/**
 * IANA timezone helpers for the event creator wizard.
 *
 * Uses `Intl.supportedValuesOf("timeZone")` (ES2022 — supported in
 * Expo SDK 54's Hermes) to enumerate all IANA zones (~400 entries
 * globally). Falls back to a curated list of common zones if the
 * runtime can't enumerate.
 *
 * `formatTimezoneOffset(tz)` returns a short offset label like "GMT+0"
 * for use alongside the IANA name in the picker UI.
 *
 * Per Cycle 3 rework (timezone full-world expansion).
 */

const FALLBACK_TIMEZONES: readonly string[] = [
  "UTC",
  // Africa
  "Africa/Cairo",
  "Africa/Casablanca",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  // Americas
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Caracas",
  "America/Chicago",
  "America/Denver",
  "America/Halifax",
  "America/Lima",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Sao_Paulo",
  "America/Santiago",
  "America/St_Johns",
  "America/Toronto",
  "America/Vancouver",
  // Asia
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Riyadh",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Tehran",
  "Asia/Tokyo",
  // Atlantic
  "Atlantic/Azores",
  "Atlantic/Cape_Verde",
  "Atlantic/Reykjavik",
  // Australia / Pacific
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Pacific/Honolulu",
  // Europe
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Brussels",
  "Europe/Bucharest",
  "Europe/Budapest",
  "Europe/Copenhagen",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Kyiv",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Oslo",
  "Europe/Paris",
  "Europe/Prague",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Vienna",
  "Europe/Warsaw",
  "Europe/Zurich",
];

let cachedTimezones: string[] | null = null;

export const getAllTimezones = (): string[] => {
  if (cachedTimezones !== null) return cachedTimezones;
  try {
    type IntlExt = typeof Intl & { supportedValuesOf?: (k: string) => string[] };
    const intlExt = Intl as IntlExt;
    if (typeof intlExt.supportedValuesOf === "function") {
      const tzs = intlExt.supportedValuesOf("timeZone");
      if (Array.isArray(tzs) && tzs.length > 0) {
        cachedTimezones = tzs.slice().sort();
        return cachedTimezones;
      }
    }
  } catch {
    /* fall through */
  }
  cachedTimezones = [...FALLBACK_TIMEZONES].sort();
  return cachedTimezones;
};

/**
 * Returns a short offset string for the given IANA zone (e.g. "GMT+0",
 * "GMT-8", "GMT+5:30"). Empty string if the runtime can't compute.
 *
 * The offset is computed at the supplied `when` (default: now), so
 * DST-affected zones return the seasonally correct offset.
 */
export const formatTimezoneOffset = (tz: string, when: Date = new Date()): string => {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    const parts = fmt.formatToParts(when);
    const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return offset;
  } catch {
    return "";
  }
};

/**
 * Returns "Europe/London (GMT+0)" — IANA name + current offset. Used
 * as the human-readable label in the timezone picker.
 */
export const formatTimezoneLabel = (tz: string): string => {
  const offset = formatTimezoneOffset(tz);
  return offset.length > 0 ? `${tz} (${offset})` : tz;
};
