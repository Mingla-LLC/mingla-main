/**
 * #4238 W4b (amendment B §5): how Mingla counts a Host ad's result.
 *
 * A sale (or sign-up) counts for an ad only when it happened within 7 days
 * AFTER the ad tap it was credited to. No view-through. The browser keeps the
 * tap for the same 7 days (AD_CLICK_TTL_MS in
 * mingla-business/src/analytics/webAnalytics.web.ts; parity is tested).
 *
 * This is applied where Mingla's count is READ (Host results, the results
 * chart, the ended notice) and, since #4238 W7, by the conversion WRITER
 * (adConversionFire.ts resolveTouch / touchWindowExpiry), so an expired tap
 * is never written as the row's touch and nothing tied to it is sent.
 */

export const HOST_AD_CLICK_WINDOW_DAYS = 7;
export const HOST_AD_CLICK_WINDOW_MS = HOST_AD_CLICK_WINDOW_DAYS * 24 * 60 *
  60 * 1000;

function toMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when a conversion at `conversionAt` is inside the 7-day window of the
 * tap at `touchAt`. A missing or unreadable time counts as expired, and so
 * does a tap dated after the sale.
 */
export function countedByMingla(
  touchAt: unknown,
  conversionAt: unknown,
): boolean {
  const touch = toMs(touchAt);
  const conversion = toMs(conversionAt);
  if (touch === null || conversion === null) return false;
  const age = conversion - touch;
  return age >= 0 && age <= HOST_AD_CLICK_WINDOW_MS;
}

/** Filters conversion rows to Mingla's count, given each touch's tap time. */
export function minglaCountedConversions<
  T extends { touch_id?: unknown; created_at?: unknown },
>(rows: readonly T[], touchCreatedAt: ReadonlyMap<string, unknown>): T[] {
  return rows.filter((row) =>
    typeof row.touch_id === "string" &&
    countedByMingla(touchCreatedAt.get(row.touch_id), row.created_at)
  );
}

/** The results copy contract (English; the screens translate it, #4420). */
export const HOST_AD_RESULTS_COPY = {
  tickets:
    "Counted by Mingla: tickets bought within 7 days of someone tapping your ad. Each order counts once, for the last ad they tapped.",
  signups:
    "Counted by Mingla: sign-ups within 7 days of someone tapping your ad. Each sign-up counts once, for the last ad they tapped.",
} as const;
