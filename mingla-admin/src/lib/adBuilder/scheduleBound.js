/**
 * Issue #4238 — an Admin campaign on a dated page (a series, a trip, an RSVP)
 * ends by the last moment anyone can still book it, the same rule the Host
 * builder follows. The server (ad-plan create_version) refuses a missing or
 * later end with `schedule_end_required` / `schedule_ends_after_last_date`;
 * this module defaults and caps the end first and turns those codes into a
 * plain sentence.
 *
 * Pure: no React, no I/O. Times are wall-clock strings in the Builder's named
 * schedule zone ("YYYY-MM-DDTHH:mm"), like the datetime-local inputs.
 */

import { isValidTimeZone } from "./scheduleTimeZone.js";

/** `iso` as a "YYYY-MM-DDTHH:mm" wall-clock string in `timeZone`, rounded DOWN to the minute. */
export function isoToZonedLocal(iso, timeZone) {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms) || !isValidTimeZone(timeZone)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "Mon 7 Dec, 00:30" for an instant in `timeZone`. */
function dayAndTime(iso, timeZone) {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${day}, ${time}`;
}

/**
 * The last bookable moment of the chosen page, in the schedule zone, or null
 * for a page without dates (brand, venue, site, marketing, apps).
 *   lastIso   the exact moment (what the server caps at)
 *   maxLocal  the input's max ("YYYY-MM-DDTHH:mm", never past lastIso)
 *   label     "Mon 7 Dec, 00:30" — the same moment the input stops at
 */
export function adminScheduleLimit(destination, scheduleZone) {
  const raw = destination?.last_bookable_at;
  const ms = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  const zone = isValidTimeZone(scheduleZone) ? scheduleZone : "UTC";
  const lastIso = new Date(ms).toISOString();
  return {
    lastIso,
    maxLocal: isoToZonedLocal(lastIso, zone),
    label: dayAndTime(lastIso, zone),
    zone,
  };
}

/** The plain sentence under the schedule inputs for a dated page. */
export function adminScheduleLimitNote(limit) {
  if (!limit) return null;
  return `This page's last bookable moment is ${limit.label} (${limit.zone}). The campaign ends by then; the end is set to it unless you pick an earlier one.`;
}

/** A plain sentence when the chosen start or end is past the limit, or null. */
export function adminScheduleBoundError(budget, limit) {
  if (!limit) return null;
  const limitMs = Date.parse(limit.lastIso);
  const start = budget?.startsAt ? Date.parse(budget.startsAt) : Number.NaN;
  const end = budget?.endsAt ? Date.parse(budget.endsAt) : Number.NaN;
  if (!Number.isFinite(end)) {
    return `Set an end on or before ${limit.label} (${limit.zone}), the last moment people can book this page.`;
  }
  if (end > limitMs) {
    return `The campaign can run until ${limit.label} (${limit.zone}), the last moment people can book this page. Pick an earlier end.`;
  }
  if (Number.isFinite(start) && start >= limitMs) {
    return `The campaign has to start before ${limit.label} (${limit.zone}), the last moment people can book this page.`;
  }
  return null;
}

/**
 * The server's schedule codes in plain words. Returns the sentence for a
 * known code, or null so the caller keeps its own message.
 */
export function adminScheduleCodeMessage(detail, limit) {
  const code = String(detail ?? "");
  const when = limit ? `${limit.label} (${limit.zone})` : "the last day people can book";
  if (/schedule_end_required/.test(code)) {
    return `This page has dates, so the campaign needs an end on or before ${when}, the last moment people can book.`;
  }
  if (/schedule_ends_after_last_date/.test(code)) {
    return `The campaign can run until ${when}, the last moment people can book this page. Pick an earlier end.`;
  }
  if (/schedule_starts_after_last_date/.test(code)) {
    return `The campaign has to start before ${when}, the last moment people can book this page.`;
  }
  return null;
}
