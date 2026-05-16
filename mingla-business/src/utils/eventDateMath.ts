/**
 * ORCH-0828 — timezone-aware event-time math.
 *
 * Before 0828, `eventLifecycle.deriveLiveStatus` did
 * `new Date(event.date).getTime()` which parses `"YYYY-MM-DD"` as UTC
 * midnight. For an event in `America/New_York` whose actual start was
 * 4:00 PM EDT (= 20:00 UTC), the parser produced 00:00 UTC of the same
 * calendar day — 20 hours before the real start. The live-window check
 * then placed the event "live" hours before it actually was.
 *
 * This helper computes the event's master start instant correctly: it
 * takes the date-only string (event-local calendar day), the
 * door-open wall-clock time, and the event's IANA timezone, and
 * returns a UTC ISO instant.
 *
 * Zero-dependency. Uses the V8 / Hermes built-in Intl.DateTimeFormat
 * which supports IANA timeZone since RN 0.71+. The two-pass DST
 * re-anchoring matches the shared edge-function helper at
 * `supabase/functions/_shared/timezone.ts`.
 */

import type { LiveEvent } from "../store/liveEventStore";

function getTzOffsetMs(instant: number, tz: string): number {
  // Returns (wallClockInTz - instantUTC) in milliseconds.
  // Positive when tz is ahead of UTC (e.g. London BST = +60min).
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(instant));
  const lookup = (t: string): string => {
    for (const p of parts) {
      if (p.type === t) return p.value;
    }
    return "00";
  };
  const tzWallUtc = Date.UTC(
    Number(lookup("year")),
    Number(lookup("month")) - 1,
    Number(lookup("day")),
    Number(lookup("hour")),
    Number(lookup("minute")),
    Number(lookup("second")),
  );
  return tzWallUtc - instant;
}

/**
 * Convert `wallClock` (e.g. "2026-05-14T16:00:00") interpreted in `tz` to
 * a UTC ISO instant. Returns null on malformed input or invalid tz.
 *
 * Example:
 *   localWallClockToUtcInstant("2026-05-14T16:00:00", "America/New_York")
 *   → "2026-05-14T20:00:00.000Z"
 */
export function localWallClockToUtcInstant(
  wallClock: string,
  tz: string,
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    wallClock,
  );
  if (m === null) return null;
  const [, y, mo, d, h, mi, s] = m;
  let naive: number;
  try {
    naive = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      s ? Number(s) : 0,
    );
  } catch {
    return null;
  }
  if (!Number.isFinite(naive)) return null;

  let offset: number;
  try {
    offset = getTzOffsetMs(naive, tz);
  } catch {
    // RangeError when tz is not a valid IANA id
    return null;
  }
  let utc = naive - offset;
  // Re-anchor once to handle DST boundary cases.
  const offset2 = getTzOffsetMs(utc, tz);
  if (offset2 !== offset) {
    offset = offset2;
    utc = naive - offset;
  }
  return new Date(utc).toISOString();
}

/**
 * Compute the master start instant of a LiveEvent as a UTC ISO timestamp.
 *
 * Sources, in order of preference:
 *   1. `event.masterStartAtUtc` if hydrated from `event_dates.start_at`
 *      (preferred — exact authoritative value)
 *   2. `event.date + event.doorsOpen` parsed in `event.timezone`
 *   3. `event.date + "T00:00:00"` parsed in `event.timezone` (fallback;
 *      better than UTC-midnight from a bare date-only Date constructor)
 *
 * Returns null when the event has no date at all (unscheduled draft) or
 * when timezone parsing fails. Callers must treat null as "upcoming /
 * unknown" rather than as "live".
 */
export function computeMasterStartAtUtc(event: LiveEvent): string | null {
  // If a server-derived value is already on the event, prefer it.
  // (Field is optional — older persisted LiveEvents won't have it.)
  const direct = (event as LiveEvent & { masterStartAtUtc?: string | null })
    .masterStartAtUtc;
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }
  if (event.date === null) return null;
  const tz = event.timezone || "UTC";
  const doorsTime = event.doorsOpen ?? "00:00";
  // doorsOpen is normally "HH:mm" or "HH:mm:ss"; tolerate both
  const normalizedDoors = /^\d{2}:\d{2}$/.test(doorsTime)
    ? `${doorsTime}:00`
    : doorsTime;
  const wallClock = `${event.date}T${normalizedDoors}`;
  return localWallClockToUtcInstant(wallClock, tz);
}

/**
 * Compute the master END instant of a LiveEvent as a UTC ISO timestamp.
 *
 * Sources, in order of preference:
 *   1. `event.masterEndAtUtc` if hydrated from `event_dates.end_at`
 *      (preferred — exact authoritative value; field currently unset by any
 *      hydration site per ORCH-0850 pre-flight grep, but reserved for the
 *      future server-projection extension)
 *   2. `event.date + event.endsAt` parsed in `event.timezone`
 *      (best-effort from display fields when hydrated field absent)
 *   3. `event.date + "T23:59:59"` parsed in `event.timezone` (last-resort
 *      fallback; assumes event runs until end of its local calendar day)
 *
 * Returns null when the event has no date at all (unscheduled draft) or
 * when timezone parsing fails. Callers treat null as "unknown — do not
 * declare past on the time-axis alone"; the canonical `isEventPast` helper
 * separately short-circuits on status='ended' / endedAt !== null.
 *
 * Established by ORCH-0850 [End-not-start parity systemic]. Mirrors
 * `computeMasterStartAtUtc` for the end-instant case; enforces
 * I-PROPOSED-LIVE-STATUS-UTC-INPUT for past-decision math.
 */
export function computeMasterEndAtUtc(event: LiveEvent): string | null {
  const direct = (event as LiveEvent & { masterEndAtUtc?: string | null })
    .masterEndAtUtc;
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }
  if (event.date === null) return null;
  const tz = event.timezone || "UTC";
  if (typeof event.endsAt === "string" && event.endsAt.length > 0) {
    const endsTime = /^\d{2}:\d{2}$/.test(event.endsAt)
      ? `${event.endsAt}:00`
      : event.endsAt;
    const candidate = localWallClockToUtcInstant(
      `${event.date}T${endsTime}`,
      tz,
    );
    if (candidate !== null) return candidate;
  }
  return localWallClockToUtcInstant(`${event.date}T23:59:59`, tz);
}
