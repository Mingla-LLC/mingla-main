-- ORCH-0588 Slice 1 — RPC for new serving path
-- Returns places ranked by signal score, filtered by is_servable + score threshold + radius (haversine).

CREATE OR REPLACE FUNCTION public.query_servable_places_by_signal(
  p_signal_id text,
  p_filter_min numeric,
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[],
  p_limit integer DEFAULT 20
) RETURNS TABLE(
  place_id uuid,
  google_place_id text,
  name text,
  address text,
  lat double precision,
  lng double precision,
  rating numeric,
  review_count integer,
  price_level text,
  price_range_start_cents integer,
  price_range_end_cents integer,
  opening_hours jsonb,
  website text,
  photos jsonb,
  stored_photo_urls text[],
  types text[],
  primary_type text,
  signal_score numeric,
  signal_contributions jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pp.id AS place_id,
    pp.google_place_id,
    pp.name,
    pp.address,
    pp.lat,
    pp.lng,
    pp.rating,
    pp.review_count,
    pp.price_level,
    pp.price_range_start_cents,
    pp.price_range_end_cents,
    pp.opening_hours,
    pp.website,
    pp.photos,
    pp.stored_photo_urls,
    pp.types,
    pp.primary_type,
    ps.score AS signal_score,
    ps.contributions AS signal_contributions
  FROM public.place_pool pp
  JOIN public.place_scores ps
    ON ps.place_id = pp.id
   AND ps.signal_id = p_signal_id
  WHERE pp.is_servable = true
    AND pp.is_active = true
    AND ps.score >= p_filter_min
    AND (
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - p_lat) / 2.0), 2) +
        COS(RADIANS(p_lat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - p_lng) / 2.0), 2)
      ))
    ) <= p_radius_m
    AND NOT (pp.id = ANY(p_exclude_place_ids))
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.query_servable_places_by_signal(text, numeric, double precision, double precision, double precision, uuid[], integer)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.query_servable_places_by_signal IS
  'ORCH-0588: signal-ranked serving path. Filters by is_servable + score threshold + haversine radius. Returns ordered by score DESC, review_count DESC.';

-- ROLLBACK:
-- REVOKE EXECUTE ON FUNCTION public.query_servable_places_by_signal(text, numeric, double precision, double precision, double precision, uuid[], integer) FROM authenticated, anon, service_role;
-- DROP FUNCTION IF EXISTS public.query_servable_places_by_signal(text, numeric, double precision, double precision, double precision, uuid[], integer);
