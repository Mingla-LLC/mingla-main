-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 2: RPC Redesign — FK-Based Navigation
-- Rewrites 5 RPCs to use city_id (UUID) and country_code instead of raw text.
-- Creates 1 new RPC for the city picker dropdown.
-- All stats use AI-approved places only. Categories use ai_categories[1] only.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── RPC 1: admin_place_pool_overview ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_place_pool_overview(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_place_pool_overview(
  p_city_id UUID DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_places BIGINT,
  active_places BIGINT,
  ai_approved_places BIGINT,
  with_photos BIGINT,
  photo_pct INTEGER,
  ai_validated_count BIGINT,
  ai_approved_count BIGINT,
  ai_rejected_count BIGINT,
  ai_pending_count BIGINT,
  distinct_categories INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE pp.is_active) AS active_places,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) AS ai_approved_places,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true
      AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true
          AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true)
      )::INTEGER ELSE 0
    END AS photo_pct,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved IS NOT NULL) AS ai_validated_count,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) AS ai_approved_count,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = false) AS ai_rejected_count,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved IS NULL) AS ai_pending_count,
    COUNT(DISTINCT pp.ai_categories[1]) FILTER (
      WHERE pp.is_active AND pp.ai_approved = true AND pp.ai_categories IS NOT NULL AND array_length(pp.ai_categories, 1) > 0
    )::INTEGER AS distinct_categories
  FROM place_pool pp
  LEFT JOIN seeding_cities sc ON pp.city_id = sc.id
  WHERE (p_city_id IS NULL OR pp.city_id = p_city_id)
    AND (p_country_code IS NULL OR sc.country_code = p_country_code);
END;
$$;

-- ── RPC 2: admin_place_country_overview ─────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_place_country_overview();

CREATE OR REPLACE FUNCTION public.admin_place_country_overview()
RETURNS TABLE (
  country_code TEXT,
  country_name TEXT,
  city_count BIGINT,
  ai_approved_places BIGINT,
  photo_pct INTEGER,
  ai_validated_pct INTEGER,
  category_coverage INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    sc.country_code,
    sc.country AS country_name,
    COUNT(DISTINCT sc.id) AS city_count,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) AS ai_approved_places,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true
          AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true)
      )::INTEGER ELSE 0
    END AS photo_pct,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active)
      )::INTEGER ELSE 0
    END AS ai_validated_pct,
    COUNT(DISTINCT pp.ai_categories[1]) FILTER (
      WHERE pp.is_active AND pp.ai_approved = true AND pp.ai_categories IS NOT NULL AND array_length(pp.ai_categories, 1) > 0
    )::INTEGER AS category_coverage
  FROM seeding_cities sc
  LEFT JOIN place_pool pp ON pp.city_id = sc.id
  GROUP BY sc.country_code, sc.country
  ORDER BY COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) DESC;
END;
$$;

-- ── RPC 3: admin_place_city_overview ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_place_city_overview(TEXT);

CREATE OR REPLACE FUNCTION public.admin_place_city_overview(p_country_code TEXT)
RETURNS TABLE (
  city_id UUID,
  city_name TEXT,
  ai_approved_places BIGINT,
  photo_pct INTEGER,
  ai_validated_pct INTEGER,
  category_coverage INTEGER,
  avg_rating NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) AS ai_approved_places,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true
          AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true)
      )::INTEGER ELSE 0
    END AS photo_pct,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active)
      )::INTEGER ELSE 0
    END AS ai_validated_pct,
    COUNT(DISTINCT pp.ai_categories[1]) FILTER (
      WHERE pp.is_active AND pp.ai_approved = true AND pp.ai_categories IS NOT NULL AND array_length(pp.ai_categories, 1) > 0
    )::INTEGER AS category_coverage,
    ROUND((AVG(pp.rating) FILTER (WHERE pp.is_active AND pp.ai_approved = true AND pp.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
  FROM seeding_cities sc
  LEFT JOIN place_pool pp ON pp.city_id = sc.id
  WHERE sc.country_code = p_country_code
  GROUP BY sc.id, sc.name
  ORDER BY COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) DESC;
END;
$$;

-- ── RPC 4: admin_place_category_breakdown ───────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_place_category_breakdown(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_place_category_breakdown(
  p_city_id UUID DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  category TEXT,
  place_count BIGINT,
  photo_pct INTEGER,
  avg_rating NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    pp.ai_categories[1] AS category,
    COUNT(*) AS place_count,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*)
      )::INTEGER ELSE 0
    END AS photo_pct,
    ROUND((AVG(pp.rating) FILTER (WHERE pp.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
  FROM place_pool pp
  LEFT JOIN seeding_cities sc ON pp.city_id = sc.id
  WHERE pp.is_active
    AND pp.ai_approved = true
    AND pp.ai_categories IS NOT NULL
    AND array_length(pp.ai_categories, 1) > 0
    AND (p_city_id IS NULL OR pp.city_id = p_city_id)
    AND (p_country_code IS NULL OR sc.country_code = p_country_code)
  GROUP BY pp.ai_categories[1]
  ORDER BY COUNT(*) DESC;
END;
$$;

-- ── RPC 5: admin_place_photo_stats ──────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_place_photo_stats(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_place_photo_stats(p_city_id UUID)
RETURNS TABLE (
  total_places BIGINT,
  with_photos BIGINT,
  without_photos BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    COUNT(*) FILTER (WHERE pp.stored_photo_urls IS NULL OR array_length(pp.stored_photo_urls, 1) IS NULL) AS without_photos
  FROM place_pool pp
  WHERE pp.city_id = p_city_id
    AND pp.is_active
    AND pp.ai_approved = true;
END;
$$;

-- ── RPC 6: admin_city_picker_data (NEW) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_city_picker_data()
RETURNS TABLE (
  city_id UUID,
  city_name TEXT,
  country_name TEXT,
  country_code TEXT,
  city_status TEXT,
  ai_approved_places BIGINT,
  total_active_places BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users au WHERE au.email = auth.email() AND au.status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    sc.country AS country_name,
    sc.country_code,
    sc.status AS city_status,
    COUNT(pp.id) FILTER (WHERE pp.is_active AND pp.ai_approved = true) AS ai_approved_places,
    COUNT(pp.id) FILTER (WHERE pp.is_active) AS total_active_places
  FROM seeding_cities sc
  LEFT JOIN place_pool pp ON pp.city_id = sc.id
  GROUP BY sc.id, sc.name, sc.country, sc.country_code, sc.status
  ORDER BY sc.country, sc.name;
END;
$$;
