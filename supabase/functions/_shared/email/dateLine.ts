// ORCH-0785 / widened ORCH-0877 — Server-side event date formatter for
// transactional email. Renders master event_dates start_at AND end_at in
// the event's own timezone using Intl.DateTimeFormat (available in the
// Deno Edge runtime).
//
// Behaviour:
//   - If startAtIso is null/invalid → returns "" so the renderer omits
//     the line entirely (Constitution #9 — no fabrication).
//   - If endAtIso is null/invalid → renders start-only (legacy shape).
//   - If start + end are on the SAME calendar day in target tz → renders
//     "Sat 18 May 2026 · 10:00 pm – 11:00 pm UTC" (year + tz suffix).
//   - If start + end CROSS calendar day in target tz → renders
//     "Sat 18 May · 10:00 pm – Sun 19 May · 2:00 am UTC" (no year on
//     either side; weekday prefix on both; matches D1 visual lock).
//
// AM/PM casing: en-GB Intl emits lowercase "am"/"pm" — we post-process
// to uppercase per Mingla copy convention (ui-ux-pro-max preflight 2026-05-18).
//
// Dash: en-dash "–" (U+2013) with regular single-spaces (NOT thin spaces;
// thin spaces render inconsistently across email clients).

const RANGE_SEP = " – ";

function toUpperAmPm(s: string): string {
  return s.replace(/\bam\b/g, "AM").replace(/\bpm\b/g, "PM");
}

function fmtDateWithYear(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: tz,
  }).format(d);
}

function fmtDateNoYear(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: tz,
  }).format(d);
}

function fmtTimeWithTz(d: Date, tz: string): string {
  // hour12 explicit — en-GB defaults to 24h which clashes with Mingla's
  // copy convention. Post-process the en-GB lowercase "am"/"pm" to uppercase.
  return toUpperAmPm(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: tz,
      timeZoneName: "short",
    }).format(d),
  );
}

function fmtTimeNoTz(d: Date, tz: string): string {
  return toUpperAmPm(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: tz,
    }).format(d),
  );
}

function calendarDayInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(d);
}

export function formatEventDateLine(
  startAtIso: string | null | undefined,
  endAtIso: string | null | undefined,
  timezone: string | null | undefined,
): string {
  if (!startAtIso) return "";
  const startDate = new Date(startAtIso);
  if (Number.isNaN(startDate.getTime())) return "";
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";

  // No end-time available → render start only (Constitution #9, no fabrication)
  if (!endAtIso) {
    try {
      return `${fmtDateWithYear(startDate, tz)} · ${fmtTimeWithTz(startDate, tz)}`;
    } catch {
      return startDate.toISOString();
    }
  }

  const endDate = new Date(endAtIso);
  if (Number.isNaN(endDate.getTime())) {
    // End present but invalid → degrade to start-only (no fabrication)
    try {
      return `${fmtDateWithYear(startDate, tz)} · ${fmtTimeWithTz(startDate, tz)}`;
    } catch {
      return startDate.toISOString();
    }
  }

  try {
    const startDay = calendarDayInTz(startDate, tz);
    const endDay = calendarDayInTz(endDate, tz);

    if (startDay === endDay) {
      // Same-day inline range. Year + tz suffix on the start side only;
      // end side is bare time. Example: "Sat 18 May 2026 · 10:00 PM – 11:00 PM UTC"
      const startPart = `${fmtDateWithYear(startDate, tz)} · ${fmtTimeNoTz(startDate, tz)}`;
      const endTime = fmtTimeWithTz(endDate, tz);
      return `${startPart}${RANGE_SEP}${endTime}`;
    }

    // Cross-midnight. Weekday prefix on both sides; no year; tz suffix on end side.
    // Example: "Sat 18 May · 10:00 PM – Sun 19 May · 2:00 AM UTC"
    const startPart = `${fmtDateNoYear(startDate, tz)} · ${fmtTimeNoTz(startDate, tz)}`;
    const endPart = `${fmtDateNoYear(endDate, tz)} · ${fmtTimeWithTz(endDate, tz)}`;
    return `${startPart}${RANGE_SEP}${endPart}`;
  } catch {
    return startDate.toISOString();
  }
}
