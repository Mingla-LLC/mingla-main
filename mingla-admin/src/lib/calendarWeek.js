// Issue #4571 W5 — the Calendar's Week view. Pure: no React, no Supabase.
//
// One Monday-to-Sunday week with four layers you can switch on and off:
//   events     events on Mingla and promised events (ops_calendar)
//   demos      booked demo calls, with the host card they are linked to or
//              "Needs linking" (admin_calendar_calls, W4's shape)
//   callbacks  a host or creator's next phone follow-up (ops_calendar_callbacks)
//   work       open Work cards and subtasks due (ops_calendar_work_due)
//
// A demo is an instant: it sits on its day and at its time in the VIEWER's time
// zone, and the week runs Monday to Sunday in that zone (the zone's midnight, not
// UTC's). Events, promised events, call-backs and Work due are dates: they keep
// their own day and carry no time.
//
// The layer toggles live in the address (?layers=events,demos), never in local
// storage: absent means all four, "none" means none.
//
// Every Work due chip and every other chip wraps inside its own day column: the
// classes below carry no nowrap, no truncate and no line clamp, and a long word
// breaks anywhere (the prototype's Work due chip shared a class with the small
// due-date pill, collapsed to one line and spilled into the next days).

import { callDayKey, callEntriesOn } from "./calendarCalls.js";

export const WEEK_LAYERS = Object.freeze([
  { key: "events", label: "Events", tone: "events" },
  { key: "demos", label: "Demos", tone: "demos" },
  { key: "callbacks", label: "Call-backs", tone: "callbacks" },
  { key: "work", label: "Work due", tone: "work" },
]);
export const WEEK_LAYER_KEYS = Object.freeze(WEEK_LAYERS.map((l) => l.key));

const KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAY_MS = 86_400_000;

/** A date key ("YYYY-MM-DD") that is a real calendar day, or null. */
export function cleanDayKey(value) {
  const m = typeof value === "string" ? value.match(KEY_RE) : null;
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? value : null;
}

function keyOfMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function msOfKey(key) {
  const m = key.match(KEY_RE);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** A day key moved by whole days (calendar arithmetic, no time zone involved). */
export function addDaysKey(key, days) {
  const clean = cleanDayKey(key);
  return clean ? keyOfMs(msOfKey(clean) + days * DAY_MS) : "";
}

/** The Monday of the week holding this day. */
export function mondayOfKey(key) {
  const clean = cleanDayKey(key);
  if (!clean) return "";
  const dow = (new Date(msOfKey(clean)).getUTCDay() + 6) % 7;
  return addDaysKey(clean, -dow);
}

/** The seven day keys of the week starting on this Monday, Monday first. */
export function weekDayKeys(monday) {
  const start = mondayOfKey(monday);
  return start ? Array.from({ length: 7 }, (_, i) => addDaysKey(start, i)) : [];
}

/** The Monday a `week` address names (any day of the week works), else the week holding `todayKey`. */
export function weekFromParam(param, todayKey) {
  return mondayOfKey(cleanDayKey(param) || cleanDayKey(todayKey) || "") || "";
}

/** "23 to 29 Nov 2026", "30 Nov to 6 Dec 2026", "28 Dec 2026 to 3 Jan 2027". */
export function weekLabel(monday) {
  const days = weekDayKeys(monday);
  if (!days.length) return "";
  const first = new Date(msOfKey(days[0]));
  const last = new Date(msOfKey(days[6]));
  const fmt = (d, opts) => d.toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
  if (first.getUTCFullYear() !== last.getUTCFullYear()) {
    return `${fmt(first, { day: "numeric", month: "short", year: "numeric" })} to ${fmt(last, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  if (first.getUTCMonth() !== last.getUTCMonth()) {
    return `${fmt(first, { day: "numeric", month: "short" })} to ${fmt(last, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return `${first.getUTCDate()} to ${fmt(last, { day: "numeric", month: "short", year: "numeric" })}`;
}

// ---- time zones -------------------------------------------------------

function validZone(zone) {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

// The zone's offset from UTC at an instant, in ms (positive east of UTC).
function offsetMs(utcMs, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The instant (ms) of midnight at the start of this day in the zone (default: the device's). */
export function zonedMidnightMs(dayKey, timeZone) {
  const key = cleanDayKey(dayKey);
  if (!key) return NaN;
  const zone = validZone(timeZone);
  const guess = msOfKey(key);
  if (!zone) {
    const m = key.match(KEY_RE);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }
  // Two passes settle a day whose offset changes (the clocks go forward or back).
  const first = guess - offsetMs(guess, zone);
  return guess - offsetMs(first, zone);
}

/** Today's day key in the zone. */
export function todayKeyIn(timeZone, now = new Date()) {
  return callDayKey(now.toISOString(), validZone(timeZone)) || keyOfMs(now.getTime());
}

/** The [from, to) instants of the week in the viewer's zone, and its first and last day. */
export function weekRange(monday, timeZone) {
  const days = weekDayKeys(monday);
  if (!days.length) return null;
  const from = zonedMidnightMs(days[0], timeZone);
  const to = zonedMidnightMs(addDaysKey(days[6], 1), timeZone);
  return { from: days[0], to: days[6], fromIso: new Date(from).toISOString(), toIso: new Date(to).toISOString() };
}

// ---- layers (in the address) -----------------------------------------

/** The layers a `layers` address names. Absent: all four. "none": none. Unknown names are ignored. */
export function parseLayers(param) {
  if (param === null || param === undefined) return new Set(WEEK_LAYER_KEYS);
  if (param === "none") return new Set();
  const named = String(param).split(",").map((s) => s.trim()).filter((s) => WEEK_LAYER_KEYS.includes(s));
  return named.length ? new Set(named) : new Set(WEEK_LAYER_KEYS);
}

/** The `layers` address value for a set: null for all four, "none" for none, else the names in order. */
export function layersParam(set) {
  const on = WEEK_LAYER_KEYS.filter((k) => set.has(k));
  if (on.length === WEEK_LAYER_KEYS.length) return null;
  return on.length ? on.join(",") : "none";
}

/** The set with one layer switched on or off. */
export function toggleLayer(set, key) {
  if (!WEEK_LAYER_KEYS.includes(key)) return new Set(set);
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

// ---- classes (the wrapping fix) --------------------------------------

/** What every chip shares: it fills its own day column and wraps, and a long word breaks inside it. */
export const WEEK_CHIP_BASE = "block w-full min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere] text-left";
/** The title inside a chip. Never truncated, never clamped. */
export const WEEK_CHIP_TITLE = "block min-w-0 whitespace-normal [overflow-wrap:anywhere] font-semibold leading-snug";
/** A Work due chip has its own class names (never the small due-date pill's). */
export const WORK_DUE_CHIP_CLASS = `week-work-chip ${WEEK_CHIP_BASE}`;
/** The tone each layer's chip wears. */
export const WEEK_TONES = Object.freeze({
  events: "border-[var(--color-info-500)] bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  demos: "border-[var(--color-success-500)] bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  callbacks: "border-[var(--color-warning-500)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  work: "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
});
/** The classes of one item's chip. */
export function weekChipClass(item) {
  return `${item.layer === "work" ? WORK_DUE_CHIP_CLASS : `week-chip ${WEEK_CHIP_BASE}`} ${WEEK_TONES[item.layer] || ""}`.trim();
}

// ---- items -----------------------------------------------------------

function words(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function ownersLine(owners) {
  const names = (Array.isArray(owners) ? owners : []).map((o) => (typeof o === "string" ? o : o?.name)).map(words).filter(Boolean);
  return names.join(", ");
}

/**
 * Every item of the week, for every layer, keyed by day.
 *   events     ops_calendar's `events` and `expected`
 *   calls      admin_calendar_calls rows (instants)
 *   callbacks  ops_calendar_callbacks rows
 *   work       ops_calendar_work_due cards
 * An item: { id, layer, day, time, title, sub, label, open, off, needsLinking, statusLabel }.
 * `open` is what a click does: { side: { kind, id } } opens panel two, { call: id } opens the booking.
 */
export function weekItems({ days, events = null, calls = [], callbacks = [], work = [], zone, q = "" } = {}) {
  const dayList = Array.isArray(days) ? days : [];
  const inWeek = new Set(dayList);
  const out = [];
  for (const e of Array.isArray(events?.events) ? events.events : []) {
    if (!e || !inWeek.has(e.start_on)) continue;
    out.push({ id: `ev-${e.id}`, layer: "events", day: e.start_on, time: "", label: "Event", title: words(e.title) || "Event",
      sub: words(e.host?.name || e.brand?.name), open: { side: { kind: "event", id: e.id } }, state: e.state || null });
  }
  for (const x of Array.isArray(events?.expected) ? events.expected : []) {
    if (!x || !inWeek.has(x.expected_on)) continue;
    out.push({ id: `x-${x.id}-${x.expected_on}`, layer: "events", day: x.expected_on, time: "", label: x.repeats && x.repeats !== "none" ? "Promised, repeats" : "Promised",
      title: words(x.title) || "Promised event", sub: words(x.host_name), open: { side: { kind: "expected", id: x.id } }, state: x.state || null });
  }
  for (const day of dayList) {
    for (const c of callEntriesOn(day, calls, zone)) {
      out.push({ id: c.id, layer: "demos", day, time: c.time, at: c.at, label: c.badge === "Host call" ? "Demo" : c.badge, title: words(c.title),
        sub: c.record?.name ? `Linked to ${c.record.name}` : c.needsLinking ? "Needs linking" : "", off: c.off, statusLabel: c.statusLabel,
        needsLinking: c.needsLinking,
        // A linked demo opens its host card; one with no card opens the booking, which says Needs linking.
        open: c.record?.id && c.audience === "host" ? { side: { kind: "host", id: c.record.id } } : { call: c.callId } });
    }
  }
  for (const r of Array.isArray(callbacks) ? callbacks : []) {
    if (!r || !inWeek.has(r.due_on)) continue;
    out.push({ id: `cb-${r.record_id}`, layer: "callbacks", day: r.due_on, time: "", label: "Call back", title: words(r.name) || "Call back",
      sub: [r.pipeline === "creators" ? "Creator" : "Host", ownersLine(r.owners)].filter(Boolean).join(" · "),
      open: { side: { kind: r.pipeline === "creators" ? "creator" : "host", id: r.record_id } } });
  }
  for (const c of Array.isArray(work) ? work : []) {
    if (!c || !inWeek.has(c.due_on)) continue;
    out.push({ id: `wd-${c.id}`, layer: "work", day: c.due_on, time: "", label: c.parent ? "Subtask due" : "Due",
      title: `#${c.number} ${words(c.title)}`.trim(), sub: [c.parent ? `Under #${c.parent.number}` : "", ownersLine(c.owners)].filter(Boolean).join(" · "),
      overdue: !!c.overdue, open: { side: { kind: "card", id: c.id } } });
  }
  const needle = words(q).toLowerCase();
  const kept = needle ? out.filter((i) => `${i.title} ${i.sub}`.toLowerCase().includes(needle)) : out;
  const rank = { demos: 0, events: 1, callbacks: 2, work: 3 };
  return kept.sort((a, b) => a.day.localeCompare(b.day) || (a.layer === "demos" && b.layer === "demos" ? String(a.at).localeCompare(String(b.at)) : rank[a.layer] - rank[b.layer])
    || a.title.localeCompare(b.title));
}

/** How many items each layer has in the week (for the toggles, on or off). */
export function layerCounts(items) {
  const counts = Object.fromEntries(WEEK_LAYER_KEYS.map((k) => [k, 0]));
  for (const i of items) counts[i.layer] += 1;
  return counts;
}

/** The items of the layers that are on, grouped by day. */
export function itemsByDay(items, layers, days) {
  const grouped = Object.fromEntries((days || []).map((d) => [d, []]));
  for (const i of items) if (layers.has(i.layer) && grouped[i.day]) grouped[i.day].push(i);
  return grouped;
}
