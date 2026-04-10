-- ORCH-0342 Phase 2: Rewrite Card Pool RPCs from text city/country to city_id UUID
-- Follows the same subquery pattern used for Place Pool RPCs (ORCH-0344).
-- Depends on Phase 1 backfill having populated city_id on existing cards.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Drop old text-param signatures to avoid overload conflicts
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_card_pool_intelligence(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_card_category_health(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_card_city_overview(TEXT);
DROP FUNCTION IF EXISTS public.admin_card_country_overview();
DROP FUNCTION IF EXISTS public.admin_detect_duplicate_curated_cards(TEXT, TEXT);

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC 1: admin_card_pool_intelligence (city_id + country_code)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_card_pool_intelligence(
  p_city_id UUID DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL
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
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH cards AS (
    SELECT cp.*
    FROM card_pool cp
    WHERE (p_city_id IS NULL OR cp.city_id = p_city_id)
      AND (p_country_code IS NULL OR cp.city_id IN (
        SELECT sc.id FROM seeding_cities sc WHERE sc.country_code = p_country_code
      ))
  ),
  cat_breakdown AS (
    SELECT jsonb_object_agg(
      cat,
      jsonb_build_object('total', cnt, 'active', active_cnt, 'single', single_cnt, 'curated', curated_cnt)
    ) AS by_cat
    FROM (
      SELECT c.category AS cat, COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE c.is_active) AS active_cnt,
        COUNT(*) FILTER (WHERE c.card_type = 'single') AS single_cnt,
        COUNT(*) FILTER (WHERE c.card_type = 'curated') AS curated_cnt
      FROM cards c WHERE c.category IS NOT NULL GROUP BY c.category
    ) sub
  ),
  impressions AS (
    SELECT COUNT(*) AS total_imp
    FROM user_card_impressions uci
    WHERE EXISTS (SELECT 1 FROM cards c WHERE c.id = uci.card_pool_id)
  )
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE c.is_active)::BIGINT,
    COUNT(*) FILTER (WHERE NOT c.is_active)::BIGINT,
    COUNT(*) FILTER (WHERE c.card_type = 'single')::BIGINT,
    COUNT(*) FILTER (WHERE c.card_type = 'curated')::BIGINT,
    COUNT(*) FILTER (WHERE c.image_url IS NOT NULL)::BIGINT,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE c.image_url IS NOT NULL) * 100.0 / COUNT(*))::INTEGER
      ELSE 0 END,
    COUNT(*) FILTER (WHERE c.is_active AND c.card_type = 'single' AND (
      c.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM place_pool pp WHERE pp.id = c.place_pool_id AND pp.is_active
      )
    ))::BIGINT,
    COUNT(*) FILTER (WHERE c.is_active AND c.card_type = 'single'
      AND c.place_pool_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM place_pool pp WHERE pp.id = c.place_pool_id
          AND pp.updated_at > now() - interval '30 days'
      )
    )::BIGINT,
    COALESCE((SELECT total_imp FROM impressions), 0)::BIGINT,
    COUNT(*) FILTER (WHERE c.is_active AND c.served_count > 0)::BIGINT,
    COUNT(*) FILTER (WHERE c.is_active AND (c.served_count IS NULL OR c.served_count = 0))::BIGINT,
    ROUND((AVG(c.served_count) FILTER (WHERE c.is_active AND c.served_count > 0))::NUMERIC, 1),
    COUNT(DISTINCT c.category) FILTER (WHERE c.is_active AND c.category IS NOT NULL)::INTEGER,
    COALESCE((SELECT by_cat FROM cat_breakdown), '{}'::JSONB)
  FROM cards c;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC 2: admin_card_category_health (city_id + country_code)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_card_category_health(
  p_city_id UUID DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  category TEXT,
  total_cards BIGINT,
  active_cards BIGINT,
  single_cards BIGINT,
  curated_cards BIGINT,
  with_images BIGINT,
  card_image_pct INTEGER,
  total_served BIGINT,
  never_served BIGINT,
  avg_served_count NUMERIC,
  orphaned_cards BIGINT,
  health TEXT
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
    cp.category,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE cp.is_active)::BIGINT,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single')::BIGINT,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'curated')::BIGINT,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL)::BIGINT,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active))::INTEGER ELSE 0 END,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0)::BIGINT,
    COUNT(*) FILTER (WHERE cp.is_active AND (cp.served_count IS NULL OR cp.served_count = 0))::BIGINT,
    ROUND((AVG(cp.served_count) FILTER (WHERE cp.is_active AND cp.served_count > 0))::NUMERIC, 1),
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single' AND (
      cp.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM place_pool pp WHERE pp.id = cp.place_pool_id AND pp.is_active
      )
    ))::BIGINT,
    CASE
      WHEN COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0)
           >= COUNT(*) FILTER (WHERE cp.is_active) * 0.5 THEN 'green'
      WHEN COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0)
           >= COUNT(*) FILTER (WHERE cp.is_active) * 0.2 THEN 'yellow'
      ELSE 'red'
    END
  FROM card_pool cp
  WHERE cp.category IS NOT NULL
    AND (p_city_id IS NULL OR cp.city_id = p_city_id)
    AND (p_country_code IS NULL OR cp.city_id IN (
      SELECT sc.id FROM seeding_cities sc WHERE sc.country_code = p_country_code
    ))
  GROUP BY cp.category
  ORDER BY COUNT(*) FILTER (WHERE cp.is_active) DESC;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC 3: admin_card_city_overview (country_code) — now groups by seeding city
-- This is the fix for the 35-junk-entry drill-down
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_card_city_overview(p_country_code TEXT)
RETURNS TABLE (
  city_id UUID,
  city_name TEXT,
  total_cards BIGINT,
  active_cards BIGINT,
  card_image_pct INTEGER,
  single_cards BIGINT,
  curated_cards BIGINT,
  served_pct INTEGER,
  never_served BIGINT,
  orphaned_cards BIGINT,
  categories_covered INTEGER
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
    COUNT(*)::BIGINT AS total_cards,
    COUNT(*) FILTER (WHERE cp.is_active)::BIGINT AS active_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active))::INTEGER ELSE 0 END AS card_image_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single')::BIGINT AS single_cards,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'curated')::BIGINT AS curated_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active))::INTEGER ELSE 0 END AS served_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND (cp.served_count IS NULL OR cp.served_count = 0))::BIGINT AS never_served,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single' AND (
      cp.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM place_pool pp WHERE pp.id = cp.place_pool_id AND pp.is_active
      )
    ))::BIGINT AS orphaned_cards,
    COUNT(DISTINCT cp.category) FILTER (WHERE cp.is_active AND cp.category IS NOT NULL)::INTEGER AS categories_covered
  FROM card_pool cp
  JOIN seeding_cities sc ON cp.city_id = sc.id
  WHERE sc.country_code = p_country_code
  GROUP BY sc.id, sc.name
  ORDER BY COUNT(*) FILTER (WHERE cp.is_active) DESC;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC 4: admin_card_country_overview — now groups through seeding_cities
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_card_country_overview()
RETURNS TABLE (
  country_code TEXT,
  country_name TEXT,
  total_cards BIGINT,
  active_cards BIGINT,
  card_image_pct INTEGER,
  single_cards BIGINT,
  curated_cards BIGINT,
  served_pct INTEGER,
  never_served BIGINT,
  orphaned_cards BIGINT,
  categories_covered INTEGER
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
    COUNT(*)::BIGINT AS total_cards,
    COUNT(*) FILTER (WHERE cp.is_active)::BIGINT AS active_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active))::INTEGER ELSE 0 END AS card_image_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single')::BIGINT AS single_cards,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'curated')::BIGINT AS curated_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active))::INTEGER ELSE 0 END AS served_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND (cp.served_count IS NULL OR cp.served_count = 0))::BIGINT AS never_served,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single' AND (
      cp.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM place_pool pp WHERE pp.id = cp.place_pool_id AND pp.is_active
      )
    ))::BIGINT AS orphaned_cards,
    COUNT(DISTINCT cp.category) FILTER (WHERE cp.is_active AND cp.category IS NOT NULL)::INTEGER AS categories_covered
  FROM card_pool cp
  JOIN seeding_cities sc ON cp.city_id = sc.id
  GROUP BY sc.country_code, sc.country
  ORDER BY COUNT(*) FILTER (WHERE cp.is_active) DESC;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC 5: admin_detect_duplicate_curated_cards (city_id)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_detect_duplicate_curated_cards(
  p_city_id UUID DEFAULT NULL
)
RETURNS TABLE (
  duplicate_group INTEGER,
  card_id UUID,
  title TEXT,
  experience_type TEXT,
  stop_count BIGINT,
  stop_places TEXT,
  served_count INTEGER,
  created_at TIMESTAMPTZ,
  is_active BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH card_stops_sorted AS (
    SELECT
      cps.card_pool_id,
      string_agg(cps.place_pool_id::TEXT, ',' ORDER BY cps.place_pool_id) AS stop_key
    FROM card_pool_stops cps
    JOIN card_pool cp ON cp.id = cps.card_pool_id
    WHERE cp.card_type = 'curated'
      AND (p_city_id IS NULL OR cp.city_id = p_city_id)
    GROUP BY cps.card_pool_id
  ),
  duplicate_keys AS (
    SELECT css.stop_key FROM card_stops_sorted css GROUP BY css.stop_key HAVING COUNT(*) > 1
  ),
  numbered_keys AS (
    SELECT dk.stop_key, ROW_NUMBER() OVER (ORDER BY dk.stop_key)::INTEGER AS grp FROM duplicate_keys dk
  )
  SELECT
    nk.grp AS duplicate_group,
    cp.id AS card_id,
    cp.title,
    cp.experience_type,
    (SELECT COUNT(*) FROM card_pool_stops s WHERE s.card_pool_id = cp.id) AS stop_count,
    nk.stop_key AS stop_places,
    cp.served_count,
    cp.created_at,
    cp.is_active
  FROM numbered_keys nk
  JOIN card_stops_sorted css ON css.stop_key = nk.stop_key
  JOIN card_pool cp ON cp.id = css.card_pool_id
  ORDER BY nk.grp, cp.served_count DESC, cp.created_at ASC;
END;
$$;
