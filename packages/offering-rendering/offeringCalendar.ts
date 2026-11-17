// issue #4420 — "Add to calendar" for a public offering, ONLY from real data.
//
// A calendar entry needs a real start AND a real end instant. When the public
// payload lacks either (no end time, an unparseable instant, an end before the
// start, a multi-date run with no single "the" date), there is NO entry and
// the page shows NO "Add to calendar" (Constitution 9: never fabricate a
// duration, never guess an end).
//
// Pure and dependency-free (Deno-unit-tested).

export interface OfferingCalendarInput {
  title: string;
  startIso: string | null | undefined;
  endIso: string | null | undefined;
  /** Shown only when the page itself shows it (address-hidden events pass null). */
  location?: string | null;
  /** The public page link, added to the description. */
  url?: string | null;
  details?: string | null;
}

export interface OfferingCalendarEntry {
  title: string;
  startMs: number;
  endMs: number;
  location: string | null;
  url: string | null;
  details: string | null;
}

/** The entry, or null when the data cannot honestly make one. */
export function offeringCalendarEntry(
  input: OfferingCalendarInput,
): OfferingCalendarEntry | null {
  const title = input.title.trim();
  if (title.length === 0) return null;
  if (typeof input.startIso !== "string" || typeof input.endIso !== "string") {
    return null;
  }
  const startMs = Date.parse(input.startIso);
  const endMs = Date.parse(input.endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  const clean = (v: string | null | undefined): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  return {
    title,
    startMs,
    endMs,
    location: clean(input.location),
    url: clean(input.url),
    details: clean(input.details),
  };
}

/** 20261219T210000Z (UTC basic format, the one both ICS and Google read). */
export function calendarUtcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const icsEscape = (v: string): string =>
  v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** A one-event iCalendar file (RFC 5545), CRLF line endings. */
export function offeringCalendarIcs(entry: OfferingCalendarEntry, uid: string): string {
  const description = [entry.details, entry.url].filter((p): p is string => p !== null).join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mingla//Public page//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${calendarUtcStamp(entry.startMs)}`,
    `DTSTART:${calendarUtcStamp(entry.startMs)}`,
    `DTEND:${calendarUtcStamp(entry.endMs)}`,
    `SUMMARY:${icsEscape(entry.title)}`,
    ...(entry.location !== null ? [`LOCATION:${icsEscape(entry.location)}`] : []),
    ...(description.length > 0 ? [`DESCRIPTION:${icsEscape(description)}`] : []),
    ...(entry.url !== null ? [`URL:${entry.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

/** The Google Calendar "add event" link (opens in the browser on native). */
export function offeringGoogleCalendarUrl(entry: OfferingCalendarEntry): string {
  const params = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(entry.title)}`,
    `dates=${calendarUtcStamp(entry.startMs)}/${calendarUtcStamp(entry.endMs)}`,
  ];
  const details = [entry.details, entry.url].filter((p): p is string => p !== null).join("\n");
  if (details.length > 0) params.push(`details=${encodeURIComponent(details)}`);
  if (entry.location !== null) params.push(`location=${encodeURIComponent(entry.location)}`);
  return `https://calendar.google.com/calendar/render?${params.join("&")}`;
}
