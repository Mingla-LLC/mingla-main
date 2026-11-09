-- #4334 tester adversarial (pg17, after the full migration chain).
--
-- Angles the implementor suites do not carry:
--   X-1  every redefined Host writer has exactly ONE overload (an installed
--        app's named-argument call can never become ambiguous), anon cannot
--        execute any of them, and the job/repin functions plus the
--        `_with_place` copy are closed to authenticated.
--   X-2  a PRE-#4334 custom-location anchor (no place id: the ~78 production
--        rows) is byte-identical after every refresh/expiry/alert/re-pin
--        function runs and after an unrelated preferences save; it is never
--        selected for refresh and never a re-pin candidate (deck safety, D10).
--   X-3  the OLD `business_patch_event_taxonomy` (installed Host builds) moving
--        a pin that carries a Google id must drop the id (the coordinates no
--        longer come from that place); an unmoved save keeps it.
--   X-4  malformed / retired ids are refused on the venue paths (W-2 covers
--        the event draft only); a blank id is NULL, a padded id is trimmed.
--   X-5  expiry never clears a live brand, a venue listing or a preference
--        anchor, however old the refresh stamp.
--
-- Fails-on-revert:
--   X-3  delete the "new coordinates with the SAME id → drop the id" branch of
--        tg_4334_events_place_stamp → X-3a red.
--   X-2  add `OR p.custom_location IS NOT NULL` to the pref_custom arm of
--        places_refresh_pins → X-2b red.
--   X-4  drop the places_checked_place_id call from biz_create_venue_listing →
--        X-4a red.
\set ON_ERROR_STOP on
BEGIN;

-- ── X-1 overloads + grants ──────────────────────────────────────────────────
DO $x1$
DECLARE
  v_name text;
  v_n integer;
  v_sig regprocedure;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'business_create_event_draft', 'business_update_event_draft', 'business_update_rsvp_graph',
    'business_publish_event_draft', 'business_publish_rsvp_draft', 'business_update_live_event_atomic',
    'business_patch_event_taxonomy', 'business_patch_event_taxonomy_with_place',
    'biz_create_venue_listing', 'biz_update_venue_identity_in_review',
    'biz_submit_venue_details_change_request', 'admin_review_venue_details_change',
    'pg_public_event_by_slug', 'plan_create', 'plan_add_place', 'plan_lock'
  ] LOOP
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'X-1a: public.% has % overloads; an installed client''s named call can become ambiguous', v_name, v_n;
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY[
    'business_create_event_draft', 'business_update_event_draft', 'business_update_rsvp_graph',
    'business_publish_event_draft', 'business_update_live_event_atomic',
    'business_patch_event_taxonomy_with_place', 'biz_create_venue_listing',
    'biz_update_venue_identity_in_review', 'biz_submit_venue_details_change_request',
    'admin_review_venue_details_change'
  ] LOOP
    SELECT p.oid::regprocedure INTO v_sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'X-1b: anon can execute %', v_sig;
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY[
    'business_patch_event_taxonomy_with_place', 'places_refresh_pins', 'places_refresh_due_pins',
    'places_refresh_record', 'places_refresh_expire_past', 'places_refresh_alert_summary',
    'places_repin_candidates', 'places_repin_apply', 'places_repin_restore'
  ] LOOP
    SELECT p.oid::regprocedure INTO v_sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_sig IS NULL THEN RAISE EXCEPTION 'X-1c: % missing', v_name; END IF;
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE')
       OR has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'X-1c: a client role can execute %', v_sig;
    END IF;
  END LOOP;

  -- Host writers stay open to the Host app.
  IF NOT has_function_privilege('authenticated',
       'public.biz_create_venue_listing(uuid,text,text,text,text,double precision,double precision,text,text,text,text,text,text,text,text,jsonb,uuid,text,text,text,text,text,text)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'X-1d: authenticated lost biz_create_venue_listing';
  END IF;
END;
$x1$;

DO $test$
DECLARE
  v_owner uuid := '43342000-0000-4000-8400-000000000001';
  v_legacy uuid := '43342000-0000-4000-8400-000000000002';
  v_anchor uuid := '43342000-0000-4000-8400-000000000003';
  v_brand uuid := '43342000-0000-4000-8400-000000000011';
  v_id1 text := 'ChIJ0Wq9hS_1OxARsFOw5qkW6Y0';
  v_hours jsonb := '[
    {"weekday":0,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":1,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":2,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":3,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":4,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":5,"open_time":"10:00","close_time":"16:00","is_closed":false},
    {"weekday":6,"open_time":null,"close_time":null,"is_closed":true}]'::jsonb;
  v_theme jsonb := '{"business_draft":{"requestedVisibility":"public"}}'::jsonb;
  v_before jsonb;
  v_after jsonb;
  v_event uuid;
  v_venue uuid;
  v_bad text;
  v_failed boolean;
  v_row record;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'tester-4334@example.test'),
    (v_legacy, 'legacy-anchor-4334@example.test'),
    (v_anchor, 'old-anchor-4334@example.test');
  INSERT INTO public.profiles(id, display_name, username) VALUES
    (v_legacy, 'Legacy anchor', 'legacy_anchor_4334'),
    (v_anchor, 'Old anchor', 'old_anchor_4334')
    ON CONFLICT (id) DO NOTHING;

  -- ── X-2 a pre-#4334 custom anchor is untouched by everything #4334 runs ──
  INSERT INTO public.preferences(profile_id, custom_location, custom_lat, custom_lng, use_gps_location)
    VALUES (v_legacy, 'Lekki, Lagos', 6.4698, 3.5852, false)
    ON CONFLICT (profile_id) DO UPDATE SET custom_location = EXCLUDED.custom_location,
      custom_lat = EXCLUDED.custom_lat, custom_lng = EXCLUDED.custom_lng, use_gps_location = false;
  SELECT to_jsonb(p) - 'updated_at' INTO v_before FROM public.preferences p WHERE profile_id = v_legacy;

  PERFORM count(*) FROM public.places_refresh_due_pins(500);
  PERFORM public.places_refresh_expire_past();
  PERFORM public.places_refresh_alert_summary();
  IF EXISTS (SELECT 1 FROM public.places_refresh_pins() WHERE row_id = v_legacy) THEN
    RAISE EXCEPTION 'X-2b: a pre-#4334 anchor (no place id) is listed for refresh';
  END IF;
  IF EXISTS (SELECT 1 FROM public.places_repin_candidates() WHERE row_id = v_legacy) THEN
    RAISE EXCEPTION 'X-2c: a preference anchor is a re-pin candidate (D10: anchors are never re-pinned)';
  END IF;
  SELECT to_jsonb(p) - 'updated_at' INTO v_after FROM public.preferences p WHERE profile_id = v_legacy;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'X-2a: the #4334 job functions rewrote a pre-#4334 anchor: % -> %', v_before, v_after;
  END IF;

  -- an unrelated preferences save (an installed Explorer build) leaves the coordinates alone
  UPDATE public.preferences SET use_gps_location = true WHERE profile_id = v_legacy;
  UPDATE public.preferences SET use_gps_location = false WHERE profile_id = v_legacy;
  SELECT to_jsonb(p) - 'updated_at' INTO v_after FROM public.preferences p WHERE profile_id = v_legacy;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'X-2d: the preferences stamp trigger changed an unrelated save: % -> %', v_before, v_after;
  END IF;

  -- ── X-5 expiry never clears an anchor, a venue or a live brand ──────────
  INSERT INTO public.preferences(profile_id, custom_location, custom_lat, custom_lng, use_gps_location,
                                 custom_location_place_id)
    VALUES (v_anchor, 'Ikeja, Lagos', 6.6018, 3.3515, false, v_id1)
    ON CONFLICT (profile_id) DO UPDATE SET custom_location = EXCLUDED.custom_location,
      custom_lat = EXCLUDED.custom_lat, custom_lng = EXCLUDED.custom_lng,
      custom_location_place_id = EXCLUDED.custom_location_place_id;
  UPDATE public.preferences SET custom_location_geo_refreshed_at = now() - interval '400 days',
    custom_location_geo_refresh_state = 'place_gone' WHERE profile_id = v_anchor;

  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'tester-4334@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country,
                            pricing_region, pricing_currency, address, lat, lng, location_provider_place_id)
    VALUES (v_brand, v_owner, 'Tester 4334', 'tester-4334', 'NGN', 'paystack', 'NG', 'NG', 'NGN',
            '175 Akin Adesola St', 6.4325, 3.4236, v_id1);
  UPDATE public.brands SET location_geo_refreshed_at = now() - interval '400 days',
    location_geo_refresh_state = 'failing' WHERE id = v_brand;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  v_venue := public.biz_create_venue_listing(
    v_brand, 'Tester venue', 'testervenue4334', 'A venue.', '', 6.4325, 3.4236, 'Lagos', 'NG',
    '175 Akin Adesola St', 'restaurant', 'tester-venue-4334@example.test', '+2348031234567', '', '', v_hours,
    NULL, 'exact', p_location_place_id => '  ' || v_id1 || '  ');
  IF (SELECT location_provider_place_id FROM public.venue_listings WHERE id = v_venue) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'X-4b: a padded place id was not trimmed';
  END IF;
  UPDATE public.venue_listings SET location_geo_refreshed_at = now() - interval '400 days',
    location_geo_refresh_state = 'failing' WHERE id = v_venue;

  PERFORM public.places_refresh_expire_past();
  IF (SELECT custom_lat FROM public.preferences WHERE profile_id = v_anchor) IS DISTINCT FROM 6.6018 THEN
    RAISE EXCEPTION 'X-5a: a preference anchor lost its coordinates to expiry';
  END IF;
  IF (SELECT lat FROM public.brands WHERE id = v_brand) IS NULL THEN
    RAISE EXCEPTION 'X-5b: a live brand lost its pin to expiry';
  END IF;
  IF (SELECT lat FROM public.venue_listings WHERE id = v_venue) IS NULL THEN
    RAISE EXCEPTION 'X-5c: a venue listing lost its pin to expiry';
  END IF;

  -- ── X-4 malformed / retired ids refused on the venue paths ──────────────
  FOREACH v_bad IN ARRAY ARRAY['dXJuOm1ieHBvaTpkaWRp', 'short', 'ChIJ has spaces inside', repeat('A', 1025)] LOOP  -- F-12: the cap is 1024
    v_failed := false;
    BEGIN
      PERFORM public.biz_create_venue_listing(
        v_brand, 'Bad id venue', 'badidvenue4334', 'A venue.', '', 6.4325, 3.4236, 'Lagos', 'NG',
        '175 Akin Adesola St', 'restaurant', 'bad-venue-4334@example.test', '+2348031234567', '', '', v_hours,
        NULL, 'exact', p_location_place_id => v_bad);
    EXCEPTION WHEN invalid_parameter_value THEN v_failed := SQLERRM = 'location_place_id_invalid';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'X-4a: venue create stored a bad place id (%)', left(v_bad, 30); END IF;
  END LOOP;

  v_failed := false;
  BEGIN
    PERFORM public.biz_update_venue_identity_in_review(v_venue, p_address => '3 Tokunbo Omisore St',
      p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4482, p_lng => 3.4569,
      p_coordinate_precision => 'exact', p_location_place_id => 'dXJuOm1ieHBvaTpkaWRp');
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := SQLERRM = 'location_place_id_invalid';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'X-4c: in-review edit stored a retired id'; END IF;

  -- an installed Host build's call (no place id argument) still resolves and stores no id
  PERFORM public.biz_update_venue_identity_in_review(v_venue, p_address => '3 Tokunbo Omisore St',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4482, p_lng => 3.4569,
    p_coordinate_precision => 'exact');
  SELECT lat, location_provider_place_id INTO v_row FROM public.venue_listings WHERE id = v_venue;
  IF v_row.lat <> 6.4482 THEN
    RAISE EXCEPTION 'X-4d: an installed app''s in-review edit did not save (%)', row_to_json(v_row);
  END IF;
  IF v_row.location_provider_place_id IS NOT NULL THEN
    RAISE EXCEPTION 'X-4e: a moved venue pin without an id kept the old id (%)', row_to_json(v_row);
  END IF;

  -- ── X-3 the OLD taxonomy function (installed Host builds) ───────────────
  v_event := ((public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Old live edit', 'location_text', 'Didi Museum', 'location_geo', '(3.4236,6.4325)',
    'location_provider_place_id', v_id1, 'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme)))
    #>> '{event,id}')::uuid;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master, occurrence_key)
    VALUES (v_event, now() + interval '5 days', now() + interval '5 days 3 hours', 'Africa/Lagos', true, 'a');
  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now(),
    slug = 'tester-old-live-edit', city = 'Lagos',
    theme = jsonb_build_object('business_event', jsonb_build_object('requestedVisibility', 'public'))
   WHERE id = v_event;
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'X-3 setup: the draft did not keep its id';
  END IF;

  -- unmoved save keeps the id
  PERFORM public.business_patch_event_taxonomy(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4325, 3.4236, NULL, '');
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'X-3b: an unmoved save through the old function lost the id';
  END IF;

  -- moved save without an id drops it
  PERFORM public.business_patch_event_taxonomy(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4482, 3.4569, 'Quays', 'exact');
  SELECT location_provider_place_id, location_geo_refreshed_at, location_geo INTO v_row
    FROM public.events WHERE id = v_event;
  IF v_row.location_provider_place_id IS NOT NULL OR v_row.location_geo_refreshed_at IS NOT NULL THEN
    RAISE EXCEPTION 'X-3a: an installed app moved the pin and the old Google id stayed attached (%)', row_to_json(v_row);
  END IF;
  IF NOT (v_row.location_geo ~= point(3.4569, 6.4482)) THEN
    RAISE EXCEPTION 'X-3c: the old function did not save the new pin (%)', row_to_json(v_row);
  END IF;
END;
$test$;

ROLLBACK;
\echo 'issue_4334_google_places.tester.adversarial: all assertions passed'
