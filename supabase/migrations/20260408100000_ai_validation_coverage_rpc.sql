-- ============================================================================
-- AI Validation: City × Category coverage RPC + scope fixes
-- ============================================================================

-- 1. New RPC: admin_ai_city_category_coverage
-- Returns approved + unvalidated counts for every city × category combination.
-- Used by the Command Center heatmap in the AI Validation page.

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
        COUNT(pp.id) FILTER (WHERE pp.ai_approved = true) AS approved_count,
        COUNT(pp.id) FILTER (WHERE pp.ai_approved IS NULL AND pp.is_active = true) AS unvalidated_count
      FROM seeding_cities sc
      CROSS JOIN (
        SELECT unnest(ARRAY[
          'casual_eats','fine_dining','drink','first_meet','flowers',
          'watch','live_performance','creative_arts','play','wellness',
          'nature_views','picnic_park','groceries'
        ]) AS category
      ) cat
      LEFT JOIN place_pool pp
        ON pp.city_id = sc.id
        AND pp.is_active = true
        AND pp.ai_categories @> ARRAY[cat.category]
      GROUP BY sc.id, sc.name, sc.country, cat.category
      ORDER BY sc.name, cat.category
    ) t
  );
END; $$;

-- 2. Fix admin_ai_validation_preview to use ai_approved IS NULL instead of ai_validated_at IS NULL
-- Also add support for 'failed' scope

CREATE OR REPLACE FUNCTION admin_ai_validation_preview(
  p_scope TEXT DEFAULT 'unvalidated',
  p_category TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_revalidate BOOLEAN DEFAULT false
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  place_count INTEGER; est_search_cost REAL; est_gpt_cost REAL; est_total REAL; est_minutes REAL;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COUNT(*) INTO place_count FROM place_pool
  WHERE is_active = true
    AND (
      p_scope = 'all' OR p_revalidate = true
      OR (p_scope = 'unvalidated' AND ai_approved IS NULL)
      OR (p_scope = 'failed' AND ai_validated_at IS NOT NULL AND ai_approved IS NULL)
      OR (p_scope NOT IN ('all','unvalidated','failed') AND ai_approved IS NULL)
    )
    AND (p_category IS NULL OR ai_categories @> ARRAY[p_category])
    AND (p_country IS NULL OR country ILIKE '%' || p_country || '%')
    AND (p_city IS NULL OR city ILIKE '%' || p_city || '%');

  est_search_cost := place_count * 0.85 * 0.0004;
  est_gpt_cost    := place_count * 0.85 * 0.0003;
  est_total       := (est_search_cost + est_gpt_cost) * 1.15;
  est_minutes     := CEIL(place_count / 25.0) * 0.75;

  RETURN json_build_object(
    'places_to_process', place_count,
    'estimated_cost_usd', ROUND(est_total::numeric, 2),
    'estimated_minutes',  ROUND(est_minutes::numeric, 0),
    'breakdown', json_build_object(
      'serper_cost',      ROUND(est_search_cost::numeric, 4),
      'gpt_cost',         ROUND(est_gpt_cost::numeric, 4),
      'contingency_pct',  15
    )
  );
END; $$;

-- 3. Fix admin_ai_validation_overview to also count by ai_approved IS NULL
-- (consistent with the new "unvalidated" definition)

CREATE OR REPLACE FUNCTION admin_ai_validation_overview()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT json_build_object(
    'total_active',  COUNT(*) FILTER (WHERE is_active = true),
    'validated',     COUNT(*) FILTER (WHERE is_active = true AND ai_approved IS NOT NULL),
    'unvalidated',   COUNT(*) FILTER (WHERE is_active = true AND ai_approved IS NULL),
    'approved',      COUNT(*) FILTER (WHERE is_active = true AND ai_approved = true),
    'rejected',      COUNT(*) FILTER (WHERE is_active = true AND ai_approved = false),
    'failed',        COUNT(*) FILTER (WHERE is_active = true AND ai_validated_at IS NOT NULL AND ai_approved IS NULL)
  ) INTO result FROM place_pool;

  RETURN result;
END; $$;

-- 4. Add 'failed' to scope constraint on ai_validation_jobs

DO $$ BEGIN
  ALTER TABLE ai_validation_jobs DROP CONSTRAINT IF EXISTS chk_avj_scope;
  ALTER TABLE ai_validation_jobs
    ADD CONSTRAINT chk_avj_scope
    CHECK (scope IS NULL OR scope IN ('unvalidated','all','category','location','failed'));
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
