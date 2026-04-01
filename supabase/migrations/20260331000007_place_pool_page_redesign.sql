-- Place Pool Page Redesign: AI columns + backfill + 4 new RPCs + extend admin_edit_place
-- Does NOT drop or modify existing RPCs

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Add AI columns to place_pool + backfill from card_pool
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE place_pool
  ADD COLUMN IF NOT EXISTS ai_categories TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_approved BOOLEAN;

-- Backfill from validated single cards (~809 places)
UPDATE place_pool pp
SET
  ai_categories = cp.ai_categories,
  ai_validated_at = cp.ai_validated_at,
  ai_approved = cp.ai_approved
FROM card_pool cp
WHERE cp.place_pool_id = pp.id
  AND cp.card_type = 'single'
  AND cp.is_active = true
  AND cp.ai_approved IS NOT NULL
  AND cp.ai_categories IS NOT NULL
  AND array_length(cp.ai_categories, 1) > 0;

CREATE INDEX IF NOT EXISTS idx_place_pool_ai_approved
  ON place_pool (ai_approved) WHERE is_active = true;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. RPC: admin_place_pool_overview — pool-wide stats at any scope
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_place_pool_overview(
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_places BIGINT,
  active_places BIGINT,
  with_photos BIGINT,
  photo_pct INTEGER,
  with_seeding_category BIGINT,
  without_seeding_category BIGINT,
  ai_validated_count BIGINT,
  ai_approved_count BIGINT,
  ai_rejected_count BIGINT,
  ai_pending_count BIGINT,
  stale_7d BIGINT,
  stale_30d BIGINT,
  distinct_categories INTEGER
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
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE pp.is_active) AS active_places,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active)
      )::INTEGER
      ELSE 0
    END AS photo_pct,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.seeding_category IS NOT NULL) AS with_seeding_category,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.seeding_category IS NULL) AS without_seeding_category,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved IS NOT NULL) AS ai_validated_count,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) AS ai_approved_count,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = false) AS ai_rejected_count,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved IS NULL) AS ai_pending_count,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.last_detail_refresh < now() - interval '7 days') AS stale_7d,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.last_detail_refresh < now() - interval '30 days') AS stale_30d,
    COUNT(DISTINCT pp.seeding_category) FILTER (WHERE pp.is_active AND pp.seeding_category IS NOT NULL)::INTEGER AS distinct_categories
  FROM public.place_pool pp
  WHERE (p_country IS NULL OR pp.country = p_country)
    AND (p_city IS NULL OR pp.city = p_city);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. RPC: admin_place_country_overview — per-country stats for drill-down
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_place_country_overview()
RETURNS TABLE (
  country TEXT,
  active_places BIGINT,
  photo_pct INTEGER,
  ai_validated_pct INTEGER,
  category_coverage INTEGER,
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
  SELECT
    COALESCE(pp.country, 'Unknown') AS country,
    COUNT(*) FILTER (WHERE pp.is_active) AS active_places,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active)
      )::INTEGER
      ELSE 0
    END AS photo_pct,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active)
      )::INTEGER
      ELSE 0
    END AS ai_validated_pct,
    COUNT(DISTINCT pp.seeding_category) FILTER (WHERE pp.is_active AND pp.seeding_category IS NOT NULL)::INTEGER AS category_coverage,
    COUNT(DISTINCT pp.city) FILTER (WHERE pp.is_active) AS city_count
  FROM public.place_pool pp
  GROUP BY COALESCE(pp.country, 'Unknown')
  ORDER BY COUNT(*) FILTER (WHERE pp.is_active) DESC;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. RPC: admin_place_city_overview — per-city stats for country drill-down
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_place_city_overview(p_country TEXT)
RETURNS TABLE (
  city_name TEXT,
  active_places BIGINT,
  photo_pct INTEGER,
  ai_validated_pct INTEGER,
  category_coverage INTEGER,
  avg_rating NUMERIC
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
    COALESCE(pp.city, 'Unknown City') AS city_name,
    COUNT(*) FILTER (WHERE pp.is_active) AS active_places,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active)
      )::INTEGER
      ELSE 0
    END AS photo_pct,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active)
      )::INTEGER
      ELSE 0
    END AS ai_validated_pct,
    COUNT(DISTINCT pp.seeding_category) FILTER (WHERE pp.is_active AND pp.seeding_category IS NOT NULL)::INTEGER AS category_coverage,
    ROUND(AVG(pp.rating) FILTER (WHERE pp.is_active AND pp.rating IS NOT NULL), 1) AS avg_rating
  FROM public.place_pool pp
  WHERE pp.country = p_country
  GROUP BY COALESCE(pp.city, 'Unknown City')
  ORDER BY COUNT(*) FILTER (WHERE pp.is_active) DESC;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. RPC: admin_place_category_breakdown — per-category stats
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_place_category_breakdown(
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
)
RETURNS TABLE (
  category TEXT,
  place_count BIGINT,
  photo_pct INTEGER,
  ai_validated BIGINT,
  ai_approved_count BIGINT,
  ai_rejected_count BIGINT,
  ai_pending BIGINT,
  avg_rating NUMERIC
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
    pp.seeding_category AS category,
    COUNT(*) FILTER (WHERE pp.is_active) AS place_count,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active AND pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active)
      )::INTEGER
      ELSE 0
    END AS photo_pct,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved IS NOT NULL) AS ai_validated,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) AS ai_approved_count,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = false) AS ai_rejected_count,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved IS NULL) AS ai_pending,
    ROUND(AVG(pp.rating) FILTER (WHERE pp.is_active AND pp.rating IS NOT NULL), 1) AS avg_rating
  FROM public.place_pool pp
  WHERE (p_country IS NULL OR pp.country = p_country)
    AND (p_city IS NULL OR pp.city = p_city)
    AND pp.seeding_category IS NOT NULL
  GROUP BY pp.seeding_category
  ORDER BY COUNT(*) FILTER (WHERE pp.is_active) DESC;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Extend admin_edit_place with p_seeding_category parameter
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_edit_place(
  p_place_id UUID,
  p_name TEXT DEFAULT NULL,
  p_price_tier TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_seeding_category TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  UPDATE public.place_pool
  SET
    name = COALESCE(p_name, name),
    price_tier = COALESCE(p_price_tier, price_tier),
    is_active = COALESCE(p_is_active, is_active),
    seeding_category = COALESCE(p_seeding_category, seeding_category),
    updated_at = now()
  WHERE id = p_place_id
  RETURNING jsonb_build_object(
    'id', id, 'name', name, 'price_tier', price_tier,
    'is_active', is_active, 'seeding_category', seeding_category
  )
  INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Place not found: %', p_place_id;
  END IF;

  -- Cascade is_active changes to cards
  IF p_is_active IS NOT NULL THEN
    UPDATE public.card_pool
    SET is_active = p_is_active, updated_at = now()
    WHERE place_pool_id = p_place_id AND card_type = 'single';
  END IF;

  RETURN v_result;
END;
$$;
