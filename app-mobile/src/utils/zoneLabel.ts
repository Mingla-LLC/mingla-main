const FRIENDLY_ZONE_NAMES: Record<string, string> = {
  "Europe/London": "London",
  "Europe/Dublin": "Dublin",
  "America/New_York": "New York",
  "America/Chicago": "Chicago",
  "America/Denver": "Denver",
  "America/Los_Angeles": "Los Angeles",
  "Africa/Lagos": "Lagos",
  "Africa/Accra": "Accra",
};

/** A concise, user-facing city label for an IANA timezone. */
export function zoneLabel(timezone: string | null | undefined): string {
  if (!timezone) return "Local";
  const known = FRIENDLY_ZONE_NAMES[timezone];
  if (known) return known;
  const segment = timezone.split("/").at(-1);
  return segment ? segment.replaceAll("_", " ") : "Local";
}

export function formatStartsAtLabel(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
  locale = "en-GB",
): string | null {
  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone || "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
}

export function formatTicketTimeLine(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
  venueLine: string | null | undefined,
  locale = "en-GB",
): string | null {
  const dateLine = formatStartsAtLabel(startsAt, timezone, locale);
  if (!dateLine) return venueLine?.trim() || null;
  const localLine = `${dateLine} (${zoneLabel(timezone)} time)`;
  return venueLine?.trim() ? `${localLine} · ${venueLine.trim()}` : localLine;
}
