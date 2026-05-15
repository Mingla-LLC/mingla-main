// ORCH-0828 — wall-clock-in-IANA-tz → UTC instant.
//
// Used by discover-merged-events to convert the client's
// `localStartEndDateTime` (a "YYYY-MM-DDTHH:MM:SS,YYYY-MM-DDTHH:MM:SS" pair
// interpreted as wall-clock in the device's IANA timezone) into UTC ISO
// instants suitable for comparing against `event_dates.start_at`
// (which is `timestamptz`, stored as UTC).
//
// Zero-dependency: uses only the V8 built-in Intl.DateTimeFormat that ships
// with Deno. Handles DST transitions via offset re-anchoring (two iterations
// converge in the worst case across all IANA tz boundaries we ship to).

const LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function getTzOffsetMs(instant: number, tz: string): number {
  // Returns (wallClockInTz - instantUTC) in milliseconds.
  // Positive when tz is ahead of UTC (e.g. Europe/London BST = +60min).
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
 * Convert a wall-clock string interpreted in `tz` to a UTC ISO instant.
 * Throws on malformed input. Caller must validate `tz` is a real IANA id
 * (Intl will throw `RangeError` if not).
 *
 * Example:
 *   localWallClockToUtcInstant("2026-05-14T16:00:00", "America/New_York")
 *   → "2026-05-14T20:00:00.000Z"   (EDT = UTC-4)
 */
export function localWallClockToUtcInstant(
  local: string,
  tz: string,
): string {
  const m = LOCAL_RE.exec(local);
  if (m === null) {
    throw new Error(`invalid_local_wall_clock: ${local}`);
  }
  const [, y, mo, d, h, mi, s] = m;
  const naive = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    s ? Number(s) : 0,
  );
  // First pass: get offset assuming the naive instant is the answer.
  let offset = getTzOffsetMs(naive, tz);
  let utc = naive - offset;
  // Second pass: re-anchor at the candidate UTC instant to catch the case
  // where the first pass landed on the wrong side of a DST transition.
  const offset2 = getTzOffsetMs(utc, tz);
  if (offset2 !== offset) {
    offset = offset2;
    utc = naive - offset;
  }
  return new Date(utc).toISOString();
}

/**
 * Parse the discover-merged-events `localStartEndDateTime` string pair.
 * Returns `{ startUtc, endUtc }` as ISO instants. Throws on malformed
 * input or invalid timezone.
 */
export function parseLocalStartEndDateTime(
  pair: string,
  tz: string,
): { startUtc: string; endUtc: string } {
  const parts = pair.split(",");
  if (parts.length !== 2) {
    throw new Error("invalid_local_start_end_datetime");
  }
  const [startLocal, endLocal] = parts.map((p) => p.trim());
  const startUtc = localWallClockToUtcInstant(startLocal, tz);
  const endUtc = localWallClockToUtcInstant(endLocal, tz);
  return { startUtc, endUtc };
}
