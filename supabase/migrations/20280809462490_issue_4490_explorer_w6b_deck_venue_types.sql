-- Issue #4490, Explorer app W6b: venue-type chips on the deck ("Places on Mingla").
-- Spec 06 §3 W6b (the spec's number 20280809414490 is taken; this is the next free
-- slot after 20280809461490 and before spec 08's reserved 20280809464490).
--
-- 1. issue_4490_place_is_servable(is_servable, is_active, photos): the place-quality
--    part of the deck's servable rule, lifted out of the two base servable RPCs so
--    the venue-type reads apply the SAME rule (one owner). One SQL expression,
--    IMMUTABLE, no SECURITY DEFINER and no SET clause, so the planner inlines it.
-- 2. The two base servable RPCs, re-emitted from their live bodies by counted
--    substitution (a count mismatch aborts; a body that already calls (1) is left
--    alone) to call (1) in place of the inline predicate. Columns, grants, ORDER BY,
--    LIMIT and geography are unchanged:
--      issue_1384_query_servable_places_by_signal (latest 20270129001384)
--      query_servable_places_by_signal_intersection (latest 20261221000001)
-- 3. issue_4490_hosted_venue_types_near(lat, lng, radius m): the venue types the
--    deck may offer as chips here: bookable hosted venues (the W6 rule,
--    issue_4490_discover_venue_candidates) whose place is inside the radius and
--    passes (1); chip types only (no 'stay'); empty while VENUE_DISCOVER is off.
-- 4. issue_4490_hosted_places_by_venue_type(type, lat, lng, radius m, exclude, limit)
--    and issue_4490_hosted_places_by_venue_type_intersection(type, circles, exclude,
--    limit): the deck rows for one venue-type chip, in the base servable row shape
--    plus venue_id. No mood floor (a chip is a place type, not a mood);
--    signal_score 0, no signal reasoning. Geography per caller (haversine radius
--    for the solo shape, inside every circle for the shared deck, both copied from
--    the base bodies). Order: review_count DESC NULLS LAST, rating DESC NULLS LAST,
--    place id ASC.
-- Every new function is service_role only except (1), an invoker helper.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_4490_place_is_servable(
  p_is_servable boolean,
  p_is_active boolean,
  p_photos text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_is_servable = true
    AND p_is_active = true
    AND p_photos IS NOT NULL
    AND pg_catalog.array_length(p_photos, 1) > 0
    AND NOT (
      pg_catalog.array_length(p_photos, 1) = 1
      AND p_photos[1] = '__backfill_failed__'
    )
$function$;

CREATE OR REPLACE FUNCTION pg_temp.issue_4490_w6b_patch(
  p_signature text,
  p_old text,
  p_new text,
  p_expected integer,
  p_marker text
) RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_def text;
  v_old_count integer;
BEGIN
  v_def := pg_get_functiondef(p_signature::regprocedure);
  IF position(p_marker IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_expected THEN
    RAISE EXCEPTION 'issue_4490_w6b_shape_mismatch: % expected % match(es), found %',
      p_signature, p_expected, v_old_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END
$function$;

-- Solo base RPC.
SELECT pg_temp.issue_4490_w6b_patch(
  'public.issue_1384_query_servable_places_by_signal(text,numeric,double precision,double precision,double precision,uuid[],integer,bigint,bigint,character,uuid)',
  $old$  WHERE pp.is_servable = true
    AND pp.is_active = true
    AND ps.score >= p_filter_min
    AND pp.stored_photo_urls IS NOT NULL
    AND pg_catalog.array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      pg_catalog.array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )$old$,
  $new$  WHERE public.issue_4490_place_is_servable(pp.is_servable, pp.is_active, pp.stored_photo_urls)
    AND ps.score >= p_filter_min$new$,
  1,
  $m$issue_4490_place_is_servable$m$
);

-- Intersection base RPC: the quality checks move into the candidate set (same rows).
SELECT pg_temp.issue_4490_w6b_patch(
  'public.query_servable_places_by_signal_intersection(text,numeric,jsonb,uuid[],integer)',
  $old$    WHERE pp.is_servable = true
      AND pp.is_active = true
      AND pp.lat IS NOT NULL$old$,
  $new$    WHERE public.issue_4490_place_is_servable(pp.is_servable, pp.is_active, pp.stored_photo_urls)
      AND pp.lat IS NOT NULL$new$,
  1,
  $m$issue_4490_place_is_servable$m$
);
SELECT pg_temp.issue_4490_w6b_patch(
  'public.query_servable_places_by_signal_intersection(text,numeric,jsonb,uuid[],integer)',
  $old$  WHERE ps.score >= p_filter_min
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )
    AND NOT (pp.id = ANY(p_exclude_place_ids))$old$,
  $new$  WHERE ps.score >= p_filter_min
    AND NOT (pp.id = ANY(p_exclude_place_ids))$new$,
  1,
  $m$  WHERE ps.score >= p_filter_min
    AND NOT (pp.id = ANY(p_exclude_place_ids))$m$
);

CREATE OR REPLACE FUNCTION public.issue_4490_hosted_venue_types_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer
)
RETURNS TABLE (venue_type text, venue_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT c.venue_type, count(DISTINCT c.venue_id)::integer
  FROM public.issue_4490_discover_venue_candidates(ARRAY[]::text[], p_lat, p_lng, p_radius_m / 1000.0) c
  JOIN public.venue_listings v ON v.id = c.venue_id
  JOIN public.place_pool pp ON pp.id = v.place_pool_id
  WHERE c.venue_type = ANY(public.issue_4490_venue_type_chip_keys())
    AND public.issue_4490_place_is_servable(pp.is_servable, pp.is_active, pp.stored_photo_urls)
    AND pp.lat IS NOT NULL AND pp.lng IS NOT NULL
    AND 6371000.0 * 2.0 * pg_catalog.asin(pg_catalog.sqrt(
          pg_catalog.power(pg_catalog.sin(pg_catalog.radians(pp.lat - p_lat) / 2.0), 2) +
          pg_catalog.cos(pg_catalog.radians(p_lat)) *
          pg_catalog.cos(pg_catalog.radians(pp.lat)) *
          pg_catalog.power(pg_catalog.sin(pg_catalog.radians(pp.lng - p_lng) / 2.0), 2)
        )) <= p_radius_m
  GROUP BY c.venue_type
  HAVING count(DISTINCT c.venue_id) > 0
  ORDER BY array_position(public.issue_4490_venue_type_chip_keys(), c.venue_type);
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_hosted_places_by_venue_type(
  p_venue_type text,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_exclude_place_ids uuid[],
  p_limit integer
)
RETURNS TABLE(place_id uuid, google_place_id text, name text, address text, lat double precision,
  lng double precision, rating numeric, review_count integer, price_level text,
  price_range_start_cents integer, price_range_end_cents integer, opening_hours jsonb, website text,
  photos jsonb, stored_photo_urls text[], types text[], primary_type text, generative_summary text,
  signal_score numeric, signal_contributions jsonb, ai_reasoning jsonb, ai_score_raw numeric,
  venue_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pp.id, pp.google_place_id, pp.name, pp.address, pp.lat, pp.lng, pp.rating, pp.review_count,
    pp.price_level, pp.price_range_start_cents, pp.price_range_end_cents, pp.opening_hours, pp.website,
    pp.photos, pp.stored_photo_urls, pp.types, pp.primary_type, pp.generative_summary,
    0::numeric, '{}'::jsonb, NULL::jsonb, NULL::numeric, c.venue_id
  FROM public.issue_4490_discover_venue_candidates(ARRAY[]::text[], p_lat, p_lng, p_radius_m / 1000.0) c
  JOIN public.venue_listings v ON v.id = c.venue_id
  JOIN public.place_pool pp ON pp.id = v.place_pool_id
  WHERE p_venue_type = ANY(public.issue_4490_venue_type_chip_keys())
    AND c.venue_type = p_venue_type
    AND public.issue_4490_place_is_servable(pp.is_servable, pp.is_active, pp.stored_photo_urls)
    AND pp.lat IS NOT NULL AND pp.lng IS NOT NULL
    AND 6371000.0 * 2.0 * pg_catalog.asin(pg_catalog.sqrt(
          pg_catalog.power(pg_catalog.sin(pg_catalog.radians(pp.lat - p_lat) / 2.0), 2) +
          pg_catalog.cos(pg_catalog.radians(p_lat)) *
          pg_catalog.cos(pg_catalog.radians(pp.lat)) *
          pg_catalog.power(pg_catalog.sin(pg_catalog.radians(pp.lng - p_lng) / 2.0), 2)
        )) <= p_radius_m
    AND NOT (pp.id = ANY(COALESCE(p_exclude_place_ids, '{}'::uuid[])))
  ORDER BY pp.review_count DESC NULLS LAST, pp.rating DESC NULLS LAST, pp.id ASC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_hosted_places_by_venue_type_intersection(
  p_venue_type text,
  p_circles jsonb,
  p_exclude_place_ids uuid[],
  p_limit integer
)
RETURNS TABLE(place_id uuid, google_place_id text, name text, address text, lat double precision,
  lng double precision, rating numeric, review_count integer, price_level text,
  price_range_start_cents integer, price_range_end_cents integer, opening_hours jsonb, website text,
  photos jsonb, stored_photo_urls text[], types text[], primary_type text, generative_summary text,
  signal_score numeric, signal_contributions jsonb, ai_reasoning jsonb, ai_score_raw numeric,
  venue_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'pg_temp'
AS $function$
  WITH circles AS (
    SELECT
      ST_SetSRID(ST_MakePoint((c->>'lng')::double precision, (c->>'lat')::double precision), 4326)::geography AS center,
      (c->>'radius_m')::double precision AS rad_m,
      (c->>'lat')::double precision AS lat,
      (c->>'lng')::double precision AS lng
    FROM jsonb_array_elements(COALESCE(p_circles, '[]'::jsonb)) AS c
    WHERE (c->>'lat') IS NOT NULL
      AND (c->>'lng') IS NOT NULL
      AND (c->>'radius_m') IS NOT NULL
  ),
  -- Bookable venues near the first circle (every row must be inside every circle,
  -- so inside the first one; with no circles, everywhere, as the base RPC).
  anchor AS (
    SELECT COALESCE((SELECT lat FROM circles LIMIT 1), 0) AS lat,
           COALESCE((SELECT lng FROM circles LIMIT 1), 0) AS lng,
           COALESCE((SELECT rad_m FROM circles LIMIT 1) / 1000.0, 20038.0) AS radius_km
  ),
  candidate_places AS (
    SELECT pp.id, c.venue_id
    FROM anchor a
    CROSS JOIN LATERAL public.issue_4490_discover_venue_candidates(ARRAY[]::text[], a.lat, a.lng, a.radius_km) c
    JOIN public.venue_listings v ON v.id = c.venue_id
    JOIN public.place_pool pp ON pp.id = v.place_pool_id
    WHERE p_venue_type = ANY(public.issue_4490_venue_type_chip_keys())
      AND c.venue_type = p_venue_type
      AND public.issue_4490_place_is_servable(pp.is_servable, pp.is_active, pp.stored_photo_urls)
      AND pp.lat IS NOT NULL
      AND pp.lng IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM circles)
        OR NOT EXISTS (
          SELECT 1
          FROM circles ci
          WHERE NOT ST_DWithin(
            ci.center,
            ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
            ci.rad_m
          )
        )
      )
  )
  SELECT pp.id, pp.google_place_id, pp.name, pp.address, pp.lat, pp.lng, pp.rating, pp.review_count,
    pp.price_level, pp.price_range_start_cents, pp.price_range_end_cents, pp.opening_hours, pp.website,
    pp.photos, pp.stored_photo_urls, pp.types, pp.primary_type, pp.generative_summary,
    0::numeric, '{}'::jsonb, NULL::jsonb, NULL::numeric, cp.venue_id
  FROM public.place_pool pp
  JOIN candidate_places cp ON cp.id = pp.id
  WHERE NOT (pp.id = ANY(COALESCE(p_exclude_place_ids, '{}'::uuid[])))
  ORDER BY pp.review_count DESC NULLS LAST, pp.rating DESC NULLS LAST, pp.id ASC
  LIMIT p_limit;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_hosted_venue_types_near(double precision, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_hosted_venue_types_near(double precision, double precision, integer) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_hosted_places_by_venue_type(text, double precision, double precision, integer, uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_hosted_places_by_venue_type(text, double precision, double precision, integer, uuid[], integer) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_hosted_places_by_venue_type_intersection(text, jsonb, uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_hosted_places_by_venue_type_intersection(text, jsonb, uuid[], integer) TO service_role;

COMMIT;
