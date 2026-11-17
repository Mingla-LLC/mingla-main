-- =====================================================================================
-- Issue #4420 — discovery reads coarse points for offerings that hide their address.
--
-- 20280722004420 gave the deck reader and the links page a coarse point (one decimal,
-- about 11 km) for an experience that hides its address until booking
-- (issue_2489_address_withheld: hideAddressUntilTicket true or absent). This file
-- applies the same coarse point to the Discover v2 readers and to two grants:
--
--   1. discover_v2_items (experiences) and discover_v2_city_context: the experience
--      radius test and distance measure each stop at issue_4420_stop_coordinate, so a
--      hidden stop is filtered and ordered at its coarse point. A visible stop is
--      measured at its exact pin, as before.
--
--   2. discover_v2_event_base: the event radius test (also used by
--      pg_discover_business_events, whose radius is caller supplied) measures an event
--      that withholds its address at the same coarse point of location_geo. Its
--      payload already returns no location_geo while withheld; city, the online
--      branch and visible events are unchanged.
--
--   3. discover_v2_nearest_city (called by discover_v2_facets_exact for the empty-city
--      hint): the event and experience candidates carry the coarse point while
--      withheld, so the hint's lat/lng and the distance that picks it never use the
--      exact pin. Trips and stays are unchanged (neither has a hide-until-booking rule).
--
--   4. pg_eligible_experiences_for_deck: anon EXECUTE is withdrawn. Its only callers
--      are the discover-cards and generate-curated-experiences edge functions, which
--      call it with the service role; no app or web client calls it. service_role and
--      authenticated keep EXECUTE.
--
--   5. events.venue_tax_address: anon column SELECT is withdrawn. It is the venue's
--      street address for tax, read only server-side with the service role; no
--      anonymous reader selects it. Other anon column grants are unchanged.
--
-- Every rewrite is an exact, counted substitution of the live definition (the #4174
-- pattern). CREATE OR REPLACE keeps signatures, return shapes, SECURITY DEFINER and
-- ACLs. A count mismatch aborts the migration.
--
-- ORDERING: strictly greater than 20280722004453 (the newest prefix in this worktree,
-- every sibling worktree and origin/main when this file was created).
-- =====================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.issue_4420_patch(
  p_signature text,
  p_old text,
  p_new text,
  p_expected integer
) RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_def text;
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_def := pg_get_functiondef(p_signature::regprocedure);
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_old_count = 0 AND v_new_count = p_expected THEN
    RETURN;
  END IF;
  IF v_old_count <> p_expected THEN
    RAISE EXCEPTION 'issue_4420_shape_mismatch: % expected % match(es), found %',
      p_signature, p_expected, v_old_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END
$function$;

-- -------------------------------------------------------------------------------------
-- 1. Experience stops are measured at their coarse point while hidden.
-- -------------------------------------------------------------------------------------
SELECT pg_temp.issue_4420_patch(
  'public.discover_v2_items(text,text[],double precision,double precision,double precision,text,jsonb,integer,integer)',
  $old$radians(s.lat-p_lat)$old$,
  $new$radians(public.issue_4420_stop_coordinate(e.theme,s.lat)-p_lat)$new$,
  1
);
SELECT pg_temp.issue_4420_patch(
  'public.discover_v2_items(text,text[],double precision,double precision,double precision,text,jsonb,integer,integer)',
  $old$cos(radians(s.lat))*power(sin(radians(s.lng-p_lng)$old$,
  $new$cos(radians(public.issue_4420_stop_coordinate(e.theme,s.lat)))*power(sin(radians(public.issue_4420_stop_coordinate(e.theme,s.lng)-p_lng)$new$,
  1
);
SELECT pg_temp.issue_4420_patch(
  'public.discover_v2_city_context(text[],double precision,double precision,double precision,text)',
  $old$radians(s.lat-p_lat)$old$,
  $new$radians(public.issue_4420_stop_coordinate(e.theme,s.lat)-p_lat)$new$,
  2
);
SELECT pg_temp.issue_4420_patch(
  'public.discover_v2_city_context(text[],double precision,double precision,double precision,text)',
  $old$cos(radians(s.lat))*power(sin(radians(s.lng-p_lng)$old$,
  $new$cos(radians(public.issue_4420_stop_coordinate(e.theme,s.lat)))*power(sin(radians(public.issue_4420_stop_coordinate(e.theme,s.lng)-p_lng)$new$,
  2
);

-- -------------------------------------------------------------------------------------
-- 2. An event that withholds its address is radius-tested at its coarse point.
--    location_geo is point(lng, lat): [0] is lng, [1] is lat.
-- -------------------------------------------------------------------------------------
SELECT pg_temp.issue_4420_patch(
  'public.discover_v2_event_base(text[],timestamp with time zone,timestamp with time zone,text[],text[],text[],double precision,double precision,double precision)',
  $old$public.ST_SetSRID(e.location_geo::public.geometry,4326)$old$,
  $new$public.ST_SetSRID(public.ST_MakePoint(
            public.issue_4420_stop_coordinate(e.theme,(e.location_geo)[0]),
            public.issue_4420_stop_coordinate(e.theme,(e.location_geo)[1])),4326)$new$,
  1
);

-- -------------------------------------------------------------------------------------
-- 3. The nearest-city hint carries coarse points for withheld events and experiences.
-- -------------------------------------------------------------------------------------
SELECT pg_temp.issue_4420_patch(
  'public.discover_v2_nearest_city(double precision,double precision)',
  $old$(e.location_geo)[1]::float8 lat,(e.location_geo)[0]::float8 lng$old$,
  $new$public.issue_4420_stop_coordinate(e.theme,(e.location_geo)[1]::float8) lat,public.issue_4420_stop_coordinate(e.theme,(e.location_geo)[0]::float8) lng$new$,
  1
);
SELECT pg_temp.issue_4420_patch(
  'public.discover_v2_nearest_city(double precision,double precision)',
  $old$SELECT concat_ws(', ',s.city,s.country_code),s.lat,s.lng,e.id::text FROM public.events e$old$,
  $new$SELECT concat_ws(', ',s.city,s.country_code),public.issue_4420_stop_coordinate(e.theme,s.lat),public.issue_4420_stop_coordinate(e.theme,s.lng),e.id::text FROM public.events e$new$,
  1
);

-- The rewritten readers keep service-role-only EXECUTE (#4073); restated, unchanged.
REVOKE ALL ON FUNCTION public.discover_v2_items(text, text[], double precision, double precision, double precision, text, jsonb, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_city_context(text[], double precision, double precision, double precision, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_event_base(text[], timestamp with time zone, timestamp with time zone, text[], text[], text[], double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_nearest_city(double precision, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discover_v2_items(text, text[], double precision, double precision, double precision, text, jsonb, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_city_context(text[], double precision, double precision, double precision, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_event_base(text[], timestamp with time zone, timestamp with time zone, text[], text[], text[], double precision, double precision, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_nearest_city(double precision, double precision) TO service_role;

-- -------------------------------------------------------------------------------------
-- 4. The deck reader is called only by service-role edge functions.
-- -------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.pg_eligible_experiences_for_deck(double precision, double precision, double precision, text[], timestamp with time zone, uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pg_eligible_experiences_for_deck(double precision, double precision, double precision, text[], timestamp with time zone, uuid[], integer) TO authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 5. The venue tax address is a server-side value. anon holds column-level grants on
--    events (#2489 phase 2: no table-level SELECT), so this column revoke is effective.
-- -------------------------------------------------------------------------------------
REVOKE SELECT (venue_tax_address) ON public.events FROM anon;

DO $verify$
BEGIN
  IF has_table_privilege('anon', 'public.events', 'SELECT') THEN
    RAISE EXCEPTION 'issue_4420: anon holds table-level SELECT on events; the column revoke would be a no-op';
  END IF;
  IF has_column_privilege('anon', 'public.events', 'venue_tax_address', 'SELECT') THEN
    RAISE EXCEPTION 'issue_4420: anon can still select events.venue_tax_address';
  END IF;
  IF has_function_privilege('anon', 'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamp with time zone,uuid[],integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_4420: anon can still execute pg_eligible_experiences_for_deck';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamp with time zone,uuid[],integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.discover_v2_items(text,text[],double precision,double precision,double precision,text,jsonb,integer,integer)', 'EXECUTE')
     OR NOT has_column_privilege('anon', 'public.events', 'theme', 'SELECT') THEN
    RAISE EXCEPTION 'issue_4420: a legitimate grant was lost';
  END IF;
END
$verify$;

COMMENT ON COLUMN public.events.venue_tax_address IS
  'ORCH-1006 venue tax address (server-side pricing input). #4420: not granted to anon; '
  'read with the service role only.';

-- #2489 SC-25 carriers: unchanged. These readers delegate to issue_4420_stop_coordinate
-- (already declared by 20280722004420); #4073 keeps delegating v2 readers out of the
-- registry.

COMMIT;
