-- ═══════════════════════════════════════════════════════════════════════════════
-- Pool Intelligence V2: Country-First, Seeding-Independent
-- Schema changes + RPC replacements
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 1: Schema Changes
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Add city column to place_pool
ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS city TEXT;

CREATE INDEX IF NOT EXISTS idx_place_pool_city ON public.place_pool (city);

-- 2. Backfill Pass 1: From seeding_cities.name via city_id FK
UPDATE public.place_pool pp
SET city = sc.name
FROM public.seeding_cities sc
WHERE pp.city_id = sc.id
  AND pp.city IS NULL;

-- 3. Backfill Pass 2: Extract locality from raw_google_data addressComponents
UPDATE public.place_pool pp
SET city = locality.value
FROM (
  SELECT
    pp2.id,
    comp->>'longText' AS value
  FROM public.place_pool pp2,
    jsonb_array_elements(pp2.raw_google_data->'addressComponents') AS comp
  WHERE pp2.city IS NULL
    AND pp2.raw_google_data->'addressComponents' IS NOT NULL
    AND comp->'types' ? 'locality'
) locality
WHERE pp.id = locality.id
  AND pp.city IS NULL;

-- 4. Backfill Pass 3: Parse from address (heuristic)
UPDATE public.place_pool
SET city = CASE
  WHEN array_length(string_to_array(address, ','), 1) >= 3
    THEN TRIM(SPLIT_PART(address, ',', 2))
  WHEN array_length(string_to_array(address, ','), 1) = 2
    THEN TRIM(SPLIT_PART(address, ',', 1))
  ELSE NULL
END
WHERE city IS NULL
  AND address IS NOT NULL
  AND address != '';

-- 5. Add city column to card_pool
ALTER TABLE public.card_pool
  ADD COLUMN IF NOT EXISTS city TEXT;

-- Backfill single cards from parent place
UPDATE public.card_pool cp
SET city = pp.city
FROM public.place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.card_type = 'single'
  AND cp.city IS NULL;

-- Backfill curated cards from first stop's place
UPDATE public.card_pool cp
SET city = pp.city
FROM public.card_pool_stops cps
JOIN public.place_pool pp ON pp.id = cps.place_pool_id
WHERE cps.card_pool_id = cp.id
  AND cp.card_type = 'curated'
  AND cp.city IS NULL
  AND cps.stop_order = (
    SELECT MIN(s2.stop_order)
    FROM public.card_pool_stops s2
    WHERE s2.card_pool_id = cp.id
  );

-- 6. Add country column to card_pool
ALTER TABLE public.card_pool
  ADD COLUMN IF NOT EXISTS country TEXT;

UPDATE public.card_pool cp
SET country = pp.country
FROM public.place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.card_type = 'single'
  AND cp.country IS NULL;

UPDATE public.card_pool cp
SET country = pp.country
FROM public.card_pool_stops cps
JOIN public.place_pool pp ON pp.id = cps.place_pool_id
WHERE cps.card_pool_id = cp.id
  AND cp.card_type = 'curated'
  AND cp.country IS NULL
  AND cps.stop_order = (
    SELECT MIN(s2.stop_order)
    FROM public.card_pool_stops s2
    WHERE s2.card_pool_id = cp.id
  );

CREATE INDEX IF NOT EXISTS idx_card_pool_country ON public.card_pool (country);
CREATE INDEX IF NOT EXISTS idx_card_pool_city ON public.card_pool (city);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 2: Drop old RPCs
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_pool_intelligence_overview();
DROP FUNCTION IF EXISTS public.admin_pool_category_health();
DROP FUNCTION IF EXISTS public.admin_pool_category_health(TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_city_category_maturity(UUID);
DROP FUNCTION IF EXISTS public.admin_tile_intelligence(UUID);
DROP FUNCTION IF EXISTS public.admin_uncategorized_places(UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.admin_uncategorized_places(TEXT, UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.admin_card_pool_intelligence(UUID);
DROP FUNCTION IF EXISTS public.admin_card_pool_intelligence(TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_pool_quality_summary();

-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 3: Create new RPCs
-- ═══════════════════════════════════════════════════════════════════════════════

-- 7.1 admin_country_overview()
CREATE OR REPLACE FUNCTION public.admin_country_overview()
RETURNS TABLE (
  country TEXT,
  total_places BIGINT,
  active_places BIGINT,
  with_photos BIGINT,
  photo_pct INTEGER,
  category_coverage INTEGER,
  total_cards BIGINT,
  uncategorized_count BIGINT,
  city_count BIGINT
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
  WITH card_counts AS (
    SELECT COALESCE(cp.country, 'Unknown') AS c_country, COUNT(*) AS cnt
    FROM public.card_pool cp
    WHERE cp.is_active
    GROUP BY COALESCE(cp.country, 'Unknown')
  )
  SELECT
    COALESCE(pp.country, 'Unknown') AS country,
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE pp.is_active) AS active_places,
    COUNT(*) FILTER (WHERE pp.is_active
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE pp.is_active
        AND pp.stored_photo_urls IS NOT NULL
        AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active))::INTEGER
      ELSE 0
    END AS photo_pct,
    COUNT(DISTINCT pp.seeding_category) FILTER (
      WHERE pp.is_active AND pp.seeding_category IS NOT NULL
    )::INTEGER AS category_coverage,
    COALESCE(cc.cnt, 0) AS total_cards,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.seeding_category IS NULL) AS uncategorized_count,
    COUNT(DISTINCT pp.city) FILTER (WHERE pp.city IS NOT NULL) AS city_count
  FROM public.place_pool pp
  LEFT JOIN card_counts cc ON cc.c_country = COALESCE(pp.country, 'Unknown')
  GROUP BY COALESCE(pp.country, 'Unknown'), cc.cnt
  ORDER BY COUNT(*) FILTER (WHERE pp.is_active) DESC;
END;
$$;

-- 7.2 admin_country_city_overview(p_country TEXT)
CREATE OR REPLACE FUNCTION public.admin_country_city_overview(p_country TEXT)
RETURNS TABLE (
  city_name TEXT,
  total_places BIGINT,
  active_places BIGINT,
  with_photos BIGINT,
  photo_pct INTEGER,
  category_coverage INTEGER,
  total_cards BIGINT,
  avg_rating NUMERIC,
  freshness_pct INTEGER,
  uncategorized_count BIGINT
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
  WITH card_counts AS (
    SELECT COALESCE(cp.city, 'Unknown City') AS c_city, COUNT(*) AS cnt
    FROM public.card_pool cp
    WHERE cp.country = p_country AND cp.is_active
    GROUP BY COALESCE(cp.city, 'Unknown City')
  )
  SELECT
    COALESCE(pp.city, 'Unknown City') AS city_name,
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE pp.is_active) AS active_places,
    COUNT(*) FILTER (WHERE pp.is_active
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE pp.is_active
        AND pp.stored_photo_urls IS NOT NULL
        AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active))::INTEGER
      ELSE 0
    END AS photo_pct,
    COUNT(DISTINCT pp.seeding_category) FILTER (
      WHERE pp.is_active AND pp.seeding_category IS NOT NULL
    )::INTEGER AS category_coverage,
    COALESCE(cc.cnt, 0) AS total_cards,
    ROUND((AVG(pp.rating) FILTER (WHERE pp.is_active AND pp.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE pp.is_active
        AND pp.last_detail_refresh > NOW() - INTERVAL '7 days') * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active))::INTEGER
      ELSE 0
    END AS freshness_pct,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.seeding_category IS NULL) AS uncategorized_count
  FROM public.place_pool pp
  LEFT JOIN card_counts cc ON cc.c_city = COALESCE(pp.city, 'Unknown City')
  WHERE pp.country = p_country
  GROUP BY COALESCE(pp.city, 'Unknown City'), cc.cnt
  ORDER BY COUNT(*) FILTER (WHERE pp.is_active) DESC;
END;
$$;

-- 7.3 admin_pool_category_health(p_country, p_city)
DROP FUNCTION IF EXISTS public.admin_pool_category_health(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_pool_category_health(
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
)
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
      COUNT(*) FILTER (WHERE pp.is_active
        AND pp.stored_photo_urls IS NOT NULL
        AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
      ROUND((AVG(pp.rating) FILTER (WHERE pp.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
    FROM public.place_pool pp
    WHERE pp.seeding_category IS NOT NULL
      AND (p_country IS NULL OR pp.country = p_country)
      AND (p_city IS NULL OR pp.city = p_city)
    GROUP BY pp.seeding_category
  ),
  card_stats AS (
    SELECT
      cp.category,
      COUNT(*) AS total_cards,
      COUNT(*) FILTER (WHERE cp.card_type = 'single') AS single_cards,
      COUNT(*) FILTER (WHERE cp.card_type = 'curated') AS curated_cards
    FROM public.card_pool cp
    WHERE cp.is_active
      AND (p_country IS NULL OR cp.country = p_country)
      AND (p_city IS NULL OR cp.city = p_city)
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

-- 7.4 admin_virtual_tile_intelligence(p_country, p_city)
DROP FUNCTION IF EXISTS public.admin_virtual_tile_intelligence(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_virtual_tile_intelligence(
  p_country TEXT,
  p_city TEXT
)
RETURNS TABLE (
  row_idx INTEGER,
  col_idx INTEGER,
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  active_places BIGINT,
  with_photos BIGINT,
  category_count INTEGER,
  top_category TEXT,
  avg_rating NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_min_lat DOUBLE PRECISION;
  v_max_lat DOUBLE PRECISION;
  v_min_lng DOUBLE PRECISION;
  v_max_lng DOUBLE PRECISION;
  v_cell_lat DOUBLE PRECISION := 0.0045;  -- ~500m
  v_cell_lng DOUBLE PRECISION;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Compute bounding box
  SELECT MIN(pp.lat), MAX(pp.lat), MIN(pp.lng), MAX(pp.lng)
  INTO v_min_lat, v_max_lat, v_min_lng, v_max_lng
  FROM public.place_pool pp
  WHERE pp.country = p_country AND pp.city = p_city AND pp.is_active;

  -- No places → empty result
  IF v_min_lat IS NULL THEN
    RETURN;
  END IF;

  -- Adjust longitude cell size for latitude (cosine correction)
  v_cell_lng := v_cell_lat / COS(RADIANS((v_min_lat + v_max_lat) / 2.0));

  -- Prevent division by zero for single-point cities
  IF v_max_lat - v_min_lat < v_cell_lat THEN
    v_min_lat := v_min_lat - v_cell_lat;
    v_max_lat := v_max_lat + v_cell_lat;
  END IF;
  IF v_max_lng - v_min_lng < v_cell_lng THEN
    v_min_lng := v_min_lng - v_cell_lng;
    v_max_lng := v_max_lng + v_cell_lng;
  END IF;

  RETURN QUERY
  SELECT
    r_idx,
    c_idx,
    v_min_lat + r_idx * v_cell_lat + v_cell_lat / 2.0 AS center_lat,
    v_min_lng + c_idx * v_cell_lng + v_cell_lng / 2.0 AS center_lng,
    COUNT(*) AS active_places,
    COUNT(*) FILTER (WHERE pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    COUNT(DISTINCT pp.seeding_category) FILTER (
      WHERE pp.seeding_category IS NOT NULL
    )::INTEGER AS category_count,
    MODE() WITHIN GROUP (ORDER BY pp.seeding_category) AS top_category,
    ROUND((AVG(pp.rating) FILTER (WHERE pp.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
  FROM (
    SELECT
      pp2.*,
      FLOOR((pp2.lat - v_min_lat) / v_cell_lat)::INTEGER AS r_idx,
      FLOOR((pp2.lng - v_min_lng) / v_cell_lng)::INTEGER AS c_idx
    FROM public.place_pool pp2
    WHERE pp2.country = p_country AND pp2.city = p_city AND pp2.is_active
  ) pp
  GROUP BY r_idx, c_idx
  ORDER BY r_idx, c_idx;
END;
$$;

-- 7.5 admin_uncategorized_places(p_country, p_city, p_limit, p_offset)
CREATE OR REPLACE FUNCTION public.admin_uncategorized_places(
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  google_place_id TEXT,
  name TEXT,
  address TEXT,
  types TEXT[],
  primary_type TEXT,
  rating DOUBLE PRECISION,
  city TEXT,
  country TEXT,
  is_active BOOLEAN,
  total_count BIGINT
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
    pp.id,
    pp.google_place_id,
    pp.name,
    pp.address,
    pp.types,
    pp.primary_type,
    pp.rating,
    pp.city,
    pp.country,
    pp.is_active,
    COUNT(*) OVER() AS total_count
  FROM public.place_pool pp
  WHERE pp.seeding_category IS NULL
    AND (p_country IS NULL OR pp.country = p_country)
    AND (p_city IS NULL OR pp.city = p_city)
  ORDER BY pp.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 7.6 admin_card_pool_intelligence(p_country, p_city)
CREATE OR REPLACE FUNCTION public.admin_card_pool_intelligence(
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
)
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
    WHERE (p_country IS NULL OR cp.country = p_country)
      AND (p_city IS NULL OR cp.city = p_city)
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
