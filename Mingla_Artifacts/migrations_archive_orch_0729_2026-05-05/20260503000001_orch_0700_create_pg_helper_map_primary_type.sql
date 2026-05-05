-- ORCH-0700 Phase 2.A — SQL helper function for category derivation
--
-- Mirrors the TypeScript `mapPrimaryTypeToMinglaCategory` in
-- `supabase/functions/_shared/categoryPlaceTypes.ts`. Returns the Mingla
-- category slug for a Google primary_type + types[] array. NULL when no match.
--
-- "First-write-wins" rule: a type is claimed by the first category whose
-- place-type list contains it (matching MINGLA_CATEGORY_PLACE_TYPES iteration
-- order in the TS source).
--
-- Used by admin RPCs to derive category server-side after `seeding_category` +
-- `ai_categories` are dropped (per ORCH-0700 + ORCH-0707 column drops).
--
-- WARNING: this function MUST stay in sync with the TS source. A future ORCH
-- should auto-generate this from the TS module. For now, hand-mirror with care.
--
-- Reference:
--   ORCH-0700 spec §3.A.A2
--   Mingla_Artifacts/specs/SPEC_ORCH-0700_MOVIES_CINEMAS_ONLY_AND_PARTIAL_DECOMMISSION.md

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_map_primary_type_to_mingla_category(
  p_primary_type text,
  p_types text[]
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $func$
DECLARE
  v_type text;
  v_result text;
BEGIN
  -- Try primary_type first
  IF p_primary_type IS NOT NULL THEN
    v_result := CASE
      -- Nature & Views (slug 'nature')
      WHEN p_primary_type IN ('beach','botanical_garden','garden','hiking_area','national_park',
                              'nature_preserve','park','scenic_spot','state_park','observation_deck',
                              'tourist_attraction','picnic_ground','vineyard','wildlife_park','wildlife_refuge',
                              'woods','mountain_peak','river','island','city_park','fountain','lake','marina')
        THEN 'nature'
      -- Icebreakers (slug 'icebreakers')
      WHEN p_primary_type IN ('cafe','bowling_alley','coffee_shop','miniature_golf_course','art_gallery',
                              'tea_house','video_arcade','museum','book_store','amusement_center',
                              'bakery','go_karting_venue','cultural_center','dessert_shop','karaoke',
                              'plaza','ice_cream_shop','comedy_club','art_museum','juice_shop',
                              'paintball_center','donut_shop','dance_hall','breakfast_restaurant','brunch_restaurant')
        THEN 'icebreakers'
      -- Drinks & Music (slug 'drinks_and_music')
      WHEN p_primary_type IN ('bar','cocktail_bar','wine_bar','brewery','pub','beer_garden','brewpub',
                              'lounge_bar','night_club','live_music_venue','coffee_roastery','coffee_stand')
        THEN 'drinks_and_music'
      -- Movies (slug 'movies')
      WHEN p_primary_type IN ('movie_theater','drive_in')
        THEN 'movies'
      -- Theatre (slug 'theatre')
      WHEN p_primary_type IN ('performing_arts_theater','opera_house','auditorium','amphitheatre','concert_hall')
        THEN 'theatre'
      -- Brunch (slug 'brunch')
      WHEN p_primary_type IN ('american_restaurant','bistro','gastropub','diner')
        THEN 'brunch'
      -- Casual (slug 'casual_food')
      WHEN p_primary_type IN ('mexican_restaurant','thai_restaurant','pizza_restaurant','sandwich_shop',
                              'mediterranean_restaurant','indian_restaurant','chinese_restaurant',
                              'vietnamese_restaurant','korean_restaurant','japanese_restaurant',
                              'lebanese_restaurant','greek_restaurant','italian_restaurant',
                              'ramen_restaurant','noodle_shop','hamburger_restaurant','deli',
                              'barbecue_restaurant','seafood_restaurant','vegan_restaurant',
                              'vegetarian_restaurant','turkish_restaurant','spanish_restaurant',
                              'french_restaurant','sushi_restaurant','buffet_restaurant','food_court',
                              'afghani_restaurant','african_restaurant','asian_restaurant',
                              'brazilian_restaurant','indonesian_restaurant','middle_eastern_restaurant',
                              'hot_pot_restaurant','dim_sum_restaurant','argentinian_restaurant',
                              'basque_restaurant','persian_restaurant','scandinavian_restaurant',
                              'filipino_restaurant','soul_food_restaurant','cuban_restaurant',
                              'hawaiian_restaurant','ethiopian_restaurant','moroccan_restaurant',
                              'peruvian_restaurant','cajun_restaurant','fusion_restaurant',
                              'korean_barbecue_restaurant','tapas_restaurant')
        THEN 'casual_food'
      -- Upscale & Fine Dining (slug 'upscale_fine_dining')
      WHEN p_primary_type IN ('fine_dining_restaurant','steak_house','oyster_bar_restaurant',
                              'fondue_restaurant','swiss_restaurant','european_restaurant',
                              'australian_restaurant','british_restaurant')
        THEN 'upscale_fine_dining'
      -- Creative & Arts (slug 'creative_arts')
      WHEN p_primary_type IN ('art_studio','history_museum','sculpture','cultural_landmark')
        THEN 'creative_arts'
      -- Play (slug 'play')
      WHEN p_primary_type IN ('amusement_park','roller_coaster','water_park','ferris_wheel',
                              'casino','planetarium','golf_course','indoor_golf_course',
                              'adventure_sports_center','ice_skating_rink')
        THEN 'play'
      -- Flowers (slug 'flowers')
      WHEN p_primary_type IN ('florist','grocery_store','supermarket')
        THEN 'flowers'
      ELSE NULL
    END;

    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
  END IF;

  -- Fallback: scan types[] in order, return first match.
  -- Use the same CASE expression by recursing on each element. Recursion safe
  -- because depth is bounded by types[] length and IMMUTABLE marker prevents
  -- planner re-entry.
  IF p_types IS NOT NULL THEN
    FOREACH v_type IN ARRAY p_types LOOP
      v_result := public.pg_map_primary_type_to_mingla_category(v_type, NULL);
      IF v_result IS NOT NULL THEN
        RETURN v_result;
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$func$;

COMMENT ON FUNCTION public.pg_map_primary_type_to_mingla_category(text, text[]) IS
  'ORCH-0700: Mirrors mapPrimaryTypeToMinglaCategory in supabase/functions/_shared/categoryPlaceTypes.ts. '
  'Returns Mingla category slug for a Google primary_type + types[]. NULL when no match. '
  'First-write-wins: a type is claimed by the first category whose place-type list contains it. '
  'WARNING: hand-mirrored from TS source. Future ORCH should auto-generate this from the TS module. '
  'Used by admin RPCs to derive category server-side after seeding_category + ai_categories columns dropped.';

-- Self-verification probes (RAISE EXCEPTION on regression)
DO $$
DECLARE
  v_test text;
BEGIN
  -- Cinema → movies
  v_test := public.pg_map_primary_type_to_mingla_category('movie_theater', NULL);
  IF v_test IS DISTINCT FROM 'movies' THEN
    RAISE EXCEPTION 'pg_map test FAIL: movie_theater expected ''movies'', got ''%''', v_test;
  END IF;

  -- Theatre → theatre
  v_test := public.pg_map_primary_type_to_mingla_category('performing_arts_theater', NULL);
  IF v_test IS DISTINCT FROM 'theatre' THEN
    RAISE EXCEPTION 'pg_map test FAIL: performing_arts_theater expected ''theatre'', got ''%''', v_test;
  END IF;

  -- Cuisine → casual_food
  v_test := public.pg_map_primary_type_to_mingla_category('italian_restaurant', NULL);
  IF v_test IS DISTINCT FROM 'casual_food' THEN
    RAISE EXCEPTION 'pg_map test FAIL: italian_restaurant expected ''casual_food'', got ''%''', v_test;
  END IF;

  -- Upscale → upscale_fine_dining
  v_test := public.pg_map_primary_type_to_mingla_category('fine_dining_restaurant', NULL);
  IF v_test IS DISTINCT FROM 'upscale_fine_dining' THEN
    RAISE EXCEPTION 'pg_map test FAIL: fine_dining_restaurant expected ''upscale_fine_dining'', got ''%''', v_test;
  END IF;

  -- Brunch → brunch
  v_test := public.pg_map_primary_type_to_mingla_category('american_restaurant', NULL);
  IF v_test IS DISTINCT FROM 'brunch' THEN
    RAISE EXCEPTION 'pg_map test FAIL: american_restaurant expected ''brunch'', got ''%''', v_test;
  END IF;

  -- Fallback to types[] when primary is null
  v_test := public.pg_map_primary_type_to_mingla_category(NULL, ARRAY['unknown_x', 'movie_theater']);
  IF v_test IS DISTINCT FROM 'movies' THEN
    RAISE EXCEPTION 'pg_map test FAIL: types[] fallback expected ''movies'', got ''%''', v_test;
  END IF;

  -- Unknown → NULL (no fabrication, Constitution #9)
  v_test := public.pg_map_primary_type_to_mingla_category('xyz_unknown', NULL);
  IF v_test IS NOT NULL THEN
    RAISE EXCEPTION 'pg_map test FAIL: unknown type expected NULL, got ''%''', v_test;
  END IF;

  -- All-null inputs → NULL
  v_test := public.pg_map_primary_type_to_mingla_category(NULL, NULL);
  IF v_test IS NOT NULL THEN
    RAISE EXCEPTION 'pg_map test FAIL: NULL inputs expected NULL, got ''%''', v_test;
  END IF;
END $$;

COMMIT;
