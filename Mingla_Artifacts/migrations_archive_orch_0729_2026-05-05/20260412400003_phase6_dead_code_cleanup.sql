-- Phase 6: Dead code cleanup
--
-- Removes the deprecated user_card_impressions system entirely.
-- Phase 1 (e05dde57) stopped writing serve-time impressions.
-- ORCH-0410 removed the last fresh-gen write paths.
-- Phase 2-4 replaced all interaction counters with record_card_interaction RPC.
-- The only SQL reader (query_pool_cards NOT EXISTS) was checking a table that
-- nothing writes to — a zombie filter. This migration completes the cleanup.
--
-- Also drops increment_user_engagement RPC (target table user_engagement_stats
-- was manually dropped from live; 2 mobile call sites being removed in code).

-- ═══════════════════════════════════════════════════════════════════
-- 0. Drop old overloads of query_pool_cards
-- ═══════════════════════════════════════════════════════════════════
-- PostgreSQL treats functions with different parameter lists as separate
-- overloads. CREATE OR REPLACE only replaces exact-signature matches.
-- We must explicitly drop the old signatures before creating the new one.

-- Overload 1: original version (no haversine params, has p_pref_updated_at)
DROP FUNCTION IF EXISTS public.query_pool_cards(UUID, TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, TEXT, TEXT, TIMESTAMPTZ, UUID[], INTEGER, TEXT[], TEXT[]);

-- Overload 2: haversine version (has p_pref_updated_at + haversine params)
DROP FUNCTION IF EXISTS public.query_pool_cards(UUID, TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, TEXT, TEXT, TIMESTAMPTZ, UUID[], INTEGER, TEXT[], TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);

-- ═══════════════════════════════════════════════════════════════════
-- 1. Create query_pool_cards WITHOUT user_card_impressions references
-- ═══════════════════════════════════════════════════════════════════
-- Changes from previous version (20260412100001):
--   - Removed p_pref_updated_at parameter (only used for impression filter)
--   - Removed NOT EXISTS user_card_impressions from count query (was lines 114-118)
--   - Removed NOT EXISTS user_card_impressions from data fetch query (was line 177)
--   - Removed entire rotation fallback branch (was lines 200-247) — with no impression
--     filter, v_total_unseen always equals total matching cards, so the "all seen"
--     fallback is unreachable. Return primary query unconditionally.

CREATE OR REPLACE FUNCTION public.query_pool_cards(
  p_user_id UUID,
  p_categories TEXT[],
  p_lat_min DOUBLE PRECISION,
  p_lat_max DOUBLE PRECISION,
  p_lng_min DOUBLE PRECISION,
  p_lng_max DOUBLE PRECISION,
  p_budget_max INTEGER DEFAULT 1000,
  p_card_type TEXT DEFAULT 'single',
  p_experience_type TEXT DEFAULT NULL,
  p_exclude_card_ids UUID[] DEFAULT '{}',
  p_limit INTEGER DEFAULT 200,
  p_price_tiers TEXT[] DEFAULT '{}',
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
  v_use_tiers BOOLEAN := (array_length(p_price_tiers, 1) IS NOT NULL AND array_length(p_price_tiers, 1) > 0);
  v_any_tier BOOLEAN := ('any' = ANY(p_price_tiers));
  v_has_place_exclusions BOOLEAN := (array_length(p_exclude_place_ids, 1) IS NOT NULL AND array_length(p_exclude_place_ids, 1) > 0);
  v_use_haversine BOOLEAN := (p_center_lat IS NOT NULL AND p_center_lng IS NOT NULL AND p_max_distance_km IS NOT NULL);
  v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center', 'dog_park', 'school', 'primary_school', 'secondary_school', 'university', 'preschool'];
  v_hidden_categories TEXT[] := ARRAY['groceries'];
  v_slug_categories TEXT[];
  v_num_categories INTEGER;
  v_per_category_cap INTEGER;
BEGIN
  IF p_categories IS NULL OR array_length(p_categories, 1) IS NULL THEN
    v_slug_categories := '{}';
  ELSE
    SELECT COALESCE(array_agg(DISTINCT slug), '{}') INTO v_slug_categories
    FROM (
      SELECT CASE lower(trim(val))
        WHEN 'nature'           THEN 'nature_views'
        WHEN 'nature & views'   THEN 'nature_views'
        WHEN 'nature_views'     THEN 'nature_views'
        WHEN 'first meet'       THEN 'first_meet'
        WHEN 'first_meet'       THEN 'first_meet'
        WHEN 'picnic park'      THEN 'picnic_park'
        WHEN 'picnic_park'      THEN 'picnic_park'
        WHEN 'drink'            THEN 'drink'
        WHEN 'casual eats'      THEN 'casual_eats'
        WHEN 'casual_eats'      THEN 'casual_eats'
        WHEN 'fine dining'      THEN 'fine_dining'
        WHEN 'fine_dining'      THEN 'fine_dining'
        WHEN 'watch'            THEN 'watch'
        WHEN 'live performance' THEN 'live_performance'
        WHEN 'live_performance' THEN 'live_performance'
        WHEN 'creative & arts'  THEN 'creative_arts'
        WHEN 'creative arts'    THEN 'creative_arts'
        WHEN 'creative_arts'    THEN 'creative_arts'
        WHEN 'play'             THEN 'play'
        WHEN 'wellness'         THEN 'wellness'
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

  -- Count total matching cards
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
      AND (
        v_any_tier
        OR (v_use_tiers AND cp.price_tier = ANY(p_price_tiers))
        OR (NOT v_use_tiers AND cp.price_min <= p_budget_max)
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
      AND (v_any_tier OR (v_use_tiers AND cp.price_tier = ANY(p_price_tiers)) OR (NOT v_use_tiers AND cp.price_min <= p_budget_max))
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
    SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.* FROM filtered f ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
  ),
  ranked AS (
    SELECT d.*, ROW_NUMBER() OVER (PARTITION BY d.category ORDER BY d.popularity_score DESC) AS cat_rank, ROW_NUMBER() OVER (PARTITION BY d.category ORDER BY d.popularity_score DESC) AS cat_position FROM deduped d
  ),
  enriched AS (
    SELECT r.*, pp.stored_photo_urls, pp.photos, COALESCE(NULLIF(r.website, ''), NULLIF(pp.website, '')) AS resolved_website
    FROM ranked r LEFT JOIN public.place_pool pp ON pp.id = r.place_pool_id WHERE r.cat_rank <= v_per_category_cap
  )
  SELECT
    CASE WHEN e.resolved_website IS NOT NULL AND (e.website IS NULL OR e.website = '') THEN to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position' || jsonb_build_object('website', e.resolved_website) ELSE to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position' END AS card,
    v_total_unseen AS total_unseen
  FROM enriched e ORDER BY e.cat_position ASC, e.popularity_score DESC LIMIT p_limit;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Drop impression counter trigger (was on user_card_impressions)
-- ═══════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_card_pool_impression_counters ON public.user_card_impressions;
DROP FUNCTION IF EXISTS public.update_card_pool_impression_counters();

-- ═══════════════════════════════════════════════════════════════════
-- 3. Drop record_card_impressions RPC (only caller was dead recordImpressions())
-- ═══════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.record_card_impressions(UUID, UUID[], INTEGER);

-- ═══════════════════════════════════════════════════════════════════
-- 4. Drop user_card_impressions table (no writers, no readers after above)
-- ═══════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS public.user_card_impressions CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- 5. Drop increment_user_engagement RPC (target table doesn't exist on live)
-- ═══════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.increment_user_engagement(UUID, TEXT, INTEGER);
