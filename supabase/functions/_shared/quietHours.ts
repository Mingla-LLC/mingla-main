/**
 * #3720 Slice B — legacy push quiet-hours helpers (10 PM – 8 AM local).
 * Pure / DB-free so Deno unit tests can pin defer windows without clock mocks
 * on the whole notify-dispatch module.
 */

export function isQuietHours(
  timezone: string | null,
  now: Date = new Date(),
  // #4255 rework: Mingla team pushes keep 22:00 to 07:00 (spec rev 3); the
  // legacy push path keeps 22:00 to 08:00.
  endHour = 8,
): boolean {
  const tz = timezone || "America/New_York";
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    });
    const hour = parseInt(formatter.format(now), 10);
    if (Number.isNaN(hour)) return true; // fail closed → defer
    return hour >= 22 || hour < endHour;
  } catch {
    return true;
  }
}

/**
 * Next local 08:00 in `timezone` at or after `now` (ISO string).
 * Used as notification_outbox.next_attempt_at for quiet-hours deferral.
 */
export function nextQuietHoursEnd(
  timezone: string | null,
  now: Date = new Date(),
  endHour = 8,
): string {
  const tz = timezone || "America/New_York";
  let localHour = endHour;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    });
    const parsed = parseInt(formatter.format(now), 10);
    if (!Number.isNaN(parsed)) localHour = parsed;
  } catch {
    localHour = endHour;
  }
  // Hours until the next end hour local. If already in-window, 0 → clamp
  // to a short re-check so a race at the boundary still re-evaluates.
  const hoursUntilOpen = (endHour - localHour + 24) % 24;
  const deltaMs = Math.max(hoursUntilOpen * 60 * 60 * 1000, 60 * 1000);
  return new Date(now.getTime() + deltaMs).toISOString();
}

/** Outbox category for deferred legacy (type/title/body) push retries. */
export const LEGACY_QUIET_HOURS_CATEGORY = "legacy_quiet_hours_push";
