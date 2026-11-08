-- #4334 — Google place ids and the 30-day coordinate refresh (spec v2 §6.2–6.8,
-- amendments A1 + A2), the re-pin (§7), chat plans (§6.2) and the api-health
-- tiles (§8), against the replayed schema.
-- MINGLA-INVARIANT: I-4334-GOOGLE-COORDS-UNDER-30-DAYS | issue #4334 | Every stored Google coordinate carries geo_refreshed_at; the refresh keeps in-scope pins under 30 days; only PAST offerings lose coordinates (day 29); live, upcoming and draft offerings and preference anchors are never cleared.
-- MINGLA-INVARIANT: I-4334-HOST-TEXT-PERMANENT | issue #4334 | Host-entered address text is never written by the refresh, the expiry or the re-pin.
--
-- Fails-on-revert (line deleted → red):
--   T-1  places_refresh_due_pins `p.in_scope AND`          → a past pin is selected
--   T-4  the trigger "writer-managed" early return           → refresh timestamp lost
--   T-10 the `= p_expected_place_id` guard in record         → a re-pick is overwritten
--   T-11/12 `NOT places_refresh_event_in_scope` in expire    → a live event loses its pin
--   T-17 A2: preferences excluded from expire                 → an anchor is cleared
--   T-18 the chat plan `p_place ? 'mapboxId'` refusal        → a retired id is accepted
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '43340000-0000-4000-8400-000000000001';
  v_brand uuid := '43340000-0000-4000-8400-000000000002';
  v_live uuid := '43340000-0000-4000-8400-000000000003';
  v_past uuid := '43340000-0000-4000-8400-000000000004';
  v_draft uuid := '43340000-0000-4000-8400-000000000005';
  v_trip uuid := '43340000-0000-4000-8400-000000000006';
  v_stop uuid := '43340000-0000-4000-8400-000000000007';
  v_centroid uuid := '43340000-0000-4000-8400-000000000008';
  v_id text := 'ChIJ0Wq9hS_1OxARsFOw5qkW6Y0';
  v_text_before text;
  v_n integer;
  v_ok boolean;
  v_row record;
  v_json jsonb;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'places-4334@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'places-4334@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Places 4334', 'places-4334', 'NGN', 'paystack', 'NG', 'NG', 'NGN');

  -- live (upcoming date), past (ended 40 days ago), draft
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, location_text, location_geo)
  VALUES
    (v_live, v_brand, v_owner, 'Live', 'live-4334', 'event', 'scheduled', 'public', 'Africa/Lagos', 'NGN', 'Didi Museum · 175 Akin Adesola St', point(3.4236, 6.4325)),
    (v_past, v_brand, v_owner, 'Past', 'past-4334', 'event', 'scheduled', 'public', 'Africa/Lagos', 'NGN', 'Quays · 3 Tokunbo Omisore St', point(3.4569, 6.4482)),
    (v_draft, v_brand, v_owner, 'Draft', 'draft-4334', 'event', 'draft', 'public', 'Africa/Lagos', 'NGN', 'Draft place', point(3.40, 6.45)),
    (v_centroid, v_brand, v_owner, 'Centroid', 'centroid-4334', 'event', 'cancelled', 'public', 'Africa/Lagos', 'NGN', 'Kyma Beach · Elegushi Beach', point(3.38975, 6.453928));
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master, occurrence_key) VALUES
    (v_live, now() + interval '5 days', now() + interval '5 days 3 hours', 'Africa/Lagos', true, 'a'),
    (v_past, now() - interval '41 days', now() - interval '40 days', 'Africa/Lagos', true, 'a'),
    (v_centroid, now() - interval '41 days', now() - interval '40 days', 'Africa/Lagos', true, 'a');

  -- ── T-16 schema: CHECKs and partial indexes ────────────────────────────
  BEGIN
    UPDATE public.events SET location_geo_refresh_state = 'nope' WHERE id = v_live;
    RAISE EXCEPTION 'T-16: refresh_state CHECK missing';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.preferences SET custom_location_geo_refresh_state = 'expired' WHERE profile_id = v_owner;
    -- (a no-op when the user has no preferences row; the CHECK itself is asserted below)
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'preferences_custom_location_geo_refresh_state_check'
                 AND pg_get_constraintdef(oid) NOT LIKE '%expired%') THEN
    RAISE EXCEPTION 'T-16: preference anchors must not allow expired (A2)';
  END IF;
  FOR v_row IN SELECT unnest(ARRAY['events_location_geo_refreshed_at_idx','experience_stops_geo_refreshed_at_idx',
      'venue_listings_location_geo_refreshed_at_idx','brands_location_geo_refreshed_at_idx',
      'preferences_custom_location_geo_refreshed_at_idx','preferences_discover_city_geo_refreshed_at_idx',
      'chat_plans_place_geo_refreshed_at_idx']) AS name LOOP
    IF to_regclass('public.' || v_row.name) IS NULL THEN
      RAISE EXCEPTION 'T-16: index % missing', v_row.name;
    END IF;
  END LOOP;

  -- ── stamp trigger: a new Google id stamps; coords without a new id drop it ─
  UPDATE public.events SET location_provider_place_id = v_id WHERE id IN (v_live, v_past, v_draft);
  SELECT * INTO v_row FROM public.events WHERE id = v_live;
  IF v_row.location_geo_refreshed_at IS NULL OR v_row.location_geo_refresh_state <> 'ok' THEN
    RAISE EXCEPTION 'T-4a: a new place id did not stamp the refresh (%/%)', v_row.location_geo_refreshed_at, v_row.location_geo_refresh_state;
  END IF;
  UPDATE public.events SET location_geo = point(3.50, 6.50) WHERE id = v_draft;
  SELECT * INTO v_row FROM public.events WHERE id = v_draft;
  IF v_row.location_provider_place_id IS NOT NULL OR v_row.location_geo_refreshed_at IS NOT NULL THEN
    RAISE EXCEPTION 'T-4b: new coordinates kept a stale place id';
  END IF;
  UPDATE public.events SET location_provider_place_id = v_id WHERE id = v_draft;

  -- a retired id is never stamped
  UPDATE public.events SET location_provider_place_id = 'dXJuOm1ieHBvaTpkaWRp' WHERE id = v_centroid;
  IF (SELECT location_geo_refreshed_at FROM public.events WHERE id = v_centroid) IS NOT NULL THEN
    RAISE EXCEPTION 'T-4c: a retired id was stamped';
  END IF;
  UPDATE public.events SET location_provider_place_id = NULL WHERE id = v_centroid;

  -- ── T-1 selection: in-scope only, older than 20 days, oldest first ─────
  UPDATE public.events SET location_geo_refreshed_at = now() - interval '25 days', location_geo_refresh_state = 'ok' WHERE id = v_live;
  UPDATE public.events SET location_geo_refreshed_at = now() - interval '35 days', location_geo_refresh_state = 'ok' WHERE id = v_past;
  UPDATE public.events SET location_geo_refreshed_at = now() - interval '22 days', location_geo_refresh_state = 'ok' WHERE id = v_draft;
  SELECT count(*) INTO v_n FROM public.places_refresh_due_pins(500) WHERE row_id = v_past;
  IF v_n <> 0 THEN RAISE EXCEPTION 'T-1: a past offering was selected for refresh'; END IF;
  SELECT array_agg(row_id ORDER BY ord)::text INTO v_text_before
    FROM (SELECT row_id, row_number() OVER () AS ord FROM public.places_refresh_due_pins(500)
           WHERE row_id IN (v_live, v_draft)) s;
  IF v_text_before <> ARRAY[v_live, v_draft]::text THEN
    RAISE EXCEPTION 'T-1: not oldest first: %', v_text_before;
  END IF;
  IF (SELECT count(*) FROM public.places_refresh_due_pins(1)) > 1 THEN RAISE EXCEPTION 'T-1: limit ignored'; END IF;

  -- ── T-3/T-4 outcomes: text columns never move ─────────────────────────
  v_text_before := (SELECT location_text FROM public.events WHERE id = v_live);
  v_ok := public.places_refresh_record('event_location', v_live, v_id, 'ok', NULL, 6.4400, 3.4300);
  SELECT * INTO v_row FROM public.events WHERE id = v_live;
  IF NOT v_ok OR v_row.location_geo[1] <> 6.44 OR v_row.location_geo[0] <> 3.43
     OR v_row.location_geo_refreshed_at < now() - interval '1 minute' OR v_row.location_text <> v_text_before
     OR v_row.location_provider_place_id <> v_id THEN
    RAISE EXCEPTION 'T-4: moved pin not written correctly (%)', v_row;
  END IF;

  -- ── T-15 idempotent: a second pass selects nothing for that pin ───────
  IF EXISTS (SELECT 1 FROM public.places_refresh_due_pins(500) WHERE row_id = v_live) THEN
    RAISE EXCEPTION 'T-15: a refreshed pin was selected again';
  END IF;

  -- ── T-5 re-id, T-6 place_gone, T-9 failing ────────────────────────────
  PERFORM public.places_refresh_record('event_location', v_draft, v_id, 'ok', 'ChIJnewIdAfterMerge01', NULL, NULL);
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_draft) <> 'ChIJnewIdAfterMerge01' THEN
    RAISE EXCEPTION 'T-5: new id not stored';
  END IF;
  PERFORM public.places_refresh_record('event_location', v_draft, 'ChIJnewIdAfterMerge01', 'place_gone');
  SELECT * INTO v_row FROM public.events WHERE id = v_draft;
  IF v_row.location_geo_refresh_state <> 'place_gone' OR v_row.location_geo IS NULL OR v_row.location_geo_refresh_failures <> 1 THEN
    RAISE EXCEPTION 'T-6: place_gone must keep coordinates and count a failure';
  END IF;
  PERFORM public.places_refresh_record('event_location', v_draft, 'ChIJnewIdAfterMerge01', 'failing');
  IF (SELECT location_geo_refresh_failures FROM public.events WHERE id = v_draft) <> 2 THEN
    RAISE EXCEPTION 'T-9: failures not counted';
  END IF;

  -- ── T-10 a host re-pick between read and write wins ───────────────────
  v_ok := public.places_refresh_record('event_location', v_live, 'ChIJsomethingElse0001', 'ok', NULL, 1.0, 1.0);
  IF v_ok OR (SELECT location_geo[1] FROM public.events WHERE id = v_live) = 1.0 THEN
    RAISE EXCEPTION 'T-10: a stale refresh overwrote the host''s pick';
  END IF;

  -- ── T-11/T-12 + A1: past expires at day 29; live never does ──────────
  UPDATE public.events SET location_geo_refreshed_at = now() - interval '35 days', location_geo_refresh_state = 'failing' WHERE id = v_live;
  v_text_before := (SELECT location_text FROM public.events WHERE id = v_past);
  PERFORM public.places_refresh_expire_past();
  SELECT * INTO v_row FROM public.events WHERE id = v_past;
  IF v_row.location_geo IS NOT NULL OR v_row.location_geo_refresh_state <> 'expired'
     OR v_row.location_provider_place_id <> v_id OR v_row.location_text <> v_text_before THEN
    RAISE EXCEPTION 'T-11: past expiry must clear coordinates and keep the id and text (%)', v_row;
  END IF;
  SELECT * INTO v_row FROM public.events WHERE id = v_live;
  IF v_row.location_geo IS NULL THEN
    RAISE EXCEPTION 'T-12 / A1: a live event at day 35 lost its pin';
  END IF;
  v_json := public.places_refresh_alert_summary();
  IF (v_json ->> 'stale_in_scope')::int < 1 OR NOT (v_json -> 'stale_ids') ? ('event_location:' || v_live) THEN
    RAISE EXCEPTION 'A1: the stale live pin is not in the alert (%)', v_json;
  END IF;

  -- ── T-14 trip JSON pins ───────────────────────────────────────────────
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, theme)
  VALUES (v_trip, v_brand, v_owner, 'Trip', 'trip-4334', 'trip', 'draft', 'public', 'Africa/Lagos', 'NGN',
    jsonb_build_object('business_trip', jsonb_build_object(
      'departureLocationText', 'Lekki Phase 1', 'departureLat', 6.44, 'departureLng', 3.47,
      'departurePlaceId', v_id, 'departureCountryCode', 'NG')));
  SELECT theme -> 'business_trip' INTO v_json FROM public.events WHERE id = v_trip;
  IF v_json ->> 'departureGeoRefreshState' <> 'ok' OR v_json -> 'departureGeoRefreshedAt' IS NULL THEN
    RAISE EXCEPTION 'T-14a: trip pin not stamped on insert (%)', v_json;
  END IF;
  PERFORM public.places_refresh_record('trip_departure', v_trip, v_id, 'ok', NULL, 6.45, 3.48);
  SELECT theme -> 'business_trip' INTO v_json FROM public.events WHERE id = v_trip;
  IF (v_json ->> 'departureLat')::float <> 6.45 OR v_json ->> 'departureLocationText' <> 'Lekki Phase 1' THEN
    RAISE EXCEPTION 'T-14b: trip refresh wrong (%)', v_json;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.places_refresh_pins() WHERE pin_kind = 'trip_departure' AND row_id = v_trip) THEN
    RAISE EXCEPTION 'T-14c: trip pin not listed';
  END IF;

  -- ── re-pin (§7): audit once, text untouched, idempotent, restorable ─
  INSERT INTO public.experience_stops(id, event_id, stop_order, place_name, address, lat, lng, place_id, country_code)
    VALUES (v_stop, v_draft, 0, 'Didi', '175 Akin Adesola St', 6.4325, 3.4236, 'dXJuOm1ieHBvaTpkaWRp', 'NG');
  IF NOT EXISTS (SELECT 1 FROM public.places_repin_candidates() WHERE row_id = v_centroid) THEN
    RAISE EXCEPTION 'R-1: the centroid row is not a re-pin candidate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.places_repin_candidates() WHERE row_id = v_stop AND label = '175 Akin Adesola St') THEN
    RAISE EXCEPTION 'R-1: the retired-id stop is not a re-pin candidate';
  END IF;
  v_text_before := (SELECT location_text FROM public.events WHERE id = v_centroid);
  v_ok := public.places_repin_apply('event_location', v_centroid, 'ChIJkymaBeach000001', 6.4227, 3.4843, 'exact');
  SELECT * INTO v_row FROM public.events WHERE id = v_centroid;
  IF NOT v_ok OR v_row.location_mapbox_lat <> 6.453928 OR v_row.location_mapbox_lng <> 3.38975
     OR v_row.location_geo[1] <> 6.4227 OR v_row.location_text <> v_text_before
     OR v_row.coordinate_precision <> 'exact' OR v_row.location_geo_refresh_state <> 'ok' THEN
    RAISE EXCEPTION 'R-2: re-pin wrong (%)', v_row;
  END IF;
  IF public.places_repin_apply('event_location', v_centroid, 'ChIJother0000000001', 1, 1, 'approximate') THEN
    RAISE EXCEPTION 'R-3: re-pin is not idempotent';
  END IF;
  PERFORM public.places_repin_apply('experience_stop', v_stop, 'ChIJdidiMuseum00001', 6.43254, 3.42369, 'approximate');
  SELECT * INTO v_row FROM public.experience_stops WHERE id = v_stop;
  IF v_row.place_id <> 'ChIJdidiMuseum00001' OR v_row.mapbox_lat <> 6.4325 OR v_row.address <> '175 Akin Adesola St' THEN
    RAISE EXCEPTION 'R-4: stop re-pin wrong (%)', v_row;
  END IF;
  PERFORM public.places_repin_restore('event_location', v_centroid);
  SELECT * INTO v_row FROM public.events WHERE id = v_centroid;
  IF v_row.location_geo[1] <> 6.453928 OR v_row.location_provider_place_id IS NOT NULL THEN
    RAISE EXCEPTION 'R-5: restore did not bring the audited pin back';
  END IF;

  -- ── A2 / R-DECK-7: a preference anchor at day 60, refresh failing, is kept
  INSERT INTO public.profiles(id, display_name, username) VALUES (v_owner, 'Places 4334', 'places_4334')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.preferences(profile_id, custom_location, custom_lat, custom_lng, use_gps_location)
    VALUES (v_owner, 'Lekki, Lagos', 6.4698, 3.5852, false)
    ON CONFLICT (profile_id) DO UPDATE SET custom_location = EXCLUDED.custom_location,
      custom_lat = EXCLUDED.custom_lat, custom_lng = EXCLUDED.custom_lng, use_gps_location = false;
  UPDATE public.preferences SET custom_location_place_id = 'ChIJlekkiAnchor00001' WHERE profile_id = v_owner;
  IF (SELECT custom_location_geo_refresh_state FROM public.preferences WHERE profile_id = v_owner) <> 'ok' THEN
    RAISE EXCEPTION 'T-17a: anchor place id not stamped';
  END IF;
  UPDATE public.preferences SET custom_location_geo_refreshed_at = now() - interval '60 days',
    custom_location_geo_refresh_state = 'failing' WHERE profile_id = v_owner;
  PERFORM public.places_refresh_record('pref_custom', v_owner, 'ChIJlekkiAnchor00001', 'failing');
  PERFORM public.places_refresh_expire_past();
  SELECT * INTO v_row FROM public.preferences WHERE profile_id = v_owner;
  IF v_row.custom_lat IS DISTINCT FROM 6.4698 OR v_row.custom_lng IS DISTINCT FROM 3.5852 THEN
    RAISE EXCEPTION 'T-17 / A2: a preference anchor was cleared';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.places_refresh_due_pins(500) WHERE pin_kind = 'pref_custom' AND row_id = v_owner) THEN
    RAISE EXCEPTION 'T-17b: the stale anchor is not selected for refresh';
  END IF;

  -- ── T-18 chat plans: providerPlaceId accepted, retired mapboxId refused ─
  v_json := public.chat_plan_parse_where('place',
    jsonb_build_object('providerPlaceId', 'ChIJdidiMuseum00001', 'name', 'Didi Museum', 'lat', 6.43, 'lng', 3.42), NULL);
  IF v_json ->> 'providerPlaceId' <> 'ChIJdidiMuseum00001' OR v_json ->> 'identityKey' <> 'google:ChIJdidiMuseum00001' THEN
    RAISE EXCEPTION 'T-18a: parse wrong (%)', v_json;
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.chat_plan_parse_where('place',
      jsonb_build_object('mapboxId', 'dXJuOm1ieHBvaTpkaWRp', 'name', 'Didi', 'lat', 6.43, 'lng', 3.42), NULL);
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS v_text_before = PG_EXCEPTION_DETAIL;
    v_failed := v_text_before = 'p_place.mapboxId_retired';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'T-18b: a retired mapboxId was not refused loudly'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
             AND table_name IN ('chat_plans', 'chat_plan_place_options') AND column_name = 'mapbox_id') THEN
    RAISE EXCEPTION 'T-18c: mapbox_id column still present';
  END IF;

  -- ── T-19 the post-save attach RPC is gone (A-2: the id rides the save) ─
  IF to_regprocedure('public.biz_set_location_place_id(text,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'T-19: the separate attach RPC still exists';
  END IF;

  -- ── §8 api-health tiles ─────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM public.api_health_services WHERE service_key = 'mapbox') THEN
    RAISE EXCEPTION 'H-1: the retired map tile is still registered';
  END IF;
  SELECT count(*) INTO v_n FROM public.api_health_services
   WHERE service_key IN ('google_places', 'google_place_details', 'google_geocoding', 'google_static_maps', 'google_place_refresh');
  IF v_n <> 5 THEN RAISE EXCEPTION 'H-2: Google tiles missing (%)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.api_health_alert_state
   WHERE service_key IN ('google_place_details', 'google_geocoding', 'google_static_maps', 'google_place_refresh');
  IF v_n <> 4 THEN RAISE EXCEPTION 'H-3: alert state rows missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'places-coordinate-refresh-daily' AND schedule = '20 3 * * *') THEN
    RAISE EXCEPTION 'H-4: the refresh cron is not scheduled';
  END IF;

  -- ── grants: service-role only ─────────────────────────────────────────
  IF has_function_privilege('authenticated', 'public.places_refresh_record(text,uuid,text,text,text,double precision,double precision)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.places_repin_apply(text,uuid,text,double precision,double precision,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G-1: refresh/re-pin functions are callable by clients';
  END IF;

  RAISE NOTICE 'issue_4334_google_places: all checks passed';
END
$test$;

ROLLBACK;
