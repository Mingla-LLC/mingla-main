-- #4334 rework (orchestrator A-2 / A-1): every Host save path that writes Google
-- coordinates carries the picked Google place id IN THE SAME WRITE, and the public
-- event read returns it (withheld with the street).
--
-- MINGLA-INVARIANT: I-4334-PLACE-ID-WITH-COORDINATES | issue #4334 | A Google-sourced pin written through a Host save path carries its Google place id in the same statement; a coordinate without an id cannot be refreshed and would break the 30-day rule.
--
-- Fails-on-revert (line deleted → red):
--   W-1  business_create_event_draft  location_provider_place_id insert
--   W-3  business_update_event_draft  location_provider_place_id SET
--   W-5  business_update_rsvp_graph   (both branches; catalog check)
--   W-6  business_update_live_event_atomic → _with_place + locationProviderPlaceId
--   W-7  biz_create_venue_listing      p_location_place_id insert
--   W-8  biz_update_venue_identity_in_review
--   W-9  submit change request → admin approve
--   W-12 the write-path registry below (a path that stops writing the id),
--        including both publish owners (draft → live promotes pin + id)
--   W-13 pg_public_event_by_slug googlePlaceId
--   W-14 pg_direct_event_checkout_bundle googlePlaceId (the buyer page's REAL read)
--   W-15 pg_public_rsvp_by_slug googlePlaceId (the RSVP page's read)
--   W-16 business_public_events_view.location_provider_place_id (public RSVP pages),
--        appended last, withheld with the street, mirrored in publicEventRow
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '43341000-0000-4000-8400-000000000001';
  v_admin uuid := '43341000-0000-4000-8400-000000000002';
  v_brand uuid := '43341000-0000-4000-8400-000000000011';
  v_id1 text := 'ChIJ0Wq9hS_1OxARsFOw5qkW6Y0';
  v_id2 text := 'ChIJ8bF1g3T1OxAR5Yx0Qn5pLk8';
  v_hours jsonb := '[
    {"weekday":0,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":1,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":2,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":3,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":4,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":5,"open_time":"10:00","close_time":"16:00","is_closed":false},
    {"weekday":6,"open_time":null,"close_time":null,"is_closed":true}]'::jsonb;
  v_theme jsonb := '{"business_draft":{"requestedVisibility":"public"}}'::jsonb;
  v_result jsonb;
  v_event uuid;
  v_venue uuid;
  v_request uuid;
  v_row record;
  v_failed boolean;
  v_fn text;
  v_src text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'place-ids-4334@example.test'),
    (v_admin, 'admin-place-ids-4334@example.test');
  INSERT INTO public.admin_users(email, role, status) VALUES ('admin-place-ids-4334@example.test', 'admin', 'active')
    ON CONFLICT (email) DO UPDATE SET role = excluded.role, status = excluded.status;
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'place-ids-4334@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Place ids 4334', 'place-ids-4334', 'NGN', 'paystack', 'NG', 'NG', 'NGN');

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- ── W-1 event draft create: the id rides the insert and is stamped ────────
  v_result := public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Place id draft', 'location_text', 'Didi Museum', 'location_geo', '(3.4236,6.4325)',
    'location_provider_place_id', v_id1, 'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme));
  v_event := (v_result #>> '{event,id}')::uuid;
  SELECT location_provider_place_id, location_geo_refreshed_at, location_geo_refresh_state INTO v_row
    FROM public.events WHERE id = v_event;
  IF v_row.location_provider_place_id IS DISTINCT FROM v_id1 OR v_row.location_geo_refreshed_at IS NULL
     OR v_row.location_geo_refresh_state <> 'ok' THEN
    RAISE EXCEPTION 'W-1: create draft did not store and stamp the place id (%)', row_to_json(v_row);
  END IF;

  -- ── W-2 a retired Mapbox id is refused loudly, not stored ────────────────
  v_failed := false;
  BEGIN
    PERFORM public.business_create_event_draft(v_brand, jsonb_build_object(
      'title', 'Retired', 'location_geo', '(3.4,6.4)', 'location_provider_place_id', 'dXJuOm1ieHBvaTpkaWRp', 'theme', v_theme));
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := SQLERRM = 'location_place_id_invalid';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'W-2: a retired id was not refused'; END IF;

  -- ── W-3 draft update re-pick: new id + new pin in one write ───────────────
  PERFORM public.business_update_event_draft(v_event, jsonb_build_object(
    'title', 'Place id draft', 'location_text', 'Quays', 'location_geo', '(3.4569,6.4482)',
    'location_provider_place_id', v_id2, 'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme), 1);
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_id2 THEN
    RAISE EXCEPTION 'W-3: draft update did not write the new place id';
  END IF;

  -- ── W-4 an installed app's save (no key) that moves the pin drops the id ──
  PERFORM public.business_update_event_draft(v_event, jsonb_build_object(
    'title', 'Place id draft', 'location_geo', '(3.40,6.40)', 'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme), 2);
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'W-4: a moved pin without an id kept a stale id';
  END IF;

  -- ── W-6 live edit: the atomic owner hands the id to _with_place ──────────
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.business_update_live_event_atomic(uuid,jsonb,text,integer)'::regprocedure;
  IF v_src NOT LIKE '%business_patch_event_taxonomy_with_place(%' OR v_src NOT LIKE '%locationProviderPlaceId%' THEN
    RAISE EXCEPTION 'W-6: the live-edit owner does not pass the place id';
  END IF;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master, occurrence_key)
    VALUES (v_event, now() + interval '5 days', now() + interval '5 days 3 hours', 'Africa/Lagos', true, 'a');
  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now(), slug = 'place-ids-event',
    theme = jsonb_build_object('business_event', jsonb_build_object('requestedVisibility', 'public', 'hideAddressUntilTicket', false)),
    city = 'Lagos', location_geo = point(3.40, 6.40),
    location_provider_place_id = NULL WHERE id = v_event;
  PERFORM public.business_patch_event_taxonomy_with_place(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4325, 3.4236, 'Didi Museum', 'exact', v_id1);
  SELECT location_provider_place_id, location_geo INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.location_provider_place_id IS DISTINCT FROM v_id1 OR NOT (v_row.location_geo ~= point(3.4236, 6.4325)) THEN
    RAISE EXCEPTION 'W-6: live edit re-pick did not write pin + id together (%)', row_to_json(v_row);
  END IF;
  -- an unrelated taxonomy save (same pin, no id) keeps the id
  PERFORM public.business_patch_event_taxonomy_with_place(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4325, 3.4236, NULL, '', NULL);
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'W-6b: an unrelated live save lost the id';
  END IF;

  -- ── W-13 the public read returns the id only when the street is public ───
  UPDATE public.events SET visibility = 'public', published_at = now(),
    theme = jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', false))
   WHERE id = v_event;
  v_result := public.pg_public_event_by_slug('place-ids-4334', 'place-ids-event')::jsonb;
  IF v_result IS NULL OR v_result ->> 'googlePlaceId' IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'W-13: public read did not return googlePlaceId (%)', left(v_result::text, 300);
  END IF;
  UPDATE public.events SET theme = jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', true))
   WHERE id = v_event;
  v_result := public.pg_public_event_by_slug('place-ids-4334', 'place-ids-event')::jsonb;
  IF NOT (v_result ? 'googlePlaceId') OR v_result -> 'googlePlaceId' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'W-13b: a hidden street leaked its place id (%)', v_result -> 'googlePlaceId';
  END IF;

  -- ── W-14 the buyer page's direct bundle carries the id, withheld with the street
  UPDATE public.events SET theme = jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', false))
   WHERE id = v_event;
  v_result := public.pg_direct_event_checkout_bundle(NULL, 'place-ids-4334', 'place-ids-event')::jsonb;
  IF v_result IS NULL OR v_result ->> 'googlePlaceId' IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'W-14: the checkout bundle did not return googlePlaceId (%)', left(v_result::text, 300);
  END IF;
  IF (public.pg_direct_event_checkout_bundle(v_event, NULL, NULL)::jsonb) ->> 'googlePlaceId' IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'W-14: the checkout bundle by event id did not return googlePlaceId';
  END IF;
  UPDATE public.events SET theme = jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', true))
   WHERE id = v_event;
  v_result := public.pg_direct_event_checkout_bundle(NULL, 'place-ids-4334', 'place-ids-event')::jsonb;
  IF NOT (v_result ? 'googlePlaceId') OR v_result -> 'googlePlaceId' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'W-14b: the checkout bundle leaked a hidden street''s place id (%)', v_result -> 'googlePlaceId';
  END IF;

  -- ── W-15 the RSVP page's read carries the id, withheld with the street ───
  UPDATE public.events SET event_type = 'rsvp',
    theme = jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', false))
   WHERE id = v_event;
  v_result := public.pg_public_rsvp_by_slug('place-ids-4334', 'place-ids-event')::jsonb;
  IF v_result IS NULL OR v_result ->> 'googlePlaceId' IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'W-15: the RSVP read did not return googlePlaceId (%)', left(v_result::text, 300);
  END IF;
  UPDATE public.events SET theme = jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', true))
   WHERE id = v_event;
  v_result := public.pg_public_rsvp_by_slug('place-ids-4334', 'place-ids-event')::jsonb;
  IF NOT (v_result ? 'googlePlaceId') OR v_result -> 'googlePlaceId' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'W-15b: the RSVP read leaked a hidden street''s place id (%)', v_result -> 'googlePlaceId';
  END IF;

  -- ── W-16 the public view (public RSVP pages) carries it, last, withheld ──
  UPDATE public.events SET theme = jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', false))
   WHERE id = v_event;
  IF (SELECT location_provider_place_id FROM public.business_public_events_view WHERE id = v_event) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'W-16: the public view did not return the place id';
  END IF;
  IF (SELECT attname FROM pg_attribute WHERE attrelid = 'public.business_public_events_view'::regclass
       AND attnum > 0 AND NOT attisdropped ORDER BY attnum DESC LIMIT 1) <> 'location_provider_place_id' THEN
    RAISE EXCEPTION 'W-16: the place id is not the view''s last column';
  END IF;
  v_result := public.pg_public_rsvp_by_slug('place-ids-4334', 'place-ids-event')::jsonb;
  IF v_result #>> '{publicEventRow,location_provider_place_id}' IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'W-16: publicEventRow does not mirror the view column';
  END IF;
  UPDATE public.events SET theme = jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', true))
   WHERE id = v_event;
  IF (SELECT location_provider_place_id FROM public.business_public_events_view WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'W-16b: the public view leaked a hidden street''s place id';
  END IF;
  v_result := public.pg_public_rsvp_by_slug('place-ids-4334', 'place-ids-event')::jsonb;
  IF NOT ((v_result -> 'publicEventRow') ? 'location_provider_place_id')
     OR v_result #> '{publicEventRow,location_provider_place_id}' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'W-16b: publicEventRow leaked a hidden street''s place id';
  END IF;

  -- ── W-7 venue create: id in the insert, stamped ──────────────────────────
  v_venue := public.biz_create_venue_listing(
    v_brand, 'Place id venue', 'placeidvenue4334', 'A venue.', '', 6.4325, 3.4236, 'Lagos', 'NG',
    '175 Akin Adesola St', 'restaurant', 'venue-4334@example.test', '+2348031234567', '', '', v_hours,
    NULL, 'exact', p_location_place_id => v_id1);
  SELECT location_provider_place_id, location_geo_refreshed_at INTO v_row FROM public.venue_listings WHERE id = v_venue;
  IF v_row.location_provider_place_id IS DISTINCT FROM v_id1 OR v_row.location_geo_refreshed_at IS NULL THEN
    RAISE EXCEPTION 'W-7: venue create did not store and stamp the id (%)', row_to_json(v_row);
  END IF;

  -- ── W-8 in-review address change carries the new id ──────────────────────
  PERFORM public.biz_update_venue_identity_in_review(v_venue, p_address => '3 Tokunbo Omisore St',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4482, p_lng => 3.4569,
    p_coordinate_precision => 'exact', p_location_place_id => v_id2);
  IF (SELECT location_provider_place_id FROM public.venue_listings WHERE id = v_venue) IS DISTINCT FROM v_id2 THEN
    RAISE EXCEPTION 'W-8: in-review address change did not write the id';
  END IF;

  -- ── W-9 live venue: the request carries the id to the admin approval ─────
  UPDATE public.venue_listings SET claim_status = 'verified' WHERE id = v_venue;
  v_result := public.biz_submit_venue_details_change_request(v_venue, p_address => '175 Akin Adesola St',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
    p_coordinate_precision => 'exact', p_location_place_id => v_id1);
  v_request := (v_result ->> 'request_id')::uuid;
  IF (SELECT details_change_place_id FROM public.venue_listings WHERE id = v_venue) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'W-9a: the change request did not keep the id';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated',
    'email', 'admin-place-ids-4334@example.test')::text, true);
  PERFORM public.admin_review_venue_details_change(v_venue, v_request, 'approve', NULL);
  SELECT location_provider_place_id, lat, details_change_place_id INTO v_row FROM public.venue_listings WHERE id = v_venue;
  IF v_row.location_provider_place_id IS DISTINCT FROM v_id1 OR v_row.lat <> 6.4325 OR v_row.details_change_place_id IS NOT NULL THEN
    RAISE EXCEPTION 'W-9b: approval did not apply pin + id together (%)', row_to_json(v_row);
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- ── W-10 brand location (direct table write) and W-11 experience stops ───
  UPDATE public.brands SET lat = 6.4325, lng = 3.4236, location_provider_place_id = v_id1 WHERE id = v_brand;
  IF (SELECT location_geo_refreshed_at FROM public.brands WHERE id = v_brand) IS NULL THEN
    RAISE EXCEPTION 'W-10: a brand pin written with its id was not stamped';
  END IF;

  -- ── W-12 write-path registry: every Host write path names the id ─────────
  FOREACH v_fn IN ARRAY ARRAY[
    'public.business_create_event_draft(uuid,jsonb)',
    'public.business_update_event_draft(uuid,jsonb,integer)',
    'public.business_patch_event_taxonomy_with_place(uuid,text,text[],text[],text[],numeric,numeric,text,text,text)',
    'public.biz_create_venue_listing(uuid,text,text,text,text,double precision,double precision,text,text,text,text,text,text,text,text,jsonb,uuid,text,text,text,text,text,text)',
    'public.biz_update_venue_identity_in_review(uuid,text,text,text,text,text,double precision,double precision,text,text)',
    'public.biz_submit_venue_details_change_request(uuid,text,text,text,text,text,double precision,double precision,text,text)',
    'public.admin_review_venue_details_change(uuid,uuid,text,text)',
    'public.business_publish_event_draft(uuid,jsonb,integer)',
    'public.business_publish_rsvp_draft(uuid,jsonb,integer)'
  ] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn::regprocedure;
    IF v_src NOT LIKE '%location_provider_place_id%' AND v_src NOT LIKE '%details_change_place_id%' THEN
      RAISE EXCEPTION 'W-12: % writes coordinates without the place id', v_fn;
    END IF;
  END LOOP;
  -- W-5: both RSVP branches (draft and published) write the id beside the pin.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.business_update_rsvp_graph(uuid,jsonb,text,uuid)'::regprocedure;
  IF (length(v_src) - length(replace(v_src, 'location_provider_place_id=CASE', ''))) / length('location_provider_place_id=CASE') <> 2 THEN
    RAISE EXCEPTION 'W-5: business_update_rsvp_graph does not write the id in both branches';
  END IF;
  -- experience stops write place_id from the stop payload in both authoring RPCs.
  FOREACH v_fn IN ARRAY ARRAY['public.biz_create_experience(uuid,jsonb,boolean)', 'public.biz_update_live_experience(uuid,jsonb,text)'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn::regprocedure;
    IF v_src NOT LIKE '%v_s_place_id := NULLIF(v_stop->>''place_id'', '''')%' THEN
      RAISE EXCEPTION 'W-11: % no longer writes the stop place id', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'issue_4334_place_id_write_paths: all checks passed';
END;
$test$;

ROLLBACK;
