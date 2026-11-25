-- Issue #4490, Explorer app W5: hosted venues lead each deck category (server only).
-- Spec 06 §3 W5 (the spec's number 20281203374490 is taken; this is the first free
-- slot after 20281203444490 and before spec 08's reserved 20281203504490).
--
-- A hosted venue is a place whose verified venue (of a live, non-internal brand)
-- passes issue_4490_venue_is_bookable (a live offer, plan or reservable tables).
-- With the flag on, discover-cards makes ONE hosted call per request (solo) or per
-- position (shared deck) for all of that request's signals, and gets at most 6
-- hosted rows per (signal, mood floor), in a fixed order (signal score DESC,
-- review_count DESC NULLS LAST, place id ASC). The stored score is never changed.
--
-- Fix round 1 (W5-N2): the wrappers used to run the whole base servable RPC with no
-- row cap and then keep the bookable venues (322-330 ms at 100 km even where no
-- venue exists, once per chip x signal). They now START from the small set of verified
-- venues whose place is inside the radius (or every circle) and score only
-- those places, so an area with no hosted venue answers at once; the costly bookability
-- check runs only in rank order and stops at 6 per (signal, floor). The guardrails are
-- the base RPCs' own rules, restated here for that small set: the place rule
-- (issue_4490_place_is_servable, the same helper the solo base RPC calls after
-- 20281203474490), the mood floor, the radius (solo haversine) or every circle
-- (shared deck ST_DWithin), exclusions and the solo price filter (the same
-- place_discovery_range_for_viewer clause). The W5 pg17 suite proves the rows equal
-- "base RPC with no row cap, restricted to bookable venues, top 6" over a grid of
-- arguments (E-1 / E-2), so the two cannot drift silently. Neither base RPC is
-- touched here.
--
-- 1. issue_4490_place_is_servable(is_servable, is_active, photos): the place-quality
--    part of the deck's servable rule (one SQL expression, IMMUTABLE, invoker, no SET:
--    inlinable). 20281203474490 makes the solo base RPC call it.
-- 2. issue_4490_hosted_servable_places(signals jsonb, lat, lng, radius m, exclude,
--    price filter...) -> base row shape + venue_id, signal_id, filter_min.
--    `signals` = [{"signal_id": text, "filter_min": number}, ...].
-- 3. issue_4490_hosted_servable_places_intersection(signals jsonb, circles, exclude):
--    the shared-deck shape.
-- 4. Flag VENUE_DECK_HOSTED_FIRST (false). Read by discover-cards (60 s cache).
--
-- Both wrappers are service_role only (discover-cards calls them with the service key).

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

-- An earlier local draft of this file defined one-signal wrappers; drop them so only
-- the request-wide shape exists (no overload is left behind).
DROP FUNCTION IF EXISTS public.issue_4490_hosted_servable_places(text, numeric, double precision, double precision, double precision, uuid[], bigint, bigint, character, uuid);
DROP FUNCTION IF EXISTS public.issue_4490_hosted_servable_places_intersection(text, numeric, jsonb, uuid[]);

CREATE OR REPLACE FUNCTION public.issue_4490_hosted_servable_places(
  p_signals jsonb,
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[],
  p_price_filter_min_minor bigint DEFAULT NULL::bigint,
  p_price_filter_max_minor bigint DEFAULT NULL::bigint,
  p_price_filter_currency character DEFAULT NULL::bpchar,
  p_fx_snapshot_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(place_id uuid, google_place_id text, name text, address text, lat double precision,
  lng double precision, rating numeric, review_count integer, price_level text,
  price_range_start_cents integer, price_range_end_cents integer, opening_hours jsonb, website text,
  photos jsonb, stored_photo_urls text[], types text[], primary_type text, generative_summary text,
  signal_score numeric, signal_contributions jsonb, ai_reasoning jsonb, ai_score_raw numeric,
  venue_id uuid, signal_id text, filter_min numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH near AS MATERIALIZED (
    -- Verified venues of live, non-internal brands whose place passes the place
    -- rule, is inside the radius and is not excluded. Bookability is checked
    -- later, only for the few candidates that can still lead (it is the costly
    -- check, so it runs in rank order and stops at 6 per pair).
    SELECT v.id AS venue_id, pp.id AS place_id
    FROM public.venue_listings v
    JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
    JOIN public.place_pool pp ON pp.id = v.place_pool_id
    WHERE v.claim_status = 'verified'
      AND public.issue_4490_place_is_servable(pp.is_servable, pp.is_active, pp.stored_photo_urls)
      AND (
        6371000.0 * 2.0 * pg_catalog.asin(pg_catalog.sqrt(
          pg_catalog.power(pg_catalog.sin(pg_catalog.radians(pp.lat - p_lat) / 2.0), 2) +
          pg_catalog.cos(pg_catalog.radians(p_lat)) *
          pg_catalog.cos(pg_catalog.radians(pp.lat)) *
          pg_catalog.power(pg_catalog.sin(pg_catalog.radians(pp.lng - p_lng) / 2.0), 2)
        ))
      ) <= p_radius_m
      AND NOT (pp.id = ANY(COALESCE(p_exclude_place_ids, '{}'::uuid[])))
      AND NOT public.admin_brand_is_internal(b.id)
  ), wanted AS (
    SELECT DISTINCT s->>'signal_id' AS signal_id, (s->>'filter_min')::numeric AS filter_min
    FROM pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(p_signals) = 'array' THEN p_signals ELSE '[]'::jsonb END) s
    WHERE pg_catalog.jsonb_typeof(s) = 'object'
      AND s->>'signal_id' IS NOT NULL
      AND s->>'filter_min' IS NOT NULL
  )
  SELECT r.id, r.google_place_id, r.name, r.address, r.lat, r.lng, r.rating, r.review_count, r.price_level,
    r.price_range_start_cents, r.price_range_end_cents, r.opening_hours, r.website, r.photos, r.stored_photo_urls,
    r.types, r.primary_type, r.generative_summary, r.score, r.contributions, r.ai_reasoning, r.ai_score_raw,
    r.venue_id, w.signal_id, w.filter_min
  FROM wanted w
  CROSS JOIN LATERAL (
    SELECT ranked.*
    FROM (
      -- Every near place that passes the floor and the price filter, in the hosted
      -- order. OFFSET 0 keeps the bookability check below out of this scan.
      SELECT pp.id, pp.google_place_id, pp.name, pp.address, pp.lat, pp.lng, pp.rating, pp.review_count,
        pp.price_level, pp.price_range_start_cents, pp.price_range_end_cents, pp.opening_hours, pp.website,
        pp.photos, pp.stored_photo_urls, pp.types, pp.primary_type, pp.generative_summary,
        ps.score, ps.contributions,
        pp.ai_signal_scores -> w.signal_id AS ai_reasoning,
        NULLIF(pp.ai_signal_scores -> w.signal_id ->> 'score_0_to_100', '')::numeric AS ai_score_raw,
        n.venue_id,
        pg_catalog.row_number() OVER (ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC) AS rank
      FROM near n
      JOIN public.place_pool pp ON pp.id = n.place_id
      JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = w.signal_id
      CROSS JOIN LATERAL public.place_discovery_range_for_viewer(
        pp.id,
        p_price_filter_currency,
        p_fx_snapshot_id
      ) filtered_price
      WHERE ps.score >= w.filter_min
        -- The solo base RPC's price clause, unchanged.
        AND (
          p_price_filter_currency IS NULL
          OR (
            filtered_price.price_range_status = 'active'
            AND COALESCE(
              filtered_price.display_currency_code,
              filtered_price.source_currency_code
            ) = p_price_filter_currency
            AND (
              COALESCE(
                filtered_price.display_max_minor,
                filtered_price.source_max_minor
              ) IS NULL
              OR COALESCE(
                  filtered_price.display_max_minor,
                  filtered_price.source_max_minor
                ) >= COALESCE(p_price_filter_min_minor, 0)
            )
            AND (
              p_price_filter_max_minor IS NULL
              OR COALESCE(
                filtered_price.display_min_minor,
                filtered_price.source_min_minor
              ) <= p_price_filter_max_minor
            )
          )
        )
      ORDER BY rank
      OFFSET 0
    ) ranked
    WHERE public.issue_4490_venue_is_bookable(ranked.venue_id)
    LIMIT 6
  ) r
  ORDER BY w.signal_id, w.filter_min, r.rank;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_hosted_servable_places_intersection(
  p_signals jsonb,
  p_circles jsonb,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS TABLE(place_id uuid, google_place_id text, name text, address text, lat double precision,
  lng double precision, rating numeric, review_count integer, price_level text,
  price_range_start_cents integer, price_range_end_cents integer, opening_hours jsonb, website text,
  photos jsonb, stored_photo_urls text[], types text[], primary_type text, generative_summary text,
  signal_score numeric, signal_contributions jsonb, ai_reasoning jsonb, ai_score_raw numeric,
  venue_id uuid, signal_id text, filter_min numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
  WITH circles AS (
    -- The shared-deck base RPC's circles, unchanged.
    SELECT
      ST_SetSRID(ST_MakePoint((c->>'lng')::double precision, (c->>'lat')::double precision), 4326)::geography AS center,
      (c->>'radius_m')::double precision AS rad_m
    FROM jsonb_array_elements(p_circles) AS c
    WHERE (c->>'lat') IS NOT NULL
      AND (c->>'lng') IS NOT NULL
      AND (c->>'radius_m') IS NOT NULL
  ), near AS MATERIALIZED (
    -- As the solo wrapper: candidates first, bookability later in rank order.
    SELECT v.id AS venue_id, pp.id AS place_id
    FROM public.venue_listings v
    JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
    JOIN public.place_pool pp ON pp.id = v.place_pool_id
    WHERE v.claim_status = 'verified'
      AND public.issue_4490_place_is_servable(pp.is_servable, pp.is_active, pp.stored_photo_urls)
      AND pp.lat IS NOT NULL
      AND pp.lng IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM circles)
        OR NOT EXISTS (
          SELECT 1
          FROM circles c
          WHERE NOT ST_DWithin(
            c.center,
            ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
            c.rad_m
          )
        )
      )
      AND NOT (pp.id = ANY(COALESCE(p_exclude_place_ids, '{}'::uuid[])))
      AND NOT public.admin_brand_is_internal(b.id)
  ), wanted AS (
    SELECT DISTINCT s->>'signal_id' AS signal_id, (s->>'filter_min')::numeric AS filter_min
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_signals) = 'array' THEN p_signals ELSE '[]'::jsonb END) s
    WHERE jsonb_typeof(s) = 'object'
      AND s->>'signal_id' IS NOT NULL
      AND s->>'filter_min' IS NOT NULL
  )
  SELECT r.id, r.google_place_id, r.name, r.address, r.lat, r.lng, r.rating, r.review_count, r.price_level,
    r.price_range_start_cents, r.price_range_end_cents, r.opening_hours, r.website, r.photos, r.stored_photo_urls,
    r.types, r.primary_type, r.generative_summary, r.score, r.contributions, r.ai_reasoning, r.ai_score_raw,
    r.venue_id, w.signal_id, w.filter_min
  FROM wanted w
  CROSS JOIN LATERAL (
    SELECT ranked.*
    FROM (
      SELECT pp.id, pp.google_place_id, pp.name, pp.address, pp.lat, pp.lng, pp.rating, pp.review_count,
        pp.price_level, pp.price_range_start_cents, pp.price_range_end_cents, pp.opening_hours, pp.website,
        pp.photos, pp.stored_photo_urls, pp.types, pp.primary_type, pp.generative_summary,
        ps.score, ps.contributions,
        pp.ai_signal_scores -> w.signal_id AS ai_reasoning,
        NULLIF((pp.ai_signal_scores -> w.signal_id ->> 'score_0_to_100'), '')::numeric AS ai_score_raw,
        n.venue_id,
        row_number() OVER (ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC) AS rank
      FROM near n
      JOIN public.place_pool pp ON pp.id = n.place_id
      JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = w.signal_id
      WHERE ps.score >= w.filter_min
      ORDER BY rank
      OFFSET 0
    ) ranked
    WHERE public.issue_4490_venue_is_bookable(ranked.venue_id)
    LIMIT 6
  ) r
  ORDER BY w.signal_id, w.filter_min, r.rank;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_hosted_servable_places(jsonb, double precision, double precision, double precision, uuid[], bigint, bigint, character, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_hosted_servable_places(jsonb, double precision, double precision, double precision, uuid[], bigint, bigint, character, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_hosted_servable_places_intersection(jsonb, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_hosted_servable_places_intersection(jsonb, jsonb, uuid[]) TO service_role;

INSERT INTO public.feature_flags (flag_key, is_enabled, description) VALUES
  ('VENUE_DECK_HOSTED_FIRST', false, '#4490 explorer W5: hosted bookable venues lead each deck category (discover-cards, server only)')
ON CONFLICT (flag_key) DO NOTHING;

COMMIT;
