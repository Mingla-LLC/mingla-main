// Issue #4276 S3: seed and refresh updates to an EXISTING place are a merge.
//
// Two rules, one owner, shared by every Google-to-place_pool update path
// (admin-seed-places, both handlers, and admin-refresh-places):
//
//   1. A value Google did not return never replaces a stored one. A search or
//      detail response is often partial. Before this, a re-seed wrote null over
//      `website` and `opening_hours`, and the next final check could then remove a
//      live place for having neither.
//   2. Fields an admin has edited stay the admin's. place_pool_admin_edits is
//      stamped by admin_edit_place only when a value actually changes.
//
// Pure: no IO. The sole-writer exclusions (photo_aesthetic_data, photo_collage_*,
// bouncer columns, ai_signal_scores) are held by the allowlist below: nothing
// outside it can reach a seed update, and none of those columns may be added.

/** The marker value for a tier edit covers both tier columns. */
const ADMIN_PROTECTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  name: ["name"],
  price_tiers: ["price_tier", "price_tiers"],
};

/**
 * Columns a seed update may write, in the order the update paths used to list
 * them. Written even when Google's answer is empty only if listed in
 * ALWAYS_WRITTEN below.
 */
export const SEED_MERGE_COLUMNS = [
  "name",
  "address",
  "lat",
  "lng",
  "types",
  "primary_type",
  "primary_type_display_name",
  "rating",
  "review_count",
  "price_level",
  "price_range_currency",
  "price_range_start_cents",
  "price_range_end_cents",
  "opening_hours",
  "secondary_opening_hours",
  "photos",
  "website",
  "google_maps_uri",
  "national_phone_number",
  "business_status",
  "editorial_summary",
  "generative_summary",
  "reviews",
  "utc_offset_minutes",
  "serves_brunch",
  "serves_lunch",
  "serves_dinner",
  "serves_breakfast",
  "serves_beer",
  "serves_wine",
  "serves_cocktails",
  "serves_coffee",
  "serves_dessert",
  "serves_vegetarian_food",
  "outdoor_seating",
  "live_music",
  "good_for_groups",
  "good_for_children",
  "good_for_watching_sports",
  "allows_dogs",
  "has_restroom",
  "reservable",
  "menu_for_children",
  "dine_in",
  "takeout",
  "delivery",
  "curbside_pickup",
  "accessibility_options",
  "parking_options",
  "payment_options",
  "raw_google_data",
  "last_detail_refresh",
] as const;

function isAbsent(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  // `types: []` and `photos: []` are how the transforms spell "Google sent none".
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Remove every absent value and every column the admin owns. Returns a new object:
 * a key missing from a Supabase update payload leaves the stored value alone.
 * Booleans false and numeric 0 are real answers and are kept.
 */
export function mergeGoogleUpdate(
  update: Readonly<Record<string, unknown>>,
  adminEditedFields: readonly string[] | null | undefined,
): Record<string, unknown> {
  const protectedColumns = new Set<string>();
  for (const field of adminEditedFields ?? []) {
    for (const column of ADMIN_PROTECTED_COLUMNS[field] ?? []) {
      protectedColumns.add(column);
    }
  }
  const merged: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(update)) {
    if (isAbsent(value) || protectedColumns.has(column)) continue;
    merged[column] = value;
  }
  return merged;
}

/**
 * The update for a re-seeded place. `row` comes from transformGooglePlaceForSeed,
 * which fills insert defaults (`name: "Unknown"`, `lat: 0`, `review_count: 0`) so a
 * NEW place satisfies its constraints. Those defaults are not Google's answer, so
 * they are read back against the raw response here and never reach a stored place.
 */
export function buildSeedMergeUpdate(
  row: Readonly<Record<string, unknown>>,
  adminEditedFields: readonly string[] | null | undefined,
): Record<string, unknown> {
  const raw = (row.raw_google_data ?? {}) as Record<string, unknown>;
  const candidate: Record<string, unknown> = {};
  for (const column of SEED_MERGE_COLUMNS) candidate[column] = row[column];

  if ((raw.displayName as { text?: unknown } | undefined)?.text == null) {
    delete candidate.name;
  }
  if (raw.location == null) {
    delete candidate.lat;
    delete candidate.lng;
  }
  if (raw.userRatingCount == null) delete candidate.review_count;

  return { ...mergeGoogleUpdate(candidate, adminEditedFields), refresh_failures: 0 };
}

/** Index admin markers by google_place_id for one batch of a seed update. */
export function adminEditsByGooglePlaceId(
  rows: ReadonlyArray<
    { google_place_id: string; edited_fields: string[] | null }
  > | null,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of rows ?? []) {
    out.set(row.google_place_id, row.edited_fields ?? []);
  }
  return out;
}

export const COVERAGE_PAGE_SIZE = 1000;

export interface CoverageRow {
  id: string;
  primary_type: string | null;
  types: string[] | null;
}

/** Every active place in a city for coverage_check, one id-ordered page at a time. */
export async function loadAllCoverageRows(
  loadPage: (afterId: string | null) => Promise<CoverageRow[]>,
): Promise<CoverageRow[]> {
  const all: CoverageRow[] = [];
  let afterId: string | null = null;
  while (true) {
    const page: CoverageRow[] = await loadPage(afterId);
    all.push(...page);
    if (page.length === 0) return all;
    afterId = page[page.length - 1].id;
  }
}
