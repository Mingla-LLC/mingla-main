-- Migration: RPC functions for Pool Intelligence page
-- All functions are SECURITY DEFINER with admin auth gate.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. admin_pool_intelligence_overview — one row per city with all key metrics
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_pool_intelligence_overview()
RETURNS TABLE (
  city_id UUID,
  city_name TEXT,
  country TEXT,
  status TEXT,
  total_places BIGINT,
  active_places BIGINT,
  with_photos BIGINT,
  photo_pct INTEGER,
  category_coverage INTEGER,
  total_cards BIGINT,
  fresh_places BIGINT,
  freshness_pct INTEGER,
  seeding_spend DOUBLE PRECISION,
  readiness_pct INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    sc.country,
    sc.status,
    COUNT(pp.id) AS total_places,
    COUNT(pp.id) FILTER (WHERE pp.is_active) AS active_places,
    COUNT(pp.id) FILTER (WHERE pp.is_active AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    CASE WHEN COUNT(pp.id) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(COUNT(pp.id) FILTER (WHERE pp.is_active AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0 / COUNT(pp.id) FILTER (WHERE pp.is_active))::INTEGER
      ELSE 0
    END AS photo_pct,
    COUNT(DISTINCT pp.seeding_category) FILTER (WHERE pp.is_active AND pp.seeding_category IS NOT NULL)::INTEGER AS category_coverage,
    (SELECT COUNT(*) FROM public.card_pool cp WHERE cp.city_id = sc.id AND cp.is_active) AS total_cards,
    COUNT(pp.id) FILTER (WHERE pp.is_active AND pp.last_detail_refresh > NOW() - INTERVAL '7 days') AS fresh_places,
    CASE WHEN COUNT(pp.id) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(COUNT(pp.id) FILTER (WHERE pp.is_active AND pp.last_detail_refresh > NOW() - INTERVAL '7 days') * 100.0 / COUNT(pp.id) FILTER (WHERE pp.is_active))::INTEGER
      ELSE 0
    END AS freshness_pct,
    COALESCE((SELECT SUM(so.estimated_cost_usd) FROM public.seeding_operations so WHERE so.city_id = sc.id), 0) AS seeding_spend,
    LEAST(100, (
      LEAST(ROUND(COUNT(pp.id) FILTER (WHERE pp.is_active) * 100.0 / GREATEST(50, 1))::INTEGER, 100) * 14 / 100 +
      CASE WHEN COUNT(pp.id) FILTER (WHERE pp.is_active) > 0
        THEN LEAST(ROUND(COUNT(pp.id) FILTER (WHERE pp.is_active AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0 / COUNT(pp.id) FILTER (WHERE pp.is_active))::INTEGER * 14 / 80, 14)
        ELSE 0
      END +
      LEAST(COUNT(DISTINCT pp.seeding_category) FILTER (WHERE pp.is_active AND pp.seeding_category IS NOT NULL)::INTEGER * 14 / 8, 14) +
      CASE WHEN (SELECT COUNT(*) FROM public.card_pool cp WHERE cp.city_id = sc.id AND cp.is_active) > 0 THEN 14 ELSE 0 END +
      CASE WHEN COUNT(pp.id) FILTER (WHERE pp.is_active) > 0
        THEN LEAST(ROUND(COUNT(pp.id) FILTER (WHERE pp.is_active AND pp.last_detail_refresh > NOW() - INTERVAL '7 days') * 100.0 / COUNT(pp.id) FILTER (WHERE pp.is_active))::INTEGER * 14 / 80, 14)
        ELSE 0
      END +
      CASE WHEN COALESCE((SELECT SUM(so.estimated_cost_usd) FROM public.seeding_operations so WHERE so.city_id = sc.id), 0) <= 70 THEN 15 ELSE 0 END +
      CASE WHEN (SELECT COUNT(*) FROM public.seeding_tiles st WHERE st.city_id = sc.id) > 0 THEN 15 ELSE 0 END
    ))::INTEGER AS readiness_pct
  FROM public.seeding_cities sc
  LEFT JOIN public.place_pool pp ON pp.city_id = sc.id
  GROUP BY sc.id, sc.name, sc.country, sc.status
  ORDER BY sc.name;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. admin_pool_category_health — one row per seeding category with metrics
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_pool_category_health()
RETURNS TABLE (
  category TEXT,
  total_places BIGINT,
  active_places BIGINT,
  with_photos BIGINT,
  photo_pct INTEGER,
  avg_rating NUMERIC,
  total_cards BIGINT,
  places_needing_cards BIGINT,
  health TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH place_stats AS (
    SELECT
      pp.seeding_category,
      COUNT(*) AS total_places,
      COUNT(*) FILTER (WHERE pp.is_active) AS active_places,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
      ROUND(AVG(pp.rating) FILTER (WHERE pp.rating IS NOT NULL), 1) AS avg_rating
    FROM public.place_pool pp
    WHERE pp.seeding_category IS NOT NULL
    GROUP BY pp.seeding_category
  ),
  card_stats AS (
    SELECT
      cp.category,
      COUNT(*) AS total_cards
    FROM public.card_pool cp
    WHERE cp.is_active
    GROUP BY cp.category
  )
  SELECT
    ps.seeding_category AS category,
    ps.total_places,
    ps.active_places,
    ps.with_photos,
    CASE WHEN ps.active_places > 0
      THEN ROUND(ps.with_photos * 100.0 / ps.active_places)::INTEGER
      ELSE 0
    END AS photo_pct,
    ps.avg_rating,
    COALESCE(cs.total_cards, 0) AS total_cards,
    GREATEST(ps.active_places - COALESCE(cs.total_cards, 0), 0) AS places_needing_cards,
    CASE
      WHEN COALESCE(cs.total_cards, 0) >= ps.active_places * 0.8 THEN 'green'
      WHEN COALESCE(cs.total_cards, 0) >= ps.active_places * 0.5 THEN 'yellow'
      ELSE 'red'
    END AS health
  FROM place_stats ps
  LEFT JOIN card_stats cs ON cs.category = ps.seeding_category
  ORDER BY ps.total_places DESC;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. admin_pool_quality_summary — aggregate data quality metrics
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_pool_quality_summary()
RETURNS TABLE (
  total_places BIGINT,
  categorized_count BIGINT,
  categorized_pct INTEGER,
  with_photos_count BIGINT,
  with_photos_pct INTEGER,
  with_rating_count BIGINT,
  fresh_count BIGINT,
  with_reviews_count BIGINT,
  avg_quality_score NUMERIC,
  quality_5 BIGINT,
  quality_4 BIGINT,
  quality_3 BIGINT,
  quality_2 BIGINT,
  quality_1 BIGINT,
  quality_0 BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      pp.id,
      (pp.seeding_category IS NOT NULL) AS has_category,
      (pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) AS has_photos,
      (pp.rating IS NOT NULL) AS has_rating,
      (pp.last_detail_refresh > NOW() - INTERVAL '7 days') AS is_fresh,
      (pp.review_count > 0) AS has_reviews
    FROM public.place_pool pp
    WHERE pp.is_active
  ),
  scored AS (
    SELECT *,
      (has_category::int + has_photos::int + has_rating::int + is_fresh::int + has_reviews::int) AS quality_score
    FROM base
  )
  SELECT
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE has_category) AS categorized_count,
    CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE has_category) * 100.0 / COUNT(*))::INTEGER ELSE 0 END AS categorized_pct,
    COUNT(*) FILTER (WHERE has_photos) AS with_photos_count,
    CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE has_photos) * 100.0 / COUNT(*))::INTEGER ELSE 0 END AS with_photos_pct,
    COUNT(*) FILTER (WHERE has_rating) AS with_rating_count,
    COUNT(*) FILTER (WHERE is_fresh) AS fresh_count,
    COUNT(*) FILTER (WHERE has_reviews) AS with_reviews_count,
    ROUND(AVG(quality_score), 1) AS avg_quality_score,
    COUNT(*) FILTER (WHERE quality_score = 5) AS quality_5,
    COUNT(*) FILTER (WHERE quality_score = 4) AS quality_4,
    COUNT(*) FILTER (WHERE quality_score = 3) AS quality_3,
    COUNT(*) FILTER (WHERE quality_score = 2) AS quality_2,
    COUNT(*) FILTER (WHERE quality_score = 1) AS quality_1,
    COUNT(*) FILTER (WHERE quality_score = 0) AS quality_0
  FROM scored;
END;
$$;
