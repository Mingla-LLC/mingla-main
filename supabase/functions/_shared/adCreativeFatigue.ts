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

/** #4238 T-4: Meta level-"ad" insights → per-ad daily rows (admin-ad-spend-sync). */
export function parseMetaAdMetrics(
  payload: unknown,
): {
  provider_ad_id: string;
  metric_date: string;
  impressions: number;
  link_clicks: number;
  spend_cents: number;
}[] {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const raw of rows) {
    const row = raw && typeof raw === "object"
      ? raw as Record<string, unknown>
      : {};
    const adId = String(row.ad_id ?? "").trim();
    const date = String(row.date_start ?? "").slice(0, 10);
    if (!adId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const count = (value: unknown) => {
      const n = Math.floor(Number(value));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const spend = Number(row.spend);
    out.push({
      provider_ad_id: adId,
      metric_date: date,
      impressions: count(row.impressions),
      link_clicks: count(row.inline_link_clicks),
      spend_cents: Number.isFinite(spend) && spend > 0
        ? Math.round(spend * 100)
        : 0,
    });
  }
  return out;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * #4238 T-4: the daily evaluation for one live Host campaign. Reads
 * ad_creative_metrics_daily (per ad) and the ad set's latest frequency
 * (ad_stage_metrics_daily), and records one pending creative_fatigue row per
 * tired creative (never twice for one creative inside 7 days). Never throws;
 * returns what happened for the sweep report. Delivery is W4.
 */
export async function evaluateCreativeFatigue(db: Db, ctx: {
  planId: string;
  campaignId: string;
  platform: string;
  liveSinceMs: number | null;
  nowMs: number;
}): Promise<string> {
  if (!FATIGUE_PLATFORMS.has(ctx.platform)) return "not_supported";
  if (ctx.liveSinceMs === null) return "not_live";
  try {
    const since = new Date(ctx.nowMs - 21 * DAY_MS).toISOString().slice(0, 10);
    const { data: metrics, error: metricsError } = await db
      .from("ad_creative_metrics_daily")
      .select("provider_ad_id,creative_id,metric_date,impressions,link_clicks")
      .eq("campaign_id", ctx.campaignId).gte("metric_date", since);
    if (metricsError) return "metrics_unavailable";
    const { data: stageRows, error: stageError } = await db
      .from("ad_stage_metrics_daily")
      .select("stage,frequency,metric_date")
      .eq("campaign_id", ctx.campaignId)
      .order("metric_date", { ascending: false }).limit(10);
    if (stageError) return "frequency_unavailable";
    const { data: fired, error: firedError } = await db
      .from("ad_plan_automation_events")
      .select("detail,created_at")
      .eq("plan_id", ctx.planId).eq("platform", ctx.platform)
      .eq("kind", "creative_fatigue");
    if (firedError) return "history_unavailable";
    const byAd = new Map<
      string,
      { creativeId: string | null; days: FatigueDay[] }
    >();
    for (const row of (metrics ?? []) as Record<string, unknown>[]) {
      const key = String(row.provider_ad_id ?? "");
      if (!key) continue;
      const entry = byAd.get(key) ??
        {
          creativeId: typeof row.creative_id === "string"
            ? row.creative_id
            : null,
          days: [],
        };
      entry.days.push({
        metric_date: String(row.metric_date),
        impressions: Number(row.impressions ?? 0),
        link_clicks: Number(row.link_clicks ?? 0),
      });
      byAd.set(key, entry);
    }
    let recorded = 0;
    for (const [providerAdId, entry] of byAd) {
      const creativeKey = entry.creativeId ?? providerAdId;
      const last = ((fired ?? []) as Record<string, unknown>[])
        .filter((row) =>
          (row.detail as Record<string, unknown> | null)?.creative_id ===
            creativeKey
        )
        .map((row) => Date.parse(String(row.created_at)))
        .filter(Number.isFinite)
        .sort((a, b) => b - a)[0] ?? null;
      for (const stage of ["prospecting", "retarget"] as const) {
        const frequency = ((stageRows ?? []) as Record<string, unknown>[])
          .find((row) => row.stage === stage)?.frequency;
        if (frequency === undefined) continue;
        if (
          !creativeFatigueDue({
            platform: ctx.platform,
            stage,
            nowMs: ctx.nowMs,
            liveSinceMs: ctx.liveSinceMs,
            frequency7d: Number(frequency),
            days: entry.days,
            lastFiredMs: last,
          })
        ) continue;
        const { error } = await db.from("ad_plan_automation_events").insert({
          plan_id: ctx.planId,
          campaign_id: ctx.campaignId,
          platform: ctx.platform,
          kind: "creative_fatigue",
          status: "pending",
          detail: {
            creative_id: creativeKey,
            provider_ad_id: providerAdId,
            stage,
          },
        });
        if (error) return "record_failed";
        recorded += 1;
        break;
      }
    }
    return recorded > 0 ? `recorded:${recorded}` : "none";
  } catch (error) {
    console.error(
      "[adCreativeFatigue] evaluation failed:",
      error instanceof Error ? error.message : String(error),
    );
    return "failed";
  }
}
