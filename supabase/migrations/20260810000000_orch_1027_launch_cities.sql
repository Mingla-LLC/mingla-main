-- ORCH-1027 [Launch Cities admin control]
-- Adds operator-controlled consumer-launch flag to seeding_cities, INDEPENDENT of
-- the seeding pipeline `status` column (DEC: pipeline-ready != operator-declared-ready).
-- Plus a partial index for the live-subset filter and two admin RPCs.

-- 1. The flag. Default false: no city is consumer-live until the operator flips it.
ALTER TABLE public.seeding_cities
  ADD COLUMN IF NOT EXISTS is_live_for_consumers boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.seeding_cities.is_live_for_consumers IS
  'ORCH-1027: operator-controlled. true = this city is live for consumer onboarding '
  '(source of truth for the ORCH-1028 location gate via check-launch-city edge fn). '
  'Orthogonal to status (pipeline state). Set only from the Launch Cities admin tab.';

-- 2. Partial index: the live subset is the only set check-launch-city ever scans.
--    Keeps the point-in-bbox query index-eligible as the table grows past launch.
CREATE INDEX IF NOT EXISTS seeding_cities_live_for_consumers_idx
  ON public.seeding_cities (is_live_for_consumers)
  WHERE is_live_for_consumers;

-- 3. Admin list RPC (Launch Cities tab). NEW — does NOT touch admin_city_picker_data.
--    Returns the launch-tab columns incl. the live flag, bbox presence, servable count.
CREATE OR REPLACE FUNCTION public.admin_launch_city_list()
  RETURNS TABLE(
    city_id uuid,
    city_name text,
    country_name text,
    country_code text,
    city_status text,
    is_live_for_consumers boolean,
    center_lat double precision,
    center_lng double precision,
    bbox_sw_lat double precision,
    bbox_sw_lng double precision,
    bbox_ne_lat double precision,
    bbox_ne_lng double precision,
    has_bbox boolean,
    is_servable_places bigint,
    total_active_places bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT
    sc.id,
    sc.name,
    sc.country,
    sc.country_code,
    sc.status,
    sc.is_live_for_consumers,
    sc.center_lat,
    sc.center_lng,
    sc.bbox_sw_lat,
    sc.bbox_sw_lng,
    sc.bbox_ne_lat,
    sc.bbox_ne_lng,
    (sc.bbox_sw_lat IS NOT NULL AND sc.bbox_ne_lat IS NOT NULL
       AND sc.bbox_sw_lng IS NOT NULL AND sc.bbox_ne_lng IS NOT NULL) AS has_bbox,
    COUNT(pp.id) FILTER (WHERE pp.is_servable AND pp.is_active) AS is_servable_places,
    COUNT(pp.id) FILTER (WHERE pp.is_active) AS total_active_places
  FROM seeding_cities sc
  LEFT JOIN place_pool pp ON pp.city_id = sc.id
  GROUP BY sc.id
  ORDER BY sc.is_live_for_consumers DESC, sc.name ASC;
$$;

-- Admin-only execution. SECURITY DEFINER bypasses RLS for the read, so we gate EXECUTE.
REVOKE ALL ON FUNCTION public.admin_launch_city_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_launch_city_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_launch_city_list() TO authenticated;

-- 4. Toggle RPC. Atomic single-purpose flag set + updated_at bump.
--    Authorization: this RPC is SECURITY INVOKER so the existing
--    admin_write_seeding_cities RLS policy is the gate (active admin_users only).
--    is_live_for_consumers is NEVER coupled to status (I-LC-STATUS-ORTHOGONAL):
--    this UPDATE writes ONLY the flag + updated_at.
CREATE OR REPLACE FUNCTION public.admin_set_city_live(p_city_id uuid, p_live boolean)
  RETURNS TABLE(city_id uuid, is_live_for_consumers boolean)
  LANGUAGE sql
  VOLATILE
  SECURITY INVOKER
  SET search_path TO 'public'
AS $$
  UPDATE public.seeding_cities
     SET is_live_for_consumers = p_live,
         updated_at = now()
   WHERE id = p_city_id
  RETURNING id, is_live_for_consumers;
$$;

REVOKE ALL ON FUNCTION public.admin_set_city_live(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_city_live(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_city_live(uuid, boolean) TO authenticated;
