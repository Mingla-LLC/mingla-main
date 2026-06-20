// @mingla/offering-rendering — shared trip date-range formatter.
//
// ORCH-1016: extracted from mingla-business TripPreview's local `formatDateRange`
// so the consumer app (TripCard + ConsumerTripDetailScreen) and the business
// trip preview/public page format trip dates IDENTICALLY (no divergent
// reimplementation). Package-isolated: imports nothing from any app src/.
//
// Inputs are ISO 8601 strings (e.g. "2026-03-12T00:00:00.000Z") or null.

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
    const start = new Date(startAt);
    const end = new Date(endAt);
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
