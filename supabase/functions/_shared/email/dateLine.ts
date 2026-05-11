// ORCH-0785 — Server-side event date formatter for transactional email.
// Renders the master event_dates start_at in the event's own timezone using
// Intl.DateTimeFormat (available in the Deno Edge runtime). Returns an empty
// string when start_at is null/invalid so the renderer omits the line entirely
// rather than fabricating a date (Constitution rule 9).

export function formatEventDateLine(
  startAtIso: string | null | undefined,
  timezone: string | null | undefined,
): string {
  if (!startAtIso) return "";
  const date = new Date(startAtIso);
  if (Number.isNaN(date.getTime())) return "";
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";
  try {
    const datePart = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: tz,
    }).format(date);
    const timePart = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      timeZoneName: "short",
    }).format(date);
    return `${datePart} · ${timePart}`;
  } catch {
    return date.toISOString();
  }
}
