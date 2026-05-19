/**
 * Centralised consumer-side event date/time display helpers.
 *
 * ORCH-0877 — replaces 4 ad-hoc formatters that previously lived in
 * `BusinessEventCard.tsx` (formatDateChip), `ExpandedBusinessEventSheet.tsx`
 * (formatDateLine), `BusinessEventCalendarRow.tsx` (formatLocalDate), and
 * `TicketPdfSheet.tsx` (formatLocalDate). I-14 — single source.
 *
 * The consumer-mobile schema (BusinessEventCard payload from
 * `discover-merged-events`) carries `masterDateUtc` + `masterEndAtUtc` +
 * `timezone`. This helper renders cross-midnight events correctly:
 *
 *   - Compact chip ("Mon 12 May")                — `formatEventDateChip`
 *   - Sheet date line with range                  — `formatEventDateLine`
 *   - Calendar row range ("21:00 → 02:00")        — `formatEventLocalRange`
 *
 * NEVER fabricates end-time (Constitution #9). When masterEndAtUtc is null
 * the helpers gracefully degrade to start-only.
 */

export interface ConsumerEventTimeFields {
  masterDateUtc: string | null;
  /** ORCH-0877 — populated by discover-merged-events from event_dates.end_at. */
  masterEndAtUtc?: string | null;
  timezone: string;
}

const isValidIso = (iso: string | null | undefined): iso is string => {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime());
};

const calendarDayInTz = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(new Date(iso));

const formatShortDateInTz = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: tz,
  }).format(new Date(iso));

const formatTimeInTz = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(iso))
    .replace(/:00\b/, "")
    .replace(/\bam\b/g, "AM")
    .replace(/\bpm\b/g, "PM");

const format24hTimeInTz = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
    hour12: false,
  }).format(new Date(iso));

/**
 * Compact chip — "Mon 12 May". Renders start date only (no time, no end).
 * Used for tight grid surfaces (discover feed cards).
 */
export const formatEventDateChip = (fields: ConsumerEventTimeFields): string => {
  if (!isValidIso(fields.masterDateUtc)) return "Soon";
  const tz = fields.timezone && fields.timezone.length > 0
    ? fields.timezone
    : "UTC";
  try {
    return formatShortDateInTz(fields.masterDateUtc, tz);
  } catch {
    return "Soon";
  }
};

/**
 * Full date line — renders one of:
 *   - "Date to be announced"                                          (no start)
 *   - "Sat 18 May · 10 PM"                                            (no end)
 *   - "Sat 18 May · 10 PM – 11 PM"                                    (same-day)
 *   - "Sat 18 May · 10 PM – Sun 19 May · 2 AM"                        (cross-midnight)
 *
 * Used by expanded sheet + PDF ticket where there's room for the full range.
 */
export const formatEventDateLine = (fields: ConsumerEventTimeFields): string => {
  if (!isValidIso(fields.masterDateUtc)) return "Date to be announced";
  const tz = fields.timezone && fields.timezone.length > 0
    ? fields.timezone
    : "UTC";
  try {
    const startDate = formatShortDateInTz(fields.masterDateUtc, tz);
    const startTime = formatTimeInTz(fields.masterDateUtc, tz);
    if (!isValidIso(fields.masterEndAtUtc)) {
      return `${startDate} · ${startTime}`;
    }
    const endTime = formatTimeInTz(fields.masterEndAtUtc, tz);
    const startDay = calendarDayInTz(fields.masterDateUtc, tz);
    const endDay = calendarDayInTz(fields.masterEndAtUtc, tz);
    if (startDay === endDay) {
      return `${startDate} · ${startTime} – ${endTime}`;
    }
    const endDate = formatShortDateInTz(fields.masterEndAtUtc, tz);
    return `${startDate} · ${startTime} – ${endDate} · ${endTime}`;
  } catch {
    return fields.masterDateUtc ?? "Date to be announced";
  }
};

/**
 * Compact local range — "Mon 12 May · 21:00 → 02:00" (24h, ASCII arrow).
 * Used by calendar row where vertical space is tight. Falls back to
 * start-only when end is null.
 */
export const formatEventLocalRange = (fields: ConsumerEventTimeFields): string => {
  if (!isValidIso(fields.masterDateUtc)) return "Date to be announced";
  const tz = fields.timezone && fields.timezone.length > 0
    ? fields.timezone
    : "UTC";
  try {
    const startDate = formatShortDateInTz(fields.masterDateUtc, tz);
    const startTime = format24hTimeInTz(fields.masterDateUtc, tz);
    if (!isValidIso(fields.masterEndAtUtc)) {
      return `${startDate} · ${startTime}`;
    }
    const endTime = format24hTimeInTz(fields.masterEndAtUtc, tz);
    return `${startDate} · ${startTime} → ${endTime}`;
  } catch {
    return fields.masterDateUtc ?? "Date to be announced";
  }
};
