-- ORCH-0700 Phase 3B — Helper canonical taxonomy fix
--
-- REPLACES the prior pg_map_primary_type_to_mingla_category helper (Migration 1
-- of ORCH-0700, applied 2026-05-03 ~earlier today) which returned an INVENTED
-- 11-slug taxonomy (brunch+casual_food split, movies+theatre split, no
-- groceries — grocery types absorbed into flowers). That taxonomy matched
-- nothing else in the codebase. Admin Place Pool dashboard rendered 0 for
-- Brunch+Lunch+Casual, Movies+Theatre, Groceries because no row in the
-- matview's primary_category column held those canonical slugs.
--
-- This migration:
--   1. CREATE OR REPLACE the helper to return the canonical 10-slug taxonomy
--      defined by DISPLAY_TO_SLUG in supabase/functions/_shared/categoryPlaceTypes.ts
--   2. REFRESH MATERIALIZED VIEW admin_place_pool_mv (re-derives all ~70K rows)
--   3. Self-verify probes (16 input/output pairs + canonical-set membership)
--   4. Post-refresh probe asserting matview contains ONLY canonical slugs ∪ {uncategorized}
--
-- Reference:
--   ORCH-0700 Phase 3B spec (Mingla_Artifacts/specs/SPEC_ORCH-0700_PHASE_3B_HELPER_TAXONOMY_FIX.md)
--   INVESTIGATION_CATEGORY_PIPELINE_END_TO_END.md
--   INVESTIGATION_ORCH-0700_PHASE_3_TAXONOMY_REGRESSION.md

BEGIN;

-- ── Step 1: Replace helper with canonical-taxonomy version ──
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
  -- Try primary_type first (single match)
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
      -- Movies & Theatre (slug 'movies_theatre') — combines former 'movies' + 'theatre' helper buckets
      WHEN p_primary_type IN ('movie_theater','drive_in',
                              'performing_arts_theater','opera_house','auditorium','amphitheatre','concert_hall')
        THEN 'movies_theatre'
      -- Brunch, Lunch & Casual (slug 'brunch_lunch_casual') — combines former 'brunch' + 'casual_food' helper buckets
      WHEN p_primary_type IN ('american_restaurant','bistro','gastropub','diner',
                              'mexican_restaurant','thai_restaurant','pizza_restaurant','sandwich_shop',
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
        THEN 'brunch_lunch_casual'
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
      -- Groceries (slug 'groceries') — MUST come BEFORE 'flowers' since grocery_store + supermarket
      -- belong here per canonical taxonomy. Flowers is florist-only.
      WHEN p_primary_type IN ('grocery_store','supermarket')
        THEN 'groceries'
      -- Flowers (slug 'flowers') — florist ONLY (no grocery absorption)
      WHEN p_primary_type = 'florist'
        THEN 'flowers'
      ELSE NULL
    END;

    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
  END IF;

  -- Fallback: scan types[] in order, return first match.
  -- Recursion safe because depth is bounded by types[] length and IMMUTABLE
  -- marker prevents planner re-entry.
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
  'ORCH-0700 Phase 3B (2026-05-03): Returns Mingla canonical category slug per DISPLAY_TO_SLUG '
  'in supabase/functions/_shared/categoryPlaceTypes.ts. Returns NULL when no match (Constitution #9 — '
  'never fabricate). Output is always within the canonical 10-slug set: nature, icebreakers, '
  'drinks_and_music, brunch_lunch_casual, upscale_fine_dining, movies_theatre, creative_arts, '
  'play, flowers, groceries. WARNING: keep in sync with _shared/derivePoolCategory.ts (TS twin) '
  'and DISPLAY_TO_SLUG (canonical authority). Future ORCH should auto-generate all three from '
  'a single source of truth. Used by admin_place_pool_mv.primary_category derivation + admin RPCs.';

-- ── Step 2: Self-verify probes (RAISE EXCEPTION on regression) ──
DO $$
DECLARE
  v_test text;
BEGIN
  -- Movies & Theatre (combined slug)
  v_test := public.pg_map_primary_type_to_mingla_category('movie_theater', NULL);
  IF v_test IS DISTINCT FROM 'movies_theatre' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-01: movie_theater expected ''movies_theatre'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('performing_arts_theater', NULL);
  IF v_test IS DISTINCT FROM 'movies_theatre' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-02: performing_arts_theater expected ''movies_theatre'', got ''%''', v_test;
  END IF;

  -- Brunch, Lunch & Casual (combined slug)
  v_test := public.pg_map_primary_type_to_mingla_category('italian_restaurant', NULL);
  IF v_test IS DISTINCT FROM 'brunch_lunch_casual' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-03: italian_restaurant expected ''brunch_lunch_casual'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('american_restaurant', NULL);
  IF v_test IS DISTINCT FROM 'brunch_lunch_casual' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-04: american_restaurant expected ''brunch_lunch_casual'', got ''%''', v_test;
  END IF;

  -- Upscale & Fine Dining
  v_test := public.pg_map_primary_type_to_mingla_category('fine_dining_restaurant', NULL);
  IF v_test IS DISTINCT FROM 'upscale_fine_dining' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-05: fine_dining_restaurant expected ''upscale_fine_dining'', got ''%''', v_test;
  END IF;

  -- Groceries (NEW — separate from flowers, must precede in CASE order)
  v_test := public.pg_map_primary_type_to_mingla_category('grocery_store', NULL);
  IF v_test IS DISTINCT FROM 'groceries' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-06: grocery_store expected ''groceries'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('supermarket', NULL);
  IF v_test IS DISTINCT FROM 'groceries' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-07: supermarket expected ''groceries'', got ''%''', v_test;
  END IF;

  -- Flowers (florist ONLY — grocery types now route to groceries)
  v_test := public.pg_map_primary_type_to_mingla_category('florist', NULL);
  IF v_test IS DISTINCT FROM 'flowers' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-08: florist expected ''flowers'', got ''%''', v_test;
  END IF;

  -- Other unchanged categories (regression backstop)
  v_test := public.pg_map_primary_type_to_mingla_category('park', NULL);
  IF v_test IS DISTINCT FROM 'nature' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-09: park expected ''nature'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('cafe', NULL);
  IF v_test IS DISTINCT FROM 'icebreakers' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-10: cafe expected ''icebreakers'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('bar', NULL);
  IF v_test IS DISTINCT FROM 'drinks_and_music' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-11: bar expected ''drinks_and_music'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('art_studio', NULL);
  IF v_test IS DISTINCT FROM 'creative_arts' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-12: art_studio expected ''creative_arts'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('amusement_park', NULL);
  IF v_test IS DISTINCT FROM 'play' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-13: amusement_park expected ''play'', got ''%''', v_test;
  END IF;

  -- Unknown type → NULL (no fabrication, Constitution #9)
  v_test := public.pg_map_primary_type_to_mingla_category('xyz_unknown', NULL);
  IF v_test IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-14: xyz_unknown expected NULL, got ''%''', v_test;
  END IF;

  -- types[] fallback
  v_test := public.pg_map_primary_type_to_mingla_category(NULL, ARRAY['unknown_x','movie_theater']);
  IF v_test IS DISTINCT FROM 'movies_theatre' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-15: types[] fallback expected ''movies_theatre'', got ''%''', v_test;
  END IF;

  -- All-NULL inputs → NULL
  v_test := public.pg_map_primary_type_to_mingla_category(NULL, NULL);
  IF v_test IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-16: NULL inputs expected NULL, got ''%''', v_test;
  END IF;

  RAISE NOTICE 'Phase 3B helper self-verify: 16/16 probes PASSED';
END $$;

-- ── Step 3: Refresh matview to re-derive primary_category for all rows ──
-- Non-CONCURRENTLY is acceptable: rebuild on ~70K rows takes seconds; cron job 13
-- collision risk is one delayed tick (per prior LANDMINE_AUDIT analysis).
REFRESH MATERIALIZED VIEW public.admin_place_pool_mv;

-- ── Step 4: Post-refresh assertion — matview MUST contain only canonical slugs ──
DO $$
DECLARE
  v_offending_count INTEGER;
  v_offending_slugs TEXT[];
BEGIN
  -- Sample any rows whose primary_category is not in canonical set ∪ {uncategorized}
  SELECT COUNT(*), ARRAY(
    SELECT DISTINCT primary_category FROM admin_place_pool_mv
    WHERE primary_category IS NOT NULL
      AND primary_category NOT IN (
        'nature','icebreakers','drinks_and_music','brunch_lunch_casual',
        'upscale_fine_dining','movies_theatre','creative_arts','play',
        'flowers','groceries','uncategorized'
      )
  ) INTO v_offending_count, v_offending_slugs
  FROM admin_place_pool_mv
  WHERE primary_category IS NOT NULL
    AND primary_category NOT IN (
      'nature','icebreakers','drinks_and_music','brunch_lunch_casual',
      'upscale_fine_dining','movies_theatre','creative_arts','play',
      'flowers','groceries','uncategorized'
    );
  IF v_offending_count > 0 THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL: matview holds % rows with non-canonical slug(s): %',
      v_offending_count, v_offending_slugs;
  END IF;

  -- Sanity: confirm at least 3 of the previously-broken canonical slugs now exist
  IF NOT EXISTS (SELECT 1 FROM admin_place_pool_mv WHERE primary_category = 'brunch_lunch_casual' LIMIT 1) THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL: zero rows with primary_category=''brunch_lunch_casual'' post-refresh — regression';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_place_pool_mv WHERE primary_category = 'movies_theatre' LIMIT 1) THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL: zero rows with primary_category=''movies_theatre'' post-refresh — regression';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_place_pool_mv WHERE primary_category = 'groceries' LIMIT 1) THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL: zero rows with primary_category=''groceries'' post-refresh — regression';
  END IF;

  RAISE NOTICE 'Phase 3B matview post-refresh verify: PASSED (all primary_category values canonical, 3 previously-broken slugs now present)';
END $$;

COMMIT;
