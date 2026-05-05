-- ORCH-0404: Add haversine distance filter to query_pool_cards
--
-- Root cause: The RPC uses a bounding box for spatial filtering, but the JS
-- post-filter in serveCardsFromPipeline uses haversine distance with a tighter
-- effective radius. With small limits (collab: 20), the RPC returns mostly
-- distant popular cards that the JS filter strips, leaving only 3-5 cards.
--
-- Fix: Add optional center lat/lng + max distance params. When provided, the
-- RPC filters by haversine distance INSIDE the SQL query so every returned card
-- is within the travel time radius. Backward compatible: NULL params skip filter.

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
  p_pref_updated_at TIMESTAMPTZ DEFAULT '1970-01-01T00:00:00Z',
  p_exclude_card_ids UUID[] DEFAULT '{}',
  p_limit INTEGER DEFAULT 200,
  p_price_tiers TEXT[] DEFAULT '{}',
  p_exclude_place_ids TEXT[] DEFAULT '{}',
  -- New params (ORCH-0404): haversine distance filter
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

  -- Count total unseen cards (used for hasMore signal)
  SELECT COUNT(*) INTO v_total_unseen
  FROM (
    SELECT DISTINCT ON (COALESCE(cp.google_place_id, cp.id::TEXT)) cp.id
    FROM public.card_pool cp
    WHERE cp.is_active = true
      AND cp.card_type = p_card_type
      AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
      AND cp.lat BETWEEN p_lat_min AND p_lat_max
      AND cp.lng BETWEEN p_lng_min AND p_lng_max
      -- ORCH-0404: Haversine distance filter (skipped when p_center_lat is NULL)
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
      AND NOT EXISTS (
        SELECT 1 FROM public.user_card_impressions uci
        WHERE uci.card_pool_id = cp.id AND uci.user_id = p_user_id
          AND uci.created_at >= p_pref_updated_at
      )
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
  ) unseen_count;

  IF v_total_unseen > 0 THEN
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
        AND NOT EXISTS (SELECT 1 FROM public.user_card_impressions uci WHERE uci.card_pool_id = cp.id AND uci.user_id = p_user_id AND uci.created_at >= p_pref_updated_at)
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
  ELSE
    -- Rotation fallback: all cards seen, re-serve least-recently-seen
    RETURN QUERY
    WITH
    filtered_no_impressions AS (
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
    with_last_seen AS (
      SELECT d.*, COALESCE((SELECT MAX(uci.created_at) FROM public.user_card_impressions uci WHERE uci.card_pool_id = d.id AND uci.user_id = p_user_id), '1970-01-01T00:00:00Z'::timestamptz) AS last_seen_at
      FROM filtered_no_impressions d
    ),
    ranked AS (
      SELECT w.*, ROW_NUMBER() OVER (PARTITION BY w.category ORDER BY w.last_seen_at ASC, w.popularity_score DESC) AS cat_rank, ROW_NUMBER() OVER (PARTITION BY w.category ORDER BY w.last_seen_at ASC, w.popularity_score DESC) AS cat_position FROM with_last_seen w
    ),
    enriched AS (
      SELECT r.*, pp.stored_photo_urls, pp.photos, COALESCE(NULLIF(r.website, ''), NULLIF(pp.website, '')) AS resolved_website
      FROM ranked r LEFT JOIN public.place_pool pp ON pp.id = r.place_pool_id WHERE r.cat_rank <= v_per_category_cap
    )
    SELECT
      CASE WHEN e.resolved_website IS NOT NULL AND (e.website IS NULL OR e.website = '') THEN to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position' - 'last_seen_at' || jsonb_build_object('website', e.resolved_website) ELSE to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position' - 'last_seen_at' END AS card,
      v_total_unseen AS total_unseen
    FROM enriched e ORDER BY e.cat_position ASC, e.last_seen_at ASC, e.popularity_score DESC LIMIT p_limit;
  END IF;
END;
$$;
