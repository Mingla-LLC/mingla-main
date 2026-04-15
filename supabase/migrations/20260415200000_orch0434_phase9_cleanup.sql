-- ════════════════════════════════════════════════════════════════════════════
-- ORCH-0434 Phase 9: Final cleanup
-- ════════════════════════════════════════════════════════════════════════════
-- Removes all backward-compat scaffolding from the 8-phase preferences
-- simplification initiative. Drop deprecated columns, remove backward-compat
-- CASE table, fix admin RPCs, migrate seeding table slugs, drop backups.

-- ── 9.1: Migrate seeding tables to new category slugs ────────────────────

UPDATE seeding_batches SET seeding_category = CASE seeding_category
  WHEN 'nature_views'     THEN 'nature'
  WHEN 'picnic_park'      THEN 'nature'
  WHEN 'first_meet'       THEN 'icebreakers'
  WHEN 'drink'            THEN 'drinks_and_music'
  WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
  WHEN 'fine_dining'      THEN 'upscale_fine_dining'
  WHEN 'watch'            THEN 'movies_theatre'
  WHEN 'live_performance' THEN 'movies_theatre'
  WHEN 'wellness'         THEN NULL
  ELSE seeding_category
END WHERE seeding_category IS NOT NULL;

UPDATE seeding_operations SET seeding_category = CASE seeding_category
  WHEN 'nature_views'     THEN 'nature'
  WHEN 'picnic_park'      THEN 'nature'
  WHEN 'first_meet'       THEN 'icebreakers'
  WHEN 'drink'            THEN 'drinks_and_music'
  WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
  WHEN 'fine_dining'      THEN 'upscale_fine_dining'
  WHEN 'watch'            THEN 'movies_theatre'
  WHEN 'live_performance' THEN 'movies_theatre'
  WHEN 'wellness'         THEN NULL
  ELSE seeding_category
END WHERE seeding_category IS NOT NULL;

-- ── 9.2a: Fix admin_ai_city_category_coverage — old 13 slugs → new 10 ───

CREATE OR REPLACE FUNCTION admin_ai_city_category_coverage()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
      SELECT
        sc.id AS city_id,
        sc.name AS city_name,
        sc.country AS country,
        cat.category,
        COUNT(pp.id) AS approved_count
      FROM seeding_cities sc
      CROSS JOIN (
        SELECT unnest(ARRAY[
          'nature','icebreakers','drinks_and_music','brunch_lunch_casual',
          'upscale_fine_dining','movies_theatre','creative_arts','play',
          'flowers','groceries'
        ]) AS category
      ) cat
      LEFT JOIN place_pool pp
        ON pp.city_id = sc.id
        AND pp.is_active = true
        AND pp.ai_approved = true
        AND pp.ai_categories @> ARRAY[cat.category]
      GROUP BY sc.id, sc.name, sc.country, cat.category
      ORDER BY sc.name, cat.category
    ) t
  );
END; $$;

-- ── 9.2b: Fix admin_trigger_category_fill — old slugs → new 10 ──────────

CREATE OR REPLACE FUNCTION public.admin_trigger_category_fill(
  p_category TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_m INTEGER DEFAULT 5000,
  p_max_results INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_log_id UUID;
  v_nearby_calls INTEGER;
  v_detail_calls INTEGER;
  v_photo_calls INTEGER;
  v_estimated_cost NUMERIC;
  v_valid_categories TEXT[] := ARRAY[
    'nature','icebreakers','drinks_and_music','brunch_lunch_casual',
    'upscale_fine_dining','movies_theatre','creative_arts','play',
    'flowers','groceries'
  ];
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  v_user_id := auth.uid();

  -- Validate category
  IF NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid category: %', p_category;
  END IF;

  -- Validate coordinates
  IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'Invalid coordinates: lat must be -90..90, lng must be -180..180';
  END IF;

  -- Validate radius
  IF p_radius_m < 100 OR p_radius_m > 50000 THEN
    RAISE EXCEPTION 'Radius must be between 100 and 50000 meters';
  END IF;

  -- Validate max_results
  IF p_max_results < 1 OR p_max_results > 200 THEN
    RAISE EXCEPTION 'max_results must be between 1 and 200';
  END IF;

  -- Cost estimate
  v_nearby_calls := CEIL(p_max_results::numeric / 20);
  v_detail_calls := p_max_results;
  v_photo_calls := p_max_results * 5;
  v_estimated_cost := (v_nearby_calls * 0.032) + (v_detail_calls * 0.017) + (v_photo_calls * 0.007);

  INSERT INTO admin_backfill_log (
    operation_type, triggered_by, status,
    target_category, target_lat, target_lng, target_radius_m,
    total_places, estimated_cost_usd, started_at
  ) VALUES (
    'category_fill', v_user_id, 'pending',
    p_category, p_lat, p_lng, p_radius_m,
    p_max_results, v_estimated_cost, now()
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'backfill_log_id', v_log_id,
    'estimated_api_calls', v_nearby_calls + v_detail_calls + v_photo_calls,
    'estimated_cost_usd', ROUND(v_estimated_cost, 2),
    'status', 'pending'
  );
END;
$$;

-- ── 9.3: Rewrite query_pool_cards — remove backward compat ──────────────
-- Changes:
--   - Removed p_budget_max and p_price_tiers deprecated params
--   - Removed backward-compat CASE table for old slugs (all callers now send new slugs)
--   - Everything else identical

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
  -- Direct assignment — all callers now send canonical new slugs.
  IF p_categories IS NULL OR array_length(p_categories, 1) IS NULL THEN
    v_slug_categories := '{}';
  ELSE
    v_slug_categories := p_categories;
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

-- ── 9.4: Drop deprecated columns ────────────────────────────────────────

ALTER TABLE preferences
  DROP COLUMN IF EXISTS budget_min,
  DROP COLUMN IF EXISTS budget_max,
  DROP COLUMN IF EXISTS price_tiers,
  DROP COLUMN IF EXISTS time_slot,
  DROP COLUMN IF EXISTS exact_time,
  DROP COLUMN IF EXISTS time_slots;

ALTER TABLE board_session_preferences
  DROP COLUMN IF EXISTS budget_min,
  DROP COLUMN IF EXISTS budget_max,
  DROP COLUMN IF EXISTS price_tiers,
  DROP COLUMN IF EXISTS time_slot,
  DROP COLUMN IF EXISTS exact_time,
  DROP COLUMN IF EXISTS time_of_day;

-- ── 9.5: Drop backup tables ─────────────────────────────────────────────

DROP TABLE IF EXISTS preferences_backup_0434;
DROP TABLE IF EXISTS board_session_preferences_backup_0434;
DROP TABLE IF EXISTS place_pool_ai_categories_backup_0434;
