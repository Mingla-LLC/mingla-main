-- ---------------------------------------------------------------------------
-- Issue #4275 — Home feed fan-out: batch the ranked lookups and hydrates.
--
-- One Home cold open of a six-intent account made about 524 ranked lookup and
-- hydrate requests against an undersized database, most of them one HTTP call
-- per category or per Picnic anchor. These two read-only functions let
-- generate-curated-experiences (service role only) send a group of lookups, and
-- then one hydrate for all of them, as one request each.
--
-- fetch_local_signal_ranked_batch CALLS the existing 11-argument function rather
-- than copying its predicate, so the serving gates keep exactly one owner.
--
-- Cap of 12: authenticator has statement_timeout=8s and a single lookup averages
-- 235 ms (pg_stat_statements), so 12 in series is about 2.8 s on average. Larger
-- batches risk the timeout under load.
--
-- fetch_feed_places_by_ids exists because 8 categories x 100 ids exceeds the URL
-- cap of a PostgREST `.in()`; an RPC POST has none. Its columns are the curated
-- hydrate list, without `photos` (selected before, never read, the widest
-- column on a 1.9 GB table).
--
-- Neither inherits the old function's GRANT ALL TO anon: service role only.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.fetch_local_signal_ranked_batch(p_requests jsonb)
  RETURNS TABLE(request_index integer, place_id uuid, rank_score numeric)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF jsonb_typeof(p_requests) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'fetch_local_signal_ranked_batch: p_requests must be a JSON array';
  END IF;
  IF jsonb_array_length(p_requests) > 12 THEN
    RAISE EXCEPTION 'fetch_local_signal_ranked_batch: % requests exceeds the cap of 12',
      jsonb_array_length(p_requests);
  END IF;

  RETURN QUERY
  SELECT (req.ord - 1)::integer, ranked.ranked_place_id, ranked.ranked_score
  FROM jsonb_array_elements(p_requests) WITH ORDINALITY AS req(body, ord)
  CROSS JOIN LATERAL public.fetch_local_signal_ranked(
    p_filter_signal := req.body->>'p_filter_signal',
    p_filter_min := (req.body->>'p_filter_min')::numeric,
    p_rank_signal := req.body->>'p_rank_signal',
    p_lat_min := (req.body->>'p_lat_min')::numeric,
    p_lat_max := (req.body->>'p_lat_max')::numeric,
    p_lng_min := (req.body->>'p_lng_min')::numeric,
    p_lng_max := (req.body->>'p_lng_max')::numeric,
    p_required_types := CASE WHEN jsonb_typeof(req.body->'p_required_types') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(req.body->'p_required_types')) END,
    p_limit := (req.body->>'p_limit')::integer,
    p_primary_type_required := CASE WHEN jsonb_typeof(req.body->'p_primary_type_required') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(req.body->'p_primary_type_required')) END,
    p_grocery_floral_tag := COALESCE((req.body->>'p_grocery_floral_tag')::boolean, false)
  ) WITH ORDINALITY AS ranked(ranked_place_id, ranked_score, position)
  ORDER BY req.ord, ranked.position;
END;
$function$;

ALTER FUNCTION public.fetch_local_signal_ranked_batch(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fetch_local_signal_ranked_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_local_signal_ranked_batch(jsonb) TO service_role;

COMMENT ON FUNCTION public.fetch_local_signal_ranked_batch(jsonb) IS
  'Issue #4275: up to 12 ranked lookups in one request. Each element holds the named arguments of the single-lookup function; request_index is the 0-based element position. Service role only.';

CREATE OR REPLACE FUNCTION public.fetch_feed_places_by_ids(p_ids uuid[])
  RETURNS TABLE(
    id uuid,
    google_place_id text,
    name text,
    address text,
    lat double precision,
    lng double precision,
    rating double precision,
    review_count integer,
    price_level text,
    price_range_start_cents integer,
    price_range_end_cents integer,
    opening_hours jsonb,
    website text,
    stored_photo_urls text[],
    types text[],
    primary_type text,
    utc_offset_minutes integer,
    city_id uuid,
    city text,
    country text,
    ai_signal_scores jsonb
  )
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(array_length(p_ids, 1), 0) > 1000 THEN
    RAISE EXCEPTION 'fetch_feed_places_by_ids: % ids exceeds the cap of 1000', array_length(p_ids, 1);
  END IF;

  RETURN QUERY
  SELECT
    pp.id, pp.google_place_id, pp.name, pp.address, pp.lat, pp.lng, pp.rating, pp.review_count,
    pp.price_level, pp.price_range_start_cents, pp.price_range_end_cents, pp.opening_hours,
    pp.website, pp.stored_photo_urls, pp.types, pp.primary_type, pp.utc_offset_minutes,
    pp.city_id, pp.city, pp.country, pp.ai_signal_scores
  FROM public.place_pool pp
  WHERE pp.id = ANY(p_ids);
END;
$function$;

ALTER FUNCTION public.fetch_feed_places_by_ids(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fetch_feed_places_by_ids(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_feed_places_by_ids(uuid[]) TO service_role;

COMMENT ON FUNCTION public.fetch_feed_places_by_ids(uuid[]) IS
  'Issue #4275: curated hydrate of up to 1000 place ids over POST. No photos column. Service role only.';

COMMIT;
