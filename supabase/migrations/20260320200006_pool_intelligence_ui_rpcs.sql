-- Pool Intelligence UI RPCs
-- Depends on: 20260320200005 (fixed RPCs), card_pool.city_id, normalized categories

-- ── 1. admin_city_category_maturity ──────────────────────────────────────────
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
      ROUND(AVG(pp.rating) FILTER (WHERE pp.rating IS NOT NULL), 1) AS avg_rating
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

-- ── 2. admin_tile_intelligence ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_tile_intelligence(p_city_id UUID)
RETURNS TABLE (
  tile_id UUID,
  tile_index INTEGER,
  row_idx INTEGER,
  col_idx INTEGER,
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  radius_m INTEGER,
  total_places BIGINT,
  active_places BIGINT,
  with_photos BIGINT,
  category_count INTEGER,
  top_category TEXT,
  seeded BOOLEAN,
  last_seeded_at TIMESTAMPTZ
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
  WITH tile_places AS (
    SELECT
      st.id AS t_id,
      pp.id AS place_id,
      pp.is_active,
      pp.stored_photo_urls,
      pp.seeding_category
    FROM public.seeding_tiles st
    LEFT JOIN public.place_pool pp ON pp.city_id = p_city_id
      AND pp.is_active
      AND ABS(pp.lat - st.center_lat) < (st.radius_m / 111000.0)
      AND ABS(pp.lng - st.center_lng) < (st.radius_m / (111000.0 * COS(RADIANS(st.center_lat))))
    WHERE st.city_id = p_city_id
  ),
  tile_agg AS (
    SELECT
      tp.t_id,
      COUNT(tp.place_id) AS total_places,
      COUNT(tp.place_id) FILTER (WHERE tp.is_active) AS active_places,
      COUNT(tp.place_id) FILTER (WHERE tp.stored_photo_urls IS NOT NULL
        AND array_length(tp.stored_photo_urls, 1) > 0) AS with_photos,
      COUNT(DISTINCT tp.seeding_category) FILTER (WHERE tp.seeding_category IS NOT NULL)::INTEGER AS category_count,
      MODE() WITHIN GROUP (ORDER BY tp.seeding_category) AS top_category
    FROM tile_places tp
    GROUP BY tp.t_id
  ),
  tile_ops AS (
    SELECT
      so.tile_id AS t_id,
      MAX(so.completed_at) AS last_seeded_at,
      COUNT(*) FILTER (WHERE so.status = 'completed') > 0 AS seeded
    FROM public.seeding_operations so
    WHERE so.city_id = p_city_id AND so.tile_id IS NOT NULL
    GROUP BY so.tile_id
  )
  SELECT
    st.id AS tile_id,
    st.tile_index,
    st.row_idx,
    st.col_idx,
    st.center_lat,
    st.center_lng,
    st.radius_m,
    COALESCE(ta.total_places, 0) AS total_places,
    COALESCE(ta.active_places, 0) AS active_places,
    COALESCE(ta.with_photos, 0) AS with_photos,
    COALESCE(ta.category_count, 0) AS category_count,
    ta.top_category,
    COALESCE(top.seeded, FALSE) AS seeded,
    top.last_seeded_at
  FROM public.seeding_tiles st
  LEFT JOIN tile_agg ta ON ta.t_id = st.id
  LEFT JOIN tile_ops top ON top.t_id = st.id
  ORDER BY st.tile_index;
END;
$$;

-- ── 3. admin_uncategorized_places ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_uncategorized_places(
  p_city_id UUID DEFAULT NULL,
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
  city_name TEXT,
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
    sc.name AS city_name,
    pp.country,
    pp.is_active,
    COUNT(*) OVER() AS total_count
  FROM public.place_pool pp
  LEFT JOIN public.seeding_cities sc ON sc.id = pp.city_id
  WHERE pp.seeding_category IS NULL
    AND (p_city_id IS NULL OR pp.city_id = p_city_id)
  ORDER BY pp.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── 4. admin_card_pool_intelligence ──────────────────────────────────────────
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
    ROUND(AVG(c.served_count) FILTER (WHERE c.served_count > 0), 1) AS avg_served_count,
    COUNT(DISTINCT c.category) FILTER (WHERE c.is_active AND c.category IS NOT NULL)::INTEGER AS categories_covered,
    (SELECT COALESCE(by_cat, '{}'::jsonb) FROM cat_breakdown) AS by_category
  FROM cards c;
END;
$$;

-- ── 5. admin_assign_place_category ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_assign_place_category(
  p_place_ids UUID[],
  p_category TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_category NOT IN (
    'nature_views', 'first_meet', 'picnic_park', 'drink', 'casual_eats',
    'fine_dining', 'watch', 'live_performance', 'creative_arts', 'play',
    'wellness', 'flowers', 'groceries'
  ) THEN
    RAISE EXCEPTION 'Invalid category slug: %', p_category;
  END IF;

  UPDATE public.place_pool
  SET seeding_category = p_category, updated_at = NOW()
  WHERE id = ANY(p_place_ids)
    AND seeding_category IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_count);
END;
$$;
