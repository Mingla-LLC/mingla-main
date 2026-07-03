/**
 * ORCH-1270 RC-3 — SMS send-window helper for the composer pre-send guardrail.
 *
 * The composer cannot read the edge function's env flags, so this is a
 * point-in-time, audience-agnostic check of whether ANY supported market is
 * currently inside its recipient-local sending window. It powers a NON-blocking
 * warning + a "schedule for the next window" affordance (RC-1's defer already
 * makes a blind "Send now" safe — this is purely a heads-up).
 *
 * SMS_QUIET_HOURS MUST equal the edge fn's QUIET_HOURS
 * (supabase/functions/marketing-send/index.ts). The T-9 drift test
 * (src/utils/__tests__/smsSendWindow.test.ts) reads both source files and
 * compares the {US,NG}×{start,end} tuples so the two copies can't drift.
 *
 * KNOWN LIMITATION (see IMPLEMENTATION_ORCH-1270 report, "spec deviations"):
 * because SUPPORTED_SMS_ZONES spans Hawaii (UTC-10) through Lagos (UTC+1), the
 * union of the per-market windows covers all 24 UTC hours — so in practice at
 * least one supported zone is ALWAYS in window and `isAnyMarketInSendWindow`
 * returns true for every instant. The warning is therefore effectively
 * always-suppressed with the spec's zone set. This is a SPEC-DESIGN issue
 * (RC-3 §5.3), not an implementation bug; the plumbing is correct and will
 * light up the moment the zone scope is narrowed (e.g. to the audience's actual
 * markets). Filed back for forensics.
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
 * True iff ≥1 supported zone's current local hour is inside its market window.
 * `false` ⇒ the whole audience is PROVABLY unreachable right now (a sufficient
 * condition regardless of the audience's timezone mix).
 */
export function isAnyMarketInSendWindow(now: Date): boolean {
  for (const { zone, market } of SUPPORTED_SMS_ZONES) {
    const h = localHourInZone(zone, now);
    if (h === null) continue;
    const { startHour, endHour } = SMS_QUIET_HOURS[market];
    if (h >= startHour && h < endHour) return true;
  }
  return false;
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
