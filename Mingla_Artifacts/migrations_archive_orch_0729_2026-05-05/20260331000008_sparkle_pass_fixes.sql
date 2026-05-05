-- Sparkle pass fixes: admin_edit_place auth + photo stats RPC

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Fix admin_edit_place — add missing admin auth check (security fix)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_edit_place(UUID, TEXT, TEXT, BOOLEAN, TEXT);

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
  -- Admin auth check (was missing — security fix)
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

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


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. New RPC: admin_place_photo_stats — photo counts by city/country text
-- Decouples PhotoTab from seeding city registration
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_place_photo_stats(
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_places BIGINT,
  with_photos BIGINT,
  without_photos BIGINT,
  photo_pct INTEGER
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
    COUNT(*) FILTER (WHERE pp.is_active) AS total_places,
    COUNT(*) FILTER (WHERE pp.is_active
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    COUNT(*) FILTER (WHERE pp.is_active
      AND (pp.stored_photo_urls IS NULL
        OR array_length(pp.stored_photo_urls, 1) IS NULL)) AS without_photos,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE pp.is_active
          AND pp.stored_photo_urls IS NOT NULL
          AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active)
      )::INTEGER
      ELSE 0
    END AS photo_pct
  FROM public.place_pool pp
  WHERE (p_country IS NULL OR pp.country = p_country)
    AND (p_city IS NULL OR pp.city = p_city);
END;
$$;
