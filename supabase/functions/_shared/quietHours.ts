/**
 * #3720 Slice B — legacy push quiet-hours helpers (10 PM – 8 AM local).
 * Pure / DB-free so Deno unit tests can pin defer windows without clock mocks
 * on the whole notify-dispatch module.
 */

export function isQuietHours(
  timezone: string | null,
  now: Date = new Date(),
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
    return hour >= 22 || hour < 8;
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
): string {
  const tz = timezone || "America/New_York";
  let localHour = 8;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    });
    const parsed = parseInt(formatter.format(now), 10);
    if (!Number.isNaN(parsed)) localHour = parsed;
  } catch {
    localHour = 8;
  }
  // Hours until the next 08:00 local. If already in-window (08–21), 0 → clamp
  // to a short re-check so a race at the boundary still re-evaluates.
  const hoursUntilOpen = (8 - localHour + 24) % 24;
  const deltaMs = Math.max(hoursUntilOpen * 60 * 60 * 1000, 60 * 1000);
  return new Date(now.getTime() + deltaMs).toISOString();
}

/** Outbox category for deferred legacy (type/title/body) push retries. */
export const LEGACY_QUIET_HOURS_CATEGORY = "legacy_quiet_hours_push";
