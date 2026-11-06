// Issue #4276 U4: the one list of what the admin's place lists read.
//
// `ai_categories` and `seeding_category` were dropped from place_pool, so any query
// naming them fails outright. A place's category is derived by the database from
// primary_type and types (pg_map_primary_type_to_mingla_category), exposed through
// the computed column below so the map, Browse and Excluded agree with the coverage
// counts instead of each re-implementing the mapping.

/** PostgREST computed column. Filter with `.eq(PLACE_CATEGORY_COLUMN, slug)`. */
export const PLACE_CATEGORY_COLUMN = "place_pool_derived_category";

const CATEGORY_SELECT = `mingla_category:${PLACE_CATEGORY_COLUMN}`;

/** The map only draws pins; it never needs the full row. */
export const PLACE_MAP_COLUMNS = [
  "id", "name", "lat", "lng", "rating", "is_active", "stored_photo_urls",
  "is_servable", "deleted_at", "deleted_reason", CATEGORY_SELECT,
].join(", ");

// Every column the list rows and the place drawer read. `raw_google_data` (about
// 8 KB per place) and `reviews` are deliberately absent: at 20 rows a page they
// are most of the payload, and the admin API role has an 8 second timeout.
const PLACE_LIST_COLUMN_NAMES = [
  "id", "google_place_id", "name", "address", "lat", "lng", "types", "primary_type",
  "primary_type_display_name", "rating", "review_count", "price_level", "price_min",
  "price_max", "price_tier", "price_tiers", "price_range_currency",
  "price_range_start_cents", "price_range_end_cents", "opening_hours",
  "secondary_opening_hours", "photos", "stored_photo_urls", "website",
  "google_maps_uri", "national_phone_number", "fetched_via", "first_fetched_at",
  "last_detail_refresh", "refresh_failures", "is_active", "created_at", "updated_at",
  "city_id", "country", "country_code", "city", "utc_offset_minutes",
  "editorial_summary", "generative_summary", "is_claimed", "claimed_by",
  "serves_brunch", "serves_lunch", "serves_dinner", "serves_breakfast", "serves_beer",
  "serves_wine", "serves_cocktails", "serves_coffee", "serves_dessert",
  "serves_vegetarian_food", "outdoor_seating", "live_music", "good_for_groups",
  "good_for_children", "good_for_watching_sports", "allows_dogs", "has_restroom",
  "reservable", "menu_for_children", "dine_in", "takeout", "delivery",
  "curbside_pickup", "accessibility_options", "parking_options", "payment_options",
  "business_status", "is_servable", "bouncer_reason", "bouncer_validated_at",
  "passes_pre_photo_check", "pre_photo_bouncer_reason",
  "pre_photo_bouncer_validated_at", "photo_aesthetic_data", "photo_collage_url",
  "photo_collage_fingerprint", "thumbs_backfilled_at", "ai_signal_scores",
  "ai_signal_scores_veto", "deleted_at", "deleted_reason",
];

export const PLACE_LIST_COLUMNS = [...PLACE_LIST_COLUMN_NAMES, CATEGORY_SELECT].join(", ");

/**
 * Exact counts scan every matching row. "estimated" is exact for small results
 * and uses the planner beyond that, so a large city's list cannot time out on the
 * count alone. Totals on these pages can be approximate.
 */
export const PLACE_LIST_COUNT_MODE = "estimated";

/** The message for an `admin_deactivate_place` answer, or null when it worked. */
export function adminDeactivateError(result) {
  if (result?.error) return result.error.message ?? String(result.error);
  // The RPC reports "already inactive" as data, not as an error.
  if (result?.data?.error) return String(result.data.error);
  return null;
}
