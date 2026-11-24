/**
 * #4490 P4-3 — asking for a private hire, as pure functions.
 *
 * The venue page's Private hire tab, the request form and the booking page
 * share these: reading the hire offer (places, price rows, sessions, the
 * damage deposit, how the venue answers), the day strip from one availability
 * row per session, the session chips, the places for one session
 * (`hire_options`: free / on hold / taken / too small / too big), the hire
 * quote and its pay plan, the hire part of a booking, and the booking state
 * card in plain words for all ten booking states.
 *
 * Same rules as `entryModel.ts`: no React, no network, no clock (callers pass
 * `now`). Money is minor units; the server computes every total — the amount
 * a guest is asked to pay is always the server's own number.
 */
import { formatVenueMoney } from "../venueMoney";
import {
  entryDateLabel,
  parseEntryOfferDetail,
  parseEntryQuote,
  venueClock,
  venueOfferErrorCopy,
  type EntryOfferDetail,
  type EntryQuote,
} from "./entryModel";
import { parsePayPlan, type PackageExtraView, type PackageQuoteExtra, type PayPlan } from "./packageModel";
import {
  isVenueLayout,
  venueLayoutCapacityError,
  type VenueLayout,
} from "./layoutModel";

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;
const asInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const asMinor = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d{1,16}$/.test(value)) return Number(value);
  return null;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// ═══════════════════════════════════════════════════════════════════════════
// The hire offer
// ═══════════════════════════════════════════════════════════════════════════

export interface HireSpaceView {
  id: string;
  name: string;
  setting: string | null;
  capacityStanding: number | null;
  capacitySeated: number | null;
}

export interface HireRowView {
  optionId: string;
  name: string;
  /** #4490 P4 follow-up: "hour" = price x booked hours. */
  unit: "guest" | "booking" | "hour";
  spaceId: string | null;
  combinationId: string | null;
  placeName: string;
  capacity: number | null;
  layoutCapacities: Partial<Record<VenueLayout, number>>;
  guestMin: number;
  guestMax: number;
  weekdays: number[] | null;
  priceMinor: number;
}

export interface HireSessionView {
  label: string;
  startTime: string;
  endTime: string;
  pastMidnight: boolean;
  weekdays: number[] | null;
}

export interface HireOfferDetail extends EntryOfferDetail {
  kind: "private_hire";
  mode: "request" | "instant";
  charge: "hire_fee" | "min_spend" | "per_guest";
  requestResponseHours: number;
  damageDepositMinor: number;
  extraGuestMinor: number | null;
  overtimeMinorPerHour: number | null;
  extras: PackageExtraView[];
  layouts: VenueLayout[];
  spaces: HireSpaceView[];
  combinations: Array<{ id: string; name: string; spaceIds: string[] }>;
  rows: HireRowView[];
  sessions: HireSessionView[];
  deposit: { kind: "none" | "percent" | "fixed"; value: number | null; balanceDueDaysBefore: number | null };
  minNoticeMinutes: number | null;
  maxAdvanceDays: number | null;
  canCollectOnline: boolean;
}

export function parseHireOfferDetail(raw: unknown): HireOfferDetail | null {
  const base = parseEntryOfferDetail(raw);
  if (base === null || !isJson(raw) || raw.kind !== "private_hire" || !isJson(raw.hire)) return null;
  const h = raw.hire;
  const rows: HireRowView[] = [];
  for (const r of Array.isArray(h.rows) ? h.rows : []) {
    if (!isJson(r)) continue;
    const optionId = asText(r.optionId);
    const priceMinor = asMinor(r.priceMinor);
    if (optionId === null || priceMinor === null) continue;
    rows.push({
      optionId,
      name: asText(r.name) ?? "",
      unit: r.unit === "guest" ? "guest" : r.unit === "hour" ? "hour" : "booking",
      spaceId: asText(r.spaceId),
      combinationId: asText(r.combinationId),
      placeName: asText(r.placeName) ?? asText(r.name) ?? "",
      capacity: asInt(r.capacity),
      layoutCapacities: Object.fromEntries(
        Object.entries(isJson(r.layoutCapacities) ? r.layoutCapacities : {}).filter(
          ([layout, capacity]) => isVenueLayout(layout) && asInt(capacity) !== null,
        ),
      ) as Partial<Record<VenueLayout, number>>,
      guestMin: Math.max(1, asInt(r.guestMin) ?? 1),
      guestMax: Math.max(1, asInt(r.guestMax) ?? 1),
      weekdays: Array.isArray(r.weekdays) ? r.weekdays.filter((d): d is number => typeof d === "number") : null,
      priceMinor,
    });
  }
  const sessions: HireSessionView[] = [];
  for (const s of Array.isArray(h.sessions) ? h.sessions : []) {
    if (!isJson(s)) continue;
    const label = asText(s.label);
    const startTime = asText(s.startTime);
    const endTime = asText(s.endTime);
    if (label === null || startTime === null || endTime === null) continue;
    sessions.push({
      label,
      startTime,
      endTime,
      pastMidnight: s.pastMidnight === true,
      weekdays: Array.isArray(s.weekdays) ? s.weekdays.filter((d): d is number => typeof d === "number") : null,
    });
  }
  const dep = isJson(raw.deposit) ? raw.deposit : {};
  const charge = h.charge === "min_spend" || h.charge === "per_guest" ? h.charge : "hire_fee";
  const extras: PackageExtraView[] = [];
  for (const row of Array.isArray(raw.extras) ? raw.extras : []) {
    if (!isJson(row)) continue;
    const id = asText(row.id);
    const name = asText(row.name);
    const priceMinor = asMinor(row.priceMinor);
    if (id === null || name === null || priceMinor === null) continue;
    extras.push({ id, name, priceMinor, per: row.per === "guest" ? "guest" : "booking" });
  }
  return {
    ...base,
    kind: "private_hire",
    mode: h.bookingMode === "instant" || raw.confirmationMode === "instant" ? "instant" : "request",
    charge,
    requestResponseHours: asInt(h.requestResponseHours) ?? 48,
    damageDepositMinor: asMinor(h.damageDepositMinor) ?? 0,
    extraGuestMinor: asMinor(h.extraGuestMinor),
    overtimeMinorPerHour: asMinor(h.overtimeMinorPerHour),
    extras,
    layouts: (Array.isArray(h.layouts) ? h.layouts : []).filter(isVenueLayout),
    spaces: (Array.isArray(h.spaces) ? h.spaces : []).filter(isJson).flatMap((s) => {
      const id = asText(s.id);
      const name = asText(s.name);
      return id === null || name === null
        ? []
        : [{ id, name, setting: asText(s.setting), capacityStanding: asInt(s.capacityStanding), capacitySeated: asInt(s.capacitySeated) }];
    }),
    combinations: (Array.isArray(h.combinations) ? h.combinations : []).filter(isJson).flatMap((c) => {
      const id = asText(c.id);
      const name = asText(c.name);
      return id === null || name === null ? [] : [{ id, name, spaceIds: ids(c.spaceIds) }];
    }),
    rows,
    sessions,
    deposit: {
      kind: dep.kind === "percent" || dep.kind === "fixed" ? dep.kind : "none",
      value: asMinor(dep.value),
      balanceDueDaysBefore: asInt(dep.balanceDueDaysBefore),
    },
    minNoticeMinutes: asInt(raw.minNoticeMinutes),
    maxAdvanceDays: asInt(raw.maxAdvanceDays),
    canCollectOnline: raw.canCollectOnline !== false,
  };
}

/** The guest range across every place: smallest row minimum to the largest place. */
export function hireGuestRange(offer: Pick<HireOfferDetail, "rows" | "extraGuestMinor">): { min: number; max: number } {
  if (offer.rows.length === 0) return { min: 1, max: 1 };
  const min = Math.min(...offer.rows.map((r) => r.guestMin));
  const max = Math.max(
    ...offer.rows.map((r) => (offer.extraGuestMinor !== null && r.capacity !== null ? Math.max(r.guestMax, r.capacity) : r.guestMax)),
  );
  return { min, max: Math.max(min, max) };
}

/** "From ₦4,000,000", "From ₦8,000 a guest". */
export function hirePriceWords(offer: Pick<HireOfferDetail, "rows" | "currencyCode" | "exponent" | "charge">): string {
  if (offer.rows.length === 0) return "Ask for a price";
  const low = Math.min(...offer.rows.map((r) => r.priceMinor));
  const money = formatVenueMoney(low, offer.currencyCode, offer.exponent);
  if (offer.rows.every((r) => r.unit === "hour")) return `From ${money} an hour`;
  if (offer.charge === "per_guest") return `From ${money} a guest`;
  if (offer.charge === "min_spend") return `From ${money} minimum spend`;
  return `From ${money}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Days and sessions
// ═══════════════════════════════════════════════════════════════════════════

export type HireDayStatus = "available" | "held" | "taken" | "closed" | "too_soon" | "too_far" | "wrong_weekday";

export interface HireDayRow {
  localDate: string;
  windowId: string;
  startsAt: string;
  endsAt: string;
  status: HireDayStatus;
  reason: string | null;
  priceMinor: number | null;
}

const HIRE_STATUSES: ReadonlySet<string> = new Set(["available", "held", "taken", "closed", "too_soon", "too_far", "wrong_weekday"]);

export function parseHireDayRows(raw: unknown): HireDayRow[] {
  const days = isJson(raw) && Array.isArray(raw.days) ? raw.days : Array.isArray(raw) ? raw : [];
  const out: HireDayRow[] = [];
  for (const row of days) {
    if (!isJson(row)) continue;
    const localDate = asText(row.local_date);
    const windowId = asText(row.window_id);
    const status = asText(row.status);
    if (localDate === null || !DATE.test(localDate) || windowId === null || status === null || !HIRE_STATUSES.has(status)) continue;
    out.push({
      localDate,
      windowId,
      startsAt: asText(row.starts_at) ?? "",
      endsAt: asText(row.ends_at) ?? "",
      status: status as HireDayStatus,
      reason: asText(row.reason),
      priceMinor: asMinor(row.price_minor),
    });
  }
  return out;
}

export type HireTileState = "free" | "held" | "taken" | "closed" | "too_soon" | "too_far" | "none";

export interface HireDayTile {
  date: string;
  state: HireTileState;
  /** "Free", "On hold", "Taken", "Closed", "Too soon", "" */
  word: string;
}

// #4490 P4 follow-up: "too soon" outranks "taken": inside the notice period an
// "Hours you set" day reads as taken (no free start), which isn't the reason.
const RANK: Record<HireDayStatus, number> = { available: 7, held: 6, too_soon: 5, taken: 4, closed: 3, wrong_weekday: 2, too_far: 1 };

/** One tile per day: the best session that day decides it. */
export function hireDayTiles(rows: readonly HireDayRow[], from: string, count: number): HireDayTile[] {
  const tiles: HireDayTile[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    const day = rows.filter((r) => r.localDate === date);
    if (day.length === 0) {
      tiles.push({ date, state: "none", word: "" });
      continue;
    }
    const best = [...day].sort((a, b) => RANK[b.status] - RANK[a.status])[0];
    const state: HireTileState =
      best.status === "available" ? "free" : best.status === "wrong_weekday" ? "closed" : best.status;
    tiles.push({ date, state, word: TILE_WORD[state] });
  }
  return tiles;
}

const TILE_WORD: Record<HireTileState, string> = {
  free: "Free",
  held: "On hold",
  taken: "Taken",
  closed: "Closed",
  too_soon: "Too soon",
  too_far: "Too far",
  none: "",
};

export interface HireSessionChip {
  windowId: string;
  label: string;
  /** "12:00–00:00" in the venue's time. */
  times: string | null;
  usable: boolean;
  /** Why not, in words ("On hold", "Taken", "Too soon to book online"). */
  note: string | null;
}

/** The sessions of a day, named from the offer's sessions by start time. */
export function sessionChipsFor(
  rows: readonly HireDayRow[],
  date: string | null,
  sessions: readonly HireSessionView[],
  timeZone: string | null,
  /** #4490 P4 follow-up: drop windows that aren't a named session (the "Hours you set" day window). */
  namedOnly = false,
): HireSessionChip[] {
  if (date === null) return [];
  const nameOf = (r: HireDayRow): HireSessionView | undefined => {
    const start = venueClock(r.startsAt, timeZone);
    const end = venueClock(r.endsAt, timeZone);
    return sessions.find((s) => s.startTime === start && s.endTime === (end === "24:00" ? "00:00" : end)) ?? sessions.find((s) => s.startTime === start);
  };
  return rows
    .filter((r) => r.localDate === date && (!namedOnly || sessions.length === 0 || nameOf(r) !== undefined))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((r) => {
      const start = venueClock(r.startsAt, timeZone);
      const end = venueClock(r.endsAt, timeZone);
      const named = nameOf(r);
      const note =
        r.status === "available"
          ? null
          : r.status === "held"
            ? "On hold"
            : r.status === "taken"
              ? "Taken"
              : r.status === "too_soon"
                ? "Too soon to book online"
                : r.status === "too_far"
                  ? "Too far ahead"
                  : r.reason === "no_space_fits"
                    ? "No space fits your group"
                    : "Not available";
      return {
        windowId: r.windowId,
        label: named?.label ?? (start !== null ? `From ${start}` : "Session"),
        times: start !== null && end !== null ? `${start}–${end === "24:00" ? "00:00" : end}` : null,
        usable: r.status === "available" || r.status === "held" || r.status === "taken",
        note,
      };
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Places for one session (hire_options)
// ═══════════════════════════════════════════════════════════════════════════

export type HirePlaceStatus = "available" | "held" | "taken" | "too_small" | "too_big" | "wrong_weekday";

export interface HirePlaceOption {
  priceOptionId: string;
  name: string;
  spaceId: string | null;
  combinationId: string | null;
  placeName: string;
  setting: string | null;
  capacity: number | null;
  guestMin: number;
  guestMax: number;
  unit: "guest" | "booking" | "hour";
  priceMinor: number;
  status: HirePlaceStatus;
  reason: string | null;
  blockedBy: string | null;
}

const PLACE_STATUSES: ReadonlySet<string> = new Set(["available", "held", "taken", "too_small", "too_big", "wrong_weekday"]);

export function parseHirePlaces(raw: unknown): HirePlaceOption[] {
  const list = isJson(raw) && Array.isArray(raw.options) ? raw.options : Array.isArray(raw) ? raw : [];
  const out: HirePlaceOption[] = [];
  for (const r of list) {
    if (!isJson(r)) continue;
    const id = asText(r.price_option_id);
    const status = asText(r.status);
    const priceMinor = asMinor(r.price_minor);
    if (id === null || status === null || !PLACE_STATUSES.has(status) || priceMinor === null) continue;
    out.push({
      priceOptionId: id,
      name: asText(r.name) ?? "",
      spaceId: asText(r.space_id),
      combinationId: asText(r.combination_id),
      placeName: asText(r.place_name) ?? asText(r.name) ?? "",
      setting: asText(r.setting),
      capacity: asInt(r.capacity),
      guestMin: Math.max(1, asInt(r.guest_min) ?? 1),
      guestMax: Math.max(1, asInt(r.guest_max) ?? 1),
      unit: r.unit === "guest" ? "guest" : r.unit === "hour" ? "hour" : "booking",
      priceMinor,
      status: status as HirePlaceStatus,
      reason: asText(r.reason),
      blockedBy: asText(r.blocked_by),
    });
  }
  return out;
}

const SETTING: Record<string, string> = { indoor: "Indoor", covered: "Covered", outdoor: "Outdoor" };

export interface PlaceListView {
  /** Places shown (too small ones are filtered, never errored). */
  shown: HirePlaceOption[];
  /** "Green Area North is too small for 120, so it's not shown." */
  hiddenLine: string | null;
}

export function placeListFor(options: readonly HirePlaceOption[], guests: number): PlaceListView {
  const small = options.filter((o) => o.status === "too_small");
  // One row per place: a weekday row that doesn't apply that day is dropped.
  const shown = options.filter((o) => o.status !== "too_small" && o.status !== "wrong_weekday");
  const names = [...new Set(small.map((o) => o.placeName))].filter((n) => !shown.some((s) => s.placeName === n));
  return {
    shown,
    hiddenLine:
      names.length === 0
        ? null
        : `${names.join(", ")} ${names.length === 1 ? "is" : "are"} too small for ${guests}, so ${names.length === 1 ? "it's" : "they're"} not shown.`,
  };
}

/** "Fits 60 – 150 · Covered". */
export function placeFitsLine(o: Pick<HirePlaceOption, "guestMin" | "guestMax" | "setting">): string {
  return [`Fits ${o.guestMin.toLocaleString("en-GB")} – ${o.guestMax.toLocaleString("en-GB")}`, o.setting !== null ? SETTING[o.setting] ?? null : null]
    .filter(Boolean)
    .join(" · ");
}

/** Why a place can't be asked for (null when it can). */
export function placeUnavailableLine(o: HirePlaceOption): string | null {
  switch (o.status) {
    case "available":
      return null;
    case "held":
      return o.blockedBy !== null && o.blockedBy !== o.placeName ? `On hold: ${o.blockedBy} is held that day` : "On hold for another booking that day";
    case "taken":
      return o.reason === "event"
        ? "Taken by an event that day"
        : o.reason === "block"
          ? "Closed for the venue that day"
          : o.blockedBy !== null && o.blockedBy !== o.placeName
            ? `Taken: ${o.blockedBy} is booked that day`
            : "Booked that day";
    case "too_big":
      return `For groups of at least ${o.guestMin.toLocaleString("en-GB")}`;
    case "too_small":
      return "Too small for your group";
    case "wrong_weekday":
      return "Not on this day";
    default: {
      const never: never = o.status;
      return never;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The quote
// ═══════════════════════════════════════════════════════════════════════════

export interface HireQuote extends EntryQuote {
  mode: "request" | "instant";
  placeName: string | null;
  layout: VenueLayout | null;
  layoutCapacity: number | null;
  guests: number;
  placeStatus: string | null;
  hireMinor: number;
  extraGuests: number;
  extraGuestMinor: number;
  overtimeHours: number;
  overtimeMinor: number;
  extrasMinor: number;
  extras: PackageQuoteExtra[];
  damageDepositMinor: number;
  requestResponseHours: number;
  payPlan: PayPlan;
}

export function parseHireQuote(raw: unknown): HireQuote | null {
  const base = parseEntryQuote(raw);
  if (base === null || !isJson(raw) || !isJson(raw.hire)) return null;
  const h = raw.hire;
  const extras: PackageQuoteExtra[] = [];
  for (const extra of Array.isArray(raw.extras) ? raw.extras : []) {
    if (!isJson(extra)) continue;
    const id = asText(extra.id);
    if (id === null) continue;
    extras.push({
      id,
      name: asText(extra.name) ?? "",
      per: extra.per === "guest" ? "guest" : "booking",
      qty: asInt(extra.qty) ?? 1,
      amountMinor: asMinor(extra.amountMinor) ?? 0,
    });
  }
  return {
    ...base,
    mode: raw.mode === "instant" ? "instant" : "request",
    placeName: asText(h.placeName),
    layout: isVenueLayout(h.layout) ? h.layout : null,
    layoutCapacity: asInt(h.layoutCapacity),
    guests: asInt(h.guests) ?? 0,
    placeStatus: asText(h.placeStatus),
    hireMinor: asMinor(h.hireMinor) ?? 0,
    extraGuests: asInt(h.extraGuests) ?? 0,
    extraGuestMinor: asMinor(h.extraGuestMinor) ?? 0,
    overtimeHours: asInt(h.overtimeHours) ?? 0,
    overtimeMinor: asMinor(h.overtimeMinor) ?? 0,
    extrasMinor: asMinor(h.extrasMinor) ?? extras.reduce((sum, extra) => sum + extra.amountMinor, 0),
    extras,
    damageDepositMinor: asMinor(h.damageDepositMinor) ?? 0,
    requestResponseHours: asInt(h.requestResponseHours) ?? 48,
    payPlan: parsePayPlan(h.payPlan),
  };
}

export interface HireSummaryLine {
  key: string;
  label: string;
  value: string;
  strong?: boolean;
}

/** The request summary: hire, extras, VAT, damage deposit, total. */
export function hireSummaryLines(q: HireQuote, exponent: number): HireSummaryLine[] {
  const m = (minor: number): string => formatVenueMoney(minor, q.currencyCode, exponent);
  const lines: HireSummaryLine[] = [
    { key: "hire", label: `${q.placeName ?? "Private hire"} · ${q.guests.toLocaleString("en-GB")} guests`, value: m(q.hireMinor) },
  ];
  if (q.extraGuests > 0) lines.push({ key: "extra", label: `${q.extraGuests} extra guests`, value: m(q.extraGuestMinor) });
  if (q.overtimeHours > 0) lines.push({ key: "over", label: `${q.overtimeHours} extra ${q.overtimeHours === 1 ? "hour" : "hours"}`, value: m(q.overtimeMinor) });
  for (const extra of q.extras) {
    lines.push({ key: `extra-${extra.id}`, label: extra.name, value: m(extra.amountMinor) });
  }
  if (q.vatMode === "added" && q.taxMinor > 0) {
    lines.push({ key: "vat", label: `VAT ${q.vatRatePct}%`, value: m(q.taxMinor) });
  } else if (q.vatMode === "included" && q.vatAmountMinor > 0) {
    lines.push({ key: "vat", label: `Includes VAT ${q.vatRatePct}%`, value: m(q.vatAmountMinor) });
  }
  if (q.damageDepositMinor > 0) lines.push({ key: "damage", label: "Refundable damage deposit", value: m(q.damageDepositMinor) });
  lines.push({ key: "total", label: "Total", value: m(q.totalMinor), strong: true });
  return lines;
}

/** The pay-now amount the server set (the deposit, or everything). */
export function hirePayNowMinor(q: Pick<HireQuote, "payPlan" | "totalMinor">): number {
  return q.payPlan.payModes.includes("deposit") && q.payPlan.depositMinor !== null ? q.payPlan.depositMinor : q.totalMinor;
}

/** "Nothing to pay yet. Gameland replies within 48 hours. If they say yes, ₦3,762,500 holds your date." */
export function requestPromise(q: HireQuote, venueName: string, exponent: number): string {
  const holds = formatVenueMoney(hirePayNowMinor(q), q.currencyCode, exponent);
  return `Nothing to pay yet. ${venueName} replies within ${q.requestResponseHours} hours. If they say yes, ${holds} holds your date.`;
}

export function damageLine(q: Pick<HireQuote, "damageDepositMinor" | "currencyCode">, exponent: number): string | null {
  if (q.damageDepositMinor <= 0) return null;
  return `Includes a ${formatVenueMoney(q.damageDepositMinor, q.currencyCode, exponent)} damage deposit, paid with the balance and refunded if nothing is damaged.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// The request address (nothing personal, no token)
// ═══════════════════════════════════════════════════════════════════════════

export interface HireChoice {
  date: string;
  /** A session window, or the day's "Hours you set" window. */
  windowId: string;
  guests: number;
  priceOptionId: string;
  /** #4490 P4 follow-up: "Hours you set" — the start (ISO) and length the guest picked. */
  startsAt?: string;
  minutes?: number;
}

/** `/b/{brand}/v/{venue}/book/{offerId}?k=hire&d=…&w=…&g=120&o=…`. */
export function hireRequestPath(input: { brandSlug: string; venueSlug: string; offerId: string } & HireChoice): string {
  const params = new URLSearchParams();
  params.set("k", "hire");
  if (DATE.test(input.date)) params.set("d", input.date);
  if (UUID.test(input.windowId)) params.set("w", input.windowId);
  params.set("g", String(Math.max(1, Math.floor(input.guests))));
  if (UUID.test(input.priceOptionId)) params.set("o", input.priceOptionId);
  if (input.startsAt !== undefined && input.minutes !== undefined && !Number.isNaN(Date.parse(input.startsAt))) {
    params.set("s", new Date(input.startsAt).toISOString());
    params.set("m", String(Math.floor(input.minutes)));
  }
  return `/b/${encodeURIComponent(input.brandSlug)}/v/${encodeURIComponent(input.venueSlug)}/book/${encodeURIComponent(input.offerId)}?${params.toString()}`;
}

export function parseHireRequestParams(params: Record<string, string | string[] | null | undefined>): HireChoice | null {
  const first = (v: string | string[] | null | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : typeof v === "string" ? v : null);
  if (first(params.k) !== "hire") return null;
  const date = first(params.d);
  const windowId = first(params.w);
  const option = first(params.o);
  const guests = Number(first(params.g));
  if (
    date === null || !DATE.test(date) || windowId === null || !UUID.test(windowId) ||
    option === null || !UUID.test(option) || !Number.isInteger(guests) || guests < 1 || guests > 100000
  ) {
    return null;
  }
  const startsAt = first(params.s);
  const minutes = Number(first(params.m));
  const flex =
    startsAt !== null && !Number.isNaN(Date.parse(startsAt)) && Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440
      ? { startsAt: new Date(startsAt).toISOString(), minutes }
      : {};
  return { date, windowId: windowId.toLowerCase(), guests, priceOptionId: option.toLowerCase(), ...flex };
}

// ═══════════════════════════════════════════════════════════════════════════
// #4490 P4 follow-up: "Hours you set" (hour_day)
// ═══════════════════════════════════════════════════════════════════════════

export interface HireHourPlace {
  key: string;
  name: string;
  spaceIds: string[];
  priceOptionId: string;
  busy: Array<{ from: string; to: string }>;
}

export interface HireHourDay {
  status: "open" | "closed" | "paused" | "too_far";
  windowId: string | null;
  opensAt: string | null;
  closesAt: string | null;
  stepMinutes: number;
  minMinutes: number;
  maxMinutes: number | null;
  setupMinutes: number;
  cleanupMinutes: number;
  places: HireHourPlace[];
  starts: Array<{ startsAt: string; maxMinutes: number; places: number }>;
}

export function parseHireHourDay(raw: unknown): HireHourDay | null {
  if (!isJson(raw)) return null;
  const status = asText(raw.status);
  if (status !== "open" && status !== "closed" && status !== "paused" && status !== "too_far") return null;
  const places: HireHourPlace[] = [];
  for (const p of Array.isArray(raw.places) ? raw.places : []) {
    if (!isJson(p)) continue;
    const priceOptionId = asText(p.priceOptionId);
    if (priceOptionId === null) continue;
    places.push({
      key: asText(p.key) ?? priceOptionId,
      name: asText(p.name) ?? "",
      spaceIds: ids(p.spaceIds),
      priceOptionId,
      busy: (Array.isArray(p.busy) ? p.busy : [])
        .filter(isJson)
        .map((b) => ({ from: asText(b.from) ?? "", to: asText(b.to) ?? "" }))
        .filter((b) => b.from.length > 0 && b.to.length > 0),
    });
  }
  const starts: HireHourDay["starts"] = [];
  for (const x of Array.isArray(raw.starts) ? raw.starts : []) {
    if (!isJson(x)) continue;
    const startsAt = asText(x.startsAt);
    const max = asInt(x.maxMinutes);
    if (startsAt === null || max === null || Number.isNaN(Date.parse(startsAt))) continue;
    // One spelling for an instant, so a start carried in the address matches.
    starts.push({ startsAt: new Date(startsAt).toISOString(), maxMinutes: max, places: asInt(x.places) ?? 0 });
  }
  return {
    status,
    windowId: asText(raw.windowId),
    opensAt: asText(raw.opensAt),
    closesAt: asText(raw.closesAt),
    stepMinutes: Math.max(15, asInt(raw.stepMinutes) ?? 60),
    minMinutes: Math.max(15, asInt(raw.minMinutes) ?? 60),
    maxMinutes: asInt(raw.maxMinutes),
    setupMinutes: Math.max(0, asInt(raw.setupMinutes) ?? 0),
    cleanupMinutes: Math.max(0, asInt(raw.cleanupMinutes) ?? 0),
    places,
    starts,
  };
}

/** The lengths a guest can pick from a start: shortest, then every step up to the longest free booking from it. */
export function hourLengthsFor(day: Pick<HireHourDay, "minMinutes" | "maxMinutes" | "stepMinutes" | "starts">, startsAt: string | null): number[] {
  if (startsAt === null) return [];
  const start = day.starts.find((s) => s.startsAt === startsAt);
  if (start === undefined) return [];
  const cap = Math.min(start.maxMinutes, day.maxMinutes ?? 1440);
  const out: number[] = [];
  for (let m = day.minMinutes; m <= cap && out.length < 48; m += day.stepMinutes) out.push(m);
  return out;
}

/** A place is free for a start and length when nothing it holds (setup and cleanup included) overlaps. */
export function hourPlaceFree(
  place: Pick<HireHourPlace, "busy">,
  startsAt: string,
  minutes: number,
  setupMinutes: number,
  cleanupMinutes: number,
): boolean {
  const from = Date.parse(startsAt) - setupMinutes * 60_000;
  const to = Date.parse(startsAt) + (minutes + cleanupMinutes) * 60_000;
  return place.busy.every((b) => Date.parse(b.to) <= from || Date.parse(b.from) >= to);
}

/** "10:00–22:00" in the venue's time; null when either end is missing. */
export function venueClockRange(from: string | null, to: string | null, timeZone: string | null): string | null {
  if (from === null || to === null) return null;
  const a = venueClock(from, timeZone);
  const b = venueClock(to, timeZone);
  return a !== null && b !== null ? `${a}–${b === "24:00" ? "00:00" : b}` : null;
}

export function hourLengthWords(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h} ${h === 1 ? "hour" : "hours"}${m > 0 ? ` ${m} min` : ""}`;
}

export const OCCASIONS: readonly string[] = ["Wedding", "Birthday", "Company day", "Brand event", "Party", "Other"];

// ═══════════════════════════════════════════════════════════════════════════
// The booking page: the hire facts and the ten states
// ═══════════════════════════════════════════════════════════════════════════

export interface HireBookingView {
  placeName: string | null;
  layout: VenueLayout | null;
  layoutCapacity: number | null;
  sessionLabel: string | null;
  /** The booked hours (current: a moved hire reads its new day). */
  bookedFrom: string | null;
  bookedTo: string | null;
  guests: number;
  hireMinor: number;
  extraGuests: number;
  extraGuestMinor: number;
  overtimeHours: number;
  overtimeMinor: number;
  extras: PackageQuoteExtra[];
  damageDepositMinor: number;
  occasion: string | null;
  note: string | null;
  siteVisit: boolean;
  replyWithinHours: number | null;
  declineReason: string | null;
  alternatives: string[];
  hostNote: string | null;
  closedReason: string | null;
  requestDeadline: string | null;
  paymentDeadline: string | null;
  depositMinor: number | null;
  totalDueMinor: number;
  balanceDueMinor: number;
  balanceDueAt: string | null;
  paidMinor: number;
  payModes: Array<{ mode: "deposit" | "full"; amountMinor: number }>;
  /** #4490 P4 follow-up: the refundable damage deposit's state; null when none. */
  damageDeposit: HireDamageDeposit | null;
}

export interface HireDamageDeposit {
  status: "due" | "collected" | "held_by_venue" | "released";
  amountMinor: number;
  paidMinor: number;
  releaseAt: string | null;
  heldReason: string | null;
  refundedMinor: number | null;
  keptMinor: number | null;
  keptReason: string | null;
  releasedAt: string | null;
}

const DEPOSIT_STATUSES: ReadonlySet<string> = new Set(["due", "collected", "held_by_venue", "released"]);

export function parseHireDamageDeposit(raw: unknown): HireDamageDeposit | null {
  if (!isJson(raw)) return null;
  const status = asText(raw.status);
  if (status === null || !DEPOSIT_STATUSES.has(status)) return null;
  return {
    status: status as HireDamageDeposit["status"],
    amountMinor: asMinor(raw.amountMinor) ?? 0,
    paidMinor: asMinor(raw.paidMinor) ?? 0,
    releaseAt: asText(raw.releaseAt),
    heldReason: asText(raw.heldReason),
    refundedMinor: asMinor(raw.refundedMinor),
    keptMinor: asMinor(raw.keptMinor),
    keptReason: asText(raw.keptReason),
    releasedAt: asText(raw.releasedAt),
  };
}

/** The guest's line for the damage deposit (held, goes back on…, returned, part kept and why). */
export function damageDepositGuestLine(d: HireDamageDeposit, currencyCode: string, exponent: number, timeZone: string | null): string {
  const money = (m: number): string => formatVenueMoney(m, currencyCode, exponent);
  const day = (iso: string | null): string | null => {
    if (iso === null) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: timeZone ?? undefined }).format(new Date(t));
  };
  switch (d.status) {
    case "due":
      return `${money(d.amountMinor)} refundable damage deposit, paid with the rest.`;
    case "collected": {
      const when = day(d.releaseAt);
      return `${money(d.paidMinor)} damage deposit held.${when !== null ? ` It comes back to you by ${when} if nothing was damaged.` : ""}`;
    }
    case "held_by_venue":
      return `${money(d.paidMinor)} damage deposit held by the venue${d.heldReason !== null ? `: ${d.heldReason}` : ""}. They'll return it once it's sorted.`;
    case "released": {
      const kept = d.keptMinor ?? 0;
      const back = d.refundedMinor ?? 0;
      return kept > 0
        ? `${money(back)} of your damage deposit is on its way back. The venue kept ${money(kept)}${d.keptReason !== null ? `: ${d.keptReason}` : ""}.`
        : `Your ${money(back)} damage deposit is on its way back.`;
    }
  }
}

/** The guest numbers a booked hire can change to (its row; up to the place's capacity when extra guests are sold). */
export function hireChangeRange(
  offer: Pick<HireOfferDetail, "rows" | "extraGuestMinor"> | null,
  priceOptionId: string | null,
): { min: number; max: number } | null {
  if (offer === null || priceOptionId === null) return null;
  const row = offer.rows.find((r) => r.optionId === priceOptionId);
  if (row === undefined) return null;
  const max = offer.extraGuestMinor !== null && row.capacity !== null ? Math.max(row.guestMax, row.capacity) : row.guestMax;
  return { min: row.guestMin, max };
}

/** The hire part of a guest booking read; null for other kinds. */
export function parseHireBooking(raw: unknown): HireBookingView | null {
  if (!isJson(raw) || !isJson(raw.hire)) return null;
  const h = raw.hire;
  const total = asMinor(raw.totalMinor) ?? 0;
  const extras: PackageQuoteExtra[] = [];
  for (const extra of Array.isArray(raw.extras) ? raw.extras : []) {
    if (!isJson(extra)) continue;
    const id = asText(extra.id);
    if (id === null) continue;
    extras.push({
      id,
      name: asText(extra.name) ?? "",
      per: extra.per === "guest" ? "guest" : "booking",
      qty: asInt(extra.qty) ?? 1,
      amountMinor: asMinor(extra.amountMinor) ?? 0,
    });
  }
  return {
    placeName: asText(h.placeName),
    layout: isVenueLayout(h.layout) ? h.layout : null,
    layoutCapacity: asInt(h.layoutCapacity),
    sessionLabel: asText(h.sessionLabel),
    bookedFrom: asText(h.bookedFrom),
    bookedTo: asText(h.bookedTo),
    guests: asInt(h.guests) ?? 0,
    hireMinor: asMinor(h.hireMinor) ?? 0,
    extraGuests: asInt(h.extraGuests) ?? 0,
    extraGuestMinor: asMinor(h.extraGuestMinor) ?? 0,
    overtimeHours: asInt(h.overtimeHours) ?? 0,
    overtimeMinor: asMinor(h.overtimeMinor) ?? 0,
    extras,
    damageDepositMinor: asMinor(h.damageDepositMinor) ?? 0,
    occasion: asText(h.occasion),
    note: asText(h.note),
    siteVisit: h.siteVisit === true,
    replyWithinHours: asInt(h.replyWithinHours),
    declineReason: asText(h.declineReason),
    alternatives: ids(h.alternatives).filter((d) => DATE.test(d)),
    hostNote: asText(h.hostNote),
    closedReason: asText(h.closedReason),
    requestDeadline: asText(raw.requestDeadline),
    paymentDeadline: asText(raw.paymentDeadline),
    depositMinor: asMinor(raw.depositMinor),
    totalDueMinor: asMinor(raw.totalDueMinor) ?? total,
    balanceDueMinor: Math.max(0, asMinor(raw.balanceDueMinor) ?? 0),
    balanceDueAt: asText(raw.balanceDueAt),
    paidMinor: asMinor(raw.paidMinor) ?? 0,
    payModes: (Array.isArray(raw.payModes) ? raw.payModes : [])
      .filter(isJson)
      .map((m) => ({ mode: m.mode === "deposit" ? ("deposit" as const) : ("full" as const), amountMinor: asMinor(m.amountMinor) ?? 0 })),
    damageDeposit: parseHireDamageDeposit(h.damageDeposit),
  };
}

export type HireStateKind =
  | "request_sent"
  | "declined"
  | "expired"
  | "pay_deposit"
  | "hold_ran_out"
  | "finalizing"
  | "confirmed"
  | "partly_cancelled"
  | "cancelled"
  | "checking"
  | "withdrawn";

export interface HireStateCard {
  kind: HireStateKind;
  title: string;
  body: string;
  /** The pay amount (the server's deposit or total), when there is one. */
  payMinor: number | null;
}

/** "Thu 20 Nov, 18:00" in the venue's time. */
export function hireMoment(iso: string | null, timeZone: string | null): string | null {
  if (iso === null) return null;
  const clock = venueClock(iso, timeZone);
  let date: string | null = null;
  try {
    date = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    date = iso.slice(0, 10);
  }
  if (date === null || !DATE.test(date)) return null;
  return clock === null ? entryDateLabel(date) : `${entryDateLabel(date)}, ${clock}`;
}

/** The booking state card for a hire, in plain words. Every amount is the server's. */
export function hireStateCard(input: {
  state: string;
  venueName: string;
  hire: HireBookingView;
  amountDueNowMinor: number;
  holdUntil: string | null;
  localDate: string | null;
  timeZone: string | null;
  currencyCode: string;
  exponent: number;
  now: number;
}): HireStateCard {
  const { hire, venueName } = input;
  const m = (minor: number): string => formatVenueMoney(minor, input.currencyCode, input.exponent);
  const date = input.localDate !== null ? entryDateLabel(input.localDate) : "your date";
  const place = hire.placeName ?? "The space";
  const reply = hire.replyWithinHours ?? 48;
  switch (input.state) {
    case "request_pending":
      return {
        kind: "request_sent",
        title: "Request sent",
        body: `${venueName} replies within ${reply} hours${hire.requestDeadline !== null ? ` (by ${hireMoment(hire.requestDeadline, input.timeZone) ?? "then"})` : ""}. You'll get an email. Nothing to pay yet.`,
        payMinor: null,
      };
    case "declined":
      return {
        kind: "declined",
        title: `${venueName} can't do that date`,
        body: `${hire.declineReason !== null ? `“${hire.declineReason}” ` : ""}Nothing was charged.`,
        payMinor: null,
      };
    case "request_expired": {
      if (hire.closedReason === "withdrawn") {
        return { kind: "withdrawn", title: "You withdrew this request", body: "Nothing was charged and nothing is held.", payMinor: null };
      }
      if (hire.closedReason === "not_paid") {
        return { kind: "hold_ran_out", title: "The hold ran out", body: `The deposit wasn't paid in time, so ${place} was let go. Nothing was charged.`, payMinor: null };
      }
      if (hire.closedReason === "released") {
        return { kind: "hold_ran_out", title: `${venueName} released the hold`, body: `${place} isn't held for you any more. Nothing was charged.`, payMinor: null };
      }
      return {
        kind: "expired",
        title: "This request timed out",
        body: `${venueName} didn't reply within ${reply} hours. Nothing was charged, and they've been told.`,
        payMinor: null,
      };
    }
    case "approved_payment_required": {
      const until = hireMoment(input.holdUntil ?? hire.paymentDeadline, input.timeZone);
      const left = input.holdUntil !== null ? Date.parse(input.holdUntil) - input.now : 1;
      if (left <= 0 || input.amountDueNowMinor <= 0) {
        return { kind: "hold_ran_out", title: "The hold ran out", body: `${place} isn't held for you any more. Nothing was charged.`, payMinor: null };
      }
      const pay = m(input.amountDueNowMinor);
      return {
        kind: "pay_deposit",
        title: `${venueName} said yes`,
        body: `${place} is held for you${until !== null ? ` until ${until}` : ""}. Pay ${pay} to make ${date} yours.`,
        payMinor: input.amountDueNowMinor,
      };
    }
    case "instant_payment_pending": {
      const until = hireMoment(input.holdUntil, input.timeZone);
      return {
        kind: "pay_deposit",
        title: "Pay to book",
        body: `${place} is held for you${until !== null ? ` until ${until}` : ""}. Pay ${m(input.amountDueNowMinor)} to make ${date} yours.`,
        payMinor: input.amountDueNowMinor,
      };
    }
    case "finalizing":
      return { kind: "finalizing", title: "Confirming your payment", body: "This usually takes a few seconds.", payMinor: null };
    case "confirmed":
      return {
        kind: "confirmed",
        title: "It's yours",
        body:
          hire.balanceDueMinor > 0
            ? `${date} is locked in. ${m(hire.balanceDueMinor)} is still to pay${hire.balanceDueAt !== null ? ` by ${hireMoment(hire.balanceDueAt, input.timeZone)?.split(",")[0] ?? "the due date"}` : ""}.`
            : `${date} is locked in and paid. We've emailed your receipt and the terms you agreed to.`,
        payMinor: hire.balanceDueMinor > 0 ? hire.balanceDueMinor : null,
      };
    case "partially_cancelled":
      return { kind: "partly_cancelled", title: "Part of this booking was cancelled", body: "Any refund follows the terms you agreed to.", payMinor: null };
    case "cancelled":
      return { kind: "cancelled", title: "Booking cancelled", body: "Any refund follows the terms you agreed to.", payMinor: null };
    case "reconciliation_required":
      return {
        kind: "checking",
        title: "We're checking your payment",
        body: "Your payment arrived after the hold ended. We're checking it with the venue; if the date can't be kept, the money comes back to you.",
        payMinor: null,
      };
    default:
      return { kind: "finalizing", title: "We're updating this booking", body: "Check again in a moment.", payMinor: null };
  }
}

/** The tracker steps: Request sent → {Venue} says yes → deposit → the rest → your day. */
export function hireTrackerSteps(state: string, venueName: string, hire: Pick<HireBookingView, "balanceDueMinor">): Array<{ key: string; label: string; done: boolean; current: boolean }> {
  const order = ["sent", "yes", "deposit", "rest", "day"];
  const at =
    state === "request_pending"
      ? 1
      : state === "approved_payment_required" || state === "instant_payment_pending" || state === "finalizing"
        ? 2
        : state === "confirmed"
          ? hire.balanceDueMinor > 0
            ? 3
            : 4
          : -1;
  const labels: Record<string, string> = {
    sent: "Request sent",
    yes: `${venueName} says yes`,
    deposit: "You pay the deposit",
    rest: "You pay the rest",
    day: "Your day",
  };
  return order.map((key, i) => ({ key, label: labels[key], done: at > i, current: at === i }));
}

/** Plain words for the hire codes (the rest come from the entry copy). */
export function hireErrorCopy(
  code: string | null | undefined,
  detail: { placeName?: string; capacity?: number; layout?: string } | null = null,
): string {
  switch (code) {
    case "offer_space_taken":
      return "That space was just taken for that session. Pick another space or day.";
    case "offer_overtime_unavailable":
      return "Extra hours aren't available for that session.";
    case "offer_guests_out_of_range":
      return "That number of guests doesn't fit this space. Pick another space or change the number.";
    case "offer_group_too_big":
      return detail !== null && typeof detail.placeName === "string" && typeof detail.capacity === "number" && isVenueLayout(detail.layout)
        ? venueLayoutCapacityError(detail.placeName, detail.capacity, detail.layout)
        : "That group is too large for this layout. Pick another layout or change the number.";
    case "offer_answer_required":
      return "Tell us the occasion before you send the request.";
    case "offer_invalid_transition":
      return "This request already changed. We've refreshed it.";
    case "offer_window_unavailable":
      return "That session isn't available any more. Pick another day or session.";
    default:
      return venueOfferErrorCopy(code);
  }
}
