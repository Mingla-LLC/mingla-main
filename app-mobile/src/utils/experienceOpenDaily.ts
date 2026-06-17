/**
 * experienceOpenDaily — ORCH-1138 Leg 3 P2-2 (open-daily detection).
 *
 * Pure, dep-free heuristic that decides whether an experience's materialized
 * occurrences represent a genuine "open-daily / open-hours" (restaurant-style)
 * model — which earns the date→time-within-window picker — versus a discrete
 * FIXED-start single/multi-date experience, which must use its real dates and
 * NEVER an arbitrary time grid.
 *
 * WHY THIS EXISTS (P2-2): the prior heuristic classified as open-daily whenever
 * there was >1 occurrence AND every window was >=90 min. A legitimately discrete
 * multi-date experience (e.g. 3 fixed-start 3-hour evenings) satisfied that and
 * was wrongly offered a fabricated 30-min time grid for a set-time event. The
 * tightened rule below additionally requires a DENSE, near-DAILY cadence — which
 * only the recurrence-materializer produces — so fixed-start sessions fall back
 * to the slot list.
 *
 * Lives in utils/ (no React Native imports) so it is unit-testable under Deno
 * AND consumed by ConsumerExperienceDetailScreen.tsx (single owner of the rule).
 */

/** Minimal occurrence shape the rule reads (a subset of ExperienceOccurrence). */
export interface OpenDailyOccurrenceWindow {
  startAt: string;
  endAt: string;
}

// A genuine open-daily run is dense + near-daily + wide-windowed. Tunables:
export const OPEN_DAILY_MIN_WINDOW_MS = 90 * 60 * 1000; // each window >= 90 min
export const OPEN_DAILY_MIN_OCCURRENCES = 7; // a meaningful daily run
export const OPEN_DAILY_MAX_MEDIAN_GAP_MS = 36 * 60 * 60 * 1000; // ~1.5 days

/**
 * Median gap (ms) between consecutive occurrence STARTS. null when fewer than 2
 * finite starts (cannot infer a cadence). Robust to ordering and to a single
 * outlier gap (median, not mean).
 */
export const medianConsecutiveGapMs = (
  occ: ReadonlyArray<OpenDailyOccurrenceWindow>,
): number | null => {
  const starts = occ
    .map((o) => new Date(o.startAt).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (starts.length <= 1) return null;
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    gaps.push(starts[i] - starts[i - 1]);
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
};

/**
 * @deprecated ORCH-1153 WS2 — RETIRED as the open-daily owner. The canonical
 * detector is now the rule-based `isOpenDailyExperience` in
 * `@mingla/event-rendering` (one owner across buyer-web + business + consumer).
 * This density heuristic classified the SAME experience differently than the web
 * page (F-5); it is no longer consumed by ConsumerExperienceDetailScreen. Kept
 * only for its existing Deno test (append-only) — do NOT reintroduce it as the
 * picker detector.
 *
 * True ONLY for a genuine open-daily / open-hours experience: a dense run of
 * occurrences (>= OPEN_DAILY_MIN_OCCURRENCES), every window wide (>=90 min), AND
 * a near-daily median cadence (<= ~1.5 days). A discrete fixed-start multi-date
 * experience fails the count and/or cadence gate → false (use the slot list).
 */
export const isOpenDailyModel = (
  occ: ReadonlyArray<OpenDailyOccurrenceWindow>,
): boolean => {
  if (occ.length < OPEN_DAILY_MIN_OCCURRENCES) return false;
  const allWideWindows = occ.every((o) => {
    const s = new Date(o.startAt).getTime();
    const e = new Date(o.endAt).getTime();
    return (
      Number.isFinite(s) &&
      Number.isFinite(e) &&
      e - s >= OPEN_DAILY_MIN_WINDOW_MS
    );
  });
  if (!allWideWindows) return false;
  const medianGap = medianConsecutiveGapMs(occ);
  return medianGap !== null && medianGap <= OPEN_DAILY_MAX_MEDIAN_GAP_MS;
};
