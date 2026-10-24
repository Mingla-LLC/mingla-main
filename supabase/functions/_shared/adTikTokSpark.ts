/** Issue #3697 — current-product Spark Pull contract for linked @usemingla posts. */

type Row = Record<string, unknown>;

export type TikTokSparkSelection =
  | { present: false; ok: true; ids: [] }
  | { present: true; ok: true; ids: string[] }
  | { present: true; ok: false; detail: string; ids: [] };

export function tiktokSparkSelection(canonicalPlan: Row): TikTokSparkSelection {
  if (!("tiktok_spark_post_ids" in canonicalPlan)) {
    return { present: false, ok: true, ids: [] };
  }
  if (!Array.isArray(canonicalPlan.tiktok_spark_post_ids)) {
    return {
      present: true,
      ok: false,
      detail: "tiktok_spark_post_ids_invalid",
      ids: [],
    };
  }
  const ids = [
    ...new Set(
      canonicalPlan.tiktok_spark_post_ids.map((value) => String(value).trim()),
    ),
  ];
  if (
    ids.length < 2 || ids.length > 4 ||
    ids.some((id) => !/^\d{10,30}$/.test(id))
  ) {
    return {
      present: true,
      ok: false,
      detail: "tiktok_spark_post_ids_invalid",
      ids: [],
    };
  }
  return { present: true, ok: true, ids };
}

export function assertTikTokSparkPostsOwned(
  selectedIds: string[],
  providerIds: string[],
): void {
  const available = new Set(providerIds);
  const missing = selectedIds.find((id) => !available.has(id));
  if (missing) throw new Error(`tiktok_spark_post_not_owned:${missing}`);
}
