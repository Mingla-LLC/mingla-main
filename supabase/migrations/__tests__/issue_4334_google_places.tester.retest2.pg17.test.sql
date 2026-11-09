-- #4334 tester retest 2 (pg17, after the full migration chain).
--
-- Angles the implementor's T-18d / T-20 / T-21 do not carry:
--   Y-1  F-5 edges of the legacy `mapboxId` key: a padded Google id is stored
--        trimmed; any non-Google value (not only the retired-vendor prefix)
--        is refused loudly; a retired id under the legacy key is refused even
--        when a valid providerPlaceId rides beside it; when both keys carry
--        Google ids the new key wins.
--   Y-2  F-12 on EVERY place-id cap: all seven CHECK constraints allow 1024
--        characters and refuse 1025, and the shared write validator
--        (places_checked_place_id) keeps 1024 and raises on 1025.
--   Y-3  F-9 as a whole-migration rule: every SECURITY DEFINER function this
--        migration defines is closed to PUBLIC and anon, except the named
--        public read and the pre-existing RSVP-publish grant (D-1, not #4334).
--        A future re-emission without its REVOKE turns this red.
--
-- Fails-on-revert (verified by the tester on a scratch copy of the replay):
--   Y-1  drop the places_is_google_place_id guard on `mapboxId` → Y-1b red.
--   Y-2  put one CHECK back to 256 → Y-2a red.
--   Y-3  GRANT EXECUTE ON business_update_rsvp_graph TO anon → Y-3 red.
\set ON_ERROR_STOP on
BEGIN;

-- ── Y-1 legacy mapboxId key edges (F-5) ─────────────────────────────────────
DO $y1$
DECLARE
  v_json jsonb;
  v_bad text;
  v_failed boolean;
BEGIN
  -- Y-1a padded Google id under the legacy key → accepted, stored trimmed
  v_json := public.chat_plan_parse_where('place',
    jsonb_build_object('mapboxId', '  ChIJS9Q72lL0OxARKJ3cGrQfM0c  ', 'name', 'Lekki Phase 1', 'lat', 6.4478, 'lng', 3.4723), NULL);
  IF v_json ->> 'providerPlaceId' IS DISTINCT FROM 'ChIJS9Q72lL0OxARKJ3cGrQfM0c'
     OR v_json ->> 'identityKey' IS DISTINCT FROM 'google:ChIJS9Q72lL0OxARKJ3cGrQfM0c' THEN
    RAISE EXCEPTION 'Y-1a: padded legacy Google id not stored trimmed (%)', v_json;
  END IF;

  -- Y-1b any non-Google legacy value is refused loudly, not only dXJuOm…
  FOREACH v_bad IN ARRAY ARRAY['short', 'has space inside id', 'pk.eyJ1IjoibWluZ2xh', 'abc$%^&*()_+', '']
  LOOP
    v_failed := false;
    BEGIN
      PERFORM public.chat_plan_parse_where('place',
        jsonb_build_object('mapboxId', v_bad, 'name', 'X', 'lat', 6.4, 'lng', 3.4), NULL);
    EXCEPTION WHEN invalid_parameter_value THEN
      v_failed := SQLERRM = 'invalid_input';
    END;
    IF NOT v_failed THEN
      RAISE EXCEPTION 'Y-1b: legacy mapboxId % was accepted', quote_literal(v_bad);
    END IF;
  END LOOP;

  -- Y-1c a retired id under the legacy key fails even beside a valid new key
  v_failed := false;
  BEGIN
    PERFORM public.chat_plan_parse_where('place',
      jsonb_build_object('providerPlaceId', 'ChIJS9Q72lL0OxARKJ3cGrQfM0c', 'mapboxId', 'dXJuOm1ieHBvaTpsZWtraQ',
                         'name', 'X', 'lat', 6.4, 'lng', 3.4), NULL);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Y-1c: a retired legacy id beside providerPlaceId was accepted silently'; END IF;

  -- Y-1d both keys carry Google ids → the new key wins
  v_json := public.chat_plan_parse_where('place',
    jsonb_build_object('providerPlaceId', 'ChIJnewKeyWins000001', 'mapboxId', 'ChIJlegacyKeyLoses001',
                       'name', 'X', 'lat', 6.4, 'lng', 3.4), NULL);
  IF v_json ->> 'providerPlaceId' IS DISTINCT FROM 'ChIJnewKeyWins000001' THEN
    RAISE EXCEPTION 'Y-1d: the legacy key overrode providerPlaceId (%)', v_json;
  END IF;
END
$y1$;

-- ── Y-2 every place-id cap is 1024 (F-12) ───────────────────────────────────
DO $y2$
DECLARE
  v_con record;
  v_n integer := 0;
  v_failed boolean;
BEGIN
  FOR v_con IN
    SELECT c.conname, c.conrelid::regclass AS rel, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND c.conname IN ('events_location_provider_place_id_length',
                         'venue_listings_location_provider_place_id_length',
                         'brands_location_provider_place_id_length',
                         'preferences_custom_location_place_id_length',
                         'preferences_discover_city_place_id_length',
                         'chat_plans_provider_place_id_length',
                         'chat_plan_place_options_provider_place_id_length')
  LOOP
    v_n := v_n + 1;
    IF v_con.def !~ '1024' OR v_con.def ~ '\m256\M' THEN
      RAISE EXCEPTION 'Y-2a: % on % is not capped at 1024: %', v_con.conname, v_con.rel, v_con.def;
    END IF;
  END LOOP;
  IF v_n <> 7 THEN RAISE EXCEPTION 'Y-2a: expected 7 place-id caps, found %', v_n; END IF;

  IF public.places_checked_place_id('  Ei' || repeat('b', 1022) || ' ') IS DISTINCT FROM 'Ei' || repeat('b', 1022) THEN
    RAISE EXCEPTION 'Y-2b: a padded 1024-character id was not kept';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.places_checked_place_id('Ei' || repeat('b', 1023));
  EXCEPTION WHEN invalid_parameter_value THEN
    v_failed := SQLERRM = 'location_place_id_invalid';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Y-2c: a 1025-character id was accepted by the write validator'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.chat_plan_parse_where('place',
      jsonb_build_object('providerPlaceId', 'Ei' || repeat('c', 1023), 'name', 'X', 'lat', 6.4, 'lng', 3.4), NULL);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Y-2d: a 1025-character providerPlaceId was accepted by the plan parser'; END IF;
END
$y2$;

-- ── Y-3 no SECURITY DEFINER function this migration defines is open to PUBLIC/anon (F-9)
DO $y3$
DECLARE
  v_fn record;
  v_open text[] := ARRAY[]::text[];
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
           EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_x
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.proname = ANY (ARRAY[
         'business_publish_event_draft', 'business_create_event_draft', 'business_update_event_draft',
         'business_update_live_event_atomic', 'business_update_rsvp_graph', 'admin_review_venue_details_change',
         'plan_create', 'chat_plans_for_conversation', 'chat_plan_parse_where', 'chat_plan_seed_original_place',
         'plan_add_place', 'plan_lock', 'chat_plan_place_identity_key', 'business_patch_event_taxonomy_with_place',
         'biz_create_venue_listing', 'biz_update_venue_identity_in_review', 'biz_submit_venue_details_change_request',
         'places_refresh_event_in_scope', 'places_refresh_chat_plan_in_scope', 'places_refresh_pins',
         'places_refresh_due_pins', 'places_refresh_record', 'places_refresh_expire_past',
         'places_refresh_alert_summary', 'places_repin_candidates', 'places_repin_apply', 'places_repin_restore',
         -- the two below are open on purpose / before #4334:
         'pg_public_event_by_slug', 'business_publish_rsvp_draft'])
  LOOP
    IF v_fn.proname IN ('pg_public_event_by_slug', 'business_publish_rsvp_draft') THEN CONTINUE; END IF;
    IF v_fn.anon_x OR v_fn.public_x THEN
      v_open := v_open || (v_fn.oid::regprocedure)::text;
    END IF;
  END LOOP;
  IF cardinality(v_open) > 0 THEN
    RAISE EXCEPTION 'Y-3: SECURITY DEFINER functions open to PUBLIC/anon: %', v_open;
  END IF;
END
$y3$;

ROLLBACK;
