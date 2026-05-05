-- ORCH-0724/0725/0727 (2026-05-05): Section 8 entirely replaced with Option B (INSERT…ON CONFLICT + DELETE) to neutralize SQLSTATE 23505 PK collision on `category_type_exclusions_pkey`. Original UPDATE collapses multi-legacy rows onto same canonical PK. ORCH-0724/0725 Option A (pre-DELETE) handled legacy/canonical collisions only and missed legacy/legacy collapses; commit 27d8c0c1 still failed on PR #62 push 4. ORCH-0727 reworks to Option B which handles ALL collision cases via ON CONFLICT DO NOTHING. Production unaffected — same end state (legacy slugs removed, canonical preserved/inserted). Sibling fixes: ORCH-0721 commit 4e8f784d (CONCURRENTLY) + ORCH-0722 commit cd276c3b (OUT-param shape × 2). Forensics: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0725_TRACK_H_APPLY_TIME_AUDIT.md §6 Option B.
-- ============================================================================
-- ORCH-0434 Phase 1: Database Foundation — Category Slug Migration
-- ============================================================================
--
-- This migration:
--   1. Creates backup tables for rollback safety
--   2. Adds intent_toggle, category_toggle, selected_dates columns
--   3. Migrates category slugs across 5 tables
--   4. Migrates display category names
--   5. Rewrites query_pool_cards RPC (new slugs, price filtering removed)
--   6. Updates compute_taste_match RPC (remove price_tiers, fix profile_id)
--
-- Slug mapping:
--   nature_views    → nature
--   picnic_park     → nature        (merged)
--   drink           → drinks_and_music
--   first_meet      → icebreakers
--   casual_eats     → brunch_lunch_casual
--   fine_dining     → upscale_fine_dining
--   watch           → movies_theatre
--   live_performance→ movies_theatre (merged)
--   wellness        → REMOVED
--   flowers         → hidden from user prefs (stays in ai_categories)
--   creative_arts   → unchanged
--   play            → unchanged
--   groceries       → unchanged (already hidden)
--
-- The deployed mobile app continues working: old slugs are accepted
-- by the RPC via backward-compat CASE table entries.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: Backup Tables
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS preferences_backup_0434 AS SELECT * FROM preferences;

CREATE TABLE IF NOT EXISTS board_session_preferences_backup_0434 AS SELECT * FROM board_session_preferences;

CREATE TABLE IF NOT EXISTS place_pool_ai_categories_backup_0434 AS SELECT id, ai_categories, seeding_category FROM place_pool;

CREATE TABLE IF NOT EXISTS card_pool_categories_backup_0434 AS SELECT id, category, categories FROM card_pool;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: New Columns
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE preferences
  ADD COLUMN IF NOT EXISTS intent_toggle boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS category_toggle boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS selected_dates date[] DEFAULT NULL;

ALTER TABLE board_session_preferences
  ADD COLUMN IF NOT EXISTS intent_toggle boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS category_toggle boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS selected_dates date[] DEFAULT NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: Slug Migration — preferences.categories
-- ════════════════════════════════════════════════════════════════════════════
-- Maps old slugs to new, removes wellness and flowers from user prefs,
-- deduplicates merged slugs (e.g. nature_views + picnic_park → nature).

UPDATE preferences SET categories = (
  SELECT COALESCE(array_agg(DISTINCT mapped), '{}')
  FROM (
    SELECT CASE slug
      WHEN 'nature_views'     THEN 'nature'
      WHEN 'picnic_park'      THEN 'nature'
      WHEN 'drink'            THEN 'drinks_and_music'
      WHEN 'first_meet'       THEN 'icebreakers'
      WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
      WHEN 'fine_dining'      THEN 'upscale_fine_dining'
      WHEN 'watch'            THEN 'movies_theatre'
      WHEN 'live_performance' THEN 'movies_theatre'
      WHEN 'wellness'         THEN NULL
      WHEN 'flowers'          THEN NULL
      ELSE slug
    END AS mapped
    FROM unnest(categories) AS slug
  ) sub
  WHERE mapped IS NOT NULL
)
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0;

-- Handle users left with empty categories (only had wellness/flowers)
UPDATE preferences
SET categories = ARRAY['nature', 'drinks_and_music', 'icebreakers']
WHERE categories IS NULL OR categories = '{}' OR array_length(categories, 1) IS NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4: Slug Migration — preferences.display_categories
-- ════════════════════════════════════════════════════════════════════════════
-- This column stores DISPLAY NAMES, not slugs.

UPDATE preferences SET display_categories = (
  SELECT COALESCE(array_agg(DISTINCT mapped), '{}')
  FROM (
    SELECT CASE name
      WHEN 'Picnic Park'      THEN 'Nature & Views'
      WHEN 'Drink'            THEN 'Drinks & Music'
      WHEN 'First Meet'       THEN 'Icebreakers'
      WHEN 'Casual Eats'      THEN 'Brunch, Lunch & Casual'
      WHEN 'Fine Dining'      THEN 'Upscale & Fine Dining'
      WHEN 'Watch'            THEN 'Movies & Theatre'
      WHEN 'Live Performance' THEN 'Movies & Theatre'
      WHEN 'Wellness'         THEN NULL
      WHEN 'Flowers'          THEN NULL
      ELSE name
    END AS mapped
    FROM unnest(display_categories) AS name
  ) sub
  WHERE mapped IS NOT NULL
)
WHERE display_categories IS NOT NULL AND array_length(display_categories, 1) > 0;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5: Slug Migration — board_session_preferences.categories
-- ════════════════════════════════════════════════════════════════════════════

UPDATE board_session_preferences SET categories = (
  SELECT COALESCE(array_agg(DISTINCT mapped), '{}')
  FROM (
    SELECT CASE slug
      WHEN 'nature_views'     THEN 'nature'
      WHEN 'picnic_park'      THEN 'nature'
      WHEN 'drink'            THEN 'drinks_and_music'
      WHEN 'first_meet'       THEN 'icebreakers'
      WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
      WHEN 'fine_dining'      THEN 'upscale_fine_dining'
      WHEN 'watch'            THEN 'movies_theatre'
      WHEN 'live_performance' THEN 'movies_theatre'
      WHEN 'wellness'         THEN NULL
      WHEN 'flowers'          THEN NULL
      ELSE slug
    END AS mapped
    FROM unnest(categories) AS slug
  ) sub
  WHERE mapped IS NOT NULL
)
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6: Slug Migration — place_pool
-- ════════════════════════════════════════════════════════════════════════════
-- NOTE: flowers STAYS in ai_categories (hidden from users, not from places).
-- Only wellness is removed from places.

-- 6a: ai_categories (TEXT[] array)
UPDATE place_pool SET ai_categories = (
  SELECT COALESCE(array_agg(DISTINCT mapped), '{}')
  FROM (
    SELECT CASE slug
      WHEN 'nature_views'     THEN 'nature'
      WHEN 'picnic_park'      THEN 'nature'
      WHEN 'drink'            THEN 'drinks_and_music'
      WHEN 'first_meet'       THEN 'icebreakers'
      WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
      WHEN 'fine_dining'      THEN 'upscale_fine_dining'
      WHEN 'watch'            THEN 'movies_theatre'
      WHEN 'live_performance' THEN 'movies_theatre'
      WHEN 'wellness'         THEN NULL
      ELSE slug  -- flowers, creative_arts, play, groceries pass through
    END AS mapped
    FROM unnest(ai_categories) AS slug
  ) sub
  WHERE mapped IS NOT NULL
)
WHERE ai_categories IS NOT NULL AND array_length(ai_categories, 1) > 0;

-- 6b: seeding_category (TEXT scalar)
UPDATE place_pool SET seeding_category = CASE seeding_category
  WHEN 'nature_views'     THEN 'nature'
  WHEN 'picnic_park'      THEN 'nature'
  WHEN 'drink'            THEN 'drinks_and_music'
  WHEN 'first_meet'       THEN 'icebreakers'
  WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
  WHEN 'fine_dining'      THEN 'upscale_fine_dining'
  WHEN 'watch'            THEN 'movies_theatre'
  WHEN 'live_performance' THEN 'movies_theatre'
  WHEN 'wellness'         THEN NULL
  ELSE seeding_category
END
WHERE seeding_category IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7: Slug Migration — card_pool
-- ════════════════════════════════════════════════════════════════════════════

-- 7a: category (TEXT scalar — primary category)
UPDATE card_pool SET category = CASE category
  WHEN 'nature_views'     THEN 'nature'
  WHEN 'picnic_park'      THEN 'nature'
  WHEN 'drink'            THEN 'drinks_and_music'
  WHEN 'first_meet'       THEN 'icebreakers'
  WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
  WHEN 'fine_dining'      THEN 'upscale_fine_dining'
  WHEN 'watch'            THEN 'movies_theatre'
  WHEN 'live_performance' THEN 'movies_theatre'
  WHEN 'wellness'         THEN 'brunch_lunch_casual'  -- orphan fallback
  ELSE category
END
WHERE category IS NOT NULL;

-- 7b: categories (TEXT[] array)
UPDATE card_pool SET categories = (
  SELECT COALESCE(array_agg(DISTINCT mapped), '{}')
  FROM (
    SELECT CASE slug
      WHEN 'nature_views'     THEN 'nature'
      WHEN 'picnic_park'      THEN 'nature'
      WHEN 'drink'            THEN 'drinks_and_music'
      WHEN 'first_meet'       THEN 'icebreakers'
      WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
      WHEN 'fine_dining'      THEN 'upscale_fine_dining'
      WHEN 'watch'            THEN 'movies_theatre'
      WHEN 'live_performance' THEN 'movies_theatre'
      WHEN 'wellness'         THEN NULL
      ELSE slug
    END AS mapped
    FROM unnest(categories) AS slug
  ) sub
  WHERE mapped IS NOT NULL
)
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8: Slug Migration — category_type_exclusions (ORCH-0727 Option B)
-- ════════════════════════════════════════════════════════════════════════════
-- Column is category_slug (NOT category).
--
-- ORCH-0727 (2026-05-05): Replaced original UPDATE + post-UPDATE dedupe DELETE
-- with Option B INSERT…ON CONFLICT + DELETE pattern. Original UPDATE collapsed
-- multi-legacy rows onto same canonical PK → SQLSTATE 23505. ORCH-0724/0725
-- Option A pre-DELETE handled only legacy/canonical collisions and missed
-- legacy/legacy collapses (commit 27d8c0c1 still failed on PR #62 push 4).
-- Option B handles all 3 collision cases (legacy/canonical, legacy/legacy,
-- no-collision) via ON CONFLICT DO NOTHING. Same end state: legacy slugs
-- removed, canonical slugs preserved/inserted. Production unaffected.

-- 8a: Insert canonical-slug rows for each legacy row, skipping any whose
-- (category_slug, excluded_type) already exists.
INSERT INTO category_type_exclusions (category_slug, excluded_type)
SELECT
  CASE category_slug
    WHEN 'nature_views'     THEN 'nature'
    WHEN 'picnic_park'      THEN 'nature'
    WHEN 'drink'            THEN 'drinks_and_music'
    WHEN 'first_meet'       THEN 'icebreakers'
    WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
    WHEN 'fine_dining'      THEN 'upscale_fine_dining'
    WHEN 'watch'            THEN 'movies_theatre'
    WHEN 'live_performance' THEN 'movies_theatre'
    WHEN 'wellness'         THEN 'brunch_lunch_casual'
  END AS new_slug,
  excluded_type
FROM category_type_exclusions
WHERE category_slug IN (
  'nature_views','picnic_park','drink','first_meet','casual_eats',
  'fine_dining','watch','live_performance','wellness'
)
ON CONFLICT (category_slug, excluded_type) DO NOTHING;

-- 8b: Delete the legacy-slug rows. Canonical rows (preserved or freshly
-- inserted by 8a) are untouched.
DELETE FROM category_type_exclusions
WHERE category_slug IN (
  'nature_views','picnic_park','drink','first_meet','casual_eats',
  'fine_dining','watch','live_performance','wellness'
);


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9: Rewrite query_pool_cards RPC
-- ════════════════════════════════════════════════════════════════════════════
-- Changes:
--   - Category CASE table updated with new + old slugs (backward compat)
--   - Price filtering REMOVED from WHERE clause
--   - p_budget_max and p_price_tiers kept in signature (backward compat) but unused
--   - v_hidden_categories updated to include 'flowers'
--   - Removed: v_use_tiers, v_any_tier, v_price_exempt variables

CREATE OR REPLACE FUNCTION public.query_pool_cards(
  p_user_id UUID,
  p_categories TEXT[],
  p_lat_min DOUBLE PRECISION,
  p_lat_max DOUBLE PRECISION,
  p_lng_min DOUBLE PRECISION,
  p_lng_max DOUBLE PRECISION,
  p_budget_max INTEGER DEFAULT 1000,          -- DEPRECATED: kept for backward compat, not used
  p_card_type TEXT DEFAULT 'single',
  p_experience_type TEXT DEFAULT NULL,
  p_exclude_card_ids UUID[] DEFAULT '{}',
  p_limit INTEGER DEFAULT 200,
  p_price_tiers TEXT[] DEFAULT '{}',          -- DEPRECATED: kept for backward compat, not used
  p_exclude_place_ids TEXT[] DEFAULT '{}',
  p_center_lat DOUBLE PRECISION DEFAULT NULL,
  p_center_lng DOUBLE PRECISION DEFAULT NULL,
  p_max_distance_km DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE(card JSONB, total_unseen BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_unseen BIGINT;
  v_has_place_exclusions BOOLEAN := (array_length(p_exclude_place_ids, 1) IS NOT NULL AND array_length(p_exclude_place_ids, 1) > 0);
  v_use_haversine BOOLEAN := (p_center_lat IS NOT NULL AND p_center_lng IS NOT NULL AND p_max_distance_km IS NOT NULL);
  v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center', 'dog_park', 'school', 'primary_school', 'secondary_school', 'university', 'preschool'];
  v_hidden_categories TEXT[] := ARRAY['groceries', 'flowers'];
  v_slug_categories TEXT[];
  v_num_categories INTEGER;
  v_per_category_cap INTEGER;
BEGIN
  -- ── Category slug normalization ──
  -- Accepts BOTH old and new slugs for backward compat with deployed mobile app.
  -- Old slugs (nature_views, drink, first_meet, etc.) resolve to new canonical slugs.
  -- This backward compat will be removed in Phase 9 (ORCH-0434).
  IF p_categories IS NULL OR array_length(p_categories, 1) IS NULL THEN
    v_slug_categories := '{}';
  ELSE
    SELECT COALESCE(array_agg(DISTINCT slug), '{}') INTO v_slug_categories
    FROM (
      SELECT CASE lower(trim(val))
        -- nature (merged: nature + picnic_park)
        WHEN 'nature'           THEN 'nature'
        WHEN 'nature_views'     THEN 'nature'
        WHEN 'nature & views'   THEN 'nature'
        WHEN 'picnic_park'      THEN 'nature'
        WHEN 'picnic park'      THEN 'nature'
        WHEN 'picnic'           THEN 'nature'
        -- drinks_and_music (renamed from drink)
        WHEN 'drinks_and_music' THEN 'drinks_and_music'
        WHEN 'drink'            THEN 'drinks_and_music'
        WHEN 'drinks'           THEN 'drinks_and_music'
        WHEN 'drinks & music'   THEN 'drinks_and_music'
        -- icebreakers (renamed from first_meet)
        WHEN 'icebreakers'      THEN 'icebreakers'
        WHEN 'first_meet'       THEN 'icebreakers'
        WHEN 'first meet'       THEN 'icebreakers'
        -- brunch_lunch_casual (from casual_eats)
        WHEN 'brunch_lunch_casual'     THEN 'brunch_lunch_casual'
        WHEN 'casual_eats'             THEN 'brunch_lunch_casual'
        WHEN 'casual eats'             THEN 'brunch_lunch_casual'
        WHEN 'brunch, lunch & casual'  THEN 'brunch_lunch_casual'
        -- upscale_fine_dining (from fine_dining)
        WHEN 'upscale_fine_dining'     THEN 'upscale_fine_dining'
        WHEN 'fine_dining'             THEN 'upscale_fine_dining'
        WHEN 'fine dining'             THEN 'upscale_fine_dining'
        WHEN 'upscale & fine dining'   THEN 'upscale_fine_dining'
        -- movies_theatre (merged: watch + live_performance)
        WHEN 'movies_theatre'          THEN 'movies_theatre'
        WHEN 'watch'                   THEN 'movies_theatre'
        WHEN 'live_performance'        THEN 'movies_theatre'
        WHEN 'live performance'        THEN 'movies_theatre'
        WHEN 'movies & theatre'        THEN 'movies_theatre'
        -- unchanged
        WHEN 'creative_arts'    THEN 'creative_arts'
        WHEN 'creative & arts'  THEN 'creative_arts'
        WHEN 'creative arts'    THEN 'creative_arts'
        WHEN 'play'             THEN 'play'
        -- wellness → fallback to brunch_lunch_casual (orphan)
        WHEN 'wellness'         THEN 'brunch_lunch_casual'
        -- hidden (backend only)
        WHEN 'flowers'          THEN 'flowers'
        WHEN 'groceries'        THEN 'groceries'
        ELSE NULL
      END AS slug
      FROM unnest(p_categories) AS val
    ) sub
    WHERE slug IS NOT NULL;
  END IF;

  v_num_categories := GREATEST(COALESCE(array_length(v_slug_categories, 1), 0), 1);
  v_per_category_cap := CEIL(p_limit::float / v_num_categories);

  -- ── Count total matching cards ──
  SELECT COUNT(*) INTO v_total_unseen
  FROM (
    SELECT DISTINCT ON (COALESCE(cp.google_place_id, cp.id::TEXT)) cp.id
    FROM public.card_pool cp
    WHERE cp.is_active = true
      AND cp.card_type = p_card_type
      AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
      AND cp.lat BETWEEN p_lat_min AND p_lat_max
      AND cp.lng BETWEEN p_lng_min AND p_lng_max
      AND (
        NOT v_use_haversine
        OR (
          6371 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(cp.lat - p_center_lat) / 2), 2) +
            COS(RADIANS(p_center_lat)) * COS(RADIANS(cp.lat)) *
            POWER(SIN(RADIANS(cp.lng - p_center_lng) / 2), 2)
          )) <= p_max_distance_km
        )
      )
      -- ORCH-0434: Price filtering REMOVED. All price tiers are now returned.
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id != ALL(p_exclude_card_ids)
      AND (NOT v_has_place_exclusions OR cp.google_place_id IS NULL OR cp.google_place_id != ALL(p_exclude_place_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.place_pool pp
        WHERE pp.id = cp.place_pool_id AND pp.types && v_excluded_types
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.card_pool_stops cps
        JOIN public.place_pool pp ON pp.id = cps.place_pool_id
        WHERE cps.card_pool_id = cp.id AND cp.place_pool_id IS NULL AND pp.types && v_excluded_types
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.place_pool pp, public.category_type_exclusions cte
        WHERE pp.id = cp.place_pool_id AND cte.category_slug = ANY(cp.categories) AND cte.excluded_type = ANY(pp.types)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.card_pool_stops cps
        JOIN public.place_pool pp ON pp.id = cps.place_pool_id, public.category_type_exclusions cte
        WHERE cps.card_pool_id = cp.id AND cp.place_pool_id IS NULL AND cte.category_slug = ANY(cp.categories) AND cte.excluded_type = ANY(pp.types)
      )
      AND NOT (cp.categories <@ v_hidden_categories)
      AND (
        cp.ai_override = true
        OR (cp.card_type = 'single' AND EXISTS (
          SELECT 1 FROM public.place_pool pp WHERE pp.id = cp.place_pool_id AND pp.ai_approved = true
        ))
        OR (cp.card_type = 'curated' AND NOT EXISTS (
          SELECT 1 FROM public.card_pool_stops cps
          JOIN public.place_pool pp ON pp.id = cps.place_pool_id
          WHERE cps.card_pool_id = cp.id AND (pp.ai_approved IS NULL OR pp.ai_approved = false)
        ))
      )
    ORDER BY COALESCE(cp.google_place_id, cp.id::TEXT), cp.popularity_score DESC
  ) matching_count;

  -- ── Return filtered, deduped, ranked, enriched cards ──
  RETURN QUERY
  WITH
  filtered AS (
    SELECT cp.*
    FROM public.card_pool cp
    WHERE cp.is_active = true
      AND cp.card_type = p_card_type
      AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
      AND cp.lat BETWEEN p_lat_min AND p_lat_max
      AND cp.lng BETWEEN p_lng_min AND p_lng_max
      AND (
        NOT v_use_haversine
        OR (
          6371 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(cp.lat - p_center_lat) / 2), 2) +
            COS(RADIANS(p_center_lat)) * COS(RADIANS(cp.lat)) *
            POWER(SIN(RADIANS(cp.lng - p_center_lng) / 2), 2)
          )) <= p_max_distance_km
        )
      )
      -- ORCH-0434: Price filtering REMOVED.
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id != ALL(p_exclude_card_ids)
      AND (NOT v_has_place_exclusions OR cp.google_place_id IS NULL OR cp.google_place_id != ALL(p_exclude_place_ids))
      AND NOT EXISTS (SELECT 1 FROM public.place_pool pp WHERE pp.id = cp.place_pool_id AND pp.types && v_excluded_types)
      AND NOT EXISTS (SELECT 1 FROM public.card_pool_stops cps JOIN public.place_pool pp ON pp.id = cps.place_pool_id WHERE cps.card_pool_id = cp.id AND cp.place_pool_id IS NULL AND pp.types && v_excluded_types)
      AND NOT EXISTS (SELECT 1 FROM public.place_pool pp, public.category_type_exclusions cte WHERE pp.id = cp.place_pool_id AND cte.category_slug = ANY(cp.categories) AND cte.excluded_type = ANY(pp.types))
      AND NOT EXISTS (SELECT 1 FROM public.card_pool_stops cps JOIN public.place_pool pp ON pp.id = cps.place_pool_id, public.category_type_exclusions cte WHERE cps.card_pool_id = cp.id AND cp.place_pool_id IS NULL AND cte.category_slug = ANY(cp.categories) AND cte.excluded_type = ANY(pp.types))
      AND NOT (cp.categories <@ v_hidden_categories)
      AND (cp.ai_override = true OR (cp.card_type = 'single' AND EXISTS (SELECT 1 FROM public.place_pool pp WHERE pp.id = cp.place_pool_id AND pp.ai_approved = true)) OR (cp.card_type = 'curated' AND NOT EXISTS (SELECT 1 FROM public.card_pool_stops cps JOIN public.place_pool pp ON pp.id = cps.place_pool_id WHERE cps.card_pool_id = cp.id AND (pp.ai_approved IS NULL OR pp.ai_approved = false))))
  ),
  deduped AS (
    SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
    FROM filtered f
    ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
  ),
  ranked AS (
    SELECT d.*,
      ROW_NUMBER() OVER (PARTITION BY d.category ORDER BY d.popularity_score DESC) AS cat_rank,
      ROW_NUMBER() OVER (PARTITION BY d.category ORDER BY d.popularity_score DESC) AS cat_position
    FROM deduped d
  ),
  enriched AS (
    SELECT r.*,
      pp.stored_photo_urls,
      pp.photos,
      COALESCE(NULLIF(r.website, ''), NULLIF(pp.website, '')) AS resolved_website
    FROM ranked r
    LEFT JOIN public.place_pool pp ON pp.id = r.place_pool_id
    WHERE r.cat_rank <= v_per_category_cap
  )
  SELECT
    CASE
      WHEN e.resolved_website IS NOT NULL AND (e.website IS NULL OR e.website = '')
      THEN to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position' || jsonb_build_object('website', e.resolved_website)
      ELSE to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position'
    END AS card,
    v_total_unseen AS total_unseen
  FROM enriched e
  ORDER BY e.cat_position ASC, e.popularity_score DESC
  LIMIT p_limit;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 10: Update compute_taste_match RPC
-- ════════════════════════════════════════════════════════════════════════════
-- Changes:
--   - Fix pre-existing bug: user_id → profile_id (preferences PK is profile_id)
--   - Remove price_tiers from similarity calculation
--   - Reweight: 70% categories, 30% intents
--   - Return type: remove shared_tiers (no longer relevant)

CREATE OR REPLACE FUNCTION public.compute_taste_match(p_user_a UUID, p_user_b UUID)
RETURNS TABLE (
  match_percentage INTEGER,
  shared_categories TEXT[],
  shared_tiers TEXT[],      -- DEPRECATED: always returns '{}', kept for backward compat
  shared_intents TEXT[]
) AS $$
DECLARE
  v_a_cats TEXT[]; v_b_cats TEXT[];
  v_a_intents TEXT[]; v_b_intents TEXT[];
  v_score FLOAT;
BEGIN
  SELECT categories, intents INTO v_a_cats, v_a_intents
    FROM preferences WHERE profile_id = p_user_a;
  SELECT categories, intents INTO v_b_cats, v_b_intents
    FROM preferences WHERE profile_id = p_user_b;

  -- ORCH-0434: price_tiers removed from similarity calc.
  -- Reweighted: 70% categories, 30% intents.
  v_score := (
    jaccard(v_a_cats, v_b_cats) * 0.7 +
    jaccard(v_a_intents, v_b_intents) * 0.3
  ) * 100;

  RETURN QUERY SELECT
    ROUND(v_score)::INTEGER,
    ARRAY(SELECT unnest(v_a_cats) INTERSECT SELECT unnest(v_b_cats)),
    '{}'::TEXT[],  -- shared_tiers deprecated
    ARRAY(SELECT unnest(v_a_intents) INTERSECT SELECT unnest(v_b_intents));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
