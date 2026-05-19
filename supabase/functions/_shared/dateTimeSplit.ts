// ORCH-0877 — server-side split of a TIMESTAMPTZ ISO string into
// (date, time) components in a target IANA timezone.
//
// Mirrors the client-side splitTimestampInTz at
// `mingla-business/src/services/publicEventsService.ts:62-85`
// so client + server agree on the same calendar-day boundary semantics.
//
// Used by:
//   - discover-merged-events/index.ts to populate doorsOpenLocal +
//     endsAtLocal on the consumer-app BusinessEventCard payload.
//   - Future server-side render sites that need to derive local-time
//     fields from event_dates UTC timestamps.
//
// Returns nulls on null/invalid input. NEVER fabricates a default.
// Constitution #9 — no fabricated data.

export interface SplitResult {
  /** YYYY-MM-DD in the target timezone. */
  date: string | null;
  /** HH:MM 24h in the target timezone. */
  time: string | null;
}

export function splitTimestampInTz(
  iso: string | null | undefined,
  tz: string | null | undefined,
): SplitResult {
  if (!iso) return { date: null, time: null };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { date: null, time: null };
  const timezone = tz && tz.length > 0 ? tz : "UTC";
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(dt);
    const get = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? "";
    const year = get("year");
    const month = get("month");
    const day = get("day");
    const hour = get("hour");
    const minute = get("minute");
    if (!year || !month || !day || !hour || !minute) {
      return { date: null, time: null };
    }
    return {
      date: `${year}-${month}-${day}`,
      // Normalize "24:00" (some ICUs emit hour=24 for midnight) to "00:00"
      time: `${hour === "24" ? "00" : hour}:${minute}`,
    };
  } catch {
    return { date: null, time: null };
  }
}
