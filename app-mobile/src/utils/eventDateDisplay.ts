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

/**
 * ORCH-1157 Round-7 [doors pill] — device-locale-aware doors time formatter.
 *
 * Unlike `formatTimeInTz` (en-GB, drops `:00` minutes — used by the date line),
 * this ALWAYS shows minutes and respects the DEVICE'S 12h/24h preference:
 *   - device on 12h → "1:00 PM"
 *   - device on 24h → "13:00"
 *
 * Mechanism: `toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })`
 * with an UNDEFINED locale resolves to the device locale + its 24-hour-clock
 * setting on Hermes — the same convention the app already uses for chat
 * timestamps (`MessageBubble`, `ChatStatusLine`). The `locale` param exists ONLY
 * so tests can pin a clock ("en-US" → 12h, "sv-SE" → 24h); production passes
 * undefined. AM/PM is uppercased for visual parity with the date line.
 * Returns null on any invalid instant (never fabricates).
 */
const formatDoorsTimeInTz = (
  iso: string,
  tz: string,
  locale?: string,
): string | null => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    // Detect the device's 12h/24h preference from the resolved format. 24h →
    // zero-padded "HH:MM" ("13:00", "04:00"); 12h → "H:MM AM/PM" ("1:00 PM").
    const is24h =
      new Intl.DateTimeFormat(locale, { hour: "numeric" })
        .resolvedOptions().hour12 === false;
    return d
      .toLocaleTimeString(locale, {
        hour: is24h ? "2-digit" : "numeric",
        minute: "2-digit",
        timeZone: tz,
      })
      .replace(/\bam\b/gi, "AM")
      .replace(/\bpm\b/gi, "PM");
  } catch {
    return null;
  }
};

/**
 * ORCH-1157 [rsvp-public-redesign] Issue 4 — consumer doors-open / doors-close
 * labels for the RSVP detail. Seth-locked: reuse the existing start_at + end_at
 * (masterDateUtc / masterEndAtUtc), NO new field/schema. "Doors open" = start,
 * "Doors close" = end, formatted in the event timezone.
 *
 * ORCH-1157 Round-7: the time itself is now device-locale-aware (12h → "1:00 PM",
 * 24h → "13:00") via `formatDoorsTimeInTz` and always carries minutes — replacing
 * the bare-hour en-GB output ("13") the date-line helper produced. REAL-DATA-ONLY:
 * `close` is null when masterEndAtUtc is absent (no fabricated close — rule 9);
 * `open` is null when there is no valid start instant.
 *
 * @param locale test-only clock override ("en-US" 12h / "sv-SE" 24h); production
 *   passes undefined → device locale + device 24-hour-clock setting.
 */
export const formatEventDoorsTimes = (
  fields: ConsumerEventTimeFields,
  locale?: string,
): { open: string | null; close: string | null } => {
  const tz = fields.timezone && fields.timezone.length > 0
    ? fields.timezone
    : "UTC";
  let open: string | null = null;
  let close: string | null = null;
  if (isValidIso(fields.masterDateUtc)) {
    open = formatDoorsTimeInTz(fields.masterDateUtc as string, tz, locale);
  }
  if (isValidIso(fields.masterEndAtUtc)) {
    close = formatDoorsTimeInTz(fields.masterEndAtUtc as string, tz, locale);
  }
  return { open, close };
};
