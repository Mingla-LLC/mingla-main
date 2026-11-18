// issue #4420 — the experience reservation model, ONE owner for the two
// pickers that use it: the Reserve sheet (mingla-business
// ExperienceReservePicker) and the inline "Book a time" picker on the page
// (ExperienceInlinePicker). Before #4420 this logic lived only inside the
// sheet; it moved here verbatim (same defaults, same caps, same selection
// hand-off to checkout) so the inline picker cannot drift from it.
//
// Pure and dependency-free (Deno-unit-tested): no React, no react-native.
// The React state wrapper is useExperienceReserveState.ts.

import {
  experienceBookedEndIso,
  experienceBookedStartIso,
} from "./experienceTimeZone.ts";
import type { ExperienceOfferingTicket } from "./experienceOfferingTypes.ts";
import { withCurrencyGlyph } from "./currencyGlyph.ts";
import { priceDecimals, priceFallbackDecimals } from "./priceDecimals.ts";

export type ExperienceReserveMode = "slots" | "open-daily";

/** One bookable occurrence (event_dates row) as the pickers read it. */
export interface ExperienceReserveDate {
  id: string;
  startAt: string;
  endAt: string;
  /** null = unlimited / unknown; 0 = sold out (shown, disabled). */
  ticketsRemaining: number | null;
}

/** What a confirmed pick hands to checkout (unchanged contract). */
export interface ExperienceReserveSelection {
  /** The chosen occurrence's event_dates.id. */
  eventDateId: string;
  /** Party size (open-daily) → cart quantity. Always ≥1; 1 in slots mode. */
  quantity: number;
  /** issue #3281 — open-daily booked start instant (ISO), when a time was chosen. */
  startAt?: string;
  /** issue #3281 R2 — chosen price option (ticket_types.id). */
  ticketTypeId?: string;
  /** issue #3281 R2 — block hire end instant (ISO). */
  bookedEndAt?: string;
  /** issue #3281 R2 — party size for group options (may differ from quantity). */
  partySize?: number;
}

/** Largest party the stepper offers when nothing smaller caps it. */
export const EXPERIENCE_MAX_PARTY = 12;
/** The party the pickers open on. */
export const EXPERIENCE_DEFAULT_PARTY = 2;

export const experienceSpacingOrDefault = (raw: number | null | undefined): number =>
  typeof raw === "number" && raw > 0 ? raw : 30;

export const experienceNoticeOrDefault = (raw: number | null | undefined): number =>
  typeof raw === "number" && raw >= 0 ? raw : 120;

/** Wall-clock minute (0..1439) of an instant in the experience zone. */
export function wallMinuteInZone(iso: string, timeZone: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      timeZone: timeZone || "UTC",
    }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  } catch {
    return null;
  }
}

/** Slot-availability rows → remaining by wall minute (experience zone). */
export function slotRemainingByWallMinute(
  slots: ReadonlyArray<{ startAt: string; remaining: number | null }>,
  timeZone: string,
): Map<number, number | null> {
  const next = new Map<number, number | null>();
  for (const s of slots) {
    const minute = wallMinuteInZone(s.startAt, timeZone);
    if (minute === null) continue;
    next.set(
      minute,
      typeof s.remaining === "number" && Number.isFinite(s.remaining)
        ? s.remaining
        : null,
    );
  }
  return next;
}

/**
 * Parse the `pg_experience_slot_availability` payload ({ slots: [...] }).
 * Anything malformed → null (the caller keeps an empty map: no fabricated
 * "N left").
 */
export function parseSlotAvailability(
  data: unknown,
): Array<{ startAt: string; remaining: number | null }> | null {
  if (data === null || typeof data !== "object") return null;
  const slots = (data as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) return null;
  const out: Array<{ startAt: string; remaining: number | null }> = [];
  for (const raw of slots) {
    if (raw === null || typeof raw !== "object") continue;
    const startAt = (raw as { startAt?: unknown }).startAt;
    const remaining = (raw as { remaining?: unknown }).remaining;
    if (typeof startAt !== "string") continue;
    out.push({
      startAt,
      remaining:
        typeof remaining === "number" && Number.isFinite(remaining)
          ? remaining
          : null,
    });
  }
  return out;
}

/** Block / group facts of the chosen option, with the sheet's defaults. */
export function experienceOptionShape(option: ExperienceOfferingTicket | null): {
  isBlock: boolean;
  isGroup: boolean;
  blockMinutes: number;
  minBlocks: number;
  maxBlocks: number;
} {
  const isBlock = option?.priceBasis === "block";
  const isGroup = option?.priceBasis === "group";
  const blockMinutes =
    typeof option?.blockMinutes === "number" && option.blockMinutes > 0
      ? option.blockMinutes
      : 60;
  const minBlocks =
    typeof option?.minBlocks === "number" && option.minBlocks > 0
      ? option.minBlocks
      : 1;
  const maxBlocks =
    typeof option?.maxBlocks === "number" && option.maxBlocks >= minBlocks
      ? option.maxBlocks
      : minBlocks;
  return { isBlock, isGroup, blockMinutes, minBlocks, maxBlocks };
}

/** The party stepper's ceiling: group cap, then live remaining. */
export function experiencePartyMax(args: {
  option: ExperienceOfferingTicket | null;
  eventRemaining: number | null;
  slotRemaining: number | null;
}): number {
  const { option, eventRemaining, slotRemaining } = args;
  const optionRemaining =
    option?.ticketsRemaining !== undefined ? option.ticketsRemaining : eventRemaining;
  const remainingForParty =
    typeof slotRemaining === "number" ? slotRemaining : optionRemaining;
  const isGroup = option?.priceBasis === "group";
  const groupCap =
    isGroup && typeof option?.groupMax === "number" && option.groupMax >= 2
      ? option.groupMax
      : EXPERIENCE_MAX_PARTY;
  return Math.min(
    groupCap,
    remainingForParty === null ? groupCap : Math.max(1, remainingForParty),
  );
}

/** The all-in unit in cents the total multiplies (option first, then fallback). */
export function experienceActiveUnitCents(
  option: ExperienceOfferingTicket | null,
  unitAllInCents: number | null,
): number | null {
  if (
    option !== null &&
    typeof option.priceAllInCents === "number" &&
    option.priceAllInCents > 0
  ) {
    return option.priceAllInCents;
  }
  if (option !== null && typeof option.priceCents === "number" && option.priceCents > 0) {
    return option.priceCents;
  }
  return typeof unitAllInCents === "number" && unitAllInCents > 0
    ? unitAllInCents
    : null;
}

/**
 * The formatted all-in total of a pick ("₦30,000"), or null when the price
 * or currency is unknown (the caller then shows no amount, never a guess).
 */
export function experienceReserveTotal(args: {
  unitCents: number | null;
  currency: string | null;
  isBlock: boolean;
  isGroup: boolean;
  blocks: number | null;
  party: number;
}): string | null {
  const blocks = args.isBlock && args.blocks !== null ? args.blocks : 1;
  const units = args.isGroup || args.isBlock ? 1 : args.party;
  const code = (args.currency ?? "").trim().toUpperCase();
  if (args.unitCents === null || code.length !== 3) return null;
  const major = (args.unitCents * units * blocks) / 100;
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        ...priceDecimals(major),
      }).format(major),
      code,
    );
  } catch {
    return `${major.toFixed(priceFallbackDecimals(major))} ${code}`;
  }
}

/**
 * Build the checkout hand-off for a pick, or null when it is not complete
 * (open-daily with no time, block with no length, an unresolvable start).
 * Byte-identical to the pre-#4420 sheet: slots → quantity 1; person → quantity
 * = party; group / block → one unit + partySize guests.
 */
export function buildExperienceReserveSelection(args: {
  mode: ExperienceReserveMode;
  date: ExperienceReserveDate | null;
  timezone: string;
  spacingMinutes: number;
  minute: number | null;
  blocks: number | null;
  party: number;
  option: ExperienceOfferingTicket | null;
}): ExperienceReserveSelection | null {
  const { mode, date, timezone, spacingMinutes, minute, blocks, party, option } = args;
  if (date === null) return null;
  const ticketTypeId = option?.ticketTypeId;
  if (mode === "slots") {
    if (date.ticketsRemaining !== null && date.ticketsRemaining <= 0) return null;
    return {
      eventDateId: date.id,
      quantity: 1,
      ...(ticketTypeId !== undefined ? { ticketTypeId } : {}),
    };
  }
  if (minute === null) return null;
  const shape = experienceOptionShape(option);
  if (shape.isBlock && blocks === null) return null;
  const bookedIso = experienceBookedStartIso(
    date.startAt,
    date.endAt,
    timezone,
    minute,
    spacingMinutes,
  );
  // issue #3281 — never confirm open-daily without a resolvable start.
  if (bookedIso === null) return null;
  let bookedEndAt: string | undefined;
  if (shape.isBlock && blocks !== null) {
    const endIso = experienceBookedEndIso(bookedIso, shape.blockMinutes, blocks);
    if (endIso === null) return null;
    bookedEndAt = endIso;
  }
  const quantity = shape.isGroup || shape.isBlock ? 1 : party;
  return {
    eventDateId: date.id,
    quantity,
    startAt: bookedIso,
    partySize: party,
    ...(ticketTypeId !== undefined ? { ticketTypeId } : {}),
    ...(bookedEndAt !== undefined ? { bookedEndAt } : {}),
  };
}

/** One day in the inline date strip. */
export interface ExperienceReserveDay {
  /** YYYY-MM-DD in the experience zone. */
  key: string;
  weekday: string;
  dayNumber: string;
  month: string;
  /** Occurrences on this day, in order. */
  dates: ExperienceReserveDate[];
  /** Every occurrence that day is sold out. */
  full: boolean;
}

const dayParts = (
  iso: string,
  timeZone: string,
  locale: string | undefined,
): { key: string; weekday: string; dayNumber: string; month: string } | null => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const zone = timeZone || "UTC";
  try {
    const keyParts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: zone,
    }).formatToParts(d);
    const y = keyParts.find((p) => p.type === "year")?.value ?? "";
    const m = keyParts.find((p) => p.type === "month")?.value ?? "";
    const day = keyParts.find((p) => p.type === "day")?.value ?? "";
    const weekday = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      timeZone: zone,
    }).format(d);
    const month = new Intl.DateTimeFormat(locale, {
      month: "short",
      timeZone: zone,
    }).format(d);
    return {
      key: `${y}-${m}-${day}`,
      weekday,
      dayNumber: String(Number(day)),
      month,
    };
  } catch {
    return null;
  }
};

/**
 * Group occurrences into calendar days (experience zone) for the date strip.
 * Order follows the input; a day is `full` when every occurrence on it is
 * sold out (it shows, crossed out, so the buyer sees why).
 */
export function experienceReserveDays(
  dates: ReadonlyArray<ExperienceReserveDate>,
  timeZone: string,
  locale?: string,
): ExperienceReserveDay[] {
  const out: ExperienceReserveDay[] = [];
  const byKey = new Map<string, ExperienceReserveDay>();
  for (const date of dates) {
    const parts = dayParts(date.startAt, timeZone, locale);
    if (parts === null) continue;
    let day = byKey.get(parts.key);
    if (day === undefined) {
      day = { ...parts, dates: [], full: true };
      byKey.set(parts.key, day);
      out.push(day);
    }
    day.dates.push(date);
    if (date.ticketsRemaining === null || date.ticketsRemaining > 0) day.full = false;
  }
  return out;
}

/** "Sat 19 Dec" for the bar summary (experience zone). */
export function experienceShortDayLabel(
  iso: string,
  timeZone: string,
  locale?: string,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: timeZone || "UTC",
    }).format(d);
  } catch {
    return "";
  }
}

/** "7:00 PM" wall time of an occurrence start (experience zone). */
export function experienceStartTimeLabel(
  iso: string,
  timeZone: string,
  locale?: string,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || "UTC",
    }).format(d);
  } catch {
    return "";
  }
}
