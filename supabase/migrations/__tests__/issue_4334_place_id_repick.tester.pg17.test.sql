-- #4334 (20280525004334) — tester adversarial: the place-id re-pick fix,
-- attacked from the sides the implementor's suite does not cover.
--
--   T-1 a malformed place id (spaces, punctuation) is refused (location_place_id_invalid) on both
--       venue RPCs and on the event taxonomy RPC, and writes nothing — even
--       when the address itself is unchanged (pre-fix the same-address call
--       returned "no change" without ever looking at the id).
--   T-2 a blank id never clears a stored venue id: '', '   ' and NULL with
--       the same address are no change (in review) / nothing_to_change
--       (live); a name-only change beside the same address keeps the id.
--   T-3 an id-only re-pick on a live venue REPLACES an already pending
--       request (replaced:true, new request id, the old request's name gone,
--       the new id carried) and leaves the live row untouched.
--   T-4 admin approval of that request writes details_change_place_id onto
--       the venue (pin unchanged, id now the new one) and clears the request.
--   T-5 callers are still refused: a signed-in stranger (forbidden) and the
--       anon role (no EXECUTE) on both venue RPCs; authenticated has no
--       EXECUTE on the event taxonomy RPC; a stranger through it is refused.
--   T-6 an unrelated event taxonomy save (no coordinates) keeps the id, with
--       the place-stamp trigger on and off.
--   T-7 a moved event pin carrying a NEW id stores the new id (triggers on),
--       and the same pin resent with a new id stores the new id.
--
-- Fails-on-revert: run against 20280521004334's definitions of the three RPCs
-- (this migration's functions restored) → T-1 (venue), T-3 and T-4 red.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '43342600-0000-4000-8400-000000000001';
  v_stranger uuid := '43342600-0000-4000-8400-000000000002';
  v_admin uuid := '43342600-0000-4000-8400-000000000003';
  v_brand uuid := '43342600-0000-4000-8400-000000000011';
  v_id1 text := 'ChIJ0Wq9hS_1OxARsFOw5qkW6Y0';
  v_id2 text := 'ChIJ8bF1g3T1OxAR5Yx0Qn5pLk8';
  v_id3 text := 'ChIJ2zQx7Wn1OxARk1Hc9Vb3Tq4';
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
  v_first_request uuid;
  v_venue uuid;
  v_event uuid;
  v_row record;
  v_code text;
  v_blank text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'repick-tester-4334@example.test'),
    (v_stranger, 'repick-stranger-4334@example.test'),
    (v_admin, 'repick-admin-4334@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'repick-tester-4334@example.test'),
    (v_stranger, 'repick-stranger-4334@example.test');
  SET LOCAL session_replication_role = replica;   -- admin team guard is out of scope here
  INSERT INTO public.admin_users(email, role, status) VALUES ('repick-admin-4334@example.test', 'admin', 'active');
  SET LOCAL session_replication_role = origin;
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Repick tester 4334', 'repick-tester-4334', 'NGN', 'paystack', 'NG', 'NG', 'NGN');
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  v_venue := public.biz_create_venue_listing(
    v_brand, 'Repick tester venue', 'repicktester4334', 'A venue.', '', 6.4325, 3.4236, 'Lagos', 'NG',
    '175 Akin Adesola St', 'restaurant', 'repick-tester-4334@example.test', '+2348031234567', '', '', v_hours,
    NULL, 'exact', p_location_place_id => v_id1);

  -- ── T-1 garbage id refused, nothing written (in review) ──────────────────
  v_code := NULL;
  BEGIN
    PERFORM public.biz_update_venue_identity_in_review(v_venue, p_address => '175 Akin Adesola St',
      p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
      p_coordinate_precision => 'exact', p_location_place_id => 'not a google place id');
  EXCEPTION WHEN invalid_parameter_value THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'location_place_id_invalid'
     OR (SELECT location_provider_place_id FROM public.venue_listings WHERE id = v_venue) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'T-1a: a garbage id on an unchanged address was not refused (code %)', v_code;
  END IF;

  -- ── T-2 a blank id never clears the stored id (in review) ────────────────
  FOREACH v_blank IN ARRAY ARRAY['', '   ', NULL] LOOP
    v_result := public.biz_update_venue_identity_in_review(v_venue, p_address => '175 Akin Adesola St',
      p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
      p_coordinate_precision => 'exact', p_location_place_id => v_blank);
    IF (v_result ->> 'changed')::boolean IS NOT FALSE
       OR (SELECT location_provider_place_id FROM public.venue_listings WHERE id = v_venue) IS DISTINCT FROM v_id1 THEN
      RAISE EXCEPTION 'T-2a: blank id [%] changed the venue (%)', v_blank, v_result;
    END IF;
  END LOOP;
  v_result := public.biz_update_venue_identity_in_review(v_venue, p_name => 'Repick tester venue two',
    p_address => '175 Akin Adesola St', p_city => 'Lagos', p_country_code => 'NG',
    p_lat => 6.4325, p_lng => 3.4236, p_coordinate_precision => 'exact', p_location_place_id => '');
  SELECT name, location_provider_place_id INTO v_row FROM public.venue_listings WHERE id = v_venue;
  IF v_row.name <> 'Repick tester venue two' OR v_row.location_provider_place_id IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'T-2b: a name change beside the same address lost the id (%)', row_to_json(v_row);
  END IF;

  -- ── live venue with a pending (name) request ─────────────────────────────
  UPDATE public.venue_listings SET claim_status = 'verified' WHERE id = v_venue;

  -- T-1 (live): garbage id refused
  v_code := NULL;
  BEGIN
    PERFORM public.biz_submit_venue_details_change_request(v_venue, p_address => '175 Akin Adesola St',
      p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
      p_coordinate_precision => 'exact', p_location_place_id => 'ChIJ has spaces');
  EXCEPTION WHEN invalid_parameter_value THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'location_place_id_invalid'
     OR (SELECT details_change_status FROM public.venue_listings WHERE id = v_venue) IS NOT NULL THEN
    RAISE EXCEPTION 'T-1b: a garbage id on a live venue was not refused (code %)', v_code;
  END IF;

  -- T-2 (live): blank ids are nothing_to_change
  FOREACH v_blank IN ARRAY ARRAY['', '   ', NULL] LOOP
    v_code := NULL;
    BEGIN
      PERFORM public.biz_submit_venue_details_change_request(v_venue, p_address => '175 Akin Adesola St',
        p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
        p_coordinate_precision => 'exact', p_location_place_id => v_blank);
    EXCEPTION WHEN invalid_parameter_value THEN v_code := SQLERRM;
    END;
    IF v_code IS DISTINCT FROM 'nothing_to_change' THEN
      RAISE EXCEPTION 'T-2c: blank id [%] on a live venue was not nothing_to_change (code %)', v_blank, v_code;
    END IF;
  END LOOP;

  v_result := public.biz_submit_venue_details_change_request(v_venue, p_name => 'Proposed new name');
  v_first_request := (v_result ->> 'request_id')::uuid;

  -- ── T-3 an id-only re-pick replaces the pending request ──────────────────
  v_result := public.biz_submit_venue_details_change_request(v_venue, p_address => '175 Akin Adesola St',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
    p_coordinate_precision => 'exact', p_location_place_id => v_id2);
  SELECT details_change_request_id, details_change_status, details_change_name, details_change_place_id,
         details_change_address, location_provider_place_id, name
    INTO v_row FROM public.venue_listings WHERE id = v_venue;
  IF (v_result ->> 'replaced')::boolean IS NOT TRUE
     OR v_row.details_change_request_id IS NOT DISTINCT FROM v_first_request
     OR v_row.details_change_request_id IS DISTINCT FROM (v_result ->> 'request_id')::uuid
     OR v_row.details_change_status IS DISTINCT FROM 'pending'
     OR v_row.details_change_name IS NOT NULL
     OR v_row.details_change_place_id IS DISTINCT FROM v_id2
     OR v_row.details_change_address IS DISTINCT FROM '175 Akin Adesola St'
     OR v_row.location_provider_place_id IS DISTINCT FROM v_id1
     OR v_row.name <> 'Repick tester venue two' THEN
    RAISE EXCEPTION 'T-3: the id-only re-pick did not replace the pending request (result %, row %)', v_result, row_to_json(v_row);
  END IF;

  -- ── T-5 strangers and anon are refused ──────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  v_code := NULL;
  BEGIN
    PERFORM public.biz_submit_venue_details_change_request(v_venue, p_address => '175 Akin Adesola St',
      p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
      p_coordinate_precision => 'exact', p_location_place_id => v_id3);
  EXCEPTION WHEN insufficient_privilege THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden'
     OR (SELECT details_change_place_id FROM public.venue_listings WHERE id = v_venue) IS DISTINCT FROM v_id2 THEN
    RAISE EXCEPTION 'T-5a: a stranger was not refused on the live request RPC (code %)', v_code;
  END IF;
  UPDATE public.venue_listings SET claim_status = 'pending_review' WHERE id = v_venue;
  v_code := NULL;
  BEGIN
    PERFORM public.biz_update_venue_identity_in_review(v_venue, p_address => '175 Akin Adesola St',
      p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
      p_coordinate_precision => 'exact', p_location_place_id => v_id3);
  EXCEPTION WHEN insufficient_privilege THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden'
     OR (SELECT location_provider_place_id FROM public.venue_listings WHERE id = v_venue) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'T-5b: a stranger was not refused on the in-review RPC (code %)', v_code;
  END IF;
  UPDATE public.venue_listings SET claim_status = 'verified' WHERE id = v_venue;
  IF has_function_privilege('anon',
       'public.biz_update_venue_identity_in_review(uuid, text, text, text, text, text, double precision, double precision, text, text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.biz_submit_venue_details_change_request(uuid, text, text, text, text, text, double precision, double precision, text, text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.business_patch_event_taxonomy_with_place(uuid, text, text[], text[], text[], numeric, numeric, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.business_patch_event_taxonomy_with_place(uuid, text, text[], text[], text[], numeric, numeric, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-5c: anon (or authenticated, on the taxonomy RPC) can execute a #4334 RPC';
  END IF;

  -- ── T-4 admin approval writes the requested id onto the venue ────────────
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_result := public.admin_review_venue_details_change(v_venue,
    (SELECT details_change_request_id FROM public.venue_listings WHERE id = v_venue), 'approve');
  SELECT location_provider_place_id, lat, lng, address, details_change_status, details_change_place_id
    INTO v_row FROM public.venue_listings WHERE id = v_venue;
  IF (v_result ->> 'ok')::boolean IS NOT TRUE
     OR v_row.location_provider_place_id IS DISTINCT FROM v_id2
     OR v_row.lat <> 6.4325 OR v_row.lng <> 3.4236 OR v_row.address <> '175 Akin Adesola St'
     OR v_row.details_change_status IS NOT NULL OR v_row.details_change_place_id IS NOT NULL THEN
    RAISE EXCEPTION 'T-4: approval did not apply the requested id (result %, row %)', v_result, row_to_json(v_row);
  END IF;

  -- ── events: a live event with a pin and a place id ───────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_result := public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Repick tester event', 'location_text', 'Didi Museum', 'location_geo', '(3.4236,6.4325)',
    'location_provider_place_id', v_id1, 'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme));
  v_event := (v_result #>> '{event,id}')::uuid;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master, occurrence_key)
    VALUES (v_event, now() + interval '5 days', now() + interval '5 days 3 hours', 'Africa/Lagos', true, 'a');
  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now(), slug = 'repick-tester-4334-event',
    theme = jsonb_build_object('business_event', jsonb_build_object('requestedVisibility', 'public', 'hideAddressUntilTicket', false)),
    city = 'Lagos', location_geo = point(3.4236, 6.4325), location_provider_place_id = v_id1
  WHERE id = v_event;

  -- T-1 (event): garbage id on the same pin refused, id kept
  v_code := NULL;
  BEGIN
    PERFORM public.business_patch_event_taxonomy_with_place(
      v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4325, 3.4236, NULL, 'exact', 'bad id; drop table');
  EXCEPTION WHEN invalid_parameter_value THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'location_place_id_invalid'
     OR (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'T-1c: a garbage event id was not refused (code %)', v_code;
  END IF;

  -- T-5 (event): a stranger through the RPC is refused
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  v_code := NULL;
  BEGIN
    PERFORM public.business_patch_event_taxonomy_with_place(
      v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4325, 3.4236, NULL, 'exact', v_id3);
  EXCEPTION WHEN raise_exception THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'insufficient_event_permission'
     OR (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'T-5d: a stranger was not refused on the taxonomy RPC (code %)', v_code;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- ── T-6 an unrelated taxonomy save (no coordinates) keeps the id ─────────
  PERFORM public.business_patch_event_taxonomy_with_place(
    v_event, 'Lagos', ARRAY['rooftop-party']::text[], ARRAY['chill']::text[], ARRAY[]::text[], NULL, NULL, NULL, '', NULL);
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'T-6a: an unrelated taxonomy save lost the id (triggers on)';
  END IF;
  SET LOCAL session_replication_role = replica;
  PERFORM public.business_patch_event_taxonomy_with_place(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], NULL, 6.0, NULL, '', '');
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'T-6b: a half pin (no lat) with a blank id lost the id (triggers off)';
  END IF;
  SET LOCAL session_replication_role = origin;

  -- ── T-7 a moved pin with a new id stores the new id; same pin + new id ───
  PERFORM public.business_patch_event_taxonomy_with_place(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4482, 3.4569, NULL, 'exact', v_id2);
  SELECT location_provider_place_id, location_geo, coordinate_precision INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.location_provider_place_id IS DISTINCT FROM v_id2 OR NOT (v_row.location_geo ~= point(3.4569, 6.4482))
     OR v_row.coordinate_precision IS DISTINCT FROM 'exact' THEN
    RAISE EXCEPTION 'T-7a: a moved pin with a new id did not store it (%)', row_to_json(v_row);
  END IF;
  PERFORM public.business_patch_event_taxonomy_with_place(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4482, 3.4569, NULL, 'exact', ' ' || v_id3 || ' ');
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_id3 THEN
    RAISE EXCEPTION 'T-7b: the same pin with a new (padded) id did not store the trimmed id';
  END IF;

  RAISE NOTICE 'issue_4334_place_id_repick tester: all checks passed';
END;
$test$;

ROLLBACK;
