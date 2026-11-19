/**
 * #4490 P5-3 — By the hour for guests, as pure data (unit-tested):
 *  - the day line (one cell per step from opening to closing: free, taken
 *    (striped, with the word), or yours);
 *  - the lengths from a start, the live price (per minute, pro rata to the
 *    hour price, half up: the server's rule) and the conflict line;
 *  - the checkout address (`?k=hour&d=&s=&m=&g=`) and its parser;
 *  - the booking's hour facts on the pass.
 */
import { venueClock } from "@mingla/brand-rendering/venueOffers/entryModel";
import type { HireHourDay } from "@mingla/brand-rendering/venueOffers/hireModel";

export type HourCellState = "free" | "taken" | "mine" | "closed";

export interface HourCell {
  startsAt: string;
  label: string;
  state: HourCellState;
}

/** A start is bookable when at least one place is free for its first step. */
export function dayLineCells(
  day: Pick<HireHourDay, "opensAt" | "closesAt" | "stepMinutes" | "starts" | "minMinutes">,
  timeZone: string | null,
  chosen: { startsAt: string; minutes: number } | null,
  nowMs: number = Date.now(),
): HourCell[] {
  if (day.opensAt === null || day.closesAt === null) return [];
  const step = Math.max(15, day.stepMinutes);
  const open = Date.parse(day.opensAt);
  const close = Date.parse(day.closesAt);
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) return [];
  const starts = new Set(day.starts.map((s) => Date.parse(s.startsAt)));
  const mineFrom = chosen !== null ? Date.parse(chosen.startsAt) : NaN;
  const mineTo = chosen !== null ? mineFrom + chosen.minutes * 60_000 : NaN;
  const out: HourCell[] = [];
  for (let t = open; t < close && out.length < 96; t += step * 60_000) {
    const iso = new Date(t).toISOString();
    const mine = chosen !== null && t >= mineFrom && t < mineTo;
    out.push({
      startsAt: iso,
      label: venueClock(iso, timeZone) ?? "",
      state: mine
        ? "mine"
        : t < nowMs
          ? "closed"
          : starts.has(t)
          ? "free"
          : close - t < Math.max(day.minMinutes, step) * 60_000
            ? "closed"
            : "taken",
    });
  }
  return out;
}

/** Price × minutes / 60, half up. */
export function hourPrice(pricePerHourMinor: number, minutes: number): number {
  return Math.round((pricePerHourMinor * minutes) / 60);
}

/** "Taken from 15:00. Shorter, or another start." when a length runs into a booking. */
export function hourConflictLine(
  day: Pick<HireHourDay, "starts">,
  startsAt: string,
  minutes: number,
  timeZone: string | null,
): string | null {
  const start = day.starts.find((s) => s.startsAt === startsAt);
  if (start === undefined) return "That start isn't free any more. Pick another.";
  if (minutes <= start.maxMinutes) return null;
  const until = new Date(Date.parse(startsAt) + start.maxMinutes * 60_000).toISOString();
  return `Taken from ${venueClock(until, timeZone) ?? "then"}. Shorter, or another start.`;
}

export interface HourChoice {
  date: string;
  startsAt: string;
  minutes: number;
  guests: number;
}

export function hourCheckoutPath(input: { brandSlug: string; venueSlug: string; offerId: string } & HourChoice): string {
  const q = new URLSearchParams({
    k: "hour",
    d: input.date,
    s: input.startsAt,
    m: String(input.minutes),
    g: String(input.guests),
  });
  return `/b/${input.brandSlug}/v/${input.venueSlug}/book/${input.offerId}?${q.toString()}`;
}

const one = (v: string | string[] | null | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : typeof v === "string" ? v : null);

export function parseHourCheckoutParams(params: Record<string, string | string[] | null | undefined>): HourChoice | null {
  if (one(params.k) !== "hour") return null;
  const date = one(params.d);
  const startsAt = one(params.s);
  const minutes = Number(one(params.m));
  const guests = Number(one(params.g) ?? "1");
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (startsAt === null || Number.isNaN(Date.parse(startsAt))) return null;
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) return null;
  if (!Number.isInteger(guests) || guests < 1 || guests > 1000) return null;
  return { date, startsAt: new Date(startsAt).toISOString(), minutes, guests };
}

export interface HourBookingFacts {
  placeName: string | null;
  bookedFrom: string | null;
  bookedTo: string | null;
  minutes: number | null;
  pricePerHourMinor: number | null;
  noShowReleaseMinutes: number | null;
  releaseIfNoShowAt: string | null;
  released: boolean;
}

export function parseHourFacts(raw: unknown): HourBookingFacts | null {
  if (raw === null || typeof raw !== "object") return null;
  const h = (raw as Record<string, unknown>).hour;
  if (h === null || typeof h !== "object") return null;
  const r = h as Record<string, unknown>;
  const s = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    placeName: s(r.placeName),
    bookedFrom: s(r.bookedFrom),
    bookedTo: s(r.bookedTo),
    minutes: n(r.minutes),
    pricePerHourMinor: n(r.pricePerHourMinor),
    noShowReleaseMinutes: n(r.noShowReleaseMinutes),
    releaseIfNoShowAt: s(r.releaseIfNoShowAt),
    released: r.released === true,
  };
}

/** "Check in within 15 minutes or it's released." */
export function releaseLine(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  return `Check in within ${minutes} minutes of your start or it's released.`;
}

/** Plain words for the by-the-hour refusals a guest can meet. */
export function hourGuestErrorCopy(code: string): string | null {
  switch (code) {
    case "offer_length_invalid":
      return "That length isn't offered. Pick one of the lengths shown.";
    case "offer_wrong_time":
      return "Bookings start on the times shown. Pick one of them.";
    case "offer_window_unavailable":
      return "That's outside the opening hours. Pick another start.";
    case "offer_space_taken":
      return "Someone just booked that time. Pick another start or a shorter length.";
    default:
      return null;
  }
}

/**
 * #4490 P5 follow-up — a by-the-hour booking reads "2 hours · Boardroom",
 * not "1 × Per hour" (its one line is the time, not a count of guests).
 */
export function hourSummaryLabel<T extends { label: string; total?: boolean; muted?: boolean }>(
  lines: T[],
  hour: { minutes: number | null; placeName: string | null } | null,
): T[] {
  if (hour === null || hour.minutes === null) return lines;
  const m = hour.minutes;
  const length = m % 60 === 0 ? `${m / 60} ${m === 60 ? "hour" : "hours"}` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} minutes`;
  const label = [length, hour.placeName].filter((x): x is string => x !== null && x.length > 0).join(" · ");
  let done = false;
  return lines.map((l) => {
    if (done || l.total === true || l.muted === true || /^(VAT|Booking fee|Includes VAT)/.test(l.label)) return l;
    done = true;
    return { ...l, label };
  });
}
