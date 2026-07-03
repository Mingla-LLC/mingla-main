/**
 * ORCH-1270 — SMS send-window helper for the composer.
 *
 * The composer cannot read the edge function's env flags, so this is a
 * point-in-time, audience-agnostic helper. It powers the always-on
 * "How SMS timing works" info note shown for an SMS "Send now" review:
 *   - `nextGlobalSendWindowOpen` → the soonest global sending window, used both
 *     to label the "Schedule for …" secondary CTA and to schedule the whole
 *     blast for that instant instead of firing a blind out-of-hours send.
 *   - `SMS_QUIET_HOURS` → the recipient-local window (8 AM–9 PM) shown in the
 *     copy and the source of truth the T-9 drift test compares to the edge fn.
 *
 * ORCH-1270 F-1: the earlier `isAnyMarketInSendWindow` gate was dead code.
 * SUPPORTED_SMS_ZONES span Honolulu (UTC-10) through Lagos (UTC+1), whose
 * per-market windows union to all 24 UTC hours, so it returned `true` for every
 * instant and the conditional warning it gated NEVER fired. The note is now
 * ALWAYS shown for an SMS "Send now" (informational, not a warning — RC-1's
 * defer already makes a blind send safe; the note just explains that off-hours
 * recipients are held, not lost), so the dead predicate was removed.
 *
 * SMS_QUIET_HOURS MUST equal the edge fn's QUIET_HOURS
 * (supabase/functions/marketing-send/index.ts). The T-9 drift test
 * (src/utils/__tests__/smsSendWindow.test.ts) reads both source files and
 * compares the {US,NG}×{start,end} tuples so the two copies can't drift.
 */

/** Recipient-local sending window per market. MUST equal edge fn QUIET_HOURS. */
export const SMS_QUIET_HOURS = {
  US: { startHour: 8, endHour: 21 }, // 8 AM–9 PM recipient-local
  NG: { startHour: 8, endHour: 20 }, // 8 AM–8 PM WAT
} as const;

export type SmsMarket = keyof typeof SMS_QUIET_HOURS;

/**
 * The distinct IANA zones the edge fn can resolve, tagged with their market.
 * US zones mirror the edge fn's US_AREACODE_TZ codomain (all 50 states + DC).
 */
export const SUPPORTED_SMS_ZONES: ReadonlyArray<{ zone: string; market: SmsMarket }> = [
  { zone: "America/New_York", market: "US" },
  { zone: "America/Chicago", market: "US" },
  { zone: "America/Denver", market: "US" },
  { zone: "America/Phoenix", market: "US" },
  { zone: "America/Los_Angeles", market: "US" },
  { zone: "America/Anchorage", market: "US" },
  { zone: "Pacific/Honolulu", market: "US" },
  { zone: "Africa/Lagos", market: "NG" },
];

/** Current local hour (0-23) in a zone, or null if the zone is unresolvable. */
function localHourInZone(zone: string, now: Date): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      hour12: false,
    });
    const h = parseInt(fmt.format(now), 10);
    return Number.isNaN(h) ? null : h;
  } catch {
    return null;
  }
}

/**
 * The soonest instant at which SOME supported zone enters (or is already in) its
 * window — the min over zones of `now + hoursUntilOpen`. Powers the
 * "Schedule for …" affordance. Returns `now` when a zone is already open.
 */
export function nextGlobalSendWindowOpen(now: Date): Date {
  let bestHoursUntilOpen = Number.POSITIVE_INFINITY;
  for (const { zone, market } of SUPPORTED_SMS_ZONES) {
    const h = localHourInZone(zone, now);
    if (h === null) continue;
    const { startHour, endHour } = SMS_QUIET_HOURS[market];
    const hoursUntilOpen = h >= startHour && h < endHour
      ? 0 // already inside the window
      : (startHour - h + 24) % 24;
    if (hoursUntilOpen < bestHoursUntilOpen) bestHoursUntilOpen = hoursUntilOpen;
  }
  if (!Number.isFinite(bestHoursUntilOpen)) bestHoursUntilOpen = 0;
  return new Date(now.getTime() + bestHoursUntilOpen * 60 * 60 * 1000);
}
