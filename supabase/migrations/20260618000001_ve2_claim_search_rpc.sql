-- Ve2 — ILIKE-safe place_pool name search for claim-search-pool edge function.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_search_place_pool_for_claim (
  p_query text,
  p_limit int DEFAULT 5
) RETURNS TABLE (
  id uuid,
  name text,
  address text,
  city text,
  country text,
  lat double precision,
  lng double precision,
  google_place_id text,
  primary_type text,
  types text[],
  opening_hours jsonb,
  stored_photo_urls text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.name,
    p.address,
    p.city,
    p.country,
    p.lat,
    p.lng,
    p.google_place_id,
    p.primary_type,
    p.types,
    p.opening_hours,
    p.stored_photo_urls
  FROM public.place_pool p
  WHERE p.is_active = true
    AND length(trim(coalesce(p_query, ''))) >= 3
    AND p.name ILIKE (
      '%' || public.escape_like_pattern(trim(p_query)) || '%'
    ) ESCAPE '\'
  ORDER BY
    CASE
      WHEN p.name ILIKE (
        public.escape_like_pattern(trim(p_query)) || '%'
      ) ESCAPE '\' THEN 0
      ELSE 1
    END,
    coalesce(p.review_count, 0) DESC,
    p.name ASC
  LIMIT greatest(1, least(coalesce(p_limit, 5), 10));
$$;

REVOKE ALL ON FUNCTION public.biz_search_place_pool_for_claim (text, int)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_search_place_pool_for_claim (text, int)
TO service_role;

COMMENT ON FUNCTION public.biz_search_place_pool_for_claim IS
  'Ve2 — public-safe place_pool rows for claim-search-pool (service_role only).';

COMMIT;
