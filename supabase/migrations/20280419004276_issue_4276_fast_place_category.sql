-- Issue #4276 (fix b): a place's category is cheap to read at production scale.
--
-- Browse, Map and the Excluded list read a place's category through the PostgREST
-- computed column place_pool_derived_category(place_pool). In production it cost about
-- 1.5 ms a row and was worked out for every candidate row before the sort and limit:
-- London's 15,551 rows took 23.5 s against the admin's 8 s timeout. Two causes:
--
--   1. The computed column carried SET search_path, and PostgreSQL never inlines a
--      function with a SET clause. So every row built the whole place_pool row (about
--      29 KB once raw_google_data, reviews and photos are unpacked) to pass it in.
--   2. pg_map_primary_type_to_mingla_category was plpgsql, re-running a 146-entry CASE
--      once for primary_type and again, recursively, for each entry of types.
--
-- Now the mapping is a constant lookup table (pg_mingla_category_type_map) read by a
-- plain SQL pg_map_primary_type_to_mingla_category, and the computed column is an
-- inlinable SQL wrapper. The planner folds the table once per query and reads only
-- primary_type and types. The answers are the same for every input: the pg17 test
-- compares the new function with the old plpgsql body for every type and mixed arrays.
--
-- pg_map_primary_type_to_mingla_category stays the one place that maps a Google type
-- to a Mingla category; pg_mingla_category_type_map is its table and has no other
-- reader. Rule kept from the baseline: primary_type wins when it maps; otherwise the
-- first entry of types, in order, that maps; otherwise null.
--
-- Indexes for the admin lists (all partial on active places, as the lists are):
--   * newest first, all cities and per city (Browse's default order);
--   * category then newest, all cities and per city, for the category filter and sort;
--   * name for the Excluded list, which sorts by name.
--
-- No column is added to place_pool. Static SQL only.
--
-- Rollback: restore pg_map_primary_type_to_mingla_category from
-- 20260505000000_baseline_squash_orch_0729.sql and place_pool_derived_category from
-- 20280410014276_issue_4276_place_merge_and_review_state.sql, then drop the five
-- place_pool_admin_* indexes and pg_mingla_category_type_map().

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_mingla_category_type_map()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT '{
    "beach": "nature",
    "botanical_garden": "nature",
    "garden": "nature",
    "hiking_area": "nature",
    "national_park": "nature",
    "nature_preserve": "nature",
    "park": "nature",
    "scenic_spot": "nature",
    "state_park": "nature",
    "observation_deck": "nature",
    "tourist_attraction": "nature",
    "picnic_ground": "nature",
    "vineyard": "nature",
    "wildlife_park": "nature",
    "wildlife_refuge": "nature",
    "woods": "nature",
    "mountain_peak": "nature",
    "river": "nature",
    "island": "nature",
    "city_park": "nature",
    "fountain": "nature",
    "lake": "nature",
    "marina": "nature",
    "cafe": "icebreakers",
    "bowling_alley": "icebreakers",
    "coffee_shop": "icebreakers",
    "miniature_golf_course": "icebreakers",
    "art_gallery": "icebreakers",
    "tea_house": "icebreakers",
    "video_arcade": "icebreakers",
    "museum": "icebreakers",
    "book_store": "icebreakers",
    "amusement_center": "icebreakers",
    "bakery": "icebreakers",
    "go_karting_venue": "icebreakers",
    "cultural_center": "icebreakers",
    "dessert_shop": "icebreakers",
    "karaoke": "icebreakers",
    "plaza": "icebreakers",
    "ice_cream_shop": "icebreakers",
    "comedy_club": "icebreakers",
    "art_museum": "icebreakers",
    "juice_shop": "icebreakers",
    "paintball_center": "icebreakers",
    "donut_shop": "icebreakers",
    "dance_hall": "icebreakers",
    "breakfast_restaurant": "icebreakers",
    "brunch_restaurant": "icebreakers",
    "bar": "drinks_and_music",
    "cocktail_bar": "drinks_and_music",
    "wine_bar": "drinks_and_music",
    "brewery": "drinks_and_music",
    "pub": "drinks_and_music",
    "beer_garden": "drinks_and_music",
    "brewpub": "drinks_and_music",
    "lounge_bar": "drinks_and_music",
    "night_club": "drinks_and_music",
    "live_music_venue": "drinks_and_music",
    "coffee_roastery": "drinks_and_music",
    "coffee_stand": "drinks_and_music",
    "movie_theater": "movies_theatre",
    "drive_in": "movies_theatre",
    "performing_arts_theater": "movies_theatre",
    "opera_house": "movies_theatre",
    "auditorium": "movies_theatre",
    "amphitheatre": "movies_theatre",
    "concert_hall": "movies_theatre",
    "american_restaurant": "brunch_lunch_casual",
    "bistro": "brunch_lunch_casual",
    "gastropub": "brunch_lunch_casual",
    "diner": "brunch_lunch_casual",
    "mexican_restaurant": "brunch_lunch_casual",
    "thai_restaurant": "brunch_lunch_casual",
    "pizza_restaurant": "brunch_lunch_casual",
    "sandwich_shop": "brunch_lunch_casual",
    "mediterranean_restaurant": "brunch_lunch_casual",
    "indian_restaurant": "brunch_lunch_casual",
    "chinese_restaurant": "brunch_lunch_casual",
    "vietnamese_restaurant": "brunch_lunch_casual",
    "korean_restaurant": "brunch_lunch_casual",
    "japanese_restaurant": "brunch_lunch_casual",
    "lebanese_restaurant": "brunch_lunch_casual",
    "greek_restaurant": "brunch_lunch_casual",
    "italian_restaurant": "brunch_lunch_casual",
    "ramen_restaurant": "brunch_lunch_casual",
    "noodle_shop": "brunch_lunch_casual",
    "hamburger_restaurant": "brunch_lunch_casual",
    "deli": "brunch_lunch_casual",
    "barbecue_restaurant": "brunch_lunch_casual",
    "seafood_restaurant": "brunch_lunch_casual",
    "vegan_restaurant": "brunch_lunch_casual",
    "vegetarian_restaurant": "brunch_lunch_casual",
    "turkish_restaurant": "brunch_lunch_casual",
    "spanish_restaurant": "brunch_lunch_casual",
    "french_restaurant": "brunch_lunch_casual",
    "sushi_restaurant": "brunch_lunch_casual",
    "buffet_restaurant": "brunch_lunch_casual",
    "food_court": "brunch_lunch_casual",
    "afghani_restaurant": "brunch_lunch_casual",
    "african_restaurant": "brunch_lunch_casual",
    "asian_restaurant": "brunch_lunch_casual",
    "brazilian_restaurant": "brunch_lunch_casual",
    "indonesian_restaurant": "brunch_lunch_casual",
    "middle_eastern_restaurant": "brunch_lunch_casual",
    "hot_pot_restaurant": "brunch_lunch_casual",
    "dim_sum_restaurant": "brunch_lunch_casual",
    "argentinian_restaurant": "brunch_lunch_casual",
    "basque_restaurant": "brunch_lunch_casual",
    "persian_restaurant": "brunch_lunch_casual",
    "scandinavian_restaurant": "brunch_lunch_casual",
    "filipino_restaurant": "brunch_lunch_casual",
    "soul_food_restaurant": "brunch_lunch_casual",
    "cuban_restaurant": "brunch_lunch_casual",
    "hawaiian_restaurant": "brunch_lunch_casual",
    "ethiopian_restaurant": "brunch_lunch_casual",
    "moroccan_restaurant": "brunch_lunch_casual",
    "peruvian_restaurant": "brunch_lunch_casual",
    "cajun_restaurant": "brunch_lunch_casual",
    "fusion_restaurant": "brunch_lunch_casual",
    "korean_barbecue_restaurant": "brunch_lunch_casual",
    "tapas_restaurant": "brunch_lunch_casual",
    "fine_dining_restaurant": "upscale_fine_dining",
    "steak_house": "upscale_fine_dining",
    "oyster_bar_restaurant": "upscale_fine_dining",
    "fondue_restaurant": "upscale_fine_dining",
    "swiss_restaurant": "upscale_fine_dining",
    "european_restaurant": "upscale_fine_dining",
    "australian_restaurant": "upscale_fine_dining",
    "british_restaurant": "upscale_fine_dining",
    "art_studio": "creative_arts",
    "history_museum": "creative_arts",
    "sculpture": "creative_arts",
    "cultural_landmark": "creative_arts",
    "amusement_park": "play",
    "roller_coaster": "play",
    "water_park": "play",
    "ferris_wheel": "play",
    "casino": "play",
    "planetarium": "play",
    "golf_course": "play",
    "indoor_golf_course": "play",
    "adventure_sports_center": "play",
    "ice_skating_rink": "play",
    "grocery_store": "groceries",
    "supermarket": "groceries",
    "florist": "flowers"
  }'::jsonb;
$$;

COMMENT ON FUNCTION public.pg_mingla_category_type_map() IS
  'Issue #4276: Google place type to Mingla category slug. Read only by '
  'pg_map_primary_type_to_mingla_category; change the mapping here.';

CREATE OR REPLACE FUNCTION public.pg_map_primary_type_to_mingla_category(p_primary_type text, p_types text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    public.pg_mingla_category_type_map() ->> p_primary_type,
    (SELECT public.pg_mingla_category_type_map() ->> u.type_name
       FROM unnest(p_types) WITH ORDINALITY AS u(type_name, position)
      WHERE public.pg_mingla_category_type_map() ? u.type_name
      ORDER BY u.position
      LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.pg_map_primary_type_to_mingla_category(text, text[]) IS
  'The one mapping from Google types to a Mingla category: primary_type when it maps, '
  'else the first entry of types that maps, else null. Issue #4276 made it a SQL '
  'lookup so list queries and indexes can use it at production scale.';

-- No SET clause: PostgreSQL inlines this, so a list reads primary_type and types
-- instead of building the whole row. Every reference inside is schema-qualified.
CREATE OR REPLACE FUNCTION public.place_pool_derived_category(p_place public.place_pool)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.pg_map_primary_type_to_mingla_category(p_place.primary_type, p_place.types);
$$;

REVOKE ALL ON FUNCTION public.place_pool_derived_category(public.place_pool) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_pool_derived_category(public.place_pool) TO authenticated, service_role;

COMMENT ON FUNCTION public.place_pool_derived_category(public.place_pool) IS
  'Issue #4276: PostgREST computed column over pg_map_primary_type_to_mingla_category. '
  'Kept free of SET clauses so it inlines; see 20280419004276.';

CREATE INDEX IF NOT EXISTS place_pool_admin_newest_idx
  ON public.place_pool (created_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS place_pool_admin_city_newest_idx
  ON public.place_pool (city_id, created_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS place_pool_admin_category_newest_idx
  ON public.place_pool (public.pg_map_primary_type_to_mingla_category(primary_type, types), created_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS place_pool_admin_city_category_newest_idx
  ON public.place_pool (city_id, public.pg_map_primary_type_to_mingla_category(primary_type, types), created_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS place_pool_admin_excluded_name_idx
  ON public.place_pool (name)
  WHERE is_active = true AND is_servable = false;

NOTIFY pgrst, 'reload schema';

COMMIT;
