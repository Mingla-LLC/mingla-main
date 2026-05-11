// ORCH-0785 follow-up — Add-to-Calendar helpers.
// Builds Google Calendar + Outlook web-compose URLs and a minimal RFC-5545
// .ics payload. The .ics is delivered as a second attachment so Apple Mail /
// any calendar-aware client gets a one-tap "Add to Calendar" affordance.
//
// Defensive defaults: if event start is null, every helper returns null and
// the email simply omits the calendar block. We never fabricate times.

import { escapeHtml } from "./escape.ts";

const DEFAULT_DURATION_HOURS = 3;

interface CalendarEventInput {
  title: string;
  startAtIso: string | null;
  endAtIso?: string | null;
  locationText: string | null;
  isOnline: boolean;
  description: string;
}

export interface CalendarLinks {
  googleUrl: string;
  outlookUrl: string;
  icsContent: string;
  icsFilename: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatUtcCompact(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${
    pad(d.getUTCDate())
  }T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${
    pad(d.getUTCSeconds())
  }Z`;
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    chunks.push(line.slice(i, i + 75));
    i += 75;
  }
  return chunks.join("\r\n ");
}

export function buildCalendarLinks(
  input: CalendarEventInput,
): CalendarLinks | null {
  if (!input.startAtIso) return null;
  const start = new Date(input.startAtIso);
  if (Number.isNaN(start.getTime())) return null;
  const endIso = input.endAtIso ?? null;
  const end = endIso ? new Date(endIso) : null;
  const endValid = end !== null && !Number.isNaN(end.getTime());
  const effectiveEnd = endValid
    ? end!
    : new Date(start.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000);

  const startCompact = formatUtcCompact(start);
  const endCompact = formatUtcCompact(effectiveEnd);
  const location = input.isOnline
    ? "Online event"
    : (input.locationText ?? "");

  const googleParams = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${startCompact}/${endCompact}`,
    details: input.description,
    location,
  });
  const googleUrl =
    `https://calendar.google.com/calendar/render?${googleParams.toString()}`;

  const outlookParams = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: input.title,
    startdt: start.toISOString(),
    enddt: effectiveEnd.toISOString(),
    body: input.description,
    location,
  });
  const outlookUrl =
    `https://outlook.live.com/calendar/0/deeplink/compose?${outlookParams.toString()}`;

  const uid = `mingla-${start.getTime().toString(36)}-${
    Math.floor(Math.random() * 1e9).toString(36)
  }@usemingla.com`;
  const dtstamp = formatUtcCompact(new Date());
  const icsLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mingla//Tickets//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${startCompact}`,
    `DTEND:${endCompact}`,
    foldIcsLine(`SUMMARY:${icsEscape(input.title)}`),
    foldIcsLine(`DESCRIPTION:${icsEscape(input.description)}`),
    foldIcsLine(`LOCATION:${icsEscape(location)}`),
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const icsContent = icsLines.join("\r\n") + "\r\n";

  return {
    googleUrl,
    outlookUrl,
    icsContent,
    icsFilename: "mingla-event.ics",
  };
}

const BRAND_ORANGE = "#FF6B2C";
const BRAND_INK = "#0F1115";
const BRAND_MUTED = "#5B6172";
const BRAND_BORDER = "#ECECEE";
const BRAND_BG_SOFT = "#FFF6F1";

export function renderCalendarBlockHtml(links: CalendarLinks): string {
  // Apple link points at a data: URI carrying the .ics payload. Mail clients
  // that honor data URIs (Apple Mail desktop) open it directly; on iOS the
  // attached .ics is the canonical path.
  const appleHref = `data:text/calendar;charset=utf-8;base64,${
    btoa(unescape(encodeURIComponent(links.icsContent)))
  }`;
  const buttonStyle =
    `display:inline-block;padding:10px 18px;background:#FFFFFF;border:1px solid ${BRAND_BORDER};border-radius:8px;color:${BRAND_INK};font-size:13px;font-weight:600;text-decoration:none;`;
  return `<div style="margin-top:24px;padding:18px;background:${BRAND_BG_SOFT};border:1px solid ${BRAND_BORDER};border-radius:12px;">
    <p style="margin:0 0 12px 0;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND_ORANGE};font-weight:700;">Add to calendar</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding-right:8px;">
          <a href="${
    escapeHtml(links.googleUrl)
  }" style="${buttonStyle}">Google</a>
        </td>
        <td style="padding-right:8px;">
          <a href="${
    escapeHtml(links.outlookUrl)
  }" style="${buttonStyle}">Outlook</a>
        </td>
        <td>
          <a href="${escapeHtml(appleHref)}" style="${buttonStyle}">Apple</a>
        </td>
      </tr>
    </table>
  </div>`;
}
