// Issue #3682 — public count RPCs plus the auth-scoped Host summary RPC.
import type { BrandFollowerSummary } from "../types/brandFollowers";

const MAX_BATCH_SIZE = 100;

// Keep the public count parser usable in render-only and contract tests that do
// not boot the app's Supabase environment. The real client is loaded only when
// a query actually runs; production calls still use the one canonical client.
const getSupabase = async (): Promise<
  typeof import("./supabase").supabase
> => (await import("./supabase")).supabase;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).sort().join("|") === keys.slice().sort().join("|");

function asCount(value: unknown, label: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label}_malformed`);
  }
  return parsed;
}

export function parseBrandFollowerSummary(value: unknown): BrandFollowerSummary {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "total",
      "newThisWeek",
      "sourcesThisWeek",
      "trend",
      "asOf",
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.asOf !== "string" ||
    !Number.isFinite(Date.parse(value.asOf)) ||
    !isRecord(value.sourcesThisWeek) ||
    !hasExactKeys(value.sourcesThisWeek, [
      "checkout",
      "brandPage",
      "emailInvite",
      "other",
    ]) ||
    !Array.isArray(value.trend) ||
    value.trend.length !== 7
  ) {
    throw new Error("follower_summary_malformed");
  }

  const total = asCount(value.total, "follower_summary");
  const newThisWeek = asCount(value.newThisWeek, "follower_summary");
  const sourcesThisWeek = {
    checkout: asCount(value.sourcesThisWeek.checkout, "follower_summary"),
    brandPage: asCount(value.sourcesThisWeek.brandPage, "follower_summary"),
    emailInvite: asCount(
      value.sourcesThisWeek.emailInvite,
      "follower_summary",
    ),
    other: asCount(value.sourcesThisWeek.other, "follower_summary"),
  };
  const trend = value.trend.map((point) =>
    asCount(point, "follower_summary"),
  );

  if (
    newThisWeek > total ||
    Object.values(sourcesThisWeek).reduce((sum, count) => sum + count, 0) !==
      newThisWeek ||
    trend[6] !== total ||
    trend.some((point, index) => index > 0 && point < trend[index - 1])
  ) {
    throw new Error("follower_summary_malformed");
  }

  return {
    schemaVersion: 1,
    total,
    newThisWeek,
    sourcesThisWeek,
    trend: trend as BrandFollowerSummary["trend"],
    asOf: value.asOf,
  };
}

export const brandFollowerCountService = {
  async getCount(brandId: string): Promise<number | null> {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc("get_brand_follower_count", {
      p_brand_id: brandId,
    });
    if (error) throw error;
    return data === null ? null : asCount(data, "follower_count");
  },

  async getCounts(brandIds: readonly string[]): Promise<Record<string, number>> {
    const uniqueBrandIds = [...new Set(brandIds.filter((id) => id.length > 0))].sort();
    if (uniqueBrandIds.length === 0) return {};

    const supabase = await getSupabase();
    const counts: Record<string, number> = {};
    for (let offset = 0; offset < uniqueBrandIds.length; offset += MAX_BATCH_SIZE) {
      const chunk = uniqueBrandIds.slice(offset, offset + MAX_BATCH_SIZE);
      const chunkIds = new Set(chunk);
      const { data, error } = await supabase.rpc("get_brand_follower_counts", {
        p_brand_ids: chunk,
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("brand_follower_counts_malformed");

      for (const row of data) {
        if (
          !isRecord(row) ||
          !hasExactKeys(row, ["brand_id", "follower_count"]) ||
          typeof row.brand_id !== "string" ||
          !chunkIds.has(row.brand_id) ||
          Object.prototype.hasOwnProperty.call(counts, row.brand_id)
        ) {
          throw new Error("brand_follower_counts_malformed");
        }
        counts[row.brand_id] = asCount(
          row.follower_count,
          "brand_follower_counts",
        );
      }
    }
    return counts;
  },

  async getHostSummary(brandId: string): Promise<BrandFollowerSummary> {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc("biz_brand_follower_summary_v1", {
      p_brand_id: brandId,
    });
    if (error) throw error;
    return parseBrandFollowerSummary(data);
  },
};
