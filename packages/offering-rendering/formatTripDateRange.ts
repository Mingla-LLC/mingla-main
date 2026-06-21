// @mingla/offering-rendering — shared trip date-range formatter.
//
// ORCH-1016: extracted from mingla-business TripPreview's local `formatDateRange`
// so the consumer app (TripCard + ConsumerTripDetailScreen) and the business
// trip preview/public page format trip dates IDENTICALLY (no divergent
// reimplementation). Package-isolated: imports nothing from any app src/.
//
// Inputs are ISO 8601 strings (e.g. "2026-03-12T00:00:00.000Z") or null.
//
// META-ORCH-1174 Leg A.3 — the canonical RPC returns Postgres timestamp text with
// a SPACE separator ("2026-08-17 00:00:00+00"), which Hermes (React Native) does
// NOT parse (returns NaN) even though V8/web does → the device showed the fallback
// "Dates to be set". We now normalize to ISO-8601 (space→'T') BEFORE parsing so the
// real range renders on native too. See ./tripDuration normalizeTimestampIso.

import { normalizeTimestampIso } from "./tripDuration";

export interface FormatTripDateRangeOptions {
  /** String returned when start or end is null/unparseable. Default "Dates to be set". */
  fallback?: string;
}

const DEFAULT_FALLBACK = "Dates to be set";

/**
 * Format a trip's start→end window as a human range, e.g. "Mar 12, 2026 – Mar 18, 2026".
 * Returns the fallback when either bound is null or fails to parse.
 */
export function formatTripDateRange(
  startAt: string | null,
  endAt: string | null,
  options?: FormatTripDateRangeOptions,
): string {
  const fallback = options?.fallback ?? DEFAULT_FALLBACK;
  if (startAt === null || endAt === null) return fallback;
  try {
    // Hermes-safe parse: normalize the space-separated backend form to ISO 8601.
    const startIso = normalizeTimestampIso(startAt);
    const endIso = normalizeTimestampIso(endAt);
    if (startIso === null || endIso === null) return fallback;
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return fallback;
    }
    const fmt = (d: Date): string =>
      d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    return `${fmt(start)} – ${fmt(end)}`;
  } catch {
    return fallback;
  }
}
