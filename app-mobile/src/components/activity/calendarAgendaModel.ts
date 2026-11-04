/**
 * Issue #4265 — the Likes → Calendar tab's pure decisions.
 *
 * Import-free on purpose, like `savedGridModel.ts`, so the Deno regression
 * suite can load it without a bundler. The tab merges FIVE sources (scheduled
 * saved cards, ticket orders, venue reservations, stays and "Going" RSVPs)
 * into one agenda. Every date is parsed ONCE here, in `buildUnifiedRows`; the
 * day strip, the week and month grids, grouping and sorting all read the
 * parsed `startMs` / `endMs` / `dayKey` instead of re-parsing strings.
 *
 * Days are the viewer's LOCAL calendar days (the device timezone).
 */

// ── Source shapes (structural subsets of the app's row types) ───────────────

/** A scheduled saved card (`calendar_entries`, shaped by AppStateManager). */
export interface AgendaCalendarEntryInput {
  id: string;
  title?: string;
  image?: string;
  address?: string;
  date?: string;
  time?: string;
  scheduled_at?: string;
  suggestedDates?: string[];
  duration_minutes?: number;
  // deno-lint-ignore no-explicit-any
  experience?: any;
}

/** One business-event ticket order row — ONE per day of a multi-day order (#2160). */
export interface AgendaTicketInput {
  orderId: string;
  eventDateId?: string | null;
  eventTitle: string;
  brandName: string;
  coverMediaUrl: string | null;
  coverMediaType?: "image" | "video" | "gif" | null;
  masterDateUtc: string | null;
  masterDateEndUtc: string | null;
  paymentStatus: string;
  ticketCount: number;
  ticketCountValid: number;
  tickets: ReadonlyArray<{ id: string; status: string }>;
  venue: { locationText: string | null };
}

export interface AgendaReservationInput {
  id: string;
  reserved_for: string;
  status: string;
  party_size: number;
  brand_name: string | null;
  brand_address?: string | null;
  brand_cover_url?: string | null;
  brand_cover_type?: string | null;
  brand_photo_url?: string | null;
}

export interface AgendaStayInput {
  groupId: string;
  state: string;
  venueName: string;
  brandName: string;
  lines: ReadonlyArray<{
    roomCheckIn: string | null;
    roomCheckOut: string | null;
    placeStartsAt: string | null;
    placeEndsAt: string | null;
  }>;
}

export interface AgendaRsvpInput {
  rsvpId: string;
  guestId: string | null;
  eventTitle: string;
  brandName: string;
  coverMediaUrl: string | null;
  coverMediaType?: "image" | "video" | "gif" | null;
  masterDateUtc: string | null;
  masterDateEndUtc: string | null;
  approvalStatus: string;
  venue: { locationText: string | null };
}

export interface AgendaSources {
  calendar: AgendaCalendarEntryInput;
  ticket: AgendaTicketInput;
  reservation: AgendaReservationInput;
  stay: AgendaStayInput;
  rsvp: AgendaRsvpInput;
}

// ── The unified row ─────────────────────────────────────────────────────────

/** The four colour-coded tags the design shows. RSVPs are event passes → "ticket". */
export type AgendaTag = "ticket" | "reservation" | "plan" | "stay";

/** The type chips above the agenda. */
export type AgendaTypeFilter = "all" | "tickets" | "reservations" | "plans" | "stays";
export const AGENDA_TYPE_FILTERS: readonly AgendaTypeFilter[] = [
  "all",
  "tickets",
  "reservations",
  "plans",
  "stays",
];

/** Why a row reads as not-yet-settled (shown in place of the place line). */
export type AgendaStatusNote = "finalizing" | "awaitingApproval" | "requested" | "cancelled" | null;

interface AgendaRowBase {
  /** Stable React key AND entity identity (see `rowIdentityKey`). */
  key: string;
  tag: AgendaTag;
  /** Parsed once. NaN when the source carries no usable date. */
  startMs: number;
  /** Effective END used for past/upcoming (never the start — ORCH-0850/0853). */
  effectiveEndMs: number;
  isPast: boolean;
  /** Local `YYYY-MM-DD` of `startMs`; null when undated. */
  dayKey: string | null;
  title: string;
  /** Venue / address line, or null. */
  place: string | null;
  imageUrl: string | null;
  mediaType: "image" | "video" | "gif" | null;
  /** A pass with a QR exists — the row shows the orange "Ticket" button. */
  hasTicket: boolean;
  statusNote: AgendaStatusNote;
  /** Curated plan stop count (0 for single places). */
  stopCount: number;
  /** Reservation party size (0 otherwise). */
  partySize: number;
}

export type UnifiedRow<S extends AgendaSources = AgendaSources> =
  | (AgendaRowBase & { kind: "calendar"; entry: S["calendar"] })
  | (AgendaRowBase & { kind: "ticket"; row: S["ticket"] })
  | (AgendaRowBase & { kind: "reservation"; reservation: S["reservation"] })
  | (AgendaRowBase & { kind: "stay"; group: S["stay"] })
  | (AgendaRowBase & { kind: "rsvp"; rsvp: S["rsvp"] });

// ── Dates ───────────────────────────────────────────────────────────────────

/**
 * ORCH-0850 [End-not-start parity]: a calendar entry is past only once
 * `scheduled_at + duration_minutes` (120 min fallback) has elapsed. Preserves
 * I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START.
 */
export const DEFAULT_CALENDAR_DURATION_MIN = 120;

export interface CalendarEntryForBucketing {
  scheduled_at?: string;
  suggestedDates?: string[];
  duration_minutes?: number;
}

export function computeEntryEffectiveEnd(entry: CalendarEntryForBucketing): Date | null {
  const startIso = entry.scheduled_at ?? entry.suggestedDates?.[0] ?? null;
  if (startIso === null) return null;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  const durationMin = typeof entry.duration_minutes === "number" && entry.duration_minutes > 0
    ? entry.duration_minutes
    : DEFAULT_CALENDAR_DURATION_MIN;
  return new Date(startMs + durationMin * 60_000);
}

/** META-ORCH-1148 2.2b — a reservation has no stored duration: one dining window. */
export const RESERVATION_DEFAULT_DURATION_MIN = 120;

const RESERVATION_TERMINAL = new Set(["cancelled_by_guest", "cancelled_by_venue", "no_show", "completed"]);
const STAY_TERMINAL = new Set(["declined", "request_expired", "cancelled"]);

function parseMs(value: string | null | undefined): number {
  if (typeof value !== "string" || value.length === 0) return Number.NaN;
  return Date.parse(value);
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Local calendar-day key, e.g. `2026-11-04`. */
export function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Local midnight `n` days after `date` (DST-safe: built from y/m/d, not ms). */
export function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The local Date a day key names (midnight). */
export function dateOfDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayKeyOfMs(ms: number): string | null {
  return Number.isFinite(ms) ? dayKeyOf(new Date(ms)) : null;
}

function calendarEntryStartIso(entry: AgendaCalendarEntryInput): string | null {
  if (entry.scheduled_at) return entry.scheduled_at;
  if (entry.suggestedDates?.[0]) return entry.suggestedDates[0];
  if (entry.date && entry.time) return `${entry.date}T${entry.time}`;
  return null;
}

function stayStartMs(group: AgendaStayInput): number {
  let min = Number.NaN;
  for (const line of group.lines) {
    for (const v of [line.roomCheckIn, line.placeStartsAt]) {
      const ms = parseMs(v);
      if (Number.isFinite(ms) && !(ms >= min)) min = ms;
    }
  }
  return min;
}

function stayEndMs(group: AgendaStayInput): number {
  let max = Number.NaN;
  for (const line of group.lines) {
    for (const v of [line.roomCheckOut, line.placeEndsAt]) {
      const ms = parseMs(v);
      if (Number.isFinite(ms) && !(ms <= max)) max = ms;
    }
  }
  return max;
}

/** ORCH-0853: tickets / RSVPs end at `end_at`, falling back to `start_at`. */
function eventEffectiveEndTs(masterDateUtc: string | null, masterDateEndUtc: string | null): number {
  const endTs = parseMs(masterDateEndUtc);
  const startTs = parseMs(masterDateUtc);
  const effectiveEndTs = Number.isFinite(endTs) ? endTs : startTs;
  return effectiveEndTs;
}

// ── Identity + dedupe ───────────────────────────────────────────────────────

/**
 * The real entity identity of a row. A ticket order is keyed by order AND
 * day: #2160 emits one row per day of a multi-day order, so two rows sharing
 * an `orderId` are two different days, not a duplicate. Keying by `orderId`
 * alone is exactly what produced "two children with the same key,
 * ticket:b0c1ab83-…" — a two-day order (two passes per day) rendered twice
 * under one key.
 */
export function ticketRowKey(row: Pick<AgendaTicketInput, "orderId" | "eventDateId" | "masterDateUtc">): string {
  const day = row.eventDateId ?? row.masterDateUtc ?? "undated";
  return `ticket:${row.orderId}:${day}`;
}

/** How much a row carries — the tie-break that picks the richer duplicate. */
function richness(row: UnifiedRow): number {
  let score = 0;
  if (row.imageUrl) score += 4;
  if (Number.isFinite(row.startMs)) score += 2;
  if (row.place) score += 1;
  if (row.kind === "ticket") score += row.row.tickets.length * 8;
  return score;
}

/**
 * Collapse rows that name the same entity. The richer row wins; on a tie the
 * FIRST one seen wins, so the result is deterministic for a given input
 * order. Order of survivors is preserved.
 */
export function dedupeUnifiedRows<S extends AgendaSources>(rows: UnifiedRow<S>[]): UnifiedRow<S>[] {
  const index = new Map<string, number>();
  const out: UnifiedRow<S>[] = [];
  for (const row of rows) {
    const at = index.get(row.key);
    if (at === undefined) {
      index.set(row.key, out.length);
      out.push(row);
    } else if (richness(row as UnifiedRow) > richness(out[at] as UnifiedRow)) {
      out[at] = row;
    }
  }
  return out;
}

// ── Building ────────────────────────────────────────────────────────────────

export interface BuildUnifiedRowsInput<S extends AgendaSources> {
  calendarEntries: readonly S["calendar"][];
  ticketOrders: readonly S["ticket"][];
  reservations: readonly S["reservation"][];
  stays: readonly S["stay"][];
  rsvps: readonly S["rsvp"][];
  /** Resolves a stay's cover (the caller owns the venue-media lookup). */
  stayImage?: (group: S["stay"]) => string | null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Every source → one row each, dates parsed once, past/upcoming decided by
 * the effective END, then deduped by entity identity.
 */
export function buildUnifiedRows<S extends AgendaSources>(
  input: BuildUnifiedRowsInput<S>,
  nowMs: number,
): UnifiedRow<S>[] {
  const rows: UnifiedRow<S>[] = [];

  for (const entry of input.calendarEntries) {
    const startMs = parseMs(calendarEntryStartIso(entry));
    const end = computeEntryEffectiveEnd(entry);
    const effectiveEndMs = end === null ? Number.NaN : end.getTime();
    const exp = (entry.experience ?? {}) as Record<string, unknown>;
    const stops = Array.isArray(exp.stops) ? (exp.stops as Array<Record<string, unknown>>) : [];
    const firstStop = stops[0];
    const place = stops.length > 0
      ? nonEmpty(firstStop?.placeName) ?? nonEmpty(firstStop?.title)
      : nonEmpty(exp.address) ?? nonEmpty(entry.address);
    rows.push({
      kind: "calendar",
      key: `calendar:${entry.id}`,
      tag: "plan",
      startMs,
      effectiveEndMs,
      isPast: Number.isFinite(effectiveEndMs) && effectiveEndMs < nowMs,
      dayKey: dayKeyOfMs(startMs),
      title: nonEmpty(exp.title) ?? nonEmpty(entry.title) ?? "",
      place,
      imageUrl: nonEmpty(exp.image) ?? nonEmpty(entry.image),
      mediaType: null,
      hasTicket: false,
      statusNote: null,
      stopCount: stops.length,
      partySize: 0,
      entry,
    });
  }

  for (const order of input.ticketOrders) {
    const startMs = parseMs(order.masterDateUtc);
    const pending = order.paymentStatus === "pending";
    // ORCH-0853: pending-payment orders always stay upcoming.
    const effectiveEndTs = eventEffectiveEndTs(order.masterDateUtc, order.masterDateEndUtc);
    rows.push({
      kind: "ticket",
      key: ticketRowKey(order),
      tag: "ticket",
      startMs,
      effectiveEndMs: effectiveEndTs,
      isPast: !pending && Number.isFinite(effectiveEndTs) && effectiveEndTs < nowMs,
      dayKey: dayKeyOfMs(startMs),
      title: order.eventTitle,
      place: nonEmpty(order.venue.locationText) ?? nonEmpty(order.brandName),
      imageUrl: nonEmpty(order.coverMediaUrl),
      mediaType: order.coverMediaType ?? null,
      hasTicket: !pending && order.tickets.length > 0,
      statusNote: pending ? "finalizing" : null,
      stopCount: 0,
      partySize: 0,
      row: order,
    });
  }

  for (const reservation of input.reservations) {
    const startMs = parseMs(reservation.reserved_for);
    const effectiveEndMs = Number.isFinite(startMs)
      ? startMs + RESERVATION_DEFAULT_DURATION_MIN * 60_000
      : Number.NaN;
    const terminal = RESERVATION_TERMINAL.has(reservation.status);
    rows.push({
      kind: "reservation",
      key: `reservation:${reservation.id}`,
      tag: "reservation",
      startMs,
      effectiveEndMs,
      isPast: terminal || (Number.isFinite(effectiveEndMs) && effectiveEndMs < nowMs),
      dayKey: dayKeyOfMs(startMs),
      title: nonEmpty(reservation.brand_name) ?? "",
      place: nonEmpty(reservation.brand_address),
      imageUrl: nonEmpty(reservation.brand_cover_url) ?? nonEmpty(reservation.brand_photo_url),
      // META-ORCH-1148 2.2g: a venue cover may be a video; the profile photo never is.
      mediaType: nonEmpty(reservation.brand_cover_url) !== null &&
          (reservation.brand_cover_type === "video" || reservation.brand_cover_type === "gif")
        ? reservation.brand_cover_type
        : null,
      hasTicket: false,
      statusNote: reservation.status === "requested"
        ? "requested"
        : reservation.status === "cancelled_by_guest" || reservation.status === "cancelled_by_venue"
        ? "cancelled"
        : null,
      stopCount: 0,
      partySize: reservation.party_size,
      reservation,
    });
  }

  for (const group of input.stays) {
    const startMs = stayStartMs(group);
    const effectiveEndMs = stayEndMs(group);
    rows.push({
      kind: "stay",
      key: `stay:${group.groupId}`,
      tag: "stay",
      startMs,
      effectiveEndMs,
      isPast: STAY_TERMINAL.has(group.state) || (Number.isFinite(effectiveEndMs) && effectiveEndMs < nowMs),
      dayKey: dayKeyOfMs(startMs),
      title: group.venueName,
      place: nonEmpty(group.brandName),
      imageUrl: input.stayImage ? input.stayImage(group) : null,
      mediaType: null,
      hasTicket: false,
      statusNote: group.state === "cancelled" ? "cancelled" : null,
      stopCount: 0,
      partySize: 0,
      group,
    });
  }

  for (const rsvp of input.rsvps) {
    const startMs = parseMs(rsvp.masterDateUtc);
    const effectiveEndTs = eventEffectiveEndTs(rsvp.masterDateUtc, rsvp.masterDateEndUtc);
    const pending = rsvp.approvalStatus === "pending";
    rows.push({
      kind: "rsvp",
      key: `rsvp:${rsvp.rsvpId}:${rsvp.guestId ?? "primary"}`,
      tag: "ticket",
      startMs,
      effectiveEndMs: effectiveEndTs,
      isPast: Number.isFinite(effectiveEndTs) && effectiveEndTs < nowMs,
      dayKey: dayKeyOfMs(startMs),
      title: rsvp.eventTitle,
      place: nonEmpty(rsvp.venue.locationText) ?? nonEmpty(rsvp.brandName),
      imageUrl: nonEmpty(rsvp.coverMediaUrl),
      mediaType: rsvp.coverMediaType ?? null,
      hasTicket: !pending,
      statusNote: pending ? "awaitingApproval" : null,
      stopCount: 0,
      partySize: 0,
      rsvp,
    });
  }

  return dedupeUnifiedRows(rows);
}

// ── Filtering, sorting, grouping ────────────────────────────────────────────

export function matchesTypeFilter(tag: AgendaTag, filter: AgendaTypeFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "tickets":
      return tag === "ticket";
    case "reservations":
      return tag === "reservation";
    case "plans":
      return tag === "plan";
    case "stays":
      return tag === "stay";
    default: {
      const never: never = filter;
      return never;
    }
  }
}

/** Upcoming soonest-first; undated rows last. */
export function sortUpcoming<R extends { startMs: number; key: string }>(rows: R[]): R[] {
  return [...rows].sort((a, b) => {
    const as = Number.isFinite(a.startMs) ? a.startMs : Number.POSITIVE_INFINITY;
    const bs = Number.isFinite(b.startMs) ? b.startMs : Number.POSITIVE_INFINITY;
    return as === bs ? a.key.localeCompare(b.key) : as - bs;
  });
}

/** Past most-recent-first; undated rows last. */
export function sortPast<R extends { startMs: number; key: string }>(rows: R[]): R[] {
  return [...rows].sort((a, b) => {
    const as = Number.isFinite(a.startMs) ? a.startMs : Number.NEGATIVE_INFINITY;
    const bs = Number.isFinite(b.startMs) ? b.startMs : Number.NEGATIVE_INFINITY;
    return as === bs ? a.key.localeCompare(b.key) : bs - as;
  });
}

export type AgendaDayLabel = "today" | "tomorrow" | "date" | "undated";

export interface AgendaDayGroup<R> {
  /** Section key — the day key, or `undated`. */
  key: string;
  dayKey: string | null;
  label: AgendaDayLabel;
  data: R[];
}

export function dayLabelFor(dayKey: string | null, todayKey: string): AgendaDayLabel {
  if (dayKey === null) return "undated";
  if (dayKey === todayKey) return "today";
  if (dayKey === dayKeyOf(addDays(dateOfDayKey(todayKey), 1))) return "tomorrow";
  return "date";
}

/** Rows (already sorted) → consecutive day groups, undated last. */
export function groupByDay<R extends { dayKey: string | null }>(
  rows: R[],
  todayKey: string,
): AgendaDayGroup<R>[] {
  const groups: AgendaDayGroup<R>[] = [];
  const byKey = new Map<string, AgendaDayGroup<R>>();
  for (const row of rows) {
    const key = row.dayKey ?? "undated";
    let group = byKey.get(key);
    if (!group) {
      group = { key, dayKey: row.dayKey, label: dayLabelFor(row.dayKey, todayKey), data: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.data.push(row);
  }
  const undated = groups.findIndex((g) => g.dayKey === null);
  if (undated >= 0 && undated !== groups.length - 1) {
    const [u] = groups.splice(undated, 1);
    groups.push(u);
  }
  return groups;
}

/** Day key → its rows' tags, for strip dots and month dots. */
export function tagsByDay<R extends { dayKey: string | null; tag: AgendaTag }>(rows: R[]): Map<string, AgendaTag[]> {
  const map = new Map<string, AgendaTag[]>();
  for (const row of rows) {
    if (row.dayKey === null) continue;
    const list = map.get(row.dayKey);
    if (list) list.push(row.tag);
    else map.set(row.dayKey, [row.tag]);
  }
  return map;
}

// ── Today / selected highlight ──────────────────────────────────────────────

export interface DayVisual {
  /** Orange fill (selected) or the quiet tile fill. */
  fill: "accent" | "quiet";
  /** Orange 1.5pt border for today (and selected), quiet otherwise. */
  border: "accent" | "quiet";
  /** Today's tile says "Today" instead of the weekday. */
  showTodayLabel: boolean;
  /** White text on the orange fill. */
  textOnAccent: boolean;
}

/**
 * Today must always be findable: an orange border and a "Today" label even
 * when another day is selected. A selected day is filled orange (today
 * selected = filled orange, still labelled "Today").
 */
export function dayVisual(input: { isToday: boolean; isSelected: boolean }): DayVisual {
  return {
    fill: input.isSelected ? "accent" : "quiet",
    border: input.isSelected || input.isToday ? "accent" : "quiet",
    showTodayLabel: input.isToday,
    textOnAccent: input.isSelected,
  };
}

// ── Day strip (List) ────────────────────────────────────────────────────────

export interface StripDay {
  dayKey: string;
  date: Date;
  isToday: boolean;
  isSelected: boolean;
  planCount: number;
}

export const DAY_STRIP_LENGTH = 7;

/** The next seven days starting today. */
export function buildDayStrip(
  today: Date,
  counts: ReadonlyMap<string, readonly unknown[]>,
  selectedDayKey: string | null,
): StripDay[] {
  const todayKey = dayKeyOf(today);
  return Array.from({ length: DAY_STRIP_LENGTH }, (_, i) => {
    const date = addDays(today, i);
    const dayKey = dayKeyOf(date);
    return {
      dayKey,
      date,
      isToday: dayKey === todayKey,
      isSelected: dayKey === selectedDayKey,
      planCount: counts.get(dayKey)?.length ?? 0,
    };
  });
}

/** Tap a day to narrow to it; tap it again to clear. */
export function toggleSelectedDay(current: string | null, tapped: string): string | null {
  return current === tapped ? null : tapped;
}

// ── Week start ──────────────────────────────────────────────────────────────

/** 0 = Sunday … 6 = Saturday. */
export type WeekStart = 0 | 1 | 6;

const SUNDAY_REGIONS = new Set(["US", "CA", "MX", "BR", "JP", "KR", "IL", "IN", "PH", "TH", "SA", "ZA", "TW", "HK", "AR", "CO", "PE", "VE"]);
const SATURDAY_REGIONS = new Set(["EG", "AF", "IR", "SY", "IQ", "LY", "DZ", "JO", "KW", "OM", "QA", "SD", "AE", "BH"]);
const SUNDAY_LANGUAGES = new Set(["he", "ja", "ko", "hi", "bn", "th", "pt-BR"]);

/**
 * The first day of the week for a BCP-47 locale. Region decides when present
 * (en-US → Sunday, en-GB → Monday); a bare language falls back to its usual
 * convention; everything else starts Monday (ISO 8601).
 */
export function weekStartForLocale(locale: string): WeekStart {
  const parts = locale.replace("_", "-").split("-");
  const language = (parts[0] ?? "").toLowerCase();
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p))?.toUpperCase() ?? null;
  if (region !== null) {
    if (SATURDAY_REGIONS.has(region)) return 6;
    if (SUNDAY_REGIONS.has(region)) return 0;
    return 1;
  }
  if (SUNDAY_LANGUAGES.has(language)) return 0;
  if (language === "en") return 0;
  return 1;
}

/** Local midnight of the first day of the week containing `date`. */
export function startOfWeek(date: Date, weekStart: WeekStart): Date {
  const diff = (date.getDay() - weekStart + 7) % 7;
  return addDays(date, -diff);
}

// ── Week grid ───────────────────────────────────────────────────────────────

export interface WeekDay<R> {
  dayKey: string;
  date: Date;
  isToday: boolean;
  isPast: boolean;
  rows: R[];
}

export function buildWeekGrid<R extends { dayKey: string | null }>(
  anchor: Date,
  weekStart: WeekStart,
  today: Date,
  rows: R[],
): WeekDay<R>[] {
  const first = startOfWeek(anchor, weekStart);
  const todayKey = dayKeyOf(today);
  const byDay = new Map<string, R[]>();
  for (const row of rows) {
    if (row.dayKey === null) continue;
    const list = byDay.get(row.dayKey);
    if (list) list.push(row);
    else byDay.set(row.dayKey, [row]);
  }
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(first, i);
    const dayKey = dayKeyOf(date);
    return {
      dayKey,
      date,
      isToday: dayKey === todayKey,
      isPast: dayKey < todayKey,
      rows: byDay.get(dayKey) ?? [],
    };
  });
}

// ── Month grid ──────────────────────────────────────────────────────────────

export const MONTH_MAX_DOTS = 3;

export interface MonthCell {
  dayKey: string;
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isPast: boolean;
  /** Up to three tag colours, in the day's order. */
  dots: AgendaTag[];
  /** Plans beyond the three dots ("+n"). */
  extra: number;
  planCount: number;
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * A 7-column month grid: leading days from the previous month, the month,
 * then trailing days to complete the last week — 5 or 6 rows (4 only for a
 * 28-day February that starts on the week's first day).
 */
export function buildMonthGrid(
  year: number,
  monthIndex: number,
  weekStart: WeekStart,
  today: Date,
  selectedDayKey: string | null,
  tags: ReadonlyMap<string, readonly AgendaTag[]>,
): MonthCell[] {
  const first = new Date(year, monthIndex, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const total = lead + daysInMonth(year, monthIndex);
  const cellCount = Math.ceil(total / 7) * 7;
  const gridStart = addDays(first, -lead);
  const todayKey = dayKeyOf(today);
  return Array.from({ length: cellCount }, (_, i) => {
    const date = addDays(gridStart, i);
    const dayKey = dayKeyOf(date);
    const dayTags = tags.get(dayKey) ?? [];
    return {
      dayKey,
      date,
      inMonth: date.getMonth() === monthIndex,
      isToday: dayKey === todayKey,
      isSelected: dayKey === selectedDayKey,
      isPast: dayKey < todayKey,
      dots: dayTags.slice(0, MONTH_MAX_DOTS),
      extra: Math.max(0, dayTags.length - MONTH_MAX_DOTS),
      planCount: dayTags.length,
    };
  });
}

/** Step a (year, month) by `delta` months. */
export function shiftMonth(year: number, monthIndex: number, delta: number): { year: number; monthIndex: number } {
  const d = new Date(year, monthIndex + delta, 1);
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

// ── View preference ─────────────────────────────────────────────────────────

export type CalendarView = "list" | "week" | "month";
export const CALENDAR_VIEWS: readonly CalendarView[] = ["list", "week", "month"];
export const DEFAULT_CALENDAR_VIEW: CalendarView = "list";

/**
 * Per-user AsyncStorage key. The `mingla:` prefix puts it inside
 * `isPrivateAsyncStorageKey`, so sign-out clears it (Constitution #6).
 */
export function calendarViewStorageKey(userId: string): string {
  return `mingla:calendar-view:${userId}`;
}

/** Anything unreadable falls back to List. */
export function parseCalendarView(raw: string | null | undefined): CalendarView {
  return raw === "list" || raw === "week" || raw === "month" ? raw : DEFAULT_CALENDAR_VIEW;
}
