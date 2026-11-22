-- Issue #4490, Explorer app W5: hosted venues lead each deck category (server only).
-- Spec 06 §3 W5 (the spec's number 20280809394490 is taken; this is the first free
-- slot after 20280809459490 and before spec 08's reserved 20280809464490).
--
-- A hosted venue is a place whose verified venue (of a live, non-internal brand)
-- passes issue_4490_venue_is_bookable (a live offer, plan or reservable tables).
-- These two wrappers return at most 6 hosted rows per signal call, in a fixed order
-- (signal score DESC, review_count DESC NULLS LAST, place id ASC). They WRAP the base
-- servable RPCs (no copy), so the mood floor, radius / circles, price filter,
-- exclusions and place-quality checks stay owned by the base bodies, and they pass
-- p_limit => NULL (LIMIT NULL = no limit) so no hosted venue is lost below a row cap.
-- The stored score is never changed. Neither base RPC is touched here.
--
-- 1. issue_4490_hosted_servable_places(<the solo RPC's arguments except p_limit>)
-- 2. issue_4490_hosted_servable_places_intersection(<the collab RPC's arguments except p_limit>)
-- 3. Flag VENUE_DECK_HOSTED_FIRST (false). Read by discover-cards (60 s cache).
--
-- Both wrappers are service_role only (discover-cards calls them with the service key).

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_4490_hosted_servable_places(
  p_signal_id text,
  p_filter_min numeric,
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
  venue_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT s.place_id, s.google_place_id, s.name, s.address, s.lat, s.lng, s.rating, s.review_count,
    s.price_level, s.price_range_start_cents, s.price_range_end_cents, s.opening_hours, s.website,
    s.photos, s.stored_photo_urls, s.types, s.primary_type, s.generative_summary, s.signal_score,
    s.signal_contributions, s.ai_reasoning, s.ai_score_raw, v.id
  FROM public.issue_1384_query_servable_places_by_signal(
    p_signal_id, p_filter_min, p_lat, p_lng, p_radius_m, p_exclude_place_ids,
    NULL::integer,
    p_price_filter_min_minor, p_price_filter_max_minor, p_price_filter_currency, p_fx_snapshot_id) s
  JOIN public.venue_listings v ON v.place_pool_id = s.place_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE NOT public.admin_brand_is_internal(b.id)
    AND public.issue_4490_venue_is_bookable(v.id)
  ORDER BY s.signal_score DESC, s.review_count DESC NULLS LAST, s.place_id ASC
  LIMIT 6;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_hosted_servable_places_intersection(
  p_signal_id text,
  p_filter_min numeric,
  p_circles jsonb,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[]
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
  SELECT s.place_id, s.google_place_id, s.name, s.address, s.lat, s.lng, s.rating, s.review_count,
    s.price_level, s.price_range_start_cents, s.price_range_end_cents, s.opening_hours, s.website,
    s.photos, s.stored_photo_urls, s.types, s.primary_type, s.generative_summary, s.signal_score,
    s.signal_contributions, s.ai_reasoning, s.ai_score_raw, v.id
  FROM public.query_servable_places_by_signal_intersection(
    p_signal_id, p_filter_min, p_circles, COALESCE(p_exclude_place_ids, '{}'::uuid[]), NULL::integer) s
  JOIN public.venue_listings v ON v.place_pool_id = s.place_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE NOT public.admin_brand_is_internal(b.id)
    AND public.issue_4490_venue_is_bookable(v.id)
  ORDER BY s.signal_score DESC, s.review_count DESC NULLS LAST, s.place_id ASC
  LIMIT 6;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_hosted_servable_places(text, numeric, double precision, double precision, double precision, uuid[], bigint, bigint, character, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_hosted_servable_places(text, numeric, double precision, double precision, double precision, uuid[], bigint, bigint, character, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_hosted_servable_places_intersection(text, numeric, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_hosted_servable_places_intersection(text, numeric, jsonb, uuid[]) TO service_role;

INSERT INTO public.feature_flags (flag_key, is_enabled, description) VALUES
  ('VENUE_DECK_HOSTED_FIRST', false, '#4490 explorer W5: hosted bookable venues lead each deck category (discover-cards, server only)')
ON CONFLICT (flag_key) DO NOTHING;

COMMIT;
