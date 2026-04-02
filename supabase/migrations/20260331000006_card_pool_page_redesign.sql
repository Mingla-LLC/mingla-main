-- Card Pool Page Redesign: 4 new card-centric RPCs + admin UPDATE policy on card_pool
-- Does NOT drop or modify admin_pool_category_health (Pool Intelligence uses it)

-- ─── RPC 1: admin_card_category_health ──────────────────────────────────────
-- Card-centric category breakdown for the Card Pool Overview tab

CREATE OR REPLACE FUNCTION public.admin_card_category_health(
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
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
    cp.category,
    COUNT(*) AS total_cards,
    COUNT(*) FILTER (WHERE cp.is_active) AS active_cards,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single') AS single_cards,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'curated') AS curated_cards,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL) AS with_images,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active)
      )::INTEGER
      ELSE 0
    END AS card_image_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0) AS total_served,
    COUNT(*) FILTER (WHERE cp.is_active AND (cp.served_count IS NULL OR cp.served_count = 0)) AS never_served,
    ROUND((AVG(cp.served_count) FILTER (WHERE cp.is_active AND cp.served_count > 0))::NUMERIC, 1) AS avg_served_count,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single' AND (
      cp.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.place_pool pp WHERE pp.id = cp.place_pool_id AND pp.is_active
      )
    )) AS orphaned_cards,
    CASE
      WHEN COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0)
           >= COUNT(*) FILTER (WHERE cp.is_active) * 0.5
        THEN 'green'
      WHEN COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0)
           >= COUNT(*) FILTER (WHERE cp.is_active) * 0.2
        THEN 'yellow'
      ELSE 'red'
    END AS health
  FROM public.card_pool cp
  WHERE cp.category IS NOT NULL
    AND (p_country IS NULL OR cp.country = p_country)
    AND (p_city IS NULL OR cp.city = p_city)
  GROUP BY cp.category
  ORDER BY COUNT(*) FILTER (WHERE cp.is_active) DESC;
END;
$$;


-- ─── RPC 2: admin_card_city_overview ────────────────────────────────────────
-- Card stats per city for drill-down from Overview tab

CREATE OR REPLACE FUNCTION public.admin_card_city_overview(p_country TEXT)
RETURNS TABLE (
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
    COALESCE(cp.city, 'Unknown City') AS city_name,
    COUNT(*) AS total_cards,
    COUNT(*) FILTER (WHERE cp.is_active) AS active_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active)
      )::INTEGER
      ELSE 0
    END AS card_image_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single') AS single_cards,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'curated') AS curated_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active)
      )::INTEGER
      ELSE 0
    END AS served_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND (cp.served_count IS NULL OR cp.served_count = 0)) AS never_served,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single' AND (
      cp.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.place_pool pp WHERE pp.id = cp.place_pool_id AND pp.is_active
      )
    )) AS orphaned_cards,
    COUNT(DISTINCT cp.category) FILTER (WHERE cp.is_active AND cp.category IS NOT NULL)::INTEGER AS categories_covered
  FROM public.card_pool cp
  WHERE cp.country = p_country
  GROUP BY COALESCE(cp.city, 'Unknown City')
  ORDER BY COUNT(*) FILTER (WHERE cp.is_active) DESC;
END;
$$;


-- ─── RPC 3: admin_detect_duplicate_curated_cards ────────────────────────────
-- Finds curated cards sharing the same set of stops (order-independent)

CREATE OR REPLACE FUNCTION public.admin_detect_duplicate_curated_cards(
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
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
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH card_stops_sorted AS (
    SELECT
      cps.card_pool_id,
      string_agg(cps.place_pool_id::TEXT, ',' ORDER BY cps.place_pool_id) AS stop_key
    FROM public.card_pool_stops cps
    JOIN public.card_pool cp ON cp.id = cps.card_pool_id
    WHERE cp.card_type = 'curated'
      AND (p_country IS NULL OR cp.country = p_country)
      AND (p_city IS NULL OR cp.city = p_city)
    GROUP BY cps.card_pool_id
  ),
  duplicate_keys AS (
    -- Get unique stop_keys that appear more than once (true duplicates)
    SELECT css.stop_key
    FROM card_stops_sorted css
    GROUP BY css.stop_key
    HAVING COUNT(*) > 1
  ),
  numbered_keys AS (
    -- Assign a group number to each unique duplicate stop_key
    SELECT dk.stop_key, ROW_NUMBER() OVER (ORDER BY dk.stop_key)::INTEGER AS grp
    FROM duplicate_keys dk
  )
  SELECT
    nk.grp AS duplicate_group,
    cp.id AS card_id,
    cp.title,
    cp.experience_type,
    (SELECT COUNT(*) FROM public.card_pool_stops s WHERE s.card_pool_id = cp.id) AS stop_count,
    nk.stop_key AS stop_places,
    cp.served_count,
    cp.created_at,
    cp.is_active
  FROM numbered_keys nk
  JOIN card_stops_sorted css ON css.stop_key = nk.stop_key
  JOIN public.card_pool cp ON cp.id = css.card_pool_id
  ORDER BY nk.grp, cp.served_count DESC, cp.created_at ASC;
END;
$$;


-- ─── RPC 4: admin_card_country_overview ─────────────────────────────────────
-- Card-centric country overview for global drill-down (replaces place-centric
-- admin_country_overview usage on the Card Pool page)

CREATE OR REPLACE FUNCTION public.admin_card_country_overview()
RETURNS TABLE (
  country TEXT,
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
    COALESCE(cp.country, 'Unknown') AS country,
    COUNT(*) AS total_cards,
    COUNT(*) FILTER (WHERE cp.is_active) AS active_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active)
      )::INTEGER
      ELSE 0
    END AS card_image_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single') AS single_cards,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'curated') AS curated_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active)
      )::INTEGER
      ELSE 0
    END AS served_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND (cp.served_count IS NULL OR cp.served_count = 0)) AS never_served,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single' AND (
      cp.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.place_pool pp WHERE pp.id = cp.place_pool_id AND pp.is_active
      )
    )) AS orphaned_cards,
    COUNT(DISTINCT cp.category) FILTER (WHERE cp.is_active AND cp.category IS NOT NULL)::INTEGER AS categories_covered
  FROM public.card_pool cp
  GROUP BY COALESCE(cp.country, 'Unknown')
  ORDER BY COUNT(*) FILTER (WHERE cp.is_active) DESC;
END;
$$;


-- ─── RLS: Allow admin users to UPDATE card_pool ─────────────────────────────
-- Pre-existing gap: only SELECT existed for authenticated role. All admin
-- deactivation buttons (browse, orphaned, duplicates) were silently no-ops.

CREATE POLICY "admin_update_card_pool" ON public.card_pool
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active')
  );
