/**
 * rsvpStatusBanner — the honest event-level state pill at the top of a public
 * RSVP page. Pure and dependency-free so it can be tested without a renderer.
 *
 * WHY this exists: the public page used to build its top pill from the TICKET
 * state machine (`resolveOfferingCta`). An RSVP row has zero tickets, so every
 * open RSVP fell into the "no visible tickets" branch and told guests
 * "Not on sale yet" on a free event that was taking RSVPs. RSVP events never go
 * through that machine for this pill; they get a countdown to the start instead.
 *
 * Time math uses ONLY absolute instants (`Date.parse` of the stored UTC start/
 * end and `nowMs`), so the result is the same for every viewer regardless of the
 * timezone their device is set to.
 *
 * Precedence (first match wins):
 *   invalid / missing start      → null (render nothing rather than guess)
 *   now >= end                   → "Ended"
 *   now >= start                 → "Happening now"
 *   guest list full + waitlist   → "Guest list full · Join the waitlist"
 *   guest list full, no waitlist → "Guest list full"
 *   >= 1 day to start            → "Starts in N day(s)"
 *   >= 1 hour to start           → "Starts in N hour(s)"
 *   >= 1 minute to start         → "Starts in N minute(s)"
 *   < 1 minute to start          → "Starting soon"
 *
 * Counts are floored, like a countdown clock: 1 day 23 hours reads "1 day", and
 * the unit only changes once a whole unit has elapsed.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export type RsvpStatusBannerKind =
  | "countdown"
  | "starting_soon"
  | "happening_now"
  | "ended"
  | "full_waitlist"
  | "full";

export interface RsvpStatusBanner {
  kind: RsvpStatusBannerKind;
  label: string;
}

export interface RsvpStatusBannerInput {
  /** The event's master start instant (ISO 8601 with offset). */
  startAtUtc: string | null | undefined;
  /** The event's master end instant (ISO 8601 with offset). */
  endAtUtc: string | null | undefined;
  nowMs: number;
  /** Confirmed-going headcount has reached the RSVP capacity. */
  capacityFull: boolean;
  waitlistEnabled: boolean;
  /** Manual approval never hard-blocks, so a full manual list keeps the countdown. */
  manualApproval: boolean;
}

const plural = (n: number, unit: string): string =>
  `${n} ${unit}${n === 1 ? "" : "s"}`;

const parseInstant = (value: string | null | undefined): number | null => {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/** "Starts in 3 days" / "Starts in 1 hour" / "Starts in 12 minutes" / "Starting soon". */
export const formatRsvpStartsIn = (msUntilStart: number): string => {
  const ms = Math.max(0, msUntilStart);
  if (ms >= DAY_MS) return `Starts in ${plural(Math.floor(ms / DAY_MS), "day")}`;
  if (ms >= HOUR_MS) return `Starts in ${plural(Math.floor(ms / HOUR_MS), "hour")}`;
  if (ms >= MINUTE_MS) {
    return `Starts in ${plural(Math.floor(ms / MINUTE_MS), "minute")}`;
  }
  return "Starting soon";
};

export const resolveRsvpStatusBanner = (
  input: RsvpStatusBannerInput,
): RsvpStatusBanner | null => {
  const startMs = parseInstant(input.startAtUtc);
  if (startMs === null || !Number.isFinite(input.nowMs)) return null;
  const endMs = parseInstant(input.endAtUtc);
  const now = input.nowMs;

  if (endMs !== null && endMs > startMs && now >= endMs) {
    return { kind: "ended", label: "Ended" };
  }
  if (now >= startMs) {
    return { kind: "happening_now", label: "Happening now" };
  }
  if (input.capacityFull) {
    if (input.waitlistEnabled) {
      return {
        kind: "full_waitlist",
        label: "Guest list full · Join the waitlist",
      };
    }
    if (!input.manualApproval) {
      return { kind: "full", label: "Guest list full" };
    }
  }
  const until = startMs - now;
  return {
    kind: until < MINUTE_MS ? "starting_soon" : "countdown",
    label: formatRsvpStartsIn(until),
  };
};

/**
 * How long until the banner copy can next change. The countdown only needs to
 * re-render at unit boundaries; the value is clamped to [1s, 60s] so a sleeping
 * tab or a clock jump self-corrects within a minute.
 */
export const rsvpStatusBannerRefreshDelayMs = (
  input: Pick<RsvpStatusBannerInput, "startAtUtc" | "endAtUtc" | "nowMs">,
): number => {
  const startMs = parseInstant(input.startAtUtc);
  if (startMs === null) return 60_000;
  const endMs = parseInstant(input.endAtUtc);
  const now = input.nowMs;
  const clamp = (ms: number): number => Math.min(60_000, Math.max(1_000, ms));
  if (now >= startMs) {
    return endMs !== null && endMs > now ? clamp(endMs - now) : 60_000;
  }
  const until = startMs - now;
  const unit = until >= DAY_MS ? DAY_MS : until >= HOUR_MS ? HOUR_MS : MINUTE_MS;
  // Time until `until` drops below its current whole-unit multiple.
  const intoUnit = until % unit;
  return clamp(intoUnit === 0 ? unit : intoUnit + 1);
};
