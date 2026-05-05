-- ════════════════════════════════════════════════════════════════════════════
-- ORCH-0443: Fix category display name vs slug mismatch in query_pool_cards
-- ════════════════════════════════════════════════════════════════════════════
--
-- Root cause: Phase 9 (ORCH-0434) removed the CASE normalization table,
-- assuming all callers send canonical slugs. They don't — the edge function
-- sends display names ("Upscale & Fine Dining") while card_pool.categories
-- stores slugs ("upscale_fine_dining"). The && operator finds zero overlap.
--
-- Fix: Restore CASE normalization for the current 10 categories.
-- Accepts both display names and slugs, outputs canonical slugs.
-- Everything else in the function body is unchanged.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.query_pool_cards(
  p_user_id UUID,
  p_categories TEXT[],
  p_lat_min DOUBLE PRECISION,
  p_lat_max DOUBLE PRECISION,
  p_lng_min DOUBLE PRECISION,
  p_lng_max DOUBLE PRECISION,
  p_card_type TEXT DEFAULT 'single',
  p_experience_type TEXT DEFAULT NULL,
  p_exclude_card_ids UUID[] DEFAULT '{}',
  p_limit INTEGER DEFAULT 200,
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
  -- ORCH-0443: Normalize category inputs to canonical slugs.
  -- Accepts both display names ("Upscale & Fine Dining") and slugs ("upscale_fine_dining").
  IF p_categories IS NULL OR array_length(p_categories, 1) IS NULL THEN
    v_slug_categories := '{}';
  ELSE
    SELECT COALESCE(array_agg(DISTINCT slug), '{}') INTO v_slug_categories
    FROM (
      SELECT CASE lower(trim(val))
        WHEN 'nature'                  THEN 'nature'
        WHEN 'nature & views'          THEN 'nature'
        WHEN 'nature_views'            THEN 'nature'
        WHEN 'icebreakers'             THEN 'icebreakers'
        WHEN 'drinks_and_music'        THEN 'drinks_and_music'
        WHEN 'drinks & music'          THEN 'drinks_and_music'
        WHEN 'brunch_lunch_casual'     THEN 'brunch_lunch_casual'
        WHEN 'brunch, lunch & casual'  THEN 'brunch_lunch_casual'
        WHEN 'upscale_fine_dining'     THEN 'upscale_fine_dining'
        WHEN 'upscale & fine dining'   THEN 'upscale_fine_dining'
        WHEN 'movies_theatre'          THEN 'movies_theatre'
        WHEN 'movies & theatre'        THEN 'movies_theatre'
        WHEN 'creative_arts'           THEN 'creative_arts'
        WHEN 'creative & arts'         THEN 'creative_arts'
        WHEN 'play'                    THEN 'play'
        WHEN 'flowers'                 THEN 'flowers'
        WHEN 'groceries'              THEN 'groceries'
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

-- ── Drop stale Phase 1 overload ────────────────────────────────────────────
-- Phase 1 (ORCH-0434) created an overload with p_budget_max and p_price_tiers.
-- Phase 9 created the clean signature without those params.
-- Both coexist in production. The old one is never called (no caller sends
-- p_budget_max or p_price_tiers). Drop it to prevent confusion.

DROP FUNCTION IF EXISTS public.query_pool_cards(
  UUID, TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, TEXT, TEXT, UUID[], INTEGER, TEXT[], TEXT[],
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
);
