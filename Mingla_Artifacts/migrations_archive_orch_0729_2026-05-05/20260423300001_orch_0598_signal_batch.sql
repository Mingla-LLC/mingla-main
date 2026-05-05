-- ORCH-0598 (Slice 6) — batch seed 5 type-grounded signals + cohort flags + user pref migration.
--
-- Idempotent: upserts + array-safe rewrites.
--
-- Impact baseline (MCP 2026-04-21 ~13:30 UTC):
--   - 2 users have 'movies_theatre' in categories
--   - 1 user has 'Movies & Theatre' in display_categories
--   - 0 users have pre-existing 'movies' or 'theatre'
--
-- Signals seeded (5): nature, play, creative_arts, movies, theatre
--
-- Paper-sim anchors (Raleigh):
--   nature    — universe 279 / high-quality 131 — Pullen Park, Lake Johnson, JC Raulston, Umstead
--   play      — universe 41  / high-quality 35  — Frankie's, Boxcar, DEFY, Bowlero, Sky Zone
--   creative_arts — universe 59 / high-quality 36 — NCMA West Building, Spin Art Nation, Pinot's Palette
--   movies    — universe 7   / high-quality 5   — Alamo Drafthouse, Regal Brier Creek, Marbles IMAX
--   theatre   — universe 15  / high-quality 14  — Meymandi, Martin Marietta, Raleigh Memorial Auditorium
--
-- See: outputs/SPEC_ORCH-0598_SIGNAL_BATCH_NATURE_PLAY_CREATIVE_MOVIES_THEATRE.md

-- ── 5 signal_definitions rows ─────────────────────────────────────────────
INSERT INTO public.signal_definitions (id, label, kind, is_active)
VALUES
  ('nature',         'Nature',           'type-grounded', true),
  ('play',           'Play',             'type-grounded', true),
  ('creative_arts',  'Creative & Arts',  'type-grounded', true),
  ('movies',         'Movies',           'type-grounded', true),
  ('theatre',        'Theatre',          'type-grounded', true)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, kind = EXCLUDED.kind, is_active = EXCLUDED.is_active,
  updated_at = now();

-- ── Signal config v1.0.0 for each ─────────────────────────────────────────

-- NATURE v1.0.0 — park-iconic, exclude restaurants/stores/gyms
WITH new_version AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES ('nature', 'v1.0.0', $json${
    "cap": 200,
    "scale": {
      "rating_cap": 35,
      "reviews_cap": 25,
      "rating_multiplier": 10,
      "reviews_log_multiplier": 5
    },
    "clamp_min": 0,
    "min_rating": 4.0,
    "min_reviews": 50,
    "bypass_rating": 4.6,
    "field_weights": {
      "types_includes_park": 40,
      "types_includes_national_park": 50,
      "types_includes_state_park": 50,
      "types_includes_botanical_garden": 45,
      "types_includes_hiking_area": 40,
      "types_includes_garden": 30,
      "types_includes_nature_preserve": 40,
      "types_includes_wildlife_park": 35,
      "types_includes_wildlife_refuge": 35,
      "types_includes_scenic_spot": 30,
      "types_includes_lake": 25,
      "types_includes_river": 20,
      "types_includes_beach": 30,
      "types_includes_picnic_ground": 15,
      "types_includes_city_park": 35,
      "types_includes_marina": 15,
      "types_includes_restaurant": -80,
      "types_includes_bar": -80,
      "types_includes_grocery_store": -80,
      "types_includes_supermarket": -80,
      "types_includes_gym": -80,
      "types_includes_fitness_center": -80,
      "types_includes_store": -60,
      "types_includes_shopping_mall": -80,
      "types_includes_movie_theater": -60,
      "types_includes_fast_food_restaurant": -80
    },
    "text_patterns": {
      "summary_regex": "park|garden|trail|scenic|nature|outdoor|wildlife|lake|hiking|preserve|woods|waterfall|meadow",
      "summary_weight": 25,
      "reviews_regex": "trail|path|scenic|walk|hike|nature|beautiful|peaceful|wildlife|fresh air",
      "reviews_weight": 15,
      "atmosphere_regex": "peaceful|serene|quiet|green|lush|natural",
      "atmosphere_weight": 10
    }
  }$json$::jsonb,
  'ORCH-0598 Slice 6 nature first-pass. Top anchors: Pullen Park (9495), Lake Johnson (4940), JC Raulston (2906), Umstead (2524), Dix Park (2096).')
  RETURNING id, signal_id
)
UPDATE public.signal_definitions sd SET current_version_id = nv.id
FROM new_version nv WHERE sd.id = nv.signal_id;

-- PLAY v1.0.0 — activity-focused, exclude food-as-primary
WITH new_version AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES ('play', 'v1.0.0', $json${
    "cap": 200,
    "scale": {
      "rating_cap": 35,
      "reviews_cap": 25,
      "rating_multiplier": 10,
      "reviews_log_multiplier": 5
    },
    "clamp_min": 0,
    "min_rating": 4.0,
    "min_reviews": 50,
    "bypass_rating": 4.6,
    "field_weights": {
      "types_includes_bowling_alley": 50,
      "types_includes_amusement_center": 45,
      "types_includes_amusement_park": 40,
      "types_includes_video_arcade": 50,
      "types_includes_go_karting_venue": 50,
      "types_includes_miniature_golf_course": 45,
      "types_includes_karaoke": 35,
      "types_includes_dance_hall": 30,
      "types_includes_skateboard_park": 30,
      "types_includes_ice_skating_rink": 40,
      "types_includes_water_park": 45,
      "types_includes_indoor_playground": 25,
      "types_includes_paintball_center": 45,
      "types_includes_escape_room": 50,
      "types_includes_laser_tag_center": 45,
      "types_includes_casino": 30,
      "types_includes_roller_coaster": 40,
      "types_includes_ferris_wheel": 35,
      "types_includes_restaurant": -60,
      "types_includes_bar": -60,
      "types_includes_sports_bar": -60,
      "types_includes_american_restaurant": -60,
      "types_includes_art_studio": -40,
      "types_includes_movie_theater": -30,
      "types_includes_performing_arts_theater": -30,
      "types_includes_grocery_store": -80,
      "good_for_groups": 15,
      "good_for_children": 5
    },
    "text_patterns": {
      "summary_regex": "bowl|arcade|karaoke|skate|mini.?golf|escape room|amusement|paintball|laser.?tag|trampoline|go.?kart|rollercoaster|ferris wheel",
      "summary_weight": 30,
      "reviews_regex": "fun|games|arcade|bowling|karaoke|trampoline|amusement|exciting|kid friendly|family",
      "reviews_weight": 15,
      "atmosphere_regex": "fun|lively|energetic|exciting|playful",
      "atmosphere_weight": 10
    }
  }$json$::jsonb,
  'ORCH-0598 Slice 6 play first-pass. Top anchors: Frankies (8148), Boxcar Arcade (3992), All In Escape (3660), DEFY (2127), Bowlero (1529), Nerd Escape (1247), Sky Zone (1155).')
  RETURNING id, signal_id
)
UPDATE public.signal_definitions sd SET current_version_id = nv.id
FROM new_version nv WHERE sd.id = nv.signal_id;

-- CREATIVE_ARTS v1.0.0 — art + culture minus theatre; exclude nail salons + farms
WITH new_version AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES ('creative_arts', 'v1.0.0', $json${
    "cap": 200,
    "scale": {
      "rating_cap": 35,
      "reviews_cap": 25,
      "rating_multiplier": 10,
      "reviews_log_multiplier": 5
    },
    "clamp_min": 0,
    "min_rating": 4.0,
    "min_reviews": 30,
    "bypass_rating": 4.5,
    "field_weights": {
      "types_includes_art_museum": 60,
      "types_includes_museum": 50,
      "types_includes_art_gallery": 45,
      "types_includes_history_museum": 45,
      "types_includes_cultural_center": 40,
      "types_includes_cultural_landmark": 35,
      "types_includes_art_studio": 40,
      "types_includes_sculpture": 30,
      "types_includes_historical_landmark": 25,
      "types_includes_library": 20,
      "types_includes_nail_salon": -100,
      "types_includes_beauty_salon": -80,
      "types_includes_grocery_store": -80,
      "types_includes_supermarket": -80,
      "types_includes_farm": -40,
      "types_includes_store": -30,
      "types_includes_shopping_mall": -60,
      "types_includes_restaurant": -30,
      "types_includes_bar": -30,
      "types_includes_performing_arts_theater": -30,
      "types_includes_concert_hall": -30,
      "types_includes_opera_house": -30,
      "types_includes_movie_theater": -30,
      "types_includes_gym": -80,
      "reservable": 5
    },
    "text_patterns": {
      "summary_regex": "museum|gallery|exhibition|exhibit|artwork|curator|collection|pottery|ceramic|paint|workshop|cultural|sculpture|paint.{0,10}sip|sip.{0,10}paint|candle.?making",
      "summary_weight": 40,
      "reviews_regex": "painting|sculpture|exhibit|museum|gallery|art|class|workshop|pottery|creative|craft",
      "reviews_weight": 25,
      "atmosphere_regex": "creative|inspiring|cultural|artistic|thought.?provoking",
      "atmosphere_weight": 10
    }
  }$json$::jsonb,
  'ORCH-0598 Slice 6 creative_arts first-pass. Merges creative + cultural per OPEN-1. Top anchors: NCMA West Building (187), Spin Art Nation (712), Pinots Palette (624). Paint-and-sip keyword boost via summary_regex. Nail salons + farms excluded.')
  RETURNING id, signal_id
)
UPDATE public.signal_definitions sd SET current_version_id = nv.id
FROM new_version nv WHERE sd.id = nv.signal_id;

-- MOVIES v1.0.0 — cinemas only, RELAXED thresholds (universe only 7 per F-2)
WITH new_version AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES ('movies', 'v1.0.0', $json${
    "cap": 200,
    "scale": {
      "rating_cap": 35,
      "reviews_cap": 25,
      "rating_multiplier": 10,
      "reviews_log_multiplier": 5
    },
    "clamp_min": 0,
    "min_rating": 3.8,
    "min_reviews": 20,
    "bypass_rating": 4.3,
    "field_weights": {
      "types_includes_movie_theater": 80,
      "types_includes_drive_in": 60,
      "types_includes_performing_arts_theater": -10,
      "types_includes_concert_hall": -40,
      "types_includes_opera_house": -40,
      "types_includes_restaurant": -60,
      "types_includes_bar": -60,
      "types_includes_nail_salon": -100,
      "types_includes_gym": -80
    },
    "text_patterns": {
      "summary_regex": "cinema|imax|movies|screen|film|showtime|drive.?in|box office|matinee",
      "summary_weight": 30,
      "reviews_regex": "movie|cinema|film|screen|showtime|imax|popcorn|theater|screening",
      "reviews_weight": 20,
      "atmosphere_regex": "comfortable|reclining|premium|luxury seating",
      "atmosphere_weight": 10
    }
  }$json$::jsonb,
  'ORCH-0598 Slice 6 movies first-pass. Tiny universe (7 places Raleigh per F-2). Relaxed min_rating 3.8, min_reviews 20, bypass 4.3. filter_min=80 in CATEGORY_TO_SIGNAL per OPEN-10. Top anchors: Alamo Drafthouse (7044), Regal Brier Creek (3187), Regal North Hills (2540), Marbles IMAX (1546).')
  RETURNING id, signal_id
)
UPDATE public.signal_definitions sd SET current_version_id = nv.id
FROM new_version nv WHERE sd.id = nv.signal_id;

-- THEATRE v1.0.0 — performing arts; soft-penalize cinemas/comedy clubs
WITH new_version AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES ('theatre', 'v1.0.0', $json${
    "cap": 200,
    "scale": {
      "rating_cap": 35,
      "reviews_cap": 25,
      "rating_multiplier": 10,
      "reviews_log_multiplier": 5
    },
    "clamp_min": 0,
    "min_rating": 4.0,
    "min_reviews": 30,
    "bypass_rating": 4.5,
    "field_weights": {
      "types_includes_performing_arts_theater": 65,
      "types_includes_opera_house": 60,
      "types_includes_auditorium": 45,
      "types_includes_amphitheatre": 40,
      "types_includes_concert_hall": 35,
      "types_includes_live_music_venue": 15,
      "types_includes_movie_theater": -20,
      "types_includes_comedy_club": -10,
      "types_includes_sports_school": -60,
      "types_includes_sports_complex": -80,
      "types_includes_gym": -80,
      "types_includes_restaurant": -40,
      "types_includes_bar": -40,
      "types_includes_nail_salon": -100,
      "types_includes_grocery_store": -80,
      "reservable": 15
    },
    "text_patterns": {
      "summary_regex": "theatre|theater|opera|broadway|ballet|performance|stage|play|symphony|orchestra|philharmonic|recital|shakespeare|musical",
      "summary_weight": 40,
      "reviews_regex": "play|performance|show|actor|actress|orchestra|curtain|stage|seat|opera|ballet|symphony",
      "reviews_weight": 25,
      "atmosphere_regex": "grand|historic|elegant|intimate|world.?class",
      "atmosphere_weight": 12
    }
  }$json$::jsonb,
  'ORCH-0598 Slice 6 theatre first-pass — user directive "focus on making theatres better". Top anchors: Meymandi Concert Hall (1436), Martin Marietta Center (2737), Raleigh Memorial Auditorium (1027), A.J. Fletcher Opera (405), Burning Coal (240). Tutu School excluded via sports_school penalty. Alamo Drafthouse soft-biased to Movies via movie_theater -20.')
  RETURNING id, signal_id
)
UPDATE public.signal_definitions sd SET current_version_id = nv.id
FROM new_version nv WHERE sd.id = nv.signal_id;

-- ── 5 cohort flags (100% from seed per OPEN-4) ─────────────────────────────
INSERT INTO public.admin_config (key, value)
VALUES
  ('signal_serving_nature_pct',         '100'::jsonb),
  ('signal_serving_play_pct',           '100'::jsonb),
  ('signal_serving_creative_arts_pct',  '100'::jsonb),
  ('signal_serving_movies_pct',         '100'::jsonb),
  ('signal_serving_theatre_pct',        '100'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- ── User preference migration: split movies_theatre → movies + theatre ─────
-- Idempotent via array_remove + array_cat + DISTINCT unnest.
-- Impact: 2 users with slug, 1 user with display name (≤3 distinct profiles).
UPDATE public.preferences
SET
  categories = (
    SELECT ARRAY(SELECT DISTINCT e FROM unnest(
      array_cat(
        array_remove(COALESCE(categories, ARRAY[]::text[]), 'movies_theatre'),
        ARRAY['movies', 'theatre']::text[]
      )
    ) AS e)
  ),
  display_categories = (
    SELECT ARRAY(SELECT DISTINCT e FROM unnest(
      array_cat(
        array_remove(COALESCE(display_categories, ARRAY[]::text[]), 'Movies & Theatre'),
        ARRAY['Movies', 'Theatre']::text[]
      )
    ) AS e)
  ),
  updated_at = now()
WHERE 'movies_theatre' = ANY(COALESCE(categories, ARRAY[]::text[]))
   OR 'Movies & Theatre' = ANY(COALESCE(display_categories, ARRAY[]::text[]));

-- ROLLBACK (use BEFORE any users save new movies/theatre prefs; else destructive):
-- UPDATE public.preferences
-- SET
--   categories = (SELECT ARRAY(SELECT DISTINCT e FROM unnest(
--       array_cat(array_remove(array_remove(COALESCE(categories, ARRAY[]::text[]), 'movies'), 'theatre'),
--                 ARRAY['movies_theatre']::text[])) AS e)),
--   display_categories = (SELECT ARRAY(SELECT DISTINCT e FROM unnest(
--       array_cat(array_remove(array_remove(COALESCE(display_categories, ARRAY[]::text[]), 'Movies'), 'Theatre'),
--                 ARRAY['Movies & Theatre']::text[])) AS e)),
--   updated_at = now()
-- WHERE 'movies' = ANY(COALESCE(categories, ARRAY[]::text[])) OR 'theatre' = ANY(COALESCE(categories, ARRAY[]::text[]));
--
-- UPDATE public.admin_config SET value = '0'::jsonb WHERE key IN (
--   'signal_serving_nature_pct', 'signal_serving_play_pct',
--   'signal_serving_creative_arts_pct', 'signal_serving_movies_pct',
--   'signal_serving_theatre_pct'
-- );
-- UPDATE public.signal_definitions SET is_active = false WHERE id IN ('nature','play','creative_arts','movies','theatre');
