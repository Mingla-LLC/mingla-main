-- Fix Pool Intelligence RPC bugs:
--   1. Ambiguous "status" column in admin_pool_intelligence_overview
--   2. ROUND(double precision, integer) → cast to NUMERIC in 3 RPCs
--   3. Stale category values in card_pool

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 1 + FIX 2a: admin_pool_intelligence_overview
--   • Rename output column "status" → "city_status" to avoid ambiguity
--   • No ROUND(double, int) issue here (already uses ::INTEGER cast)
--   • Must DROP first because return type changed
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_pool_intelligence_overview();

CREATE OR REPLACE FUNCTION public.admin_pool_intelligence_overview()
RETURNS TABLE (
  city_id UUID,
  city_name TEXT,
  country TEXT,
  city_status TEXT,
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
    sc.status AS city_status,
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
-- FIX 2b: admin_pool_category_health — cast AVG(rating) to NUMERIC before ROUND
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
      ROUND((AVG(pp.rating) FILTER (WHERE pp.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
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
-- FIX 2c: admin_city_category_maturity — cast AVG(rating) to NUMERIC before ROUND
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_city_category_maturity(p_city_id UUID)
RETURNS TABLE (
  category TEXT,
  total_places BIGINT,
  active_places BIGINT,
  with_photos BIGINT,
  photo_pct INTEGER,
  avg_rating NUMERIC,
  total_cards BIGINT,
  single_cards BIGINT,
  curated_cards BIGINT,
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
      COUNT(*) FILTER (WHERE pp.is_active AND pp.stored_photo_urls IS NOT NULL
        AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
      ROUND((AVG(pp.rating) FILTER (WHERE pp.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
    FROM public.place_pool pp
    WHERE pp.city_id = p_city_id AND pp.seeding_category IS NOT NULL
    GROUP BY pp.seeding_category
  ),
  card_stats AS (
    SELECT
      cp.category,
      COUNT(*) AS total_cards,
      COUNT(*) FILTER (WHERE cp.card_type = 'single') AS single_cards,
      COUNT(*) FILTER (WHERE cp.card_type = 'curated') AS curated_cards
    FROM public.card_pool cp
    WHERE cp.city_id = p_city_id AND cp.is_active
    GROUP BY cp.category
  )
  SELECT
    ps.seeding_category AS category,
    ps.total_places,
    ps.active_places,
    ps.with_photos,
    CASE WHEN ps.active_places > 0
      THEN ROUND(ps.with_photos * 100.0 / ps.active_places)::INTEGER
      ELSE 0 END AS photo_pct,
    ps.avg_rating,
    COALESCE(cs.total_cards, 0) AS total_cards,
    COALESCE(cs.single_cards, 0) AS single_cards,
    COALESCE(cs.curated_cards, 0) AS curated_cards,
    GREATEST(ps.active_places - COALESCE(cs.total_cards, 0), 0) AS places_needing_cards,
    CASE
      WHEN COALESCE(cs.total_cards, 0) >= ps.active_places * 0.8 THEN 'green'
      WHEN COALESCE(cs.total_cards, 0) >= ps.active_places * 0.5 THEN 'yellow'
      ELSE 'red'
    END AS health
  FROM place_stats ps
  LEFT JOIN card_stats cs ON cs.category = ps.seeding_category
  ORDER BY ps.active_places DESC;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 2d: admin_card_pool_intelligence — cast AVG(served_count) to NUMERIC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_card_pool_intelligence(p_city_id UUID DEFAULT NULL)
RETURNS TABLE (
  total_cards BIGINT,
  active_cards BIGINT,
  inactive_cards BIGINT,
  single_cards BIGINT,
  curated_cards BIGINT,
  with_images BIGINT,
  image_pct INTEGER,
  orphaned_cards BIGINT,
  stale_cards BIGINT,
  total_impressions BIGINT,
  total_served BIGINT,
  never_served BIGINT,
  avg_served_count NUMERIC,
  categories_covered INTEGER,
  by_category JSONB
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
  WITH cards AS (
    SELECT cp.*
    FROM public.card_pool cp
    WHERE (p_city_id IS NULL OR cp.city_id = p_city_id)
  ),
  cat_breakdown AS (
    SELECT jsonb_object_agg(
      cat,
      jsonb_build_object(
        'total', cnt,
        'active', active_cnt,
        'single', single_cnt,
        'curated', curated_cnt
      )
    ) AS by_cat
    FROM (
      SELECT
        c.category AS cat,
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE c.is_active) AS active_cnt,
        COUNT(*) FILTER (WHERE c.card_type = 'single') AS single_cnt,
        COUNT(*) FILTER (WHERE c.card_type = 'curated') AS curated_cnt
      FROM cards c
      WHERE c.category IS NOT NULL
      GROUP BY c.category
    ) sub
  ),
  impressions AS (
    SELECT COUNT(*) AS total_imp
    FROM public.user_card_impressions uci
    WHERE EXISTS (SELECT 1 FROM cards c WHERE c.id = uci.card_pool_id)
  )
  SELECT
    COUNT(*) AS total_cards,
    COUNT(*) FILTER (WHERE c.is_active) AS active_cards,
    COUNT(*) FILTER (WHERE NOT c.is_active) AS inactive_cards,
    COUNT(*) FILTER (WHERE c.card_type = 'single') AS single_cards,
    COUNT(*) FILTER (WHERE c.card_type = 'curated') AS curated_cards,
    COUNT(*) FILTER (WHERE c.image_url IS NOT NULL) AS with_images,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE c.image_url IS NOT NULL) * 100.0 / COUNT(*))::INTEGER
      ELSE 0 END AS image_pct,
    COUNT(*) FILTER (WHERE c.card_type = 'single' AND c.is_active AND (
      c.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.place_pool pp WHERE pp.id = c.place_pool_id AND pp.is_active
      )
    )) AS orphaned_cards,
    COUNT(*) FILTER (WHERE c.card_type = 'single' AND c.is_active AND EXISTS (
      SELECT 1 FROM public.place_pool pp WHERE pp.id = c.place_pool_id
        AND pp.last_detail_refresh < NOW() - INTERVAL '30 days'
    )) AS stale_cards,
    (SELECT total_imp FROM impressions) AS total_impressions,
    COUNT(*) FILTER (WHERE c.served_count > 0) AS total_served,
    COUNT(*) FILTER (WHERE c.is_active AND (c.served_count IS NULL OR c.served_count = 0)) AS never_served,
    ROUND((AVG(c.served_count) FILTER (WHERE c.served_count > 0))::NUMERIC, 1) AS avg_served_count,
    COUNT(DISTINCT c.category) FILTER (WHERE c.is_active AND c.category IS NOT NULL)::INTEGER AS categories_covered,
    (SELECT COALESCE(by_cat, '{}'::jsonb) FROM cat_breakdown) AS by_category
  FROM cards c;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX 3: Stale category cleanup in card_pool
-- ═══════════════════════════════════════════════════════════════════════════════

-- Legacy short names → correct slugs
UPDATE public.card_pool SET category = 'nature_views' WHERE category = 'Nature';
UPDATE public.card_pool SET category = 'picnic_park' WHERE category = 'Picnic';
UPDATE public.card_pool SET category = 'flowers' WHERE category = 'Groceries & Flowers';

-- Work & Business is not a valid category — deactivate these cards
UPDATE public.card_pool SET is_active = false WHERE category = 'Work & Business';

-- Also normalize the categories[] array for these same values
UPDATE public.card_pool
SET categories = (
  SELECT array_agg(
    CASE val
      WHEN 'Nature' THEN 'nature_views'
      WHEN 'Picnic' THEN 'picnic_park'
      WHEN 'Groceries & Flowers' THEN 'flowers'
      WHEN 'Work & Business' THEN 'wellness'
      ELSE val
    END
  )
  FROM unnest(categories) AS val
)
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0
  AND (
    'Nature' = ANY(categories) OR
    'Picnic' = ANY(categories) OR
    'Groceries & Flowers' = ANY(categories) OR
    'Work & Business' = ANY(categories)
  );

-- Final catch-all: single cards with non-slug categories → derive from parent place
UPDATE public.card_pool cp
SET category = pp.seeding_category
FROM public.place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.card_type = 'single'
  AND pp.seeding_category IS NOT NULL
  AND cp.category NOT IN (
    'nature_views', 'first_meet', 'picnic_park', 'drink', 'casual_eats',
    'fine_dining', 'watch', 'live_performance', 'creative_arts', 'play',
    'wellness', 'flowers', 'groceries'
  );

-- Curated cards catch-all: derive from first stop's place
UPDATE public.card_pool cp
SET category = pp.seeding_category
FROM public.card_pool_stops cps
JOIN public.place_pool pp ON pp.id = cps.place_pool_id
WHERE cps.card_pool_id = cp.id
  AND cp.card_type = 'curated'
  AND pp.seeding_category IS NOT NULL
  AND cp.category NOT IN (
    'nature_views', 'first_meet', 'picnic_park', 'drink', 'casual_eats',
    'fine_dining', 'watch', 'live_performance', 'creative_arts', 'play',
    'wellness', 'flowers', 'groceries'
  )
  AND cps.stop_order = (
    SELECT MIN(cps2.stop_order)
    FROM public.card_pool_stops cps2
    WHERE cps2.card_pool_id = cp.id
  );
