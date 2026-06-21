/**
 * ORCH-1186-B — pure, testable helpers for the venue intelligence dashboard.
 *
 * Kept out of VenueIntelligenceModule.tsx so the bar math + the insufficient-
 * data threshold have a clean test seam (SPEC §9 / the no-fabrication +
 * aggregation tests). NO React, NO JSX, NO side effects here.
 */

/**
 * The minimum number of qualifying orders before the slow-hours / slow-days
 * tiles render real buckets. Below this the hour/day buckets are noise, not
 * signal (SPEC §4.6 E-B/E-C). This is the §9 fails-on-revert anchor — the
 * no-fabrication test asserts it stays present and equal to 14.
 */
export const INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS = 14 as const;

/** Bar-color tokens (verbatim from the established sparkline convention). */
export const BAR_INACTIVE = "rgba(255,255,255,0.16)" as const;
export const BAR_CONTEXT = "rgba(255,255,255,0.28)" as const;

/** Floor percentages so an empty bucket still shows a visible stub. */
export const SPARKLINE_FLOOR_PCT = 4 as const;
export const BARROW_FLOOR_PCT = 6 as const;

/**
 * Normalize a count series to 0..100 (percentage of the max bucket).
 * Used by the 24-hour and 7-day bar rows. Divides by max(...counts, 1) to
 * avoid division by zero — an all-zero series returns all-zero heights.
 */
export function normalizeBars(counts: number[]): number[] {
  const max = Math.max(...counts, 1);
  return counts.map((c) => (c / max) * 100);
}

/**
 * Indices of the minimum-count bucket(s). When multiple buckets share the
 * minimum, ALL are returned (honest — there are multiple equally-quiet slots).
 * Returns an empty array for an empty input.
 */
export function minBucketIndices(counts: number[]): number[] {
  if (counts.length === 0) return [];
  const min = Math.min(...counts);
  return counts
    .map((c, i) => (c === min ? i : -1))
    .filter((i) => i >= 0);
}

/** 12-hour clock label for an hour-of-day 0..23 (e.g. 0 -> "12 AM", 15 -> "3 PM"). */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${period}`;
}

/** Full weekday name for the 0=Mon..6=Sun convention used by the RPC. */
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_NAMES[((weekday % 7) + 7) % 7] ?? "";
}

/** Single-letter weekday ticks, Mon..Sun, for the slow-days bar row axis. */
export const WEEKDAY_TICKS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * Join up to `cap` labels into a human phrase ("A", "A and B",
 * "A, B and C", "A, B, C +2 more"). Used for tie cases in the takeaway lines.
 */
export function joinLabels(labels: string[], cap = 3): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] ?? "";
  const shown = labels.slice(0, cap);
  const extra = labels.length - shown.length;
  if (labels.length <= cap) {
    const head = shown.slice(0, -1).join(", ");
    const tail = shown[shown.length - 1];
    return shown.length === 2 ? `${shown[0]} and ${tail}` : `${head} and ${tail}`;
  }
  return `${shown.join(", ")} +${extra} more`;
}
