// #4318 — Links page custom strips: the form rules, the save arguments and the
// reorder logic the Links page tab (components/links/LinksPagePanel.jsx) uses.
//
// Pure module: no React, no Supabase, so plain node tests can load it.
// The server (admin_links_strip_save / admin_links_strips_reorder) re-checks
// every rule here; this module only lets the form say what is wrong before a
// round trip.
//
// #4339: every strip has a time zone. The database owns the window (a strip
// is public from 00:00 on "Shows on" to 23:59 on "Show until", in its zone:
// links_strip_window) and the list's status; this module only words them,
// plus the editor's live preview of the window before a save.

import { browserTimeZone, formatInZone, isValidTimeZone, zonedLocalToUtc } from "./scheduleTime.js";
import { zoneCity, zoneOffset } from "./timeZoneSearch.js";

export const LINKS_STRIP_TITLE_MAX = 60;

export const LINKS_STRIP_LABELS = Object.freeze(["From Mingla", "Featured", "New", "Giveaway"]);

export const LINKS_STRIP_OPENS = Object.freeze([
  Object.freeze({ id: "web", label: "Web link" }),
  Object.freeze({ id: "blog", label: "Blog post" }),
  Object.freeze({ id: "explorer", label: "Explorer app" }),
  Object.freeze({ id: "host", label: "Host app" }),
]);

// The server's rule, exactly (admin_links_strip_save in
// supabase/migrations/20280508004318_issue_4318_links_page.sql): after an
// optional http(s):// is stripped, a host of letters, digits and inner
// hyphens per label, a 2-63 letter TLD, an optional port, then any path,
// query or fragment; at most 500 characters and no other scheme.
const WEB_LINK_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(:[0-9]{1,5})?([/?#]\S*)?$/i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const WEB_LINK_MAX = 500;

/** True when the server will accept this web link. */
export function isValidStripUrl(url) {
  const value = normalizeStripUrl(url);
  return value.length > 0 && value.length <= WEB_LINK_MAX && !OTHER_SCHEME.test(value) && WEB_LINK_PATTERN.test(value);
}

export const LINKS_STRIP_MESSAGES = Object.freeze({
  title: "Add a title so people know what the strip is.",
  titleTooLong: `Keep the title to ${LINKS_STRIP_TITLE_MAX} characters.`,
  showsOn: "Choose the day the strip shows on.",
  showsUntil: "“Show until” can't be before “Shows on”. Pick the same day or a later one, or leave it empty.",
  timeZone: "Pick a time zone from the list.",
  label: "Choose a label.",
  opens: "Choose what the strip opens.",
  blog: "Choose the blog post this strip opens.",
  url: "Enter a web link like usemingla.com/host.",
});

/** The web link as stored: trimmed, with any http(s):// removed. */
export function normalizeStripUrl(url) {
  return String(url ?? "").trim().replace(/^https?:\/\//i, "");
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The first problem with a strip draft, as { field, message }, or null when
 * it can be saved. Checked in the order the form reads, top to bottom.
 */
export function validateStripDraft(draft) {
  const value = draft || {};
  const title = String(value.title ?? "").trim();
  if (!ISO_DAY.test(String(value.showsOn ?? ""))) return { field: "showsOn", message: LINKS_STRIP_MESSAGES.showsOn };
  // "Show until" is optional: empty keeps the strip to its one day. ISO days
  // compare correctly as strings.
  const until = String(value.showsUntil ?? "").trim();
  if (until && (!ISO_DAY.test(until) || until < value.showsOn)) {
    return { field: "showsUntil", message: LINKS_STRIP_MESSAGES.showsUntil };
  }
  if (!isValidTimeZone(value.timeZone)) return { field: "timeZone", message: LINKS_STRIP_MESSAGES.timeZone };
  if (!title) return { field: "title", message: LINKS_STRIP_MESSAGES.title };
  if (title.length > LINKS_STRIP_TITLE_MAX) return { field: "title", message: LINKS_STRIP_MESSAGES.titleTooLong };
  if (!LINKS_STRIP_LABELS.includes(value.label)) return { field: "label", message: LINKS_STRIP_MESSAGES.label };
  if (!LINKS_STRIP_OPENS.some((option) => option.id === value.opens)) return { field: "opens", message: LINKS_STRIP_MESSAGES.opens };
  if (value.opens === "blog" && !value.blogPostId) return { field: "blog", message: LINKS_STRIP_MESSAGES.blog };
  if (value.opens === "web" && !isValidStripUrl(value.url)) {
    return { field: "url", message: LINKS_STRIP_MESSAGES.url };
  }
  return null;
}

/**
 * The admin_links_strip_save arguments for a valid draft. Strips are not by
 * city: every strip shows on every city's view. Only a web strip sends a URL
 * and only a blog strip sends a post, so switching "Opens" never leaves a stale value behind.
 */
export function stripSaveArgs(draft) {
  return {
    p_id: draft.id || null,
    p_shows_on: draft.showsOn,
    p_title: String(draft.title ?? "").trim(),
    p_label: draft.label,
    p_opens: draft.opens,
    p_url: draft.opens === "web" ? normalizeStripUrl(draft.url) : null,
    p_blog_post_id: draft.opens === "blog" ? draft.blogPostId : null,
    // Empty means the strip shows on its one day only.
    p_shows_until: String(draft.showsUntil ?? "").trim() || null,
    // #4339: the zone the days are read in; the server refuses any it does not know.
    p_time_zone: draft.timeZone,
  };
}

/** The strips as the list RPC returns them, top of the page first. */
export function stripRows(data) {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.strips) ? data.strips : [];
  return [...rows].sort((a, b) => (Number(a.position) - Number(b.position)) || String(a.id).localeCompare(String(b.id)));
}

/**
 * The list with the strip `id` moved to index `to` (clamped to the ends), or
 * null when nothing moves (unknown id, or already there).
 */
export function moveStrip(strips, id, to) {
  const from = strips.findIndex((strip) => strip.id === id);
  if (from < 0) return null;
  const target = Math.max(0, Math.min(strips.length - 1, Number(to)));
  if (!Number.isFinite(target) || target === from) return null;
  const next = [...strips];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * Optimistic reorder: show `next` straight away, save its order, and put
 * `previous` back if the save fails (including a stale order, PT409). The
 * error is rethrown so the caller can say what happened.
 */
export async function runOptimisticReorder({ previous, next, apply, commit }) {
  apply(next);
  try {
    await commit(next.map((strip) => strip.id));
  } catch (error) {
    apply(previous);
    throw error;
  }
}

/** Local calendar day as YYYY-MM-DD. */
export function isoDay(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayFromIso(value) {
  if (!ISO_DAY.test(String(value ?? ""))) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The "Shows on" choices: today and the next six days. */
export function showsOnOptions(today = new Date(), days = 7) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const name = day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    return { value: isoDay(day), label: i === 0 ? `Today, ${name}` : name };
  });
}

/** The strip's mono line on the page: its label and day ("From Mingla · Thu 12"). */
export function stripMetaLine(label, showsOn, today = new Date()) {
  const day = dayFromIso(showsOn);
  if (!day) return label;
  const when = isoDay(day) === isoDay(today)
    ? "Today"
    : `${day.toLocaleDateString("en-GB", { weekday: "short" })} ${day.getDate()}`;
  return `${label} · ${when}`;
}

/**
 * The days a strip shows, for the strips list: "Mon 9 – Fri 13", the month
 * added when the range crosses one ("Fri 30 Oct – Mon 2 Nov"), or the single
 * day ("Thu 12") when there is no end date.
 */
export function stripDateRange(showsOn, showsUntil) {
  const start = dayFromIso(showsOn);
  if (!start) return "No day";
  const short = (day, withMonth) => `${day.toLocaleDateString("en-GB", { weekday: "short" })} ${day.getDate()}${withMonth ? ` ${day.toLocaleDateString("en-GB", { month: "short" })}` : ""}`;
  const end = dayFromIso(showsUntil);
  if (!end || isoDay(end) <= isoDay(start)) return short(start, false);
  const crossesMonth = start.getMonth() !== end.getMonth() || start.getFullYear() !== end.getFullYear();
  return `${short(start, crossesMonth)} – ${short(end, crossesMonth)}`;
}

/** The day in words ("Thursday 12 November"). */
export function stripDayLabel(showsOn) {
  const day = dayFromIso(showsOn);
  return day ? day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "No day";
}

/** What a strip opens, in words, for the strips list. */
export function stripOpensSummary(strip) {
  if (strip.opens === "web") return `opens ${strip.url || "a web link"}`;
  if (strip.opens === "blog") return strip.blog_title ? `opens blog: ${strip.blog_title}` : "opens a blog post";
  if (strip.opens === "host") return "opens the Host app";
  if (strip.opens === "explorer") return "opens the Explorer app";
  return "opens nothing yet";
}

// ── #4339 time zones ─────────────────────────────────────────────────────────

/** The list pill for the server's status (admin_links_strips_list.status). */
export const LINKS_STRIP_STATUS = Object.freeze({
  scheduled: Object.freeze({ label: "Scheduled", tone: "scheduled" }),
  live: Object.freeze({ label: "Live", tone: "live" }),
  ended: Object.freeze({ label: "Ended", tone: "ended" }),
});

/** The pill for a strip, or null when the server sent no status this admin knows. */
export function stripStatus(strip) {
  const key = String(strip?.status || "");
  return Object.hasOwn(LINKS_STRIP_STATUS, key) ? LINKS_STRIP_STATUS[key] : null;
}

function addDayIso(value) {
  const [y, m, d] = value.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

function dayWords(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
}

// 00:00 on a day in a zone, as an instant. A zone whose clocks change at
// midnight skips 00:00 on that day; the day then starts at 01:00.
function zoneMidnight(day, zone) {
  return zonedLocalToUtc(day, "00:00", zone) || zonedLocalToUtc(day, "01:00", zone);
}

/**
 * The editor's live line under the dates: when the strip shows, in its zone
 * and on the admin's own clock. The same window as the database's
 * links_strip_window, for the preview only; the server decides. null until
 * "Shows on" and a valid zone are set.
 */
export function stripWindowLine({ showsOn, showsUntil, timeZone }, viewerZone = browserTimeZone()) {
  if (!ISO_DAY.test(String(showsOn ?? "")) || !isValidTimeZone(timeZone)) return null;
  const until = ISO_DAY.test(String(showsUntil ?? "")) && showsUntil >= showsOn ? showsUntil : showsOn;
  const start = zoneMidnight(showsOn, timeZone);
  const end = zoneMidnight(addDayIso(until), timeZone);
  if (!start || !end) return null;
  const lastMinute = new Date(end.getTime() - 60_000).toISOString();
  return {
    from: `00:00 ${dayWords(showsOn)}`,
    to: `23:59 ${dayWords(until)}`,
    zone: `${zoneCity(timeZone)} time (${zoneOffset(timeZone, start)})`,
    viewer: viewerZone && viewerZone !== timeZone
      ? `That is ${formatInZone(start.toISOString(), viewerZone)} to ${formatInZone(lastMinute, viewerZone)} your time.`
      : "That is your computer's time zone too.",
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
}

/** The strip's zone for the list: "Lagos GMT+1" (the offset at its first day), or "" without one. */
export function stripZoneLine(strip) {
  const zone = strip?.time_zone;
  if (!zone) return "";
  // A zone this browser cannot format still names itself (tester P3-4).
  if (!isValidTimeZone(zone)) return String(zone);
  const at = Date.parse(strip?.starts_at || "");
  return `${zoneCity(zone)} ${zoneOffset(zone, Number.isFinite(at) ? new Date(at) : new Date())}`;
}

/** "starts Mon 16 Nov · 00:00 your time" for a scheduled strip, from the server's starts_at; else "". */
export function stripStartsLine(strip, viewerZone = browserTimeZone()) {
  if (strip?.status !== "scheduled" || !strip?.starts_at) return "";
  const when = formatInZone(strip.starts_at, viewerZone);
  return when ? `starts ${when} your time` : "";
}
