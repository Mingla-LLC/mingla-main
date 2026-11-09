// Issue #4339 Creators and Locals calls (Seth approved, 9 Nov) — booked calls
// on the admin Calendar. Pure: no React, no Supabase.
//
// Every Book a call booking (Host from usemingla.com/schedule, Creator from
// /schedule/creators, Local from /schedule/locals) is read for the month on
// screen through admin_calendar_calls, beside #3980's ops_calendar. A call is
// an instant (`call_at`, timestamptz), so it is drawn on its LOCAL day and at
// its local time in the VIEWER's time zone (their device's zone), and the
// footnote names that zone. Events keep their own local day and time.
//
// There is no cancel or move path for a booking today, so every call's
// status is "booked".

import { BOOKING_ICP_LABELS, SOCIAL_LABELS } from "./inboundLeads.js";

export const CALL_LABELS = Object.freeze({ host: "Host call", creator: "Creator call", local: "Local call" });
export const MAKES_LABELS = Object.freeze({ video: "Video", photo: "Photos", both: "Video and photos" });

/** The viewer's IANA time zone (their device's), or null when the browser cannot say. */
export function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function zoneOrUndefined(timeZone) {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

function validDate(iso) {
  if (typeof iso !== "string") return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "YYYY-MM-DD" of an instant on the calendar of `timeZone` (default: the device's). */
export function callDayKey(iso, timeZone) {
  const date = validDate(iso);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zoneOrUndefined(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "4:30 PM" in `timeZone` (default: the device's). */
export function callTime(iso, timeZone) {
  const date = validDate(iso);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: zoneOrUndefined(timeZone), hour: "numeric", minute: "2-digit" }).format(date);
}

/** "Tuesday 11 March 2031, 4:30 PM PDT" in `timeZone` (default: the device's). */
export function callWhen(iso, timeZone) {
  const date = validDate(iso);
  if (!date) return "";
  const zone = zoneOrUndefined(timeZone);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
  return `${day}, ${time}`;
}

/** The zone's short name at an instant ("WAT", "PST"), or "" when unknown. */
export function zoneShortName(timeZone, at = new Date()) {
  const zone = zoneOrUndefined(timeZone);
  if (!zone) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value || "";
}

/** The Calendar footnote, naming the viewer's zone. */
export function calendarZoneNote(timeZone = viewerTimeZone(), at = new Date()) {
  const zone = timeZone ? `${timeZone} ${zoneShortName(timeZone, at)}`.trim() : "local time";
  return `Calls and post times are in your time zone (${zone}). Events stay on their own local day and time.`;
}

/** Only a real https link is ever rendered. */
function httpsLink(url) {
  if (typeof url !== "string") return null;
  const value = url.trim();
  return /^https:\/\/[^\s]+$/i.test(value) ? value : null;
}

/** The calls drawn on one day of the viewer's calendar, in time order. */
export function callEntriesOn(dayKey, calls, timeZone) {
  const out = [];
  for (const call of Array.isArray(calls) ? calls : []) {
    if (!call || !CALL_LABELS[call.audience] || callDayKey(call.call_at, timeZone) !== dayKey) continue;
    out.push({
      type: "call",
      id: `call-${call.id}`,
      callId: call.id,
      title: call.name || "Booked call",
      time: callTime(call.call_at, timeZone),
      badge: CALL_LABELS[call.audience],
      audience: call.audience,
      at: call.call_at,
    });
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** What the call panel shows. */
export function callView(call, timeZone) {
  if (!call || !CALL_LABELS[call.audience]) return null;
  const bookerZone = typeof call.booker_time_zone === "string" && zoneOrUndefined(call.booker_time_zone) ? call.booker_time_zone : null;
  const what =
    call.audience === "host" ? (BOOKING_ICP_LABELS[call.icp] ? `Runs: ${BOOKING_ICP_LABELS[call.icp]}` : null)
      : call.audience === "creator" ? (MAKES_LABELS[call.makes] ? `Makes: ${MAKES_LABELS[call.makes]}` : null)
        : call.first_place ? `First place: ${call.first_place}` : null;
  return {
    id: call.id,
    badge: CALL_LABELS[call.audience],
    name: call.name || "Booked call",
    when: callWhen(call.call_at, timeZone),
    // The booker's own clock, when their zone is known and differs from the viewer's.
    bookerWhen: bookerZone && bookerZone !== (timeZone || viewerTimeZone()) ? `${callWhen(call.call_at, bookerZone)} (${bookerZone})` : null,
    what,
    venue: call.audience === "host" && call.venue ? call.venue : null,
    city: call.city || null,
    socialLabel: SOCIAL_LABELS[call.social_platform] || "Social",
    socialHandle: typeof call.social_handle === "string" && call.social_handle.trim() ? call.social_handle.trim() : null,
    socialUrl: httpsLink(call.social_url),
    workUrl: httpsLink(call.work_url),
    meetUrl: httpsLink(call.meet_url),
    eventUrl: httpsLink(call.event_url),
    leadHash: `#/inbound?lead=${encodeURIComponent(call.lead_id || call.id)}`,
    status: call.status || "booked",
    isTest: !!call.is_test,
  };
}

/** The [from, to) instants for the days on screen, from the viewer's local midnight. */
export function callRange(firstDay, lastDay) {
  const from = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate());
  const to = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}
