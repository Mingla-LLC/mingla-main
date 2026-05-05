-- ORCH-0347B: RPCs for seed cleanup and city-based seeding.

-- RPC 1: Instant cleanup via TRUNCATE (replaces 18-band delete loop)
CREATE OR REPLACE FUNCTION public.truncate_seed_map_presence()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  row_count BIGINT;
BEGIN
  SELECT count(*) INTO row_count FROM public.seed_map_presence;
  TRUNCATE public.seed_map_presence;
  RETURN jsonb_build_object('deleted', row_count);
END;
$$;

REVOKE ALL ON FUNCTION public.truncate_seed_map_presence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.truncate_seed_map_presence() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.truncate_seed_map_presence() TO service_role;

-- RPC 2: Place count per city for seed density calculation
CREATE OR REPLACE FUNCTION public.get_place_count_per_city()
RETURNS TABLE(city_id UUID, place_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT city_id, count(*) AS place_count
  FROM public.place_pool
  WHERE is_active = true AND city_id IS NOT NULL
  GROUP BY city_id;
$$;

REVOKE ALL ON FUNCTION public.get_place_count_per_city() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_place_count_per_city() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_place_count_per_city() TO authenticated;
