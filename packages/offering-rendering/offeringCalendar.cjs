// issue #4420 / #4334 — "Add to calendar" for a public offering, ONLY from real data.
//
// THE ONE OWNER of calendar facts: the entry rules, the ICS file, and the
// Google and Outlook "add event" links. A plain CommonJS module (with
// offeringCalendar.d.cts for TypeScript) so the SAME code serves the buyer page
// (Metro and jest resolve the .cjs) AND the server route
// mingla-business/api/event-calendar.js (Node cannot load .ts). Dependency-free
// on purpose; Deno tests load it with createRequire.
//
// A calendar entry needs a real start AND a real end instant. When the public
// payload lacks either (no end time, an unparseable instant, an end before the
// start, a multi-date run with no single "the" date), there is NO entry and
// the page shows NO "Add to calendar" (Constitution 9: never fabricate a
// duration, never guess an end).
"use strict";

/** The entry, or null when the data cannot honestly make one. */
function offeringCalendarEntry(input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length === 0) return null;
  if (typeof input.startIso !== "string" || typeof input.endIso !== "string") {
    return null;
  }
  const startMs = Date.parse(input.startIso);
  const endMs = Date.parse(input.endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  const clean = (v) =>
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
function calendarUtcStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const icsEscape = (v) =>
  v.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/**
 * A one-event iCalendar file (RFC 5545), CRLF line endings. DTSTAMP is the
 * moment the file is made (RFC 5545 §3.8.7.2), `stampMs` only so tests can pin it.
 */
function offeringCalendarIcs(entry, uid, stampMs = Date.now()) {
  const description = [entry.details, entry.url].filter((p) => p !== null).join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mingla//Public page//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${calendarUtcStamp(stampMs)}`,
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
function offeringGoogleCalendarUrl(entry) {
  const params = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(entry.title)}`,
    `dates=${calendarUtcStamp(entry.startMs)}/${calendarUtcStamp(entry.endMs)}`,
  ];
  const details = [entry.details, entry.url].filter((p) => p !== null).join("\n");
  if (details.length > 0) params.push(`details=${encodeURIComponent(details)}`);
  if (entry.location !== null) params.push(`location=${encodeURIComponent(entry.location)}`);
  return `https://calendar.google.com/calendar/render?${params.join("&")}`;
}

/**
 * The Outlook.com / Microsoft 365 "add event" compose link (#4420 C2). Start
 * and end are ISO-8601 UTC instants, which the compose page reads as UTC.
 */
function offeringOutlookCalendarUrl(entry) {
  const params = [
    `subject=${encodeURIComponent(entry.title)}`,
    `startdt=${encodeURIComponent(new Date(entry.startMs).toISOString())}`,
    `enddt=${encodeURIComponent(new Date(entry.endMs).toISOString())}`,
  ];
  if (entry.location !== null) params.push(`location=${encodeURIComponent(entry.location)}`);
  const body = [entry.details, entry.url].filter((p) => p !== null).join("\n");
  if (body.length > 0) params.push(`body=${encodeURIComponent(body)}`);
  params.push("path=/calendar/action/compose", "rru=addevent");
  return `https://outlook.live.com/calendar/0/action/compose?${params.join("&")}`;
}

module.exports = {
  offeringCalendarEntry,
  calendarUtcStamp,
  offeringCalendarIcs,
  offeringGoogleCalendarUrl,
  offeringOutlookCalendarUrl,
};
