-- Migration: admin_pool_management
-- Phase 1: seeding_cities, seeding_tiles, seeding_operations tables,
-- place_pool columns (city_id, country, seeding_category),
-- RPCs (admin_edit_place, admin_city_place_stats, admin_city_card_stats),
-- country backfill from address, and indexes.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. seeding_cities
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.seeding_cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  country_code TEXT,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  coverage_radius_km DOUBLE PRECISION NOT NULL DEFAULT 10,
  tile_radius_m INTEGER NOT NULL DEFAULT 1500,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'seeding', 'seeded', 'launched')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, country)
);

ALTER TABLE public.seeding_cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_seeding_cities" ON public.seeding_cities
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_seeding_cities" ON public.seeding_cities
  FOR SELECT USING (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. seeding_tiles
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.seeding_tiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES public.seeding_cities(id) ON DELETE CASCADE,
  tile_index INTEGER NOT NULL,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  radius_m INTEGER NOT NULL,
  row_idx INTEGER NOT NULL,
  col_idx INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city_id, tile_index)
);

CREATE INDEX idx_seeding_tiles_city ON public.seeding_tiles (city_id);

ALTER TABLE public.seeding_tiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_seeding_tiles" ON public.seeding_tiles
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_seeding_tiles" ON public.seeding_tiles
  FOR SELECT USING (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. seeding_operations
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.seeding_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES public.seeding_cities(id) ON DELETE CASCADE,
  tile_id UUID REFERENCES public.seeding_tiles(id) ON DELETE SET NULL,
  seeding_category TEXT NOT NULL,
  app_category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),

  -- Results
  google_api_calls INTEGER NOT NULL DEFAULT 0,
  places_returned INTEGER NOT NULL DEFAULT 0,
  places_rejected_no_photos INTEGER NOT NULL DEFAULT 0,
  places_rejected_closed INTEGER NOT NULL DEFAULT 0,
  places_rejected_excluded_type INTEGER NOT NULL DEFAULT 0,
  places_new_inserted INTEGER NOT NULL DEFAULT 0,
  places_duplicate_skipped INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Error tracking
  error_message TEXT,
  error_details JSONB,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seeding_operations_city ON public.seeding_operations (city_id);
CREATE INDEX idx_seeding_operations_status ON public.seeding_operations (status);

ALTER TABLE public.seeding_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_seeding_operations" ON public.seeding_operations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_seeding_operations" ON public.seeding_operations
  FOR SELECT USING (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. place_pool — add city_id, country, seeding_category columns
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES public.seeding_cities(id) ON DELETE SET NULL;

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS country TEXT;

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS seeding_category TEXT;

CREATE INDEX IF NOT EXISTS idx_place_pool_city_id ON public.place_pool (city_id);
CREATE INDEX IF NOT EXISTS idx_place_pool_country ON public.place_pool (country);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Backfill country from address (last comma-separated part)
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE public.place_pool
SET country = TRIM(SPLIT_PART(address, ',', array_length(string_to_array(address, ','), 1)))
WHERE country IS NULL
  AND address IS NOT NULL
  AND address != '';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. RPC: admin_edit_place (SECURITY DEFINER)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_edit_place(
  p_place_id UUID,
  p_name TEXT DEFAULT NULL,
  p_price_tier TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
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
    updated_at = now()
  WHERE id = p_place_id
  RETURNING jsonb_build_object('id', id, 'name', name, 'price_tier', price_tier, 'is_active', is_active)
  INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Place not found: %', p_place_id;
  END IF;

  -- Cascade is_active changes to cards
  IF p_is_active IS NOT NULL THEN
    UPDATE public.card_pool
    SET is_active = p_is_active, updated_at = now()
    WHERE place_pool_id = p_place_id;
  END IF;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. RPC: admin_city_place_stats (SECURITY DEFINER)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_city_place_stats(p_city_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_places', COUNT(*) FILTER (WHERE is_active),
    'inactive_places', COUNT(*) FILTER (WHERE NOT is_active),
    'avg_rating', ROUND(AVG(rating) FILTER (WHERE is_active AND rating IS NOT NULL)::numeric, 2),
    'with_photos', COUNT(*) FILTER (WHERE is_active AND stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0),
    'without_photos', COUNT(*) FILTER (WHERE is_active AND (stored_photo_urls IS NULL OR array_length(stored_photo_urls, 1) IS NULL)),
    'stale_count', COUNT(*) FILTER (WHERE is_active AND last_detail_refresh < now() - interval '7 days'),
    'by_seeding_category', (
      SELECT COALESCE(jsonb_object_agg(
        COALESCE(seeding_category, 'unknown'),
        jsonb_build_object('count', cnt, 'with_photos', photo_cnt)
      ), '{}'::jsonb)
      FROM (
        SELECT seeding_category,
               COUNT(*) as cnt,
               COUNT(*) FILTER (WHERE stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0) as photo_cnt
        FROM public.place_pool
        WHERE city_id = p_city_id AND is_active
        GROUP BY seeding_category
      ) sub
    ),
    'price_tier_distribution', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(price_tier, 'unknown'), cnt), '{}'::jsonb)
      FROM (
        SELECT price_tier, COUNT(*) as cnt
        FROM public.place_pool
        WHERE city_id = p_city_id AND is_active
        GROUP BY price_tier
      ) sub
    )
  ) INTO v_result
  FROM public.place_pool
  WHERE city_id = p_city_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. RPC: admin_city_card_stats (SECURITY DEFINER)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_city_card_stats(p_city_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_single_cards', COUNT(*) FILTER (WHERE c.card_type = 'single' AND c.is_active),
    'total_curated_cards', COUNT(*) FILTER (WHERE c.card_type = 'curated' AND c.is_active),
    'inactive_cards', COUNT(*) FILTER (WHERE NOT c.is_active),
    'cards_with_photos', COUNT(*) FILTER (WHERE c.is_active AND c.image_url IS NOT NULL),
    'cards_without_photos', COUNT(*) FILTER (WHERE c.is_active AND c.image_url IS NULL),
    'by_category', (
      SELECT COALESCE(jsonb_object_agg(category, cnt), '{}'::jsonb)
      FROM (
        SELECT c2.category, COUNT(*) as cnt
        FROM public.card_pool c2
        JOIN public.place_pool p2 ON c2.place_pool_id = p2.id
        WHERE p2.city_id = p_city_id AND c2.is_active
        GROUP BY c2.category
      ) sub
    ),
    'places_without_cards', (
      SELECT COUNT(*)
      FROM public.place_pool p3
      LEFT JOIN public.card_pool c3 ON c3.place_pool_id = p3.id AND c3.is_active
      WHERE p3.city_id = p_city_id AND p3.is_active AND c3.id IS NULL
    )
  ) INTO v_result
  FROM public.card_pool c
  JOIN public.place_pool p ON c.place_pool_id = p.id
  WHERE p.city_id = p_city_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;
