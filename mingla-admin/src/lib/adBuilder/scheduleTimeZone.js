/**
 * Issue #3697 — campaign start/end times are entered in a NAMED time zone,
 * never silently in the browser's zone. A Lagos event scheduled from a London
 * or US browser must start at the Lagos wall-clock time the operator typed.
 *
 * Pure: `zonedLocalToIso` converts a `YYYY-MM-DDTHH:mm` wall-clock string in an
 * IANA zone to an absolute ISO instant using only Intl (no dependency).
 */

/** Zones offered in the Builder. The browser zone is added when it differs. */
export const SCHEDULE_TIME_ZONES = Object.freeze([
  "Africa/Lagos",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
]);

const COUNTRY_ZONES = Object.freeze({
  NG: "Africa/Lagos",
  GB: "Europe/London",
});

export function isValidTimeZone(zone) {
  if (typeof zone !== "string" || zone.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function browserTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * The default zone: the single targeted country's zone when it is known
 * (Nigeria → Africa/Lagos), otherwise the browser zone.
 */
export function defaultScheduleTimeZone(countries = [], fallback = browserTimeZone()) {
  const unique = [...new Set((countries ?? []).map((c) => String(c).toUpperCase()))];
  if (unique.length === 1 && COUNTRY_ZONES[unique[0]]) return COUNTRY_ZONES[unique[0]];
  return isValidTimeZone(fallback) ? fallback : "UTC";
}

/** The zone list for the picker, always containing `current`. */
export function scheduleTimeZoneOptions(current, browser = browserTimeZone()) {
  const zones = [...SCHEDULE_TIME_ZONES];
  for (const zone of [browser, current]) {
    if (isValidTimeZone(zone) && !zones.includes(zone)) zones.push(zone);
  }
  return zones;
}

function zoneOffsetMinutes(utcMillis, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMillis));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - utcMillis) / 60000);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * `2026-10-23T18:00` in `Africa/Lagos` → `2026-10-23T17:00:00.000Z`.
 * Returns null for an empty/invalid input or zone (never guesses a zone).
 */
export function zonedLocalToIso(local, timeZone) {
  if (typeof local !== "string" || !isValidTimeZone(timeZone)) return null;
  const match = LOCAL_RE.exec(local.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  if (!Number.isFinite(wall)) return null;
  // Two passes settle DST edges: guess with the offset at the wall time, then
  // correct with the offset at the resulting instant.
  let instant = wall - zoneOffsetMinutes(wall, timeZone) * 60000;
  instant = wall - zoneOffsetMinutes(instant, timeZone) * 60000;
  return new Date(instant).toISOString();
}

/** Human label: "Africa/Lagos (GMT+1)". */
export function timeZoneLabel(timeZone, at = new Date()) {
  if (!isValidTimeZone(timeZone)) return "Time zone unresolved";
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    return name ? `${timeZone} (${name})` : timeZone;
  } catch {
    return timeZone;
  }
}

/** Format an ISO instant in the plan's zone for Review. */
export function formatInZone(iso, timeZone) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  return `${date.toLocaleString("en-GB", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  })} ${zone}`;
}
