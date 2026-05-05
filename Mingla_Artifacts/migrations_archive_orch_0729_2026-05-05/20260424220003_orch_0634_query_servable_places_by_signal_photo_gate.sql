-- ORCH-0634 — Patch query_servable_places_by_signal: add G3 photo gate
--
-- The current RPC filters on is_servable=true + score + radius + exclusions
-- but NOT on stored_photo_urls. 9 places today are is_servable=true with only
-- the '__backfill_failed__' photo sentinel and would serve as broken cards.
--
-- ORCH-0640 coordination (2026-04-22 note) flagged this as the Constitution #13
-- (exclusion consistency) violation to close. fetchSinglesForSignalRank in
-- generate-curated-experiences already applies the gate client-side after its
-- rewrite in this same ORCH-0634 session, but any OTHER caller of this RPC
-- (direct callers, admin probes, future surfaces) still gets the leak without
-- this patch.
--
-- Matches the predicate pattern from legacy query_pool_cards two-gate.
-- Idempotent (CREATE OR REPLACE).

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
SET search_path TO 'public'
AS $function$
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
    -- ORCH-0634 G3 photo gate: closes the 9-row leak from places approved by
    -- Bouncer but with __backfill_failed__ photo sentinel. Mirror of legacy
    -- query_pool_cards predicate. Constitution #13 exclusion consistency.
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )
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
$function$;

COMMENT ON FUNCTION public.query_servable_places_by_signal IS
  'ORCH-0634: signal-scored servable places within radius. Three-gate serving enforced: is_servable + stored_photo_urls (G3 patch 2026-04-22) + signal_score >= filter_min. Used by discover-cards multi-chip fan-out and generate-curated-experiences curated stop fetch.';
