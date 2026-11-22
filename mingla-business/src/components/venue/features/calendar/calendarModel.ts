/**
 * #4490 P4-2 — the venue Calendar (`cal`, `cal-conflict`) as pure functions:
 * the date ranges for Day / Week / Month, which blocks sit in which space row
 * on which day (hires, holds, events, blocks, setup and cleanup, a
 * combination blocked by one of its parts), each day's entry fill after the
 * hire cut, and the venue-local ↔ instant conversions the block sheet needs.
 * No React, no services. Weekdays are 0 = Monday.
 */
import type {
  CalendarClaim,
  CalendarDay,
  VenueCalendar,
} from "../../../../types/venueOffers";
import { clockIn, dateIn, shortDay } from "../bookings/bookingModel";
import { routeForEventRowDefensive } from "../../../../utils/routeForEventRow";

export type CalendarView = "day" | "week" | "month";

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function rangeFor(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const from = addDays(anchor, -weekdayOf(anchor));
    return { from, to: addDays(from, 6) };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const next = new Date(`${first}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from: first, to: addDays(next.toISOString().slice(0, 10), -1) };
}

export function shiftAnchor(view: CalendarView, anchor: string, step: 1 | -1): string {
  if (view === "day") return addDays(anchor, step);
  if (view === "week") return addDays(anchor, 7 * step);
  const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + step);
  return d.toISOString().slice(0, 10);
}

export function daysIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "17 – 23 Nov", "Sat 13 Dec", "December 2026". */
export function rangeTitle(view: CalendarView, from: string, to: string): string {
  if (view === "day") return shortDay(from);
  if (view === "month") return `${MONTHS_LONG[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  const a = `${Number(from.slice(8, 10))}${from.slice(5, 7) !== to.slice(5, 7) ? ` ${MONTHS[Number(from.slice(5, 7)) - 1]}` : ""}`;
  return `${a} – ${Number(to.slice(8, 10))} ${MONTHS[Number(to.slice(5, 7)) - 1]}`;
}

// --------------------------------------------------------------- blocks

export type BlockTone = "hire" | "hold" | "event" | "block" | "inside" | "part" | "group" | "request";

/**
 * #4490 fix 3 — the spaces an event sits in: the server's list when it sends
 * one, else its space, else (whole venue) every space.
 */
export function eventSpaceIds(cal: VenueCalendar, e: VenueCalendar["events"][number]): string[] {
  if (e.spaceIds !== undefined && e.spaceIds.length > 0) return e.spaceIds;
  if (e.spaceId !== null) return [e.spaceId];
  if (e.combinationId) return cal.combinations.find((c) => c.id === e.combinationId)?.spaceIds ?? [];
  return cal.spaces.map((s) => s.id);
}

export interface CalendarBlock {
  key: string;
  tone: BlockTone;
  title: string;
  detail: string | null;
  /** Read aloud: state word first (status is never colour alone). */
  label: string;
  groupId: string | null;
  claimId: string | null;
  eventId: string | null;
  /** Sort key: when the block starts that day. */
  at: string;
}

export interface CalendarRow {
  key: string;
  kind: "space" | "combination";
  id: string;
  name: string;
  detail: string;
  spaceIds: string[];
}

export function calendarRows(cal: VenueCalendar): CalendarRow[] {
  const rows: CalendarRow[] = cal.spaces.map((s) => ({
    key: `s:${s.id}`,
    kind: "space",
    id: s.id,
    name: s.name,
    detail: `${s.capacity.toLocaleString("en-GB")} guests`,
    spaceIds: [s.id],
  }));
  for (const c of cal.combinations) {
    const cap = c.spaceIds.reduce((n, id) => n + (cal.spaces.find((s) => s.id === id)?.capacity ?? 0), 0);
    rows.push({ key: `c:${c.id}`, kind: "combination", id: c.id, name: c.name, detail: `${cap.toLocaleString("en-GB")} guests · together`, spaceIds: c.spaceIds });
  }
  return rows;
}

/** True when [from, to) touches the venue's local day `date`. */
export function touchesDay(fromIso: string | null, toIso: string | null, date: string, timezone: string): boolean {
  if (fromIso === null || toIso === null) return false;
  const start = dateIn(fromIso, timezone);
  // The end is exclusive: a block ending at 00:00 does not touch the next day.
  const endAt = new Date(Date.parse(toIso) - 1).toISOString();
  const end = dateIn(endAt, timezone);
  if (start === null || end === null) return false;
  return start <= date && date <= end;
}

function timesWords(fromIso: string | null, toIso: string | null, timezone: string): string | null {
  const a = clockIn(fromIso, timezone);
  const b = clockIn(toIso, timezone);
  return a !== null && b !== null ? `${a}–${b}` : null;
}

function claimBlock(c: CalendarClaim, timezone: string, inside: boolean): CalendarBlock {
  const booked = timesWords(c.bookedFrom ?? c.claimFrom, c.bookedTo ?? c.claimTo, timezone);
  const withBuffers = timesWords(c.claimFrom, c.claimTo, timezone);
  const buffers = c.bookedFrom !== null && (c.bookedFrom !== c.claimFrom || c.bookedTo !== c.claimTo) ? withBuffers : null;
  if (c.kind === "event") {
    return {
      key: c.claimId,
      tone: "event",
      title: c.eventTitle ?? "Event",
      detail: booked,
      label: `Event: ${c.eventTitle ?? "event"}${booked !== null ? `, ${booked}` : ""}`,
      groupId: null,
      claimId: c.claimId,
      eventId: c.eventId,
      at: c.claimFrom,
    };
  }
  if (c.kind === "block") {
    return {
      key: c.claimId,
      tone: "block",
      title: "Blocked",
      detail: [c.blockReason, withBuffers].filter(Boolean).join(" · ") || null,
      label: `Blocked${c.blockReason !== null ? `: ${c.blockReason}` : ""}${withBuffers !== null ? `, ${withBuffers}` : ""}`,
      groupId: null,
      claimId: c.claimId,
      eventId: null,
      at: c.claimFrom,
    };
  }
  const hold = c.kind === "hold";
  const who = c.guestName ?? "Guest";
  const session = [c.sessionLabel, c.guests !== null ? `${c.guests}` : null].filter(Boolean).join(" · ");
  if (inside) {
    return {
      key: c.claimId,
      tone: "inside",
      title: `Inside ${c.viaCombinationName ?? "a hire"}`,
      detail: `${hold ? "On hold" : "Booked"} · ${who}`,
      label: `Inside a hire of ${c.viaCombinationName ?? "a combination"}: ${hold ? "on hold" : "booked"} for ${who}`,
      groupId: c.groupId,
      claimId: c.claimId,
      eventId: null,
      at: c.claimFrom,
    };
  }
  return {
    key: c.claimId,
    tone: hold ? "hold" : "hire",
    title: hold ? `On hold · ${who}` : who,
    detail: [session || null, buffers !== null ? `with setup ${buffers}` : booked].filter(Boolean).join(" · ") || null,
    label: `${hold ? "On hold" : "Private hire"}: ${who}${session ? `, ${session}` : ""}${booked !== null ? `, ${booked}` : ""}${buffers !== null ? `, setup and cleanup ${buffers}` : ""}`,
    groupId: c.groupId,
    claimId: c.claimId,
    eventId: null,
    at: c.claimFrom,
  };
}

/** Every block in one row on one day, in time order (one per booking). */
export function blocksFor(cal: VenueCalendar, row: CalendarRow, date: string): CalendarBlock[] {
  const tz = cal.timezone;
  const out: CalendarBlock[] = [];
  const seenGroups = new Set<string>();
  if (row.kind === "space") {
    for (const c of cal.claims) {
      if (c.spaceId !== row.id || !touchesDay(c.claimFrom, c.claimTo, date, tz)) continue;
      out.push(claimBlock(c, tz, c.viaCombinationId !== null));
    }
    // #4490 fix 2 (N76 c) — events at the venue that share their space (no
    // claim) still show on the space they use; a whole-venue event shows on
    // every space. An exclusive event already has its claim above.
    const claimed = new Set(cal.claims.filter((c) => c.eventId !== null && c.spaceId === row.id).map((c) => c.eventId));
    const seenDates = new Set<string>();
    for (const e of cal.events ?? []) {
      if (!eventSpaceIds(cal, e).includes(row.id)) continue;
      if (claimed.has(e.eventId) || !touchesDay(e.startsAt, e.endsAt, date, tz)) continue;
      const dateKey = `${e.eventId}|${e.startsAt}`;
      if (seenDates.has(dateKey)) continue;
      seenDates.add(dateKey);
      const times = timesWords(e.startsAt, e.endsAt, tz);
      const where =
        e.spaceId !== null
          ? null
          : e.combinationId
            ? cal.combinations.find((c) => c.id === e.combinationId)?.name ?? null
            : "Whole venue";
      out.push({
        key: `ev-${e.eventId}-${e.startsAt}-${row.id}`,
        tone: "event",
        title: e.title,
        detail: [times, where].filter(Boolean).join(" · ") || null,
        label: `Event: ${e.title}${times !== null ? `, ${times}` : ""}${where !== null ? `, ${where === "Whole venue" ? "whole venue" : where}` : ""}`,
        groupId: null,
        claimId: null,
        eventId: e.eventId,
        at: e.startsAt,
      });
    }
  } else {
    // The combination's own hire: one block for the booking (its parts carry the claims).
    for (const c of cal.claims) {
      if (c.viaCombinationId !== row.id || !touchesDay(c.claimFrom, c.claimTo, date, tz)) continue;
      const key = c.groupId ?? c.claimId;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      out.push(claimBlock({ ...c, viaCombinationId: null }, tz, false));
    }
    // #4490 fix 3 (N101, N106) — an event on this combination shows here.
    const seenEventDates = new Set<string>();
    for (const e of cal.events ?? []) {
      if (e.combinationId !== row.id || !touchesDay(e.startsAt, e.endsAt, date, tz)) continue;
      const dateKey = `${e.eventId}|${e.startsAt}`;
      if (seenEventDates.has(dateKey)) continue;
      seenEventDates.add(dateKey);
      const times = timesWords(e.startsAt, e.endsAt, tz);
      out.push({
        key: `ev-${e.eventId}-${e.startsAt}-${row.id}`,
        tone: "event",
        title: e.title,
        detail: [times, e.spaceUse === "exclusive" ? "Takes these spaces" : "Shared"].filter(Boolean).join(" · "),
        label: `Event: ${e.title}${times !== null ? `, ${times}` : ""}`,
        groupId: null,
        claimId: null,
        eventId: e.eventId,
        at: e.startsAt,
      });
    }
    const seenBlockers = new Set<string>();
    for (const b of cal.combinationBlocks) {
      if (b.combinationId !== row.id || !touchesDay(b.from, b.to, date, tz)) continue;
      if (seenBlockers.has(b.blockedBy)) continue;
      seenBlockers.add(b.blockedBy);
      const times = timesWords(b.from, b.to, tz);
      out.push({
        key: `cb-${b.claimId}`,
        tone: "inside",
        title: `Blocked by ${b.blockedBy}`,
        detail: times,
        label: `Blocked by ${b.blockedBy}${times !== null ? `, ${times}` : ""}`,
        groupId: null,
        claimId: null,
        eventId: null,
        at: b.from,
      });
    }
    // #4490 fix 3 (N102) — an event that shares a part of this combination
    // (it holds nothing, so it is not a block): "Part in use".
    for (const e of cal.events ?? []) {
      if (e.combinationId === row.id || e.spaceUse === "exclusive") continue;
      if (!touchesDay(e.startsAt, e.endsAt, date, tz)) continue;
      const parts = eventSpaceIds(cal, e).filter((id) => row.spaceIds.includes(id));
      if (parts.length === 0) continue;
      const dateKey = `${e.eventId}|${e.startsAt}`;
      if (seenEventDates.has(dateKey)) continue;
      seenEventDates.add(dateKey);
      const times = timesWords(e.startsAt, e.endsAt, tz);
      const partNames = parts
        .map((id) => cal.spaces.find((s) => s.id === id)?.name)
        .filter((n): n is string => typeof n === "string");
      const partWords = parts.length === row.spaceIds.length ? "every part" : partNames.join(", ") || "a part";
      out.push({
        key: `pu-${e.eventId}-${e.startsAt}-${row.id}`,
        tone: "part",
        title: `Part in use · ${e.title}`,
        detail: [times, partWords].filter(Boolean).join(" · "),
        label: `Part in use: ${e.title} on ${partWords}${times !== null ? `, ${times}` : ""}`,
        groupId: null,
        claimId: null,
        eventId: e.eventId,
        at: e.startsAt,
      });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Requests still to answer that would take this row's space that day. */
export function requestsFor(cal: VenueCalendar, row: CalendarRow, date: string): CalendarBlock[] {
  return cal.requests
    .filter((r) => r.spaceIds.length > 0 && r.spaceIds.every((s) => row.spaceIds.includes(s)) && row.spaceIds.length === r.spaceIds.length)
    .filter((r) => touchesDay(r.bookedFrom, r.bookedTo, date, cal.timezone))
    .map((r) => ({
      key: `rq-${r.groupId}`,
      tone: "request" as const,
      title: `Asked · ${r.guestName}`,
      detail: r.collides ? "Clashes with a booking" : "Not held yet",
      label: `Request to answer from ${r.guestName}${r.collides ? ", clashes with a booking" : ""}`,
      groupId: r.groupId,
      claimId: null,
      eventId: null,
      at: r.bookedFrom ?? "",
    }));
}

/** "186 sold of 400", "limit 200 (hire)", "Closed", "Hired out". */
export function entryFill(day: CalendarDay | undefined): { line: string; pct: number; cut: boolean } | null {
  if (day === undefined) return null;
  if (day.closed) return { line: "Closed", pct: 0, cut: false };
  const pool = day.pools[0];
  if (pool === undefined) return null;
  if (pool.venueHired) return { line: "Hired out", pct: 100, cut: true };
  const limit = pool.limitEffective;
  const pct = limit > 0 ? Math.min(100, Math.round((pool.sold / limit) * 100)) : 0;
  if (pool.hireCut > 0) {
    return { line: `${pool.sold} sold · limit ${limit} (was ${pool.dailyLimit})`, pct, cut: true };
  }
  return { line: `${pool.sold} sold of ${limit}`, pct, cut: false };
}

/** How busy a day is, for the month grid. */
export function daySummary(cal: VenueCalendar, date: string): { hires: number; holds: number; events: number; blocks: number; requests: number; groups: number } {
  const tz = cal.timezone;
  const groups = new Set<string>();
  const holds = new Set<string>();
  const eventIds = new Set<string>();
  let blocks = 0;
  for (const c of cal.claims) {
    if (!touchesDay(c.claimFrom, c.claimTo, date, tz)) continue;
    if (c.kind === "event") eventIds.add(c.eventId ?? c.claimId);
    else if (c.kind === "block") blocks += 1;
    else if (c.kind === "hold") holds.add(c.groupId ?? c.claimId);
    else groups.add(c.groupId ?? c.claimId);
  }
  // #4490 fix 2 — shared-space and whole-venue events count once each.
  for (const e of cal.events ?? []) {
    if (touchesDay(e.startsAt, e.endsAt, date, tz)) eventIds.add(e.eventId);
  }
  const events = eventIds.size;
  const requests = cal.requests.filter((r) => touchesDay(r.bookedFrom, r.bookedTo, date, tz)).length;
  const packages = cal.days.find((d) => d.localDate === date)?.groups.length ?? 0;
  return { hires: groups.size, holds: holds.size, events, blocks, requests, groups: packages };
}

// --------------------------------------------------------------- time zones

/** Minutes the zone is ahead of UTC at an instant. */
export function zoneOffsetMinutes(instantMs: number, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instantMs));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return Math.round((asUtc - instantMs) / 60_000);
  } catch {
    return 0;
  }
}

/** The instant of a venue-local date and time ("2026-12-13", "14:00", "Africa/Lagos"). */
export function zonedIso(date: string, time: string, timezone: string): string {
  const [h, m] = time.split(":").map((x) => Number(x));
  const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h ?? 0, m ?? 0);
  const first = guess - zoneOffsetMinutes(guess, timezone) * 60_000;
  const second = guess - zoneOffsetMinutes(first, timezone) * 60_000;
  return new Date(second).toISOString();
}

export interface BlockDraft {
  target: string | null;
  fromDate: string;
  fromTime: string;
  toDate: string;
  toTime: string;
  reason: string;
}

export function blockIssue(d: BlockDraft, timezone: string): string | null {
  if (d.target === null) return "Pick the space to block";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(d.toDate)) return "Pick when the block starts and ends";
  const from = Date.parse(zonedIso(d.fromDate, d.fromTime, timezone));
  const to = Date.parse(zonedIso(d.toDate, d.toTime, timezone));
  if (!(to > from)) return "The block must end after it starts";
  if (to - from > 31 * 24 * 60 * 60_000) return "A block can last 31 days at most";
  return null;
}

/**
 * #4490 W3 fix 1 — the screen an event block opens: the canonical event-row
 * route (an experience, trip or RSVP at the venue opens its own dashboard),
 * from the calendar's own event row. An event the calendar does not list
 * opens the event dashboard.
 */
export function calendarEventRoute(cal: Pick<VenueCalendar, "events">, eventId: string): string {
  const row = cal.events.find((e) => e.eventId === eventId);
  return routeForEventRowDefensive({
    id: eventId,
    eventType: row?.eventType ?? undefined,
    status: row?.status,
  });
}
