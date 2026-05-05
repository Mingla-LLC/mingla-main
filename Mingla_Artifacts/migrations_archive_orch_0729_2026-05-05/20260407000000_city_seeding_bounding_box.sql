-- ═══════════════════════════════════════════════════════════════════════════════
-- City Seeding Bounding Box Model
-- Adds viewport bounding box to seeding_cities, backfills from center+radius,
-- adds overlap-check RPC. coverage_radius_km is deprecated (column retained).
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Add bounding box columns (nullable initially for backfill)
ALTER TABLE public.seeding_cities
  ADD COLUMN IF NOT EXISTS bbox_sw_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS bbox_sw_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS bbox_ne_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS bbox_ne_lng DOUBLE PRECISION;

-- 2. Backfill: approximate bbox from center + coverage_radius_km
-- Uses: lat_offset = radius_km / 111.32
--       lng_offset = radius_km / (111.32 * cos(center_lat_radians))
UPDATE public.seeding_cities
SET
  bbox_sw_lat = center_lat - (coverage_radius_km / 111.32),
  bbox_ne_lat = center_lat + (coverage_radius_km / 111.32),
  bbox_sw_lng = center_lng - (coverage_radius_km / (111.32 * COS(RADIANS(center_lat)))),
  bbox_ne_lng = center_lng + (coverage_radius_km / (111.32 * COS(RADIANS(center_lat))))
WHERE bbox_sw_lat IS NULL;

-- 3. Enforce NOT NULL now that all rows have values
ALTER TABLE public.seeding_cities
  ALTER COLUMN bbox_sw_lat SET NOT NULL,
  ALTER COLUMN bbox_sw_lng SET NOT NULL,
  ALTER COLUMN bbox_ne_lat SET NOT NULL,
  ALTER COLUMN bbox_ne_lng SET NOT NULL;

-- 4. coverage_radius_km: deprecated — code will stop reading it.
-- Column retained for rollback safety. Drop in a future migration.
COMMENT ON COLUMN public.seeding_cities.coverage_radius_km
  IS 'DEPRECATED: replaced by bbox_sw/ne columns. Retained for rollback.';

-- 5. RPC: check_city_bbox_overlap
-- Returns any existing cities whose bounding box overlaps the proposed bbox.
-- Used by admin UI to prevent duplicate city registration.
CREATE OR REPLACE FUNCTION public.check_city_bbox_overlap(
  p_sw_lat DOUBLE PRECISION,
  p_sw_lng DOUBLE PRECISION,
  p_ne_lat DOUBLE PRECISION,
  p_ne_lng DOUBLE PRECISION,
  p_exclude_id UUID DEFAULT NULL
)
RETURNS TABLE(id UUID, name TEXT, country TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sc.id, sc.name, sc.country
  FROM seeding_cities sc
  WHERE (p_exclude_id IS NULL OR sc.id != p_exclude_id)
    AND sc.bbox_sw_lat < p_ne_lat
    AND sc.bbox_ne_lat > p_sw_lat
    AND sc.bbox_sw_lng < p_ne_lng
    AND sc.bbox_ne_lng > p_sw_lng;
$$;
