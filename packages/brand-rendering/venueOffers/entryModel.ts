/**
 * #4490 P2 — buying entry to a venue, as pure functions.
 *
 * Everything the guest's entry flow decides lives here so it can be unit
 * tested and shared: reading the `venue-offers` answers (offer detail, the day
 * rows, the quote, the booking), the date strip tiles and their states, the
 * price-option rows (weekday and time rules explained, never hidden), the
 * stepper bounds, the summary lines with VAT per the venue's VAT mode, the ID
 * reminder, the hold countdown, the refund preview in plain words, the booking
 * page's state, and the plain-words copy for every server error code.
 *
 * No runtime imports beyond other pure modules (the same rule as
 * `venueFeaturePage.ts`): no React, no network, no clock (callers pass `now`).
 * Money is minor units with the currency's exponent; the server computes every
 * total and this module only formats what it was given.
 */
import { formatVenueMoney } from "../venueMoney";
import { venueDateLabel } from "../venueValues";

// ═══════════════════════════════════════════════════════════════════════════
// Wire shapes (parsed fail-closed)
// ═══════════════════════════════════════════════════════════════════════════

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;
const asInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
/** bigint columns may arrive as strings from PostgREST json. */
const asMinor = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d{1,16}$/.test(value)) return Number(value);
  return null;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface EntryPriceOption {
  id: string;
  name: string;
  guestMin: number;
  guestMax: number;
  /** 0 = Monday. Null or all seven = every day. */
  weekdays: number[] | null;
  startTime: string | null;
  endTime: string | null;
  /** "Student or NYSC ID" when the gate checks an ID for this price. */
  idCheckLabel: string | null;
  priceMinor: number;
  /** #4490 P3 — "booking" = one price for the whole group. */
  unit?: "guest" | "booking";
  passDays?: number | null;
  passWindowDays?: number | null;
}

export interface EntryRefundRung {
  minMinutesBefore: number;
  refundBps: number;
}

export interface EntryOfferDetail {
  id: string;
  name: string;
  summary: string | null;
  description: string | null;
  entryStyle: "walk_in" | "day_pass" | "timed_session" | null;
  options: EntryPriceOption[];
  policyText: string | null;
  refundLadder: EntryRefundRung[];
  currencyCode: string;
  exponent: number;
  vat: { mode: "added" | "included" | "none"; ratePct: number } | null;
  venue: {
    id: string | null;
    name: string;
    slug: string | null;
    brandSlug: string | null;
    brandName: string | null;
    address: string | null;
    city: string | null;
    countryCode: string | null;
    timezone: string | null;
  };
  /** #4490 F4 — false while the venue can't take payments online (sold at the gate only). */
  canCollectOnline?: boolean;
}

export function parseEntryOfferDetail(raw: unknown): EntryOfferDetail | null {
  if (!isJson(raw)) return null;
  const id = asText(raw.id);
  const name = asText(raw.name);
  const currencyCode = asText(raw.currencyCode);
  if (id === null || name === null || currencyCode === null) return null;
  const options: EntryPriceOption[] = [];
  for (const row of Array.isArray(raw.options) ? raw.options : []) {
    if (!isJson(row)) continue;
    const optionId = asText(row.id);
    const optionName = asText(row.name);
    const priceMinor = asMinor(row.priceMinor);
    if (optionId === null || optionName === null || priceMinor === null) continue;
    const guestMin = Math.max(1, asInt(row.guestMin) ?? 1);
    const guestMax = Math.max(guestMin, asInt(row.guestMax) ?? guestMin);
    const weekdays = Array.isArray(row.weekdays)
      ? row.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
      : null;
    options.push({
      id: optionId,
      name: optionName,
      guestMin,
      guestMax,
      weekdays,
      startTime: asText(row.startTime),
      endTime: asText(row.endTime),
      idCheckLabel: isJson(row.eligibility) ? asText(row.eligibility.label) : null,
      priceMinor,
      unit: row.unit === "booking" ? "booking" : "guest",
      passDays: asInt(row.passDays),
      passWindowDays: asInt(row.passWindowDays),
    });
  }
  const policy = isJson(raw.policy) ? raw.policy : null;
  const ladder: EntryRefundRung[] = [];
  for (const rung of Array.isArray(policy?.refundLadder) ? (policy?.refundLadder as unknown[]) : []) {
    if (!isJson(rung)) continue;
    const minutes = asInt(rung.minMinutesBefore);
    const bps = asInt(rung.refundBps);
    if (minutes !== null && bps !== null) ladder.push({ minMinutesBefore: minutes, refundBps: bps });
  }
  const vatRaw = isJson(raw.vat) ? raw.vat : null;
  const vatMode = vatRaw?.mode;
  const vat: EntryOfferDetail["vat"] =
    vatMode === "added" || vatMode === "included" || vatMode === "none"
      ? {
          mode: vatMode,
          ratePct: typeof vatRaw?.ratePct === "number" ? vatRaw.ratePct : 0,
        }
      : null;
  const venue = isJson(raw.venue) ? raw.venue : {};
  const style = raw.entryStyle;
  return {
    id,
    name,
    summary: asText(raw.summary),
    description: asText(raw.description),
    entryStyle:
      style === "walk_in" || style === "day_pass" || style === "timed_session" ? style : null,
    options,
    policyText: policyWords(policy),
    refundLadder: ladder,
    currencyCode,
    exponent: asInt(raw.minorUnitExponent) ?? 2,
    vat,
    venue: {
      id: asText(venue.id),
      name: asText(venue.name) ?? "",
      slug: asText(venue.slug),
      brandSlug: asText(venue.brandSlug),
      brandName: asText(venue.brandName),
      address: asText(venue.address),
      city: asText(venue.city),
      countryCode: asText(venue.countryCode),
      timezone: asText(venue.timezone),
    },
    canCollectOnline: raw.canCollectOnline !== false,
  };
}

export type EntryDayStatus =
  | "available"
  | "sold_out"
  | "taken"
  | "gate_only"
  | "closed"
  | "too_soon"
  | "too_far"
  | "wrong_weekday";

export interface EntryDayRow {
  localDate: string;
  startsAt: string;
  endsAt: string;
  windowId: string;
  status: EntryDayStatus;
  reason: string | null;
  remaining: number;
  priceMinor: number | null;
}

const DAY_STATUSES: ReadonlySet<string> = new Set([
  "available",
  "sold_out",
  // #4490 P5 — a by-the-hour day with no free start left.
  "taken",
  "gate_only",
  "closed",
  "too_soon",
  "too_far",
  "wrong_weekday",
]);

export function parseEntryDayRows(raw: unknown): EntryDayRow[] {
  const days = isJson(raw) && Array.isArray(raw.days) ? raw.days : Array.isArray(raw) ? raw : [];
  const rows: EntryDayRow[] = [];
  for (const row of days) {
    if (!isJson(row)) continue;
    const localDate = asText(row.local_date);
    const windowId = asText(row.window_id);
    const status = asText(row.status);
    if (localDate === null || !DATE_ONLY.test(localDate) || windowId === null) continue;
    if (status === null || !DAY_STATUSES.has(status)) continue;
    rows.push({
      localDate,
      startsAt: asText(row.starts_at) ?? "",
      endsAt: asText(row.ends_at) ?? "",
      windowId,
      status: status as EntryDayStatus,
      reason: asText(row.reason),
      remaining: Math.max(0, asInt(row.remaining) ?? 0),
      priceMinor: asMinor(row.price_minor),
    });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// Calendar helpers (calendar dates only; the venue's own day comes from the
// server rows or from `venueToday`)
// ═══════════════════════════════════════════════════════════════════════════

/** The venue's calendar date at `now`, `YYYY-MM-DD`. Falls back to UTC. */
export function venueToday(now: Date, timeZone: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    if (DATE_ONLY.test(parts)) return parts;
  } catch {
    // fall through
  }
  return now.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** 0 = Monday, for a calendar date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAY_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** "Thu 19 Nov". */
export const entryDateLabel = (date: string): string => venueDateLabel(date);

/** "HH:MM" of an ISO instant in the venue's zone (24-hour). */
export function venueClock(iso: string, timeZone: string | null): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone ?? "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at);
  } catch {
    return null;
  }
}

/**
 * "12:00 to 00:00" for a day window. #4490 N34: midnight reads 00:00, the
 * same as the session line ("12:00–00:00"), never 24:00.
 */
export function windowText(row: Pick<EntryDayRow, "startsAt" | "endsAt">, timeZone: string | null): string | null {
  const from = venueClock(row.startsAt, timeZone);
  const to = venueClock(row.endsAt, timeZone);
  if (from === null || to === null) return null;
  return `${from} to ${to}`;
}

/** "Mon to Thu only", "Sat and Sun only", "Mon, Wed and Fri only"; null = every day. */
export function weekdayRuleText(weekdays: readonly number[] | null): string | null {
  if (weekdays === null) return null;
  const days = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (days.length === 0 || days.length === 7) return null;
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (days.length >= 3 && contiguous) {
    return `${WEEKDAY_SHORT[days[0]]} to ${WEEKDAY_SHORT[days[days.length - 1]]} only`;
  }
  const names = days.map((d) => WEEKDAY_SHORT[d]);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} only`;
}

// ═══════════════════════════════════════════════════════════════════════════
// The date strip
// ═══════════════════════════════════════════════════════════════════════════

export type EntryTileState =
  | "open"
  | "few_left"
  | "full"
  | "gate_only"
  | "closed"
  | "too_soon"
  | "not_yet";

export interface EntryDayTile {
  date: string;
  top: string;
  big: string;
  /** Short state under the number ("Few left", "Full", "Closed" …), or "". */
  bottom: string;
  state: EntryTileState;
  /** A day that cannot be bought online. It stays tappable to explain why. */
  soldOnline: boolean;
  row: EntryDayRow | null;
}

const TILE_BOTTOM: Record<EntryTileState, string> = {
  open: "",
  few_left: "Few left",
  full: "Full",
  gate_only: "At the gate",
  closed: "Closed",
  too_soon: "Too late",
  not_yet: "Not yet",
};

/** "Few left" when 10 or fewer remain (or 10% of a small day). */
export const FEW_LEFT = 10;

export function tileStateFor(row: EntryDayRow | null): EntryTileState {
  if (row === null) return "closed";
  switch (row.status) {
    case "available":
      return row.remaining <= FEW_LEFT ? "few_left" : "open";
    case "sold_out":
    case "taken":
      return "full";
    case "gate_only":
      return "gate_only";
    case "too_soon":
      return "too_soon";
    case "too_far":
      return "not_yet";
    case "wrong_weekday":
      // the general strip never asks per option; treat as open
      return "open";
    default:
      return "closed";
  }
}

/**
 * One tile per calendar day from `from` for `count` days. A day with no
 * window on sale is "Closed" (no schedule, a closed weekday, a special day).
 */
export function entryDayTiles(rows: readonly EntryDayRow[], from: string, count: number): EntryDayTile[] {
  // #4490 fix 2 (N85): a day can hold several windows (timed sessions). The
  // tile speaks for the day's best window: a day with any session still on
  // sale is open, never "Too late" because its first session has passed.
  const byDate = new Map<string, EntryDayRow>();
  for (const row of rows) {
    const seen = byDate.get(row.localDate);
    if (seen === undefined || dayRowRank(row) > dayRowRank(seen)) byDate.set(row.localDate, row);
  }
  const tiles: EntryDayTile[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = addDays(from, i);
    const row = byDate.get(date) ?? null;
    const state = tileStateFor(row);
    tiles.push({
      date,
      top: WEEKDAY_SHORT[weekdayOf(date)],
      big: String(Number(date.slice(8, 10))),
      bottom: TILE_BOTTOM[state],
      state,
      soldOnline: state === "open" || state === "few_left",
      row,
    });
  }
  return tiles;
}

/** How good a window is for speaking for its day (higher wins). */
function dayRowRank(row: EntryDayRow): number {
  if (row.status === "available" && row.remaining > 0) return 3;
  if (row.status === "gate_only") return 2;
  if (row.status === "sold_out" || row.status === "taken") return 1;
  return 0;
}

export type EntrySessionState = "open" | "few_left" | "full" | "past" | "closed";

/** One timed session of a day, as a time chip ("10:30", "25 left"). */
export interface EntrySessionChip {
  windowId: string;
  /** "10:30". */
  label: string;
  /** "10:30 to 11:00". */
  rangeText: string | null;
  /** "25 left", "Few left · 4", "Full", "Past". */
  note: string;
  remaining: number;
  state: EntrySessionState;
  /** Can be picked and bought online. */
  usable: boolean;
}

/**
 * #4490 fix 2 (N85) — the day's sessions in time order, each with places
 * left; sessions that have started (server "too_soon") are "Past" and off.
 */
export function entrySessionsFor(
  rows: readonly EntryDayRow[],
  date: string | null,
  timeZone: string | null,
): EntrySessionChip[] {
  if (date === null) return [];
  return rows
    .filter((row) => row.localDate === date)
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((row) => {
      const label = venueClock(row.startsAt, timeZone) ?? "";
      let state: EntrySessionState;
      if (row.status === "available" && row.remaining > 0) state = row.remaining <= FEW_LEFT ? "few_left" : "open";
      else if (row.status === "available" || row.status === "sold_out" || row.status === "taken") state = "full";
      else if (row.status === "too_soon") state = "past";
      else state = "closed";
      const note =
        state === "open"
          ? `${row.remaining} left`
          : state === "few_left"
            ? `Few left · ${row.remaining}`
            : state === "full"
              ? "Full"
              : state === "past"
                ? "Past"
                : "Closed";
      return {
        windowId: row.windowId,
        label,
        rangeText: windowText(row, timeZone),
        note,
        remaining: row.remaining,
        state,
        usable: state === "open" || state === "few_left",
      };
    });
}

/** The session to quote: the picked one when it is usable, else the day's first usable. */
export function pickEntrySession(
  sessions: readonly EntrySessionChip[],
  pickedWindowId: string | null,
): EntrySessionChip | null {
  const picked = sessions.find((s) => s.windowId === pickedWindowId && s.usable);
  return picked ?? sessions.find((s) => s.usable) ?? null;
}

/** The first day after `after` that can be bought online, or null. */
export function nextOpenDate(rows: readonly EntryDayRow[], after: string): string | null {
  const open = rows
    .filter((row) => row.localDate > after && row.status === "available" && row.remaining > 0)
    .map((row) => row.localDate)
    .sort();
  return open[0] ?? null;
}

/** Why a day cannot be bought, in plain words; null for an open day. */
export function entryDayNotice(tile: EntryDayTile): string | null {
  const day = entryDateLabel(tile.date);
  switch (tile.state) {
    case "closed":
      return tile.row?.reason === "bookings_paused"
        ? "Online booking is paused for now. You can still buy at the gate."
        : `Closed on ${day}.`;
    case "full":
      return tile.row !== null && tile.row.remaining > 0
        ? `Only ${tile.row.remaining} ${tile.row.remaining === 1 ? "place is" : "places are"} left on ${day}.`
        : `${day} is full.`;
    case "gate_only":
      return `Tickets for ${day} are at the gate only.`;
    case "too_soon":
      return `It's too late to book ${day} online. You can still buy at the gate if it's open.`;
    case "not_yet":
      return `${day} isn't on sale yet.`;
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Price options for the chosen day
// ═══════════════════════════════════════════════════════════════════════════

export interface EntryOptionRow {
  option: EntryPriceOption;
  /** The price on that day (busy-time prices applied by the server). */
  priceMinor: number;
  /**
   * #4490 06-W4 fix 1 (W4-N1): true only when `priceMinor` is the server's
   * price for the chosen day (and session), from that option's own
   * `availability` row (the quote's resolver, `issue_4490_option_price_at`).
   * False = the offer's list price: never shown as the price of a row.
   */
  dayPriced: boolean;
  /** False when this price does not apply that day or at that time. */
  usable: boolean;
  /** Why it cannot be used, or the rule that limits it ("Mon to Thu only"). */
  rule: string | null;
}

/**
 * Each option on a day. `perOption` holds that option's own day rows (the
 * server's `wrong_weekday` / `wrong_time` answer and its busy price).
 */
export function entryOptionRows(
  options: readonly EntryPriceOption[],
  date: string | null,
  perOption: ReadonlyMap<string, readonly EntryDayRow[]>,
  /** #4490 06-W4 fix 1: the chosen session's window (a timed day has one row per session, each priced on its own start). */
  windowId: string | null = null,
): EntryOptionRow[] {
  return options.map((option) => {
    const own = perOption.get(option.id);
    const dayRow =
      date === null
        ? undefined
        : (windowId !== null ? own?.find((row) => row.windowId === windowId) : undefined) ??
          own?.find((row) => row.localDate === date);
    const weekdayRule = weekdayRuleText(option.weekdays);
    const timeRule =
      option.startTime !== null && option.endTime !== null
        ? `${option.startTime} to ${option.endTime} only`
        : null;
    const rule = [weekdayRule, timeRule].filter((r): r is string => r !== null).join(" · ") || null;
    let usable = true;
    if (dayRow?.status === "wrong_weekday") usable = false;
    else if (dayRow === undefined && date !== null && option.weekdays !== null && option.weekdays.length > 0) {
      usable = option.weekdays.includes(weekdayOf(date));
    }
    return {
      option,
      priceMinor: dayRow?.priceMinor ?? option.priceMinor,
      dayPriced: dayRow !== undefined && dayRow.priceMinor !== null,
      usable,
      rule,
    };
  });
}

/** The line that explains a dimmed option on the chosen day. */
export function optionUnavailableLine(row: EntryOptionRow, date: string): string {
  const days = weekdayRuleText(row.option.weekdays);
  const weekday = WEEKDAY_LONG[weekdayOf(date)];
  if (days !== null && row.option.weekdays !== null && !row.option.weekdays.includes(weekdayOf(date))) {
    return `${row.option.name} is for ${days.replace(/ only$/, "")}. On ${weekday} it isn't available.`;
  }
  return `${row.option.name} isn't available on ${weekday}${
    row.option.startTime !== null && row.option.endTime !== null
      ? ` (it's for ${row.option.startTime} to ${row.option.endTime})`
      : ""
  }.`;
}

/** Counts per option id. */
export type EntryCounts = Readonly<Record<string, number>>;

/** The next count for a stepper press: 0 ↔ guestMin, then one at a time. */
export function stepCount(option: EntryPriceOption, current: number, delta: 1 | -1): number {
  if (delta === 1) {
    if (current <= 0) return option.guestMin;
    return Math.min(option.guestMax, current + 1);
  }
  if (current <= option.guestMin) return 0;
  return current - 1;
}

export const totalGuests = (counts: EntryCounts): number =>
  Object.values(counts).reduce((sum, n) => sum + (Number.isFinite(n) && n > 0 ? n : 0), 0);

/** The quote lines for the server, only usable options with a count. */
export function quoteLinesFor(
  rows: readonly EntryOptionRow[],
  counts: EntryCounts,
): Array<{ priceOptionId: string; guests: number }> {
  return rows
    .filter((row) => row.usable && (counts[row.option.id] ?? 0) > 0)
    .map((row) => ({ priceOptionId: row.option.id, guests: counts[row.option.id] as number }));
}

/** Drop counts for options that cannot be used on the newly chosen day. */
export function countsForDay(rows: readonly EntryOptionRow[], counts: EntryCounts): Record<string, number> {
  const next: Record<string, number> = {};
  for (const row of rows) {
    const n = counts[row.option.id] ?? 0;
    if (row.usable && n > 0) next[row.option.id] = Math.min(Math.max(n, row.option.guestMin), row.option.guestMax);
  }
  return next;
}

/** "Bring a valid Student or NYSC ID. It's checked at the gate." when needed. */
export function idCheckNote(rows: readonly EntryOptionRow[], counts: EntryCounts): string | null {
  const labels = [
    ...new Set(
      rows
        .filter((row) => row.usable && (counts[row.option.id] ?? 0) > 0 && row.option.idCheckLabel !== null)
        .map((row) => row.option.idCheckLabel as string),
    ),
  ];
  if (labels.length === 0) return null;
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
  return `Bring a valid ${list}. It's checked at the gate.`;
}

/** Problems that stop the guest going on, in plain words (empty = fine). */
export function entrySelectionProblem(
  tile: EntryDayTile | null,
  counts: EntryCounts,
): string | null {
  if (tile === null) return "Choose a day.";
  if (!tile.soldOnline) return entryDayNotice(tile);
  const guests = totalGuests(counts);
  if (guests < 1) return "Add at least one guest.";
  if (tile.row !== null && guests > tile.row.remaining) {
    return `Only ${tile.row.remaining} ${tile.row.remaining === 1 ? "place is" : "places are"} left on ${entryDateLabel(tile.date)}.`;
  }
  return null;
}

/** "2 guests" / "1 guest". */
export const guestsText = (n: number): string => `${n} ${n === 1 ? "guest" : "guests"}`;

// ═══════════════════════════════════════════════════════════════════════════
// The quote and the summary
// ═══════════════════════════════════════════════════════════════════════════

export interface EntryQuoteLine {
  priceOptionId: string;
  name: string;
  guests: number;
  unitPriceMinor: number;
  baseMinor: number;
  taxMinor: number;
  totalMinor: number;
  idCheckLabel: string | null;
  passDays?: number | null;
  passWindowDays?: number | null;
}

export interface EntryQuote {
  quoteId: string;
  currencyCode: string;
  subtotalMinor: number;
  feeMinor: number;
  taxMinor: number;
  totalMinor: number;
  expiresAt: string | null;
  vatMode: "added" | "included" | "none";
  vatRatePct: number;
  vatAmountMinor: number;
  window: { windowId: string; localDate: string; startsAt: string; endsAt: string } | null;
  lines: EntryQuoteLine[];
  policyText: string | null;
}

export function parseEntryQuote(raw: unknown): EntryQuote | null {
  if (!isJson(raw)) return null;
  const quoteId = asText(raw.quoteId);
  const currencyCode = asText(raw.currencyCode);
  const totalMinor = asMinor(raw.totalMinor);
  if (quoteId === null || currencyCode === null || totalMinor === null) return null;
  const vat = isJson(raw.vat) ? raw.vat : {};
  const mode = vat.mode === "added" || vat.mode === "included" ? vat.mode : "none";
  const win = isJson(raw.window) ? raw.window : null;
  const lines: EntryQuoteLine[] = [];
  for (const line of Array.isArray(raw.lines) ? raw.lines : []) {
    if (!isJson(line)) continue;
    const id = asText(line.priceOptionId);
    if (id === null) continue;
    lines.push({
      priceOptionId: id,
      name: asText(line.name) ?? "",
      guests: asInt(line.guests) ?? 0,
      unitPriceMinor: asMinor(line.unitPriceMinor) ?? 0,
      baseMinor: asMinor(line.baseMinor) ?? 0,
      taxMinor: asMinor(line.taxMinor) ?? 0,
      totalMinor: asMinor(line.totalMinor) ?? 0,
      idCheckLabel: asText(line.idCheckLabel),
      passDays: asInt(line.passDays),
      passWindowDays: asInt(line.passWindowDays),
    });
  }
  const policy = isJson(raw.policy) ? raw.policy : null;
  return {
    quoteId,
    currencyCode,
    subtotalMinor: asMinor(raw.subtotalMinor) ?? 0,
    feeMinor: asMinor(raw.feeMinor) ?? 0,
    // With VAT included in the price the server reports the tax as 0 and the
    // amount inside `vat.amountMinor`; the summary needs the amount to say "Includes VAT".
    taxMinor: Math.max(asMinor(raw.taxMinor) ?? 0, mode === "none" ? 0 : (asMinor(vat.amountMinor) ?? 0)),
    totalMinor,
    expiresAt: asText(raw.expiresAt),
    vatMode: mode,
    vatRatePct: typeof vat.ratePct === "number" ? vat.ratePct : 0,
    vatAmountMinor: asMinor(vat.amountMinor) ?? asMinor(raw.taxMinor) ?? 0,
    window:
      win === null || asText(win.windowId) === null
        ? null
        : {
            windowId: win.windowId as string,
            localDate: asText(win.localDate) ?? "",
            startsAt: asText(win.startsAt) ?? "",
            endsAt: asText(win.endsAt) ?? "",
          },
    lines,
    policyText: policy === null ? null : policyWords(policy),
  };
}

export interface SummaryLine {
  label: string;
  value: string;
  /** The total row (bold). */
  total?: boolean;
  /** A muted line under the total ("Includes VAT ₦1,046.51"). */
  muted?: boolean;
}

const ratePctText = (pct: number): string =>
  Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;

/**
 * The summary card's rows from the server's numbers. VAT added: a "VAT 7.5%"
 * line above the total. Included: "Includes VAT …" under it. None: nothing.
 */
export function summaryLines(
  lines: ReadonlyArray<Pick<EntryQuoteLine, "name" | "guests" | "baseMinor" | "totalMinor">>,
  totals: {
    currencyCode: string;
    exponent: number;
    taxMinor: number;
    feeMinor: number;
    totalMinor: number;
    vatMode: "added" | "included" | "none";
    vatRatePct: number;
  },
  totalLabel = "Total",
): SummaryLine[] {
  const money = (minor: number): string => formatVenueMoney(minor, totals.currencyCode, totals.exponent);
  const out: SummaryLine[] = lines.map((line) => ({
    label: `${line.guests} × ${line.name}`,
    value: money(totals.vatMode === "included" ? line.totalMinor : line.baseMinor),
  }));
  if (totals.feeMinor > 0) out.push({ label: "Booking fee", value: money(totals.feeMinor) });
  if (totals.vatMode === "added" && totals.taxMinor > 0) {
    out.push({ label: `VAT ${ratePctText(totals.vatRatePct)}`, value: money(totals.taxMinor) });
  }
  out.push({ label: totalLabel, value: money(totals.totalMinor), total: true });
  if (totals.vatMode === "included" && totals.taxMinor > 0) {
    out.push({ label: `Includes VAT ${ratePctText(totals.vatRatePct)}`, value: money(totals.taxMinor), muted: true });
  }
  return out;
}

/** The line under the steppers before a quote exists. */
export function vatModeLine(vat: EntryOfferDetail["vat"]): string | null {
  if (vat === null || vat.mode === "none") return null;
  return vat.mode === "added"
    ? `Prices are before ${ratePctText(vat.ratePct)} VAT, added at checkout.`
    : "Prices include VAT.";
}

// ═══════════════════════════════════════════════════════════════════════════
// The booking (after hold)
// ═══════════════════════════════════════════════════════════════════════════

export type EntryBookingState =
  | "instant_payment_pending"
  | "request_pending"
  | "approved_payment_required"
  | "finalizing"
  | "confirmed"
  | "partially_cancelled"
  | "cancelled"
  | "declined"
  | "request_expired"
  | "reconciliation_required";

export interface EntryPass {
  passId: string;
  status: "valid" | "void" | "refunded";
  admits: number;
  admittedCount: number;
  validLocalDate: string | null;
  validFrom: string | null;
  validTo: string | null;
  holderName: string | null;
  idCheckLabel: string | null;
  idCheckCount: number;
  qrPayload: string | null;
  daysAllowed?: number;
  daysUsed?: number;
  validUntilLocalDate?: string | null;
}

export interface EntryBooking {
  groupId: string;
  reference: string;
  state: EntryBookingState;
  version: number;
  bookingSource: string | null;
  paymentCollection: string | null;
  currencyCode: string;
  subtotalMinor: number;
  feeMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  refundedMinor: number;
  amountDueNowMinor: number;
  holdUntil: string | null;
  guest: { name: string | null; email: string | null; phone: string | null };
  venue: {
    id: string | null;
    name: string;
    slug: string | null;
    brandSlug: string | null;
    brandName: string | null;
    address: string | null;
    city: string | null;
    lat: number | null;
    lng: number | null;
    timezone: string | null;
  };
  offer: { id: string | null; name: string; entryStyle: string | null };
  window: { localDate: string; startsAt: string; endsAt: string } | null;
  lines: EntryQuoteLine[];
  policyText: string | null;
  vatMode: "added" | "included" | "none";
  passes: EntryPass[];
}

const BOOKING_STATES: ReadonlySet<string> = new Set([
  "instant_payment_pending",
  "request_pending",
  "approved_payment_required",
  "finalizing",
  "confirmed",
  "partially_cancelled",
  "cancelled",
  "declined",
  "request_expired",
  "reconciliation_required",
]);

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function parseEntryBooking(raw: unknown): EntryBooking | null {
  if (!isJson(raw)) return null;
  const groupId = asText(raw.groupId);
  const state = asText(raw.state);
  const currencyCode = asText(raw.currencyCode);
  if (groupId === null || state === null || !BOOKING_STATES.has(state) || currencyCode === null) {
    return null;
  }
  const guest = isJson(raw.guest) ? raw.guest : {};
  const venue = isJson(raw.venue) ? raw.venue : {};
  const offer = isJson(raw.offer) ? raw.offer : {};
  const win = isJson(raw.window) ? raw.window : null;
  const policy = isJson(raw.policy) ? raw.policy : {};
  const passes: EntryPass[] = [];
  for (const pass of Array.isArray(raw.passes) ? raw.passes : []) {
    if (!isJson(pass)) continue;
    const passId = asText(pass.passId);
    const status = pass.status;
    if (passId === null || (status !== "valid" && status !== "void" && status !== "refunded")) continue;
    passes.push({
      passId,
      status,
      admits: asInt(pass.admits) ?? 0,
      admittedCount: asInt(pass.admittedCount) ?? 0,
      validLocalDate: asText(pass.validLocalDate),
      validFrom: asText(pass.validFrom),
      validTo: asText(pass.validTo),
      holderName: asText(pass.holderName),
      idCheckLabel: asText(pass.idCheckLabel),
      idCheckCount: asInt(pass.idCheckCount) ?? 0,
      qrPayload: asText(pass.qrPayload),
      daysAllowed: Math.max(1, asInt(pass.daysAllowed) ?? 1),
      daysUsed: Math.max(0, asInt(pass.daysUsed) ?? 0),
      validUntilLocalDate: asText(pass.validUntilLocalDate),
    });
  }
  const quoteLike = parseEntryQuote({
    quoteId: "booking",
    currencyCode,
    totalMinor: asMinor(raw.totalMinor) ?? 0,
    lines: raw.lines,
  });
  const vatMode = raw.vatMode === "added" || raw.vatMode === "included" ? raw.vatMode : "none";
  return {
    groupId,
    reference: asText(raw.reference) ?? "",
    state: state as EntryBookingState,
    version: asInt(raw.version) ?? 1,
    bookingSource: asText(raw.bookingSource),
    paymentCollection: asText(raw.paymentCollection),
    currencyCode,
    subtotalMinor: asMinor(raw.subtotalMinor) ?? 0,
    feeMinor: asMinor(raw.feeMinor) ?? 0,
    taxMinor: asMinor(raw.taxMinor) ?? 0,
    totalMinor: asMinor(raw.totalMinor) ?? 0,
    paidMinor: asMinor(raw.paidMinor) ?? 0,
    refundedMinor: asMinor(raw.refundedMinor) ?? 0,
    amountDueNowMinor: asMinor(raw.amountDueNowMinor) ?? 0,
    holdUntil: asText(raw.holdUntil),
    guest: { name: asText(guest.name), email: asText(guest.email), phone: asText(guest.phone) },
    venue: {
      id: asText(venue.id),
      name: asText(venue.name) ?? "",
      slug: asText(venue.slug),
      brandSlug: asText(venue.brandSlug),
      brandName: asText(venue.brandName),
      address: asText(venue.address),
      city: asText(venue.city),
      lat: asNumber(venue.lat),
      lng: asNumber(venue.lng),
      timezone: asText(venue.timezone),
    },
    offer: {
      id: asText(offer.id),
      name: asText(offer.name) ?? "",
      entryStyle: asText(offer.entryStyle),
    },
    window:
      win === null
        ? null
        : {
            localDate: asText(win.localDate) ?? "",
            startsAt: asText(win.startsAt) ?? "",
            endsAt: asText(win.endsAt) ?? "",
          },
    lines: quoteLike?.lines ?? [],
    policyText: policyWords(policy),
    vatMode,
    passes,
  };
}

// ---------------------------------------------------------------------------
// Refund words: the SAME sentence the Host reads in the editor's review.
// ---------------------------------------------------------------------------

function minutesBeforeWords(minutes: number): string {
  if (minutes <= 0) return "until it starts";
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? "24 hours before" : `${d} days before`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "1 hour before" : `${h} hours before`;
  }
  return `${minutes} min before`;
}

/** "Full refund up to 24 hours before, then 50% back until it starts" - or "No refunds". */
export function refundLadderWords(ladder: readonly EntryRefundRung[]): string {
  if (ladder.length === 0) return "No refunds";
  return [...ladder]
    .sort((a, b) => b.minMinutesBefore - a.minMinutesBefore)
    .map((rung) => {
      const pct =
        rung.refundBps >= 10000 ? "Full refund" : rung.refundBps <= 0 ? "No refund" : `${rung.refundBps / 100}% back`;
      return rung.minMinutesBefore <= 0 ? `${pct} until it starts` : `${pct} up to ${minutesBeforeWords(rung.minMinutesBefore)}`;
    })
    .join(", then ");
}

/**
 * The refund terms as a guest reads them. Built from the ladder when the server
 * sent one; otherwise the server's own sentence is made readable ("1 day(s)"
 * becomes "24 hours", "up to the start" becomes "until it starts").
 */
export function policyWords(policy: Record<string, unknown> | null): string | null {
  if (policy === null) return null;
  const rawLadder = Array.isArray(policy.refundLadder) ? (policy.refundLadder as unknown[]) : null;
  if (rawLadder !== null) {
    const ladder: EntryRefundRung[] = [];
    let complete = true;
    for (const rung of rawLadder) {
      // The offer reads camelCase; a booking's snapshot keeps the stored snake_case.
      const minutes = isJson(rung) ? asInt(rung.minMinutesBefore ?? rung.min_minutes_before) : null;
      const bps = isJson(rung) ? asInt(rung.refundBps ?? rung.refund_bps) : null;
      if (minutes === null || bps === null) complete = false;
      else ladder.push({ minMinutesBefore: minutes, refundBps: bps });
    }
    if (complete) return refundLadderWords(ladder);
  }
  const text = asText(policy.text);
  if (text === null) return null;
  return text
    .replace(/\b1 day\(s\) before/g, "24 hours before")
    .replace(/\b(\d+) day\(s\) before/g, "$1 days before")
    .replace(/\b1 hour\(s\) before/g, "1 hour before")
    .replace(/\b(\d+) hour\(s\) before/g, "$1 hours before")
    .replace(/ up to the start\b/g, " until it starts")
    .replace(/(\d+)% refund/g, "$1% back")
    .replace(/\.\s+(?=\S)/g, ", then ")
    .replace(/\.$/, "");
}

/**
 * Booking lines in the offer's own price order (the order checkout shows). The
 * server lists a booking's lines by when they were written, which is not the
 * offer's order; unknown ids keep their place after the known ones.
 */
export function orderLinesByOptions<T extends { priceOptionId: string }>(
  lines: readonly T[],
  optionIds: readonly string[],
): T[] {
  if (optionIds.length === 0) return [...lines];
  const rank = (id: string): number => {
    const at = optionIds.indexOf(id);
    return at === -1 ? optionIds.length : at;
  };
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => rank(a.line.priceOptionId) - rank(b.line.priceOptionId) || a.index - b.index)
    .map((entry) => entry.line);
}

/** "12 Ikorodu Rd, Lagos, Nigeria" - the city is added only when the address does not already name it. */
export function venueAddressLine(address: string | null, city: string | null): string | null {
  const a = address?.trim() ?? "";
  const c = city?.trim() ?? "";
  if (a.length === 0) return c.length > 0 ? c : null;
  if (c.length === 0) return a;
  const parts = a.split(",").map((part) => part.trim().toLowerCase());
  return parts.includes(c.toLowerCase()) || a.toLowerCase().includes(c.toLowerCase()) ? a : `${a}, ${c}`;
}

/** The currency's minor-unit exponent (NGN 2, JPY 0); 2 when unknown. */
export function currencyExponent(currencyCode: string): number {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency: currencyCode })
      .resolvedOptions().maximumFractionDigits;
    return typeof digits === "number" && digits >= 0 && digits <= 4 ? digits : 2;
  } catch {
    return 2;
  }
}

/**
 * The VAT rate a booking was charged, from its own snapshot numbers (the
 * booking read carries the amounts, not the rate): tax over the pre-tax
 * amount, to one decimal. 0 when there is no tax.
 */
export function impliedVatRatePct(booking: Pick<EntryBooking, "taxMinor" | "totalMinor" | "feeMinor">): number {
  const base = booking.totalMinor - booking.taxMinor - booking.feeMinor;
  if (booking.taxMinor <= 0 || base <= 0) return 0;
  return Math.round((booking.taxMinor / base) * 1000) / 10;
}

/**
 * The VAT shown on a booking. A booking read reports tax 0 when VAT is included in the
 * price, so the amount inside the price is worked out from the rate: total x rate / (100 + rate)
 * (the same split the quote uses). Added VAT keeps the stored tax.
 */
export function bookingVat(
  booking: Pick<EntryBooking, "taxMinor" | "totalMinor" | "feeMinor" | "vatMode">,
  offerRatePct: number | null,
): { taxMinor: number; ratePct: number } {
  if (booking.taxMinor > 0) return { taxMinor: booking.taxMinor, ratePct: impliedVatRatePct(booking) };
  if (booking.vatMode !== "included" || offerRatePct === null || offerRatePct <= 0) {
    return { taxMinor: 0, ratePct: 0 };
  }
  const priced = Math.max(0, booking.totalMinor - booking.feeMinor);
  return { taxMinor: Math.round((priced * offerRatePct) / (100 + offerRatePct)), ratePct: offerRatePct };
}

/** Seconds left on a hold (0 when gone or unknown). */
export function holdSecondsLeft(holdUntil: string | null, now: number): number {
  if (holdUntil === null) return 0;
  const end = Date.parse(holdUntil);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - now) / 1000));
}

/** "On hold until 20:41" in the venue's time. */
export function holdUntilText(holdUntil: string, timeZone: string | null): string {
  const clock = venueClock(holdUntil, timeZone);
  return clock === null ? "On hold" : `On hold until ${clock}`;
}

/** "14:05 left" (minutes:seconds). */
export function countdownText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`;
}

export type VisitView =
  | { kind: "pay"; amountMinor: number; holdUntil: string | null }
  | { kind: "hold_expired" }
  | { kind: "confirming" }
  | { kind: "checking" }
  | { kind: "confirmed" }
  | { kind: "cancelled"; partial: boolean }
  | { kind: "other" };

/** Which booking page to show. Pure: `now` is the caller's clock. */
export function visitViewFor(booking: EntryBooking, now: number): VisitView {
  switch (booking.state) {
    case "instant_payment_pending":
    case "approved_payment_required":
      if (booking.amountDueNowMinor <= 0) return { kind: "confirming" };
      if (booking.holdUntil === null || holdSecondsLeft(booking.holdUntil, now) <= 0) {
        return { kind: "hold_expired" };
      }
      return { kind: "pay", amountMinor: booking.amountDueNowMinor, holdUntil: booking.holdUntil };
    case "finalizing":
      return { kind: "confirming" };
    case "reconciliation_required":
      return { kind: "checking" };
    case "confirmed":
      return { kind: "confirmed" };
    case "cancelled":
      return { kind: "cancelled", partial: false };
    case "partially_cancelled":
      return { kind: "cancelled", partial: true };
    default:
      return { kind: "other" };
  }
}

/** The pass's headline: "3 guests · Thu 19 Nov". */
export function passHeadline(booking: EntryBooking): string {
  const admits = booking.passes[0]?.admits ?? booking.lines.reduce((n, l) => n + l.guests, 0);
  const date = booking.window?.localDate ?? booking.passes[0]?.validLocalDate ?? null;
  return date === null ? guestsText(admits) : `${guestsText(admits)} · ${entryDateLabel(date)}`;
}

/** "Show this at the gate, any time from 12:00 to 00:00." */
export function passWindowLine(booking: EntryBooking, place: "gate" | "front_desk" = "gate"): string | null {
  if (booking.window === null) return null;
  const text = windowText(booking.window, booking.venue.timezone);
  // #4490 fix 2 (N87): a room or desk booked by the hour is shown at the front desk.
  const where = place === "front_desk" ? "at the front desk" : "at the gate";
  return text === null ? null : `Show this ${where}, any time from ${text}.`;
}

/** "Bring a Student or NYSC ID for 1 guest." */
export function passIdLine(pass: EntryPass | undefined): string | null {
  if (pass === undefined || pass.idCheckLabel === null) return null;
  const n = pass.idCheckCount > 0 ? pass.idCheckCount : 1;
  return `Bring a ${pass.idCheckLabel} for ${guestsText(n)}.`;
}

/** "10-Day Flex · any 10 days in 60" or the unchanged single-day name. */
export function entryOptionName(option: EntryPriceOption): string {
  if (option.passDays == null || option.passWindowDays == null) return option.name;
  const rule = option.passDays === option.passWindowDays
    ? `${option.passDays} days in a row`
    : `any ${option.passDays} days in ${option.passWindowDays}`;
  return `${option.name} · ${rule}`;
}

/** "Day 3 of 10 · valid until Sat 16 Jan" after the third admission day. */
export function passProgressLine(pass: EntryPass | undefined): string | null {
  const allowed = pass?.daysAllowed ?? 1;
  const until = pass?.validUntilLocalDate ?? null;
  if (pass === undefined || allowed <= 1 || until === null) return null;
  const day = Math.min(allowed, Math.max(1, pass.daysUsed ?? 0));
  return `Day ${day} of ${allowed} · valid until ${entryDateLabel(until)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Cancel: the refund preview in plain words
// ═══════════════════════════════════════════════════════════════════════════

export interface EntryCancelPreview {
  groupId: string;
  previewIds: string[];
  previewHash: string;
  paidMinor: number;
  refundMinor: number;
  keepMinor: number;
  currencyCode: string;
  paymentCollection: string | null;
  expiresAt: string | null;
}

export function parseEntryCancelPreview(raw: unknown): EntryCancelPreview | null {
  if (!isJson(raw)) return null;
  const groupId = asText(raw.groupId);
  const previewHash = asText(raw.previewHash);
  const currencyCode = asText(raw.currencyCode);
  const ids = Array.isArray(raw.previewIds) ? raw.previewIds.filter((id): id is string => typeof id === "string") : [];
  if (groupId === null || previewHash === null || currencyCode === null || ids.length === 0) return null;
  return {
    groupId,
    previewIds: ids,
    previewHash,
    paidMinor: asMinor(raw.paidMinor) ?? 0,
    refundMinor: asMinor(raw.refundMinor) ?? 0,
    keepMinor: asMinor(raw.keepMinor) ?? 0,
    currencyCode,
    paymentCollection: asText(raw.paymentCollection),
    expiresAt: asText(raw.expiresAt),
  };
}

/** What cancelling means for the guest's money, in one or two sentences. */
export function refundPreviewWords(preview: EntryCancelPreview, exponent: number, venueName: string): string {
  const money = (minor: number): string => formatVenueMoney(minor, preview.currencyCode, exponent);
  if (preview.paidMinor <= 0) {
    return "Nothing was paid online, so there is nothing to refund. Cancelling frees your places.";
  }
  if (preview.refundMinor >= preview.paidMinor) {
    return `You paid ${money(preview.paidMinor)}. You get all of it back.`;
  }
  if (preview.refundMinor <= 0) {
    return `You paid ${money(preview.paidMinor)}. Under ${venueName}'s terms nothing comes back at this point. Cancelling frees your places.`;
  }
  return `You paid ${money(preview.paidMinor)}. You get ${money(preview.refundMinor)} back. ${venueName} keeps ${money(preview.keepMinor)} under its terms.`;
}

/** The cancelled page's money line. */
export function cancelledMoneyLine(booking: EntryBooking, exponent: number): string {
  const money = (minor: number): string => formatVenueMoney(minor, booking.currencyCode, exponent);
  if (booking.refundedMinor > 0) {
    return `${money(booking.refundedMinor)} is on its way back to the card or account you paid with. Banks usually take a few working days.`;
  }
  if (booking.paidMinor > 0) return "Nothing was refunded under the terms you agreed.";
  return "Nothing was charged.";
}

// ═══════════════════════════════════════════════════════════════════════════
// Server error codes → plain words
// ═══════════════════════════════════════════════════════════════════════════

const ERROR_COPY: Readonly<Record<string, string>> = {
  offer_not_found: "This is no longer on sale.",
  offer_window_unavailable: "That day is no longer on sale. Choose another day.",
  offer_option_unavailable: "One of those prices is no longer on sale. Check your choices.",
  offer_wrong_weekday: "One of those prices isn't available on that day.",
  offer_wrong_time: "One of those prices isn't available at that time.",
  offer_guests_out_of_range: "That number of guests isn't allowed for one of the prices.",
  offer_day_closed: "The venue is closed that day. Choose another day.",
  offer_too_soon: "It's too late to book that day online.",
  offer_too_far: "That day isn't on sale yet.",
  offer_amount_too_large:
    "This payment is too large to take in one go. Ask for a smaller deposit, or record it as paid to the venue.",
  offer_quote_not_found: "Your prices ran out. We've checked them again.",
  offer_quote_expired: "Prices are held for 15 minutes. We've checked them again.",
  offer_changed: "The venue changed this offer. Check the new price.",
  offer_guest_invalid: "Check your name, email and phone.",
  offer_guest_email_required: "Add your email. Your pass is sent there.",
  offer_idempotency_conflict: "Something changed while we were saving. Try again.",
  offer_booking_not_found: "We couldn't find this booking. The link may be wrong or out of date.",
  offer_hold_expired: "Your hold ran out and the places went back on sale. Start again.",
  offer_payment_already_pending: "A payment for this booking is already in progress. Give it a minute, then check again.",
  // #4490 06-W4 fix 1 (W4-N3): another device is paying this booking another way right now.
  offer_payment_mode_conflict: "Something changed while we were saving. Try again.",
  offer_invalid_transition: "This booking can't do that any more. Reload to see where it stands.",
  offer_bank_not_ready: "This venue can't take payments online right now. You can still buy at the gate.",
  offer_payment_details_rejected:
    "The payment page didn't accept these details. Check your email address and try again.",
  offer_payment_unavailable: "We couldn't open the payment page. Try again. If money left your account, we're checking it.",
  offer_payment_ambiguous: "We couldn't confirm the payment page opened. If money left your account, we're checking it.",
  offer_cancel_too_late: "This booking can no longer be cancelled: it has already started.",
  offer_already_checked_in: "This booking has been used at the gate, so it can't be cancelled.",
  offer_cancel_preview_invalid: "The refund amount changed. Check it again before you cancel.",
  offers_not_enabled: "This venue isn't selling online right now.",
  stale_write: "Something changed while we were saving. Try again.",
  booking_token_required: "We couldn't find this booking. Open it from the link in your email.",
  rate_limited: "Too many tries in a short time. Wait a minute, then try again.",
  auth_invalid: "Your session ended. Reload the page and try again.",
  invalid_request: "Something went wrong with that request. Reload and try again.",
  availability_range_invalid: "We couldn't load those days. Try again.",
  // #4490 P3 — group packages, deposits, the balance and changes.
  offer_answer_required: "Choose an option for each question before you pay.",
  offer_extra_unavailable: "One of those extras isn't offered any more. Check your extras.",
  offer_pay_mode_unavailable: "This booking has to be paid in full now.",
  offer_nothing_to_pay: "There's nothing left to pay on this booking.",
  offer_payment_already_paid: "That payment went through already. We've refreshed your booking.",
  offer_change_not_allowed: "This booking can't be changed that way.",
  offer_change_too_late: "It's too late to change this booking online. Contact the venue.",
  offer_change_nothing: "That's the same as your booking now.",
  // #4490 P4 follow-ups (private hire changes, "Hours you set").
  offer_space_taken: "Your space is already booked then. Pick another day or time.",
  offer_capacity_conflict: "That day is full. Pick another day.",
  offer_length_invalid: "Pick a length between the shortest and longest booking.",
};

/** Plain words for a server code. Unknown codes never show a raw code. */
export function venueOfferErrorCopy(code: string | null | undefined, remaining?: number | null): string {
  if (code === "offer_sold_out") {
    return typeof remaining === "number" && remaining > 0
      ? `Only ${remaining} ${remaining === 1 ? "place is" : "places are"} left that day. Lower the number of guests or choose another day.`
      : "That day sold out online. Choose another day.";
  }
  if (typeof code === "string" && code in ERROR_COPY) return ERROR_COPY[code];
  return "Something went wrong on our side. Try again in a moment.";
}

/** The email check the pay button waits on. */
export const ENTRY_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
