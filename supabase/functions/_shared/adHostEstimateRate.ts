/**
 * #4238 r8 P2-3 — a durable limit on Host reach estimates (ad-plan
 * host_estimate), per brand AND per user, on the database clock. The old
 * limit lived in one edge isolate's memory, so it held nothing across
 * instances while every call could hit the shared Mingla ad accounts'
 * estimate quota (and Google Geocoding for Snapchat and pins).
 *
 * Same pattern as biz_web_follow_rate_hit (#3682): one atomic upsert per
 * bucket in public.ad_host_estimate_rate (ad_host_estimate_rate_hit).
 * Fails CLOSED: if the limiter cannot answer, no estimate is made.
 *
 * Guards I-4238-ESTIMATE-RATE-DURABLE (declared in supabase/functions/_shared/__tests__/issue_4238_mb_r9_rework.implementor.test.ts).
 */

export const HOST_ESTIMATE_WINDOW_SECONDS = 60;
export const HOST_ESTIMATE_MAX_PER_BRAND = 20;
export const HOST_ESTIMATE_MAX_PER_USER = 30;

type RpcDb = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type HostEstimateRateVerdict =
  | { allowed: true }
  | { allowed: false; status: 429 | 503; error: string; detail: string };

export async function checkHostEstimateRate(
  db: RpcDb,
  brandId: string,
  userId: string,
): Promise<HostEstimateRateVerdict> {
  const buckets: Array<[string, number]> = [
    [`host_estimate:brand:${brandId}`, HOST_ESTIMATE_MAX_PER_BRAND],
    [`host_estimate:user:${userId}`, HOST_ESTIMATE_MAX_PER_USER],
  ];
  for (const [bucket, max] of buckets) {
    const { data, error } = await db.rpc("ad_host_estimate_rate_hit", {
      p_bucket_key: bucket,
      p_window_seconds: HOST_ESTIMATE_WINDOW_SECONDS,
      p_max_hits: max,
    });
    if (error || typeof data !== "boolean") {
      console.error("[ad-plan] host_estimate limiter unavailable", {
        detail: String(error?.message ?? "no_answer").slice(0, 200),
      });
      return {
        allowed: false,
        status: 503,
        error: "estimate_unavailable",
        detail: "rate_limiter_unavailable",
      };
    }
    if (data === true) {
      return {
        allowed: false,
        status: 429,
        error: "rate_limited",
        detail: "estimate_too_soon",
      };
    }
  }
  return { allowed: true };
}
