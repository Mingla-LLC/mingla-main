/**
 * #4490 P3-3 — booking a group package, as pure functions.
 *
 * The Groups pane, the package checkout and the booking page share these:
 * reading the package offer (what's included, the choice guests make, the
 * extras, the deposit and the pay modes, the start times), the day strip from
 * one availability row per start time, the price option that fits the group,
 * the summary with extras, VAT and "pay now / pay later", the pay-mode words
 * ("Half now / All now"), the balance card, and a change's money in words.
 *
 * Same rules as `entryModel.ts`: no React, no network, no clock (callers pass
 * `now`). Money is minor units; the server computes every total.
 */
import { formatVenueMoney } from "../venueMoney";
import {
  entryDateLabel,
  entryDayTiles,
  parseEntryOfferDetail,
  parseEntryQuote,
  venueClock,
  type EntryDayRow,
  type EntryDayTile,
  type EntryOfferDetail,
  type EntryPriceOption,
  type EntryQuote,
  type SummaryLine,
} from "./entryModel";

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

// ═══════════════════════════════════════════════════════════════════════════
// The package offer
// ═══════════════════════════════════════════════════════════════════════════

export interface PackageInclusionView {
  kind: "item" | "menu_item" | "staff" | "perk" | "choice";
  label: string;
  staffRatio: number | null;
  /** A choice guests make (2..10 options). */
  options: string[];
}

export interface PackageExtraView {
  id: string;
  name: string;
  priceMinor: number;
  per: "booking" | "guest";
}

export interface PackageDeposit {
  kind: "none" | "percent" | "fixed";
  value: number | null;
  balanceDueDaysBefore: number | null;
}

export interface PackageOfferDetail extends EntryOfferDetail {
  kind: "group_package";
  inclusions: PackageInclusionView[];
  extras: PackageExtraView[];
  deposit: PackageDeposit;
  payModes: Array<"deposit" | "full">;
  startTimes: string[];
  durationMinutes: number | null;
  minNoticeMinutes: number | null;
  /** False while the venue can't take payments online (sold at the venue only). */
  canCollectOnline: boolean;
  /** Guests can change numbers and extras until this many minutes before. */
  guestChangeUntilMinutes: number | null;
  moveUntilMinutes: number | null;
}

export function parsePackageOfferDetail(raw: unknown): PackageOfferDetail | null {
  const base = parseEntryOfferDetail(raw);
  if (base === null || !isJson(raw) || raw.kind !== "group_package") return null;
  const inclusions: PackageInclusionView[] = [];
  for (const row of Array.isArray(raw.inclusions) ? raw.inclusions : []) {
    if (!isJson(row)) continue;
    const label = asText(row.label);
    if (label === null) continue;
    const kind = row.kind;
    inclusions.push({
      kind: kind === "menu_item" || kind === "staff" || kind === "perk" || kind === "choice" ? kind : "item",
      label,
      staffRatio: asInt(row.staffRatio),
      options: Array.isArray(row.options) ? row.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0) : [],
    });
  }
  const extras: PackageExtraView[] = [];
  for (const row of Array.isArray(raw.extras) ? raw.extras : []) {
    if (!isJson(row)) continue;
    const id = asText(row.id);
    const name = asText(row.name);
    const priceMinor = asMinor(row.priceMinor);
    if (id === null || name === null || priceMinor === null) continue;
    extras.push({ id, name, priceMinor, per: row.per === "guest" ? "guest" : "booking" });
  }
  const dep = isJson(raw.deposit) ? raw.deposit : {};
  const depKind = dep.kind === "percent" || dep.kind === "fixed" ? dep.kind : "none";
  const policy = isJson(raw.policy) ? raw.policy : {};
  const rule = isJson(policy.dateChangeRule) ? policy.dateChangeRule : {};
  const modes = Array.isArray(raw.payModes)
    ? raw.payModes.filter((m): m is "deposit" | "full" => m === "deposit" || m === "full")
    : [];
  return {
    ...base,
    kind: "group_package",
    inclusions,
    extras,
    deposit: { kind: depKind, value: asMinor(dep.value), balanceDueDaysBefore: asInt(dep.balanceDueDaysBefore) },
    payModes: modes.length > 0 ? modes : ["full"],
    startTimes: Array.isArray(raw.startTimes) ? raw.startTimes.filter((t): t is string => typeof t === "string") : [],
    durationMinutes: asInt(raw.durationMinutes),
    minNoticeMinutes: asInt(raw.minNoticeMinutes),
    canCollectOnline: raw.canCollectOnline !== false,
    guestChangeUntilMinutes: asInt(rule.guestChangeUntilMinutesBefore ?? rule.guest_change_until_minutes_before),
    moveUntilMinutes: asInt(rule.allowedUntilMinutesBefore ?? rule.allowed_until_minutes_before),
  };
}

/** The whole group's range across the package's price options. */
export function groupRange(options: readonly EntryPriceOption[]): { min: number; max: number } {
  if (options.length === 0) return { min: 1, max: 1 };
  return { min: Math.min(...options.map((o) => o.guestMin)), max: Math.max(...options.map((o) => o.guestMax)) };
}

/** The price option that fits a group of `guests` (price by group size), or null. */
export function optionForGuests(options: readonly EntryPriceOption[], guests: number): EntryPriceOption | null {
  const sorted = [...options].sort((a, b) => a.guestMin - b.guestMin);
  return sorted.find((o) => guests >= o.guestMin && guests <= o.guestMax) ?? null;
}

/** "₦10,000 a guest" / "₦150,000 for the group" / "from ₦9,000 a guest". */
export function packagePriceWords(offer: Pick<PackageOfferDetail, "options" | "currencyCode" | "exponent">, unitOf: (o: EntryPriceOption) => "guest" | "booking" = () => "guest"): string {
  const money = (m: number): string => formatVenueMoney(m, offer.currencyCode, offer.exponent);
  if (offer.options.length === 0) return "";
  const lowest = Math.min(...offer.options.map((o) => o.priceMinor));
  if (offer.options.length === 1 && unitOf(offer.options[0]) === "booking") return `${money(lowest)} for the group`;
  return `${offer.options.length > 1 ? "from " : ""}${money(lowest)} a guest`;
}

export function durationText(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/** "3 days" / "48 hours" / "2 hours" for a lead time in minutes. */
export function leadText(minutes: number): string {
  if (minutes === 1440) return "24 hours";
  if (minutes >= 1440 && minutes % 1440 === 0) return minutes === 1440 ? "1 day" : `${minutes / 1440} days`;
  if (minutes >= 60 && minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Days and start times
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_RANK: Record<string, number> = {
  available: 0,
  gate_only: 1,
  sold_out: 2,
  too_soon: 3,
  too_far: 4,
  wrong_weekday: 5,
  closed: 6,
};

/** One row per day for the strip: the best start time that day stands for it. */
export function bestRowPerDay(rows: readonly EntryDayRow[]): EntryDayRow[] {
  const byDate = new Map<string, EntryDayRow>();
  for (const row of rows) {
    const cur = byDate.get(row.localDate);
    if (
      cur === undefined ||
      (STATUS_RANK[row.status] ?? 9) < (STATUS_RANK[cur.status] ?? 9) ||
      ((STATUS_RANK[row.status] ?? 9) === (STATUS_RANK[cur.status] ?? 9) && row.remaining > cur.remaining)
    ) {
      byDate.set(row.localDate, row);
    }
  }
  return [...byDate.values()].sort((a, b) => a.localDate.localeCompare(b.localDate));
}

export function packageDayTiles(rows: readonly EntryDayRow[], from: string, count: number): EntryDayTile[] {
  return entryDayTiles(bestRowPerDay(rows), from, count);
}

/** The first day after `after` that groups can book online, or null. */
export function nextOpenPackageDate(tiles: readonly EntryDayTile[], after: string): string | null {
  return tiles.find((t) => t.date > after && t.soldOnline)?.date ?? null;
}

export interface StartChip {
  windowId: string;
  time: string;
  /** Bookable for this group right now. */
  usable: boolean;
  /** "Taken", "Full", "Too late" — the reason a chip is off. */
  note: string | null;
  remaining: number;
}

/** The start times on a day, each with why it can't be picked (never hidden). */
export function startChipsFor(rows: readonly EntryDayRow[], date: string | null, guests: number, timeZone: string | null): StartChip[] {
  if (date === null) return [];
  return rows
    .filter((r) => r.localDate === date)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((r) => {
      const time = venueClock(r.startsAt, timeZone) ?? r.startsAt.slice(11, 16);
      if (r.status !== "available") {
        return {
          windowId: r.windowId,
          time,
          usable: false,
          note: r.status === "too_soon" ? "Too late" : r.status === "sold_out" || r.status === "gate_only" ? "Taken" : "Closed",
          remaining: r.remaining,
        };
      }
      if (r.remaining < guests) return { windowId: r.windowId, time, usable: false, note: `${r.remaining} left`, remaining: r.remaining };
      return { windowId: r.windowId, time, usable: true, note: null, remaining: r.remaining };
    });
}

/** Why a day can't be booked by a group, in plain words; null for an open day. */
export function packageDayNotice(tile: EntryDayTile, minNoticeMinutes: number | null): string | null {
  const day = entryDateLabel(tile.date);
  switch (tile.state) {
    case "too_soon":
      return minNoticeMinutes !== null && minNoticeMinutes > 0
        ? `Groups book ${leadText(minNoticeMinutes)} ahead, so ${day} can't be booked online.`
        : `It's too late to book ${day} online.`;
    case "full":
    case "gate_only":
      return `${day} is fully booked for groups.`;
    case "closed":
      return tile.row?.reason === "bookings_paused" ? "Online booking is paused for now." : `Closed on ${day}.`;
    case "not_yet":
      return `${day} isn't open for booking yet.`;
    default:
      return null;
  }
}

/** "3 hours: 16:00 to 19:00". */
export function durationLine(row: Pick<EntryDayRow, "startsAt" | "endsAt">, minutes: number | null, timeZone: string | null): string | null {
  const start = venueClock(row.startsAt, timeZone);
  const end = venueClock(row.endsAt, timeZone);
  const d = durationText(minutes);
  if (start === null || end === null) return d;
  return d === null ? `${start} to ${end}` : `${d}: ${start} to ${end}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// The quote: extras, the pay plan
// ═══════════════════════════════════════════════════════════════════════════

export interface PackageQuoteExtra {
  id: string;
  name: string;
  per: "booking" | "guest";
  qty: number;
  amountMinor: number;
}

export interface PayPlan {
  payModes: Array<"deposit" | "full">;
  depositMinor: number | null;
  balanceDueAt: string | null;
  depositKind: "none" | "percent" | "fixed";
  depositValue: number | null;
  /** The deposit was folded into one payment (covers the total, or the due date passed). */
  collapsed: "deposit_covers_total" | "balance_due_passed" | null;
}

export interface PackageQuote extends EntryQuote {
  packageMinor: number;
  extrasMinor: number;
  extras: PackageQuoteExtra[];
  payPlan: PayPlan;
}

export function parsePayPlan(raw: unknown): PayPlan {
  const p = isJson(raw) ? raw : {};
  const modes = Array.isArray(p.payModes)
    ? p.payModes.filter((m): m is "deposit" | "full" => m === "deposit" || m === "full")
    : [];
  return {
    payModes: modes.length > 0 ? modes : ["full"],
    depositMinor: asMinor(p.depositMinor),
    balanceDueAt: asText(p.balanceDueAt),
    depositKind: p.depositKind === "percent" || p.depositKind === "fixed" ? p.depositKind : "none",
    depositValue: asMinor(p.depositValue),
    collapsed: p.collapsed === "deposit_covers_total" || p.collapsed === "balance_due_passed" ? p.collapsed : null,
  };
}

export function parsePackageQuote(raw: unknown): PackageQuote | null {
  const base = parseEntryQuote(raw);
  if (base === null || !isJson(raw)) return null;
  const lines = Array.isArray(raw.lines) ? raw.lines.filter(isJson) : [];
  const extras: PackageQuoteExtra[] = [];
  for (const e of Array.isArray(raw.extras) ? raw.extras : []) {
    if (!isJson(e)) continue;
    const id = asText(e.id);
    if (id === null) continue;
    extras.push({
      id,
      name: asText(e.name) ?? "",
      per: e.per === "guest" ? "guest" : "booking",
      qty: asInt(e.qty) ?? 1,
      amountMinor: asMinor(e.amountMinor) ?? 0,
    });
  }
  return {
    ...base,
    packageMinor: lines.reduce((s, l) => s + (asMinor(l.packageMinor) ?? asMinor(l.baseMinor) ?? 0), 0),
    extrasMinor: lines.reduce((s, l) => s + (asMinor(l.extrasMinor) ?? 0), 0),
    extras,
    payPlan: parsePayPlan(raw.payPlan),
  };
}

/** The deposit choice in words: "Half now", "30% now", "₦50,000 now". */
export function depositWords(plan: Pick<PayPlan, "depositKind" | "depositValue" | "depositMinor">, currencyCode: string, exponent: number): string {
  if (plan.depositKind === "percent" && plan.depositValue !== null) {
    return plan.depositValue === 5000 ? "Half now" : `${plan.depositValue / 100}% now`;
  }
  if (plan.depositMinor !== null) return `${formatVenueMoney(plan.depositMinor, currencyCode, exponent)} now`;
  return "Deposit now";
}

/**
 * The summary for a package: the package line, each extra, VAT, the total,
 * and (with a deposit) what is paid now and what is left for later.
 */
export function packageSummaryLines(
  quote: Pick<PackageQuote, "lines" | "packageMinor" | "extras" | "taxMinor" | "feeMinor" | "totalMinor" | "vatMode" | "vatRatePct" | "currencyCode">,
  input: { exponent: number; offerName: string; guests: number; unit: "guest" | "booking"; payNowMinor: number | null; laterMinor: number | null; laterBy: string | null },
): SummaryLine[] {
  const money = (m: number): string => formatVenueMoney(m, quote.currencyCode, input.exponent);
  const out: SummaryLine[] = [
    {
      label: input.unit === "booking" ? `${input.offerName} for ${input.guests}` : `${input.guests} × ${input.offerName}`,
      value: money(quote.packageMinor),
    },
    ...quote.extras.map((e) => ({ label: e.qty > 1 ? `${e.qty} × ${e.name}` : e.name, value: money(e.amountMinor) })),
  ];
  if (quote.feeMinor > 0) out.push({ label: "Booking fee", value: money(quote.feeMinor) });
  const rate = Number.isInteger(quote.vatRatePct) ? `${quote.vatRatePct}%` : `${quote.vatRatePct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
  if (quote.vatMode === "added" && quote.taxMinor > 0) out.push({ label: `VAT ${rate}`, value: money(quote.taxMinor) });
  out.push({ label: "Total", value: money(quote.totalMinor), total: input.payNowMinor === null });
  if (quote.vatMode === "included" && quote.taxMinor > 0) out.push({ label: `Includes VAT ${rate}`, value: money(quote.taxMinor), muted: true });
  if (input.payNowMinor !== null) {
    out.push({ label: "Pay now", value: money(input.payNowMinor), total: true });
    if (input.laterMinor !== null && input.laterMinor > 0) {
      out.push({ label: input.laterBy !== null ? `Pay by ${input.laterBy}` : "Pay later", value: money(input.laterMinor), muted: true });
    }
  }
  return out;
}

/** "Thu 26 Nov" for an instant, in the venue's calendar. */
export function venueDayOf(iso: string | null, timeZone: string | null): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? entryDateLabel(parts) : null;
  } catch {
    return entryDateLabel(d.toISOString().slice(0, 10));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The booking: the balance and changes
// ═══════════════════════════════════════════════════════════════════════════

export interface BookingChangeRules {
  moveUntil: string | null;
  guestChangeUntil: string | null;
  maxChanges: number | null;
  changesUsed: number;
  canMove: boolean;
  canChangeGuests: boolean;
  canAddExtras: boolean;
}

export interface PackageBookingView {
  offerKind: string | null;
  /** The package's own price (without extras or VAT), summed over its lines. */
  packageMinor: number;
  guests: number;
  windowId: string | null;
  totalDueMinor: number;
  balanceDueMinor: number;
  balanceDueAt: string | null;
  depositMinor: number | null;
  paidOnlineMinor: number;
  paidAtVenueMinor: number;
  payModes: Array<{ mode: "deposit" | "full"; amountMinor: number }>;
  extras: PackageQuoteExtra[];
  answers: Array<{ question: string; answer: string }>;
  inclusions: Array<{ kind: string; label: string }>;
  changeRules: BookingChangeRules | null;
}

/** The P3 fields of a booking read (all optional on the wire; P2 bookings read as paid in full). */
export function parsePackageBooking(raw: unknown): PackageBookingView {
  const b = isJson(raw) ? raw : {};
  const rules = isJson(b.changeRules) ? b.changeRules : null;
  const win = isJson(b.window) ? b.window : {};
  const total = asMinor(b.totalMinor) ?? 0;
  const lines = Array.isArray(b.lines) ? b.lines.filter(isJson) : [];
  return {
    offerKind: asText(b.offerKind) ?? (isJson(b.offer) ? asText(b.offer.kind) : null),
    // The package price as it stands now (a guest change moves it): guests × the
    // per-guest price, or the group price; the booked figure when neither is known.
    packageMinor: lines.reduce((n, l) => {
      const unitPrice = asMinor(l.unitPriceMinor);
      const g = asInt(l.guests) ?? 0;
      if (unitPrice !== null) return n + (l.unit === "booking" ? unitPrice : unitPrice * g);
      return n + (asMinor(l.packageMinor) ?? asMinor(l.baseMinor) ?? 0);
    }, 0),
    guests: lines.reduce((n, l) => n + (asInt(l.guests) ?? 0), 0),
    windowId: asText(win.windowId),
    totalDueMinor: asMinor(b.totalDueMinor) ?? total,
    balanceDueMinor: Math.max(0, asMinor(b.balanceDueMinor) ?? 0),
    balanceDueAt: asText(b.balanceDueAt),
    depositMinor: asMinor(b.depositMinor),
    paidOnlineMinor: asMinor(b.paidOnlineMinor) ?? asMinor(b.paidMinor) ?? 0,
    paidAtVenueMinor: asMinor(b.paidAtVenueMinor) ?? 0,
    payModes: (Array.isArray(b.payModes) ? b.payModes : [])
      .filter(isJson)
      .map((m) => ({ mode: m.mode === "deposit" ? ("deposit" as const) : ("full" as const), amountMinor: asMinor(m.amountMinor) ?? 0 })),
    extras: (Array.isArray(b.extras) ? b.extras : []).filter(isJson).map((e) => ({
      id: asText(e.id) ?? "",
      name: asText(e.name) ?? "",
      per: e.per === "guest" ? ("guest" as const) : ("booking" as const),
      qty: asInt(e.qty) ?? 1,
      amountMinor: asMinor(e.amountMinor) ?? 0,
    })),
    answers: Object.entries(isJson(b.answers) ? b.answers : {})
      .filter((e): e is [string, string] => typeof e[1] === "string")
      .map(([question, answer]) => ({ question, answer })),
    inclusions: (Array.isArray(b.inclusions) ? b.inclusions : [])
      .filter(isJson)
      .map((i) => ({ kind: asText(i.kind) ?? "item", label: asText(i.label) ?? "" }))
      .filter((i) => i.label.length > 0 && i.kind !== "choice"),
    changeRules:
      rules === null
        ? null
        : {
            moveUntil: asText(rules.moveUntil),
            guestChangeUntil: asText(rules.guestChangeUntil),
            maxChanges: asInt(rules.maxChanges),
            changesUsed: asInt(rules.changesUsed) ?? 0,
            canMove: rules.canMove === true,
            canChangeGuests: rules.canChangeGuests === true,
            canAddExtras: rules.canAddExtras === true,
          },
  };
}

/** The balance card: "Balance ₦75,250 due Thu 26 Nov" (or overdue). */
export function balanceCardWords(
  view: Pick<PackageBookingView, "balanceDueMinor" | "balanceDueAt">,
  input: { currencyCode: string; exponent: number; timeZone: string | null; now: number },
): { title: string; body: string; overdue: boolean } | null {
  if (view.balanceDueMinor <= 0) return null;
  const amount = formatVenueMoney(view.balanceDueMinor, input.currencyCode, input.exponent);
  const day = venueDayOf(view.balanceDueAt, input.timeZone);
  const due = view.balanceDueAt === null ? NaN : Date.parse(view.balanceDueAt);
  const overdue = !Number.isNaN(due) && due < input.now;
  if (day === null) return { title: `Balance ${amount}`, body: "Pay the rest any time before your visit.", overdue: false };
  return overdue
    ? { title: `Balance ${amount} was due ${day}`, body: "Pay the rest now to keep your booking in good standing.", overdue: true }
    : { title: `Balance ${amount} due ${day}`, body: "Pay it here any time before then. We'll remind you by email.", overdue: false };
}

export interface GuestChangeSummary {
  amountMinor: number;
  taxDeltaMinor: number;
  feeMinor: number;
  refundMinor: number;
  totalDueAfterMinor: number;
  balanceAfterMinor: number;
  currencyCode: string;
  groupVersion: number | null;
  toGuests: number | null;
  toDate: string | null;
}

export function parseGuestChangeSummary(raw: unknown): GuestChangeSummary | null {
  if (!isJson(raw)) return null;
  const currencyCode = asText(raw.currencyCode);
  if (currencyCode === null) return null;
  return {
    amountMinor: asMinor(raw.amountMinor) ?? 0,
    taxDeltaMinor: asMinor(raw.taxDeltaMinor) ?? 0,
    feeMinor: asMinor(raw.feeMinor) ?? 0,
    refundMinor: asMinor(raw.refundMinor) ?? 0,
    totalDueAfterMinor: asMinor(raw.totalDueAfterMinor) ?? 0,
    balanceAfterMinor: asMinor(raw.balanceAfterMinor) ?? 0,
    currencyCode,
    groupVersion: asInt(raw.groupVersion),
    toGuests: asInt(raw.toGuests),
    toDate: asText(raw.toDate),
  };
}

/** What a change costs (or gives back), shown before the guest confirms. */
export function guestChangeWords(s: GuestChangeSummary, exponent: number): { title: string; body: string } {
  const money = (m: number): string => formatVenueMoney(m, s.currencyCode, exponent);
  let title = "Same price";
  if (s.amountMinor > 0) {
    title =
      s.taxDeltaMinor > 0
        ? `${money(s.amountMinor)} more (${money(s.amountMinor - s.taxDeltaMinor)} + VAT ${money(s.taxDeltaMinor)})`
        : `${money(s.amountMinor)} more`;
  } else if (s.refundMinor > 0) {
    title = `${money(s.refundMinor)} back to you`;
  }
  const parts: string[] = [];
  if (s.feeMinor > 0) parts.push(`Includes a ${money(s.feeMinor)} change fee.`);
  if (s.refundMinor > 0) parts.push("It goes back to the card or account you paid with. Banks usually take a few working days.");
  parts.push(
    s.balanceAfterMinor > 0
      ? `New total ${money(s.totalDueAfterMinor)}. Left to pay after this: ${money(s.balanceAfterMinor)}.`
      : `New total ${money(s.totalDueAfterMinor)}. Nothing left to pay.`,
  );
  return { title, body: parts.join(" ") };
}

/** "Number of guests can be changed until Thu 26 Nov, 16:00". */
export function untilWords(iso: string | null, timeZone: string | null): string | null {
  if (iso === null) return null;
  const day = venueDayOf(iso, timeZone);
  const clock = venueClock(iso, timeZone);
  if (day === null) return null;
  return clock === null ? day : `${day}, ${clock}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// The checkout address for a package choice
// ═══════════════════════════════════════════════════════════════════════════

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXTRA_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface PackageChoice {
  date: string;
  windowId: string;
  guests: number;
  extras: string[];
  /** Choice index → option index, both in the offer's own order. */
  answers: Record<number, number>;
  payMode: "deposit" | "full";
}

/** `/b/{brand}/v/{venue}/book/{offerId}?k=group&d=…&w=…&g=12&x=a,b&a=0.1&pay=deposit` (nothing personal, no token). */
export function packageCheckoutPath(input: { brandSlug: string; venueSlug: string; offerId: string } & PackageChoice): string {
  const params = new URLSearchParams();
  params.set("k", "group");
  if (DATE.test(input.date)) params.set("d", input.date);
  if (UUID.test(input.windowId)) params.set("w", input.windowId);
  params.set("g", String(Math.max(1, Math.floor(input.guests))));
  const extras = input.extras.filter((x) => EXTRA_ID.test(x));
  if (extras.length > 0) params.set("x", extras.join(","));
  const answers = Object.entries(input.answers).map(([q, o]) => `${q}.${o}`);
  if (answers.length > 0) params.set("a", answers.join(","));
  params.set("pay", input.payMode);
  return `/b/${encodeURIComponent(input.brandSlug)}/v/${encodeURIComponent(input.venueSlug)}/book/${encodeURIComponent(input.offerId)}?${params.toString()}`;
}

export function parsePackageCheckoutParams(params: Record<string, string | string[] | null | undefined>): PackageChoice | null {
  const first = (v: string | string[] | null | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : typeof v === "string" ? v : null);
  if (first(params.k) !== "group") return null;
  const date = first(params.d);
  const windowId = first(params.w);
  const guests = Number(first(params.g));
  if (date === null || !DATE.test(date) || windowId === null || !UUID.test(windowId) || !Number.isInteger(guests) || guests < 1 || guests > 100000) {
    return null;
  }
  const extras = (first(params.x) ?? "").split(",").filter((x) => EXTRA_ID.test(x)).slice(0, 20);
  const answers: Record<number, number> = {};
  for (const part of (first(params.a) ?? "").split(",").slice(0, 10)) {
    const m = /^(\d{1,2})\.(\d{1,2})$/.exec(part);
    if (m !== null) answers[Number(m[1])] = Number(m[2]);
  }
  return { date, windowId: windowId.toLowerCase(), guests, extras, answers, payMode: first(params.pay) === "deposit" ? "deposit" : "full" };
}

/** Answers keyed by the question's words, the way the server takes them. */
export function answersPayload(offer: Pick<PackageOfferDetail, "inclusions">, answers: Readonly<Record<number, number>>): Record<string, string> {
  const choices = offer.inclusions.filter((i) => i.kind === "choice");
  const out: Record<string, string> = {};
  choices.forEach((c, i) => {
    const pick = answers[i];
    if (pick !== undefined && c.options[pick] !== undefined) out[c.label] = c.options[pick];
  });
  return out;
}

/** The first question still unanswered, or null. */
export function missingAnswer(offer: Pick<PackageOfferDetail, "inclusions">, answers: Readonly<Record<number, number>>): string | null {
  const choices = offer.inclusions.filter((i) => i.kind === "choice");
  const idx = choices.findIndex((_, i) => answers[i] === undefined);
  return idx < 0 ? null : choices[idx].label;
}

/** Plain words for the P3 guest error codes (the rest live in entryModel). */
export const PACKAGE_ERROR_COPY: Readonly<Record<string, string>> = {
  offer_answer_required: "Choose an option for each question before you pay.",
  offer_extra_unavailable: "One of those extras isn't offered any more. Check your extras.",
  offer_pay_mode_unavailable: "This booking has to be paid in full now.",
  offer_nothing_to_pay: "There's nothing left to pay on this booking.",
  offer_payment_already_paid: "That payment went through already. We've refreshed your booking.",
  offer_change_not_allowed: "This booking can't be changed that way.",
  offer_change_too_late: "It's too late to change this booking online. Contact the venue.",
  offer_change_nothing: "That's the same as your booking now.",
  offer_guests_out_of_range: "That number of guests is outside this package's group size.",
};
