// Issue #4383 — "Later" pickers: a date and time typed in a chosen IANA
// timezone, turned into one UTC instant (Constitution 12: validated in the
// SELECTED timezone at submit, and again on the server).
//
// Pure module: no React, no Supabase, so the plain node tests run it.

/** The browser's own zone, or UTC when it cannot say. */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const COMMON_ZONES = ["Africa/Lagos", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Helsinki", "Europe/Dublin", "UTC"];

/** Every zone the browser knows (common ones first), always including `extra`. */
export function timeZoneOptions(extra = []) {
  let all = [];
  try {
    all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch {
    all = [];
  }
  const seen = new Set();
  const out = [];
  for (const zone of [...extra, ...COMMON_ZONES, ...all]) {
    if (typeof zone === "string" && zone && !seen.has(zone) && isValidTimeZone(zone)) {
      seen.add(zone);
      out.push(zone);
    }
  }
  return out;
}

export function isValidTimeZone(zone) {
  if (typeof zone !== "string" || !zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// The wall-clock parts of an instant in a zone.
function partsIn(instantMs, zone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(instantMs)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

// How far the zone's wall clock is ahead of UTC at an instant, in ms.
function offsetAt(instantMs, zone) {
  const p = partsIn(instantMs, zone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(instantMs / 1000) * 1000;
}

/**
 * "2026-11-14", "17:00", "Africa/Lagos" -> the UTC instant (a Date), or null
 * when the input is not a real date, time and zone. A wall time that does
 * not exist (skipped by a clock change) returns null rather than a guess.
 */
export function zonedLocalToUtc(dateStr, timeStr, zone) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  const tm = /^(\d{2}):(\d{2})$/.exec(String(timeStr || ""));
  if (!dm || !tm || !isValidTimeZone(zone)) return null;
  const [y, m, d, h, mi] = [Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(tm[1]), Number(tm[2])];
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let guess = wall - offsetAt(wall, zone);
  guess = wall - offsetAt(guess, zone);
  const back = partsIn(guess, zone);
  if (back.y !== y || back.m !== m || back.d !== d || back.h !== h || back.mi !== mi) return null;
  return new Date(guess);
}

/** An instant as the date and time inputs of a zone: { date: "2026-11-14", time: "17:00" }. */
export function utcToZonedInputs(iso, zone) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !isValidTimeZone(zone)) return { date: "", time: "" };
  const p = partsIn(ms, zone);
  const pad = (n) => String(n).padStart(2, "0");
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/**
 * The time a "Later" choice resolves to, or why it cannot be used. The server
 * refuses anything less than a minute ahead, so the screen does too.
 */
export function checkLaterTime({ date, time, zone }, nowMs = Date.now()) {
  if (!isValidTimeZone(zone)) return { ok: false, message: "Pick a timezone." };
  if (!date || !time) return { ok: false, message: "Pick a date and a time." };
  const at = zonedLocalToUtc(date, time, zone);
  if (!at) return { ok: false, message: "That time doesn't exist in this timezone (the clocks change). Pick another." };
  if (at.getTime() <= nowMs + 60_000) return { ok: false, message: "Pick a time at least a minute from now." };
  return { ok: true, at };
}

/** "Fri 14 Nov · 17:00" in a zone (the zone itself is shown beside it). */
export function formatInZone(iso, zone) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const safeZone = isValidTimeZone(zone) ? zone : "UTC";
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: safeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(ms));
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: safeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  return `${date.replace(",", "")} · ${clock}`;
}

/**
 * What a list shows for a scheduled time: the saved zone's wall time and,
 * when the viewer's zone differs, the viewer's too.
 */
export function scheduleLabel(iso, zone, viewerZone = browserTimeZone()) {
  const saved = formatInZone(iso, zone);
  if (!saved) return { primary: "", zone: "", viewer: "" };
  const viewer = viewerZone && viewerZone !== zone ? `${formatInZone(iso, viewerZone)} your time` : "";
  return { primary: saved, zone: isValidTimeZone(zone) ? zone : "UTC", viewer };
}
