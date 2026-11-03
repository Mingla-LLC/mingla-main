/**
 * issue #3281 — Extras, buyer side: one owner for reading a ticket's extras off
 * the event payload and for the limits a cart may ask for.
 *
 * The server is the authority (issue_3281_price_extras). These helpers mirror
 * it so the picker never offers a count the quote would refuse:
 *   cap = min(maxPerTicket × tickets on the line, places left)
 * where a date-limited extra counts its places on each date the line covers.
 * Prices are never computed here; the quote prices every extra.
 *
 * No array spread or array destructuring here: Explorer's class D payment
 * suites load this file with no Babel runtime helpers installed.
 */

import type { CheckoutAddOnRequest } from "./ticketCheckoutContract";

export interface PublicTicketExtra {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  /** Server all-in per unit (fees passed on). */
  priceAllInCents: number;
  maxPerTicket: number;
  isUnlimited: boolean;
  /** event_dates ids it is sold on; null means every date its ticket admits. */
  validOccurrenceIds: string[] | null;
  /** null when unlimited; a number shared by every date; or a count per date. */
  remaining: number | Record<string, number> | null;
}

/** The cart line an extra hangs off, as the server reads it. */
export interface ExtrasParentLine {
  quantity: number;
  byDate?: Readonly<Record<string, number>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const wholeAtLeast = (value: unknown, min: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min
    ? value
    : null;

/** Reads `ticket.extras` from either public reader; anything malformed is dropped. */
export function parsePublicTicketExtras(value: unknown): PublicTicketExtra[] {
  if (!Array.isArray(value)) return [];
  const out: PublicTicketExtra[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") {
      continue;
    }
    const priceCents = wholeAtLeast(raw.priceCents, 0);
    const maxPerTicket = wholeAtLeast(raw.maxPerTicket, 1);
    if (priceCents === null || maxPerTicket === null) continue;
    const allIn = wholeAtLeast(raw.priceAllInCents, 0);
    let remaining: PublicTicketExtra["remaining"] = null;
    if (raw.isUnlimited !== true) {
      if (typeof raw.remaining === "number") {
        remaining = Math.max(0, Math.floor(raw.remaining));
      } else if (isRecord(raw.remaining)) {
        const byDate: Record<string, number> = {};
        const counts = raw.remaining;
        for (const id of Object.keys(counts)) {
          const n = counts[id];
          if (typeof n === "number") byDate[id] = Math.max(0, Math.floor(n));
        }
        remaining = byDate;
      } else {
        // A limited extra whose count we can't read is not offered.
        remaining = 0;
      }
    }
    out.push({
      id: raw.id,
      name: raw.name,
      description:
        typeof raw.description === "string" && raw.description.trim().length > 0
          ? raw.description
          : null,
      priceCents,
      priceAllInCents: allIn ?? priceCents,
      maxPerTicket,
      isUnlimited: raw.isUnlimited === true,
      validOccurrenceIds: Array.isArray(raw.validOccurrenceIds)
        ? raw.validOccurrenceIds.filter((id): id is string => typeof id === "string")
        : null,
      remaining,
    });
  }
  return out;
}

/** Tickets on the line, the way the server counts them. */
export function extrasParentCount(line: ExtrasParentLine | undefined): number {
  if (line === undefined) return 0;
  if (line.byDate !== undefined) {
    let sum = 0;
    for (const n of Object.values(line.byDate)) {
      if (Number.isInteger(n) && n > 0) sum += n;
    }
    return sum;
  }
  return Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0;
}

/**
 * The dates the cart is for. An all-days pass reaches checkout with no dates
 * chosen and the server binds every date that hasn't ended, so extras read
 * those; any other cart reads the guest's chosen dates.
 */
export function extrasCartDates(
  chosenDateIds: readonly string[],
  occurrences: ReadonlyArray<{ id: string; endAt: string }>,
  allDaysPass: boolean,
  now: number = Date.now(),
): string[] {
  if (!allDaysPass) return chosenDateIds.slice();
  return occurrences
    .filter((occurrence) => Date.parse(occurrence.endAt) > now)
    .map((occurrence) => occurrence.id);
}

/**
 * The dates a line's tickets are for: the per-date map's dates, else the chosen
 * dates the ticket admits. Empty on a single-date event.
 */
export function extrasLineDates(
  line: ExtrasParentLine | undefined,
  ticketValidOccurrenceIds: readonly string[] | null | undefined,
  chosenDateIds: readonly string[],
): string[] {
  if (line?.byDate !== undefined) {
    const byDate = line.byDate;
    return Object.keys(byDate).filter(
      (id) => Number.isInteger(byDate[id]) && byDate[id] > 0,
    );
  }
  if (ticketValidOccurrenceIds == null) return chosenDateIds.slice();
  return chosenDateIds.filter((id) => ticketValidOccurrenceIds.includes(id));
}

/** The dates of `lineDates` this extra is sold on; null means it isn't date-limited. */
export function extraDatesOnLine(
  extra: PublicTicketExtra,
  lineDates: readonly string[],
): string[] | null {
  if (extra.validOccurrenceIds === null) return null;
  return lineDates.filter((id) => extra.validOccurrenceIds!.includes(id));
}

/** The most of this extra the line may carry; 0 means it isn't offered. */
export function extraCap(
  extra: PublicTicketExtra,
  parentCount: number,
  lineDates: readonly string[],
): number {
  if (parentCount <= 0) return 0;
  let cap = extra.maxPerTicket * parentCount;
  const dates = extraDatesOnLine(extra, lineDates);
  if (dates !== null && dates.length === 0) return 0;
  if (typeof extra.remaining === "number") {
    cap = Math.min(cap, extra.remaining);
  } else if (extra.remaining !== null) {
    for (const id of dates ?? []) {
      cap = Math.min(cap, extra.remaining[id] ?? 0);
    }
  }
  return Math.max(0, cap);
}

/** True when the extra is on the line's dates but has no places left there. */
export function extraSoldOutOnLine(
  extra: PublicTicketExtra,
  lineDates: readonly string[],
): boolean {
  const dates = extraDatesOnLine(extra, lineDates);
  if (dates !== null && dates.length === 0) return false;
  if (typeof extra.remaining === "number") return extra.remaining === 0;
  if (extra.remaining === null) return false;
  return (dates ?? []).some((id) => (extra.remaining as Record<string, number>)[id] === 0);
}

/**
 * Sets one extra's count and keeps the list in the server's order. A zero count
 * drops the entry; an empty list returns undefined so the line's wire body is
 * unchanged.
 */
export function withExtraQuantity(
  current: readonly CheckoutAddOnRequest[] | undefined,
  addOnId: string,
  quantity: number,
): CheckoutAddOnRequest[] | undefined {
  const next = (current ?? []).filter((entry) => entry.addOnId !== addOnId);
  const q = Math.floor(quantity);
  if (q > 0) next.push({ addOnId, quantity: q });
  next.sort((a, b) => a.addOnId.localeCompare(b.addOnId));
  return next.length > 0 ? next : undefined;
}

/**
 * Trims a line's extras to what it can still carry: an extra no longer on the
 * event, or above its cap after the tickets changed, comes down. Returns the
 * same array when nothing changed.
 */
export function fitExtrasToLine(
  current: readonly CheckoutAddOnRequest[] | undefined,
  extras: readonly PublicTicketExtra[],
  parentCount: number,
  lineDates: readonly string[],
): readonly CheckoutAddOnRequest[] | undefined {
  if (current === undefined || current.length === 0) return current;
  let changed = false;
  const next: CheckoutAddOnRequest[] = [];
  for (const entry of current) {
    const extra = extras.find((candidate) => candidate.id === entry.addOnId);
    const cap = extra === undefined ? 0 : extraCap(extra, parentCount, lineDates);
    const quantity = Math.min(entry.quantity, cap);
    if (quantity !== entry.quantity) changed = true;
    if (quantity > 0) next.push({ addOnId: entry.addOnId, quantity });
  }
  if (!changed) return current;
  return next.length > 0 ? next : undefined;
}

const EXTRAS_REFUSAL_COPY: Record<string, string> = {
  extras_invalid: "We couldn't read your extras. Change them and try again.",
  extra_not_available: "One of your extras is no longer on sale. Remove it to continue.",
  extra_quantity_above_max: "You've picked more of an extra than your tickets allow.",
  extra_not_on_chosen_days: "One of your extras isn't on the dates you picked.",
  extra_capacity_exceeded: "One of your extras just sold out. Pick fewer to continue.",
  extras_need_paid_ticket: "Paid extras need a paid ticket.",
  extras_not_on_installments: "Extras are paid in full, so they can't go on a payment plan.",
};

/** Buyer copy for a refusal the server names after extras; null for anything else. */
export function extrasRefusalCopy(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  return EXTRAS_REFUSAL_COPY[code] ?? null;
}

/** The refusal token inside a raw server message, if it is an extras one. */
export function extrasRefusalIn(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  for (const code of Object.keys(EXTRAS_REFUSAL_COPY)) {
    if (message.includes(code)) return code;
  }
  return null;
}
