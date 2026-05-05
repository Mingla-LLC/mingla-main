-- ============================================================================
-- Fix AI Validation RPCs: server-side city stats + simplified coverage
-- ============================================================================

-- 1. New RPC: admin_ai_city_stats — per-city breakdown (replaces broken client query)

CREATE OR REPLACE FUNCTION admin_ai_city_stats()
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
        COUNT(*) AS total_active,
        COUNT(*) FILTER (WHERE pp.ai_approved = true) AS approved,
        COUNT(*) FILTER (WHERE pp.ai_approved = false) AS rejected,
        COUNT(*) FILTER (WHERE pp.ai_approved IS NULL) AS unvalidated
      FROM place_pool pp
      JOIN seeding_cities sc ON sc.id = pp.city_id
      WHERE pp.is_active = true
      GROUP BY sc.id, sc.name, sc.country
      ORDER BY COUNT(*) FILTER (WHERE pp.ai_approved IS NULL) DESC, sc.name
    ) t
  );
END; $$;

-- 2. New RPC: admin_ai_city_overview — single city stats for stat cards

CREATE OR REPLACE FUNCTION admin_ai_city_overview(p_city_id UUID)
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
    'rejected',      COUNT(*) FILTER (WHERE is_active = true AND ai_approved = false)
  ) INTO result FROM place_pool WHERE city_id = p_city_id;

  RETURN result;
END; $$;

-- 3. Simplify coverage RPC: remove broken unvalidated_count, add explicit ai_approved = true

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
          'casual_eats','fine_dining','drink','first_meet','flowers',
          'watch','live_performance','creative_arts','play','wellness',
          'nature_views','picnic_park','groceries'
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
