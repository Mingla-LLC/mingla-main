-- ORCH-0347C: Add city_id to seed_map_presence for per-city tracking.
ALTER TABLE public.seed_map_presence
  ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES public.seeding_cities(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_seed_map_presence_city_id
  ON public.seed_map_presence (city_id)
  WHERE city_id IS NOT NULL;

-- RPC: Per-city seed stats for admin dashboard
CREATE OR REPLACE FUNCTION public.get_seed_stats_per_city()
RETURNS TABLE(
  city_id UUID,
  city_name TEXT,
  country TEXT,
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  coverage_radius_km DOUBLE PRECISION,
  status TEXT,
  place_count BIGINT,
  seed_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    sc.country,
    sc.center_lat,
    sc.center_lng,
    sc.coverage_radius_km,
    sc.status,
    COALESCE(pp.cnt, 0) AS place_count,
    COALESCE(sp.cnt, 0) AS seed_count
  FROM public.seeding_cities sc
  LEFT JOIN (
    SELECT city_id, count(*) AS cnt
    FROM public.place_pool
    WHERE is_active = true AND city_id IS NOT NULL
    GROUP BY city_id
  ) pp ON pp.city_id = sc.id
  LEFT JOIN (
    SELECT city_id, count(*) AS cnt
    FROM public.seed_map_presence
    WHERE city_id IS NOT NULL
    GROUP BY city_id
  ) sp ON sp.city_id = sc.id
  WHERE sc.status IN ('seeded', 'launched')
  ORDER BY COALESCE(pp.cnt, 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_seed_stats_per_city() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_seed_stats_per_city() TO authenticator;
GRANT EXECUTE ON FUNCTION public.get_seed_stats_per_city() TO authenticated;
