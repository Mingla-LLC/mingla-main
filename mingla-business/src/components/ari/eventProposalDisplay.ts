/** Format an event confirmation time in the event's timezone, always including its year. */
export function formatEventProposalWhen(
  startAt: unknown,
  endAt: unknown,
  timezone: unknown,
): string | null {
  if (typeof startAt !== "string") return null;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return null;
  const timeZone = typeof timezone === "string" && timezone.trim()
    ? timezone
    : undefined;
  try {
    const startDate = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone,
    }).format(start);
    const startTime = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(start);
    const zoneLabel = typeof timeZone === "string"
      ? timeZone === "Africa/Lagos"
        ? "WAT"
        : new Intl.DateTimeFormat(undefined, {
          timeZone,
          timeZoneName: "short",
        }).formatToParts(start).find((part) => part.type === "timeZoneName")
          ?.value ?? timeZone
      : null;
    const startText = `${startDate}, ${startTime}${zoneLabel ? ` ${zoneLabel}` : ""}`;
    if (typeof endAt !== "string") return startText;
    const end = new Date(endAt);
    if (Number.isNaN(end.getTime())) return startText;
    const startDay = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(start);
    const endDay = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(end);
    if (startDay === endDay) {
      const endTime = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }).format(end);
      return `${startText} – ${endTime}${zoneLabel ? ` ${zoneLabel}` : ""}`;
    }
    const endDate = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(end);
    return `${startText} – ${endDate}${zoneLabel ? ` ${zoneLabel}` : ""}`;
  } catch {
    // Invalid or stale timezone values should not hide the event date entirely.
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(start);
    } catch {
      return null;
    }
  }
}
