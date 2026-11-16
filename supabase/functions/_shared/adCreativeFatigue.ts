/**
 * #4238 T-4 (amendment A decision 5): the "your ad is getting tired" signal,
 * evaluated daily per ad on Meta, TikTok and Snapchat. All must hold:
 *   1. the ad has been live at least 7 days;
 *   2. at least 3,000 impressions in the last 3 days;
 *   3. its ad set's 7-day frequency is at least 3.0 (prospecting) or 6.0
 *      (retarget);
 *   4. its last-3-day CTR is at most 70% of its own baseline CTR (live days
 *      2–4). A zero-impression baseline never fires.
 * It fires at most once per creative per plan in 7 days (creative_fatigue in
 * ad_plan_automation_events, detail.creative_id). Google and Reddit: never.
 * Pure; the sweep records the row and W4 delivers the notification.
 *
 * MINGLA-INVARIANT: I-4238-FATIGUE-THRESHOLDS | issue #4238 | creativeFatigueDue fires only on Meta/TikTok/Snapchat at >= 7 days live, >= 3,000 impressions in the last 3 days, frequency >= 3 (>= 6 retarget) and last-3-day CTR <= 70% of the days 2-4 baseline, and never twice for one creative inside 7 days.
 */

export const FATIGUE_PLATFORMS: ReadonlySet<string> = new Set([
  "meta",
  "tiktok",
  "snapchat",
]);
export const FATIGUE_MIN_DAYS_LIVE = 7;
export const FATIGUE_MIN_RECENT_IMPRESSIONS = 3000;
export const FATIGUE_FREQUENCY_PROSPECTING = 3;
export const FATIGUE_FREQUENCY_RETARGET = 6;
export const FATIGUE_CTR_RATIO = 0.7;
export const FATIGUE_REPEAT_DAYS = 7;

const DAY_MS = 86_400_000;

export type FatigueDay = {
  /** YYYY-MM-DD (the provider's reporting day). */
  metric_date: string;
  impressions: number;
  link_clicks: number;
};

function dayIndex(date: string, liveSinceMs: number): number | null {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const liveDay = Date.UTC(
    new Date(liveSinceMs).getUTCFullYear(),
    new Date(liveSinceMs).getUTCMonth(),
    new Date(liveSinceMs).getUTCDate(),
  );
  // Live day 1 is the day the ad went live.
  return Math.floor((ms - liveDay) / DAY_MS) + 1;
}

function ctr(
  rows: readonly FatigueDay[],
): { impressions: number; ctr: number } {
  const impressions = rows.reduce(
    (sum, row) => sum + Math.max(0, row.impressions),
    0,
  );
  const clicks = rows.reduce(
    (sum, row) => sum + Math.max(0, row.link_clicks),
    0,
  );
  return { impressions, ctr: impressions > 0 ? clicks / impressions : 0 };
}

export function creativeFatigueDue(input: {
  platform: string;
  stage: "prospecting" | "retarget";
  nowMs: number;
  liveSinceMs: number | null;
  /** The ad set's 7-day frequency (ad_stage_metrics_daily). */
  frequency7d: number | null;
  days: readonly FatigueDay[];
  /** When this creative last fired on this plan (null = never). */
  lastFiredMs: number | null;
}): boolean {
  if (!FATIGUE_PLATFORMS.has(input.platform)) return false;
  if (input.liveSinceMs === null || !Number.isFinite(input.liveSinceMs)) {
    return false;
  }
  if (
    input.lastFiredMs !== null &&
    input.nowMs - input.lastFiredMs < FATIGUE_REPEAT_DAYS * DAY_MS
  ) return false;
  const today = dayIndex(
    new Date(input.nowMs).toISOString().slice(0, 10),
    input.liveSinceMs,
  );
  if (today === null || today < FATIGUE_MIN_DAYS_LIVE + 1) {
    // Day 8 is the first day with 7 full days live behind it.
    return false;
  }
  const frequency = Number(input.frequency7d);
  const threshold = input.stage === "retarget"
    ? FATIGUE_FREQUENCY_RETARGET
    : FATIGUE_FREQUENCY_PROSPECTING;
  if (!Number.isFinite(frequency) || frequency < threshold) return false;
  const indexed = input.days.map((row) => ({
    row,
    index: dayIndex(row.metric_date, input.liveSinceMs as number),
  }));
  const baseline = ctr(
    indexed.filter((item) =>
      item.index !== null && item.index >= 2 && item.index <= 4
    )
      .map((item) => item.row),
  );
  const recent = ctr(
    indexed.filter((item) =>
      item.index !== null && item.index >= today - 3 && item.index <= today - 1
    ).map((item) => item.row),
  );
  if (baseline.impressions <= 0 || baseline.ctr <= 0) return false;
  if (recent.impressions < FATIGUE_MIN_RECENT_IMPRESSIONS) return false;
  return recent.ctr <= baseline.ctr * FATIGUE_CTR_RATIO;
}
