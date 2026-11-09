-- #4334 (20280525004334) — a re-pick onto the same pin with a new Google place
-- id is saved, and a moved event pin never keeps the old place's id.
--
-- MINGLA-INVARIANT: I-4334-PLACE-ID-REPICK-COUNTS | issue #4334 | A venue address re-picked onto the same pin with a new, valid Google place id is a change (in review: written; live: a change request); a resent address with the same or no id changes nothing; an event pin that moved without an id stores NULL, never the previous place's id.
--
--   V-1 in review: same text/city/country/pin/precision + new id → changed:true, id written
--   V-2 in review: same everything + same id, or no id → changed:false, nothing written
--   V-3 live: same everything + new id → a change request carrying the id
--   V-4 live: same everything + same id, or no id → nothing_to_change
--   E-1 event: a moved pin with a blank id stores NULL (end to end, triggers on)
--   E-2 event: the RPC itself writes NULL for a moved pin with a blank id (triggers off)
--   E-3 event: the same pin resent with a blank id keeps the id (#3827, triggers off)
--   S-1 venue in review: the same id with refined coordinates keeps the id
--   S-2 live venue: a request with the same id and refined coordinates keeps it on approval
--   S-3 event taxonomy: the same id with refined coordinates keeps the id
--   S-4 published RSVP: the same id with refined coordinates keeps the id
--   S-5 event draft: the same id with refined coordinates keeps the id
--   S-6 a direct UPDATE that moves a pin without an id still clears it (venue and event),
--       even after an earlier write in the same transaction asserted that id
--   C-1 the asserted-id record is empty after a venue create and an event draft create
--   C-2 ...after an in-review save that changed nothing, so a direct move of another
--       venue holding the same id then clears that venue's id
--   C-3 ...after a live-venue request refused as nothing_to_change (caught)
--
-- Fails-on-revert: run against 20280521004334's definitions (this migration's
-- functions restored) → V-1, V-3 and E-2 red; without section (3) of the
-- migration (the place-stamp triggers) → S-1..S-5 red; without the INSERT and
-- no-op consumption of the record → C-1 and C-2 red.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '43342500-0000-4000-8400-000000000001';
  v_brand uuid := '43342500-0000-4000-8400-000000000011';
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
  v_venue uuid;
  v_event uuid;
  v_row record;
  v_failed boolean;
  v_admin uuid := '43342500-0000-4000-8400-000000000002';
  v_request uuid;
  v_rsvp uuid := '43342500-0000-4000-8400-000000000031';
  v_venue_a uuid;
  v_venue_b uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'repick-4334@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'repick-4334@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Repick 4334', 'repick-4334', 'NGN', 'paystack', 'NG', 'NG', 'NGN');
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  v_venue := public.biz_create_venue_listing(
    v_brand, 'Repick venue', 'repickvenue4334', 'A venue.', '', 6.4325, 3.4236, 'Lagos', 'NG',
    '175 Akin Adesola St', 'restaurant', 'repick-venue-4334@example.test', '+2348031234567', '', '', v_hours,
    NULL, 'exact', p_location_place_id => v_id1);

  -- ── V-1 in review: id-only re-pick is written ────────────────────────────
  v_result := public.biz_update_venue_identity_in_review(v_venue, p_address => '175 Akin Adesola St',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
    p_coordinate_precision => 'exact', p_location_place_id => v_id2);
  SELECT location_provider_place_id, lat, lng, address INTO v_row FROM public.venue_listings WHERE id = v_venue;
  IF (v_result ->> 'changed')::boolean IS NOT TRUE OR v_row.location_provider_place_id IS DISTINCT FROM v_id2
     OR v_row.lat <> 6.4325 OR v_row.lng <> 3.4236 OR v_row.address <> '175 Akin Adesola St' THEN
    RAISE EXCEPTION 'V-1: an id-only re-pick in review was not written (result %, row %)', v_result, row_to_json(v_row);
  END IF;

  -- ── V-2 in review: same id, or no id → changed:false ─────────────────────
  v_result := public.biz_update_venue_identity_in_review(v_venue, p_address => '175 Akin Adesola St',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
    p_coordinate_precision => 'exact', p_location_place_id => v_id2);
  IF (v_result ->> 'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'V-2a: the same id counted as a change (%)', v_result;
  END IF;
  v_result := public.biz_update_venue_identity_in_review(v_venue, p_address => '175 Akin Adesola St',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
    p_coordinate_precision => 'exact');
  IF (v_result ->> 'changed')::boolean IS NOT FALSE
     OR (SELECT location_provider_place_id FROM public.venue_listings WHERE id = v_venue) IS DISTINCT FROM v_id2 THEN
    RAISE EXCEPTION 'V-2b: a resend with no id changed something (%)', v_result;
  END IF;

  -- ── V-3 live: id-only re-pick creates a request carrying the id ──────────
  UPDATE public.venue_listings SET claim_status = 'verified' WHERE id = v_venue;
  v_result := public.biz_submit_venue_details_change_request(v_venue, p_address => '175 Akin Adesola St',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
    p_coordinate_precision => 'exact', p_location_place_id => v_id1);
  SELECT details_change_status, details_change_place_id, details_change_lat, location_provider_place_id
    INTO v_row FROM public.venue_listings WHERE id = v_venue;
  IF v_row.details_change_status IS DISTINCT FROM 'pending' OR v_row.details_change_place_id IS DISTINCT FROM v_id1
     OR v_row.details_change_lat <> 6.4325 OR v_row.location_provider_place_id IS DISTINCT FROM v_id2
     OR NOT ((v_result -> 'proposed') ? 'address') THEN
    RAISE EXCEPTION 'V-3: an id-only re-pick on a live venue made no request (result %, row %)', v_result, row_to_json(v_row);
  END IF;

  -- ── V-4 live: same id, or no id → nothing_to_change ──────────────────────
  v_failed := false;
  BEGIN
    PERFORM public.biz_submit_venue_details_change_request(v_venue, p_address => '175 Akin Adesola St',
      p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
      p_coordinate_precision => 'exact', p_location_place_id => v_id2);
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := SQLERRM = 'nothing_to_change';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'V-4a: the stored id counted as a change'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.biz_submit_venue_details_change_request(v_venue, p_address => '175 Akin Adesola St',
      p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.4325, p_lng => 3.4236,
      p_coordinate_precision => 'exact');
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := SQLERRM = 'nothing_to_change';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'V-4b: a resend with no id counted as a change'; END IF;

  -- ── events: a live event with a pin and a place id ───────────────────────
  v_result := public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Repick event', 'location_text', 'Didi Museum', 'location_geo', '(3.4236,6.4325)',
    'location_provider_place_id', v_id1, 'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme));
  v_event := (v_result #>> '{event,id}')::uuid;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master, occurrence_key)
    VALUES (v_event, now() + interval '5 days', now() + interval '5 days 3 hours', 'Africa/Lagos', true, 'a');
  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now(), slug = 'repick-4334-event',
    theme = jsonb_build_object('business_event', jsonb_build_object('requestedVisibility', 'public', 'hideAddressUntilTicket', false)),
    city = 'Lagos', location_geo = point(3.4236, 6.4325), location_provider_place_id = v_id1
  WHERE id = v_event;

  -- ── E-1 moved pin, blank id → NULL (end to end) ──────────────────────────
  PERFORM public.business_patch_event_taxonomy_with_place(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4482, 3.4569, NULL, 'approximate', '');
  SELECT location_provider_place_id, location_geo INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.location_provider_place_id IS NOT NULL OR NOT (v_row.location_geo ~= point(3.4569, 6.4482)) THEN
    RAISE EXCEPTION 'E-1: a moved pin kept the old place id (%)', row_to_json(v_row);
  END IF;

  -- ── E-2 / E-3 the RPC's own decision, with triggers off ──────────────────
  -- The events place-stamp trigger also clears a stale id when the pin moves;
  -- with it off, the result is what the RPC itself writes.
  UPDATE public.events SET location_geo = point(3.4236, 6.4325), location_provider_place_id = v_id1 WHERE id = v_event;
  SET LOCAL session_replication_role = replica;
  PERFORM public.business_patch_event_taxonomy_with_place(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4482, 3.4569, NULL, 'approximate', '   ');
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'E-2: the RPC kept the old place id for a moved pin with a blank id';
  END IF;
  UPDATE public.events SET location_geo = point(3.4236, 6.4325), location_provider_place_id = v_id1 WHERE id = v_event;
  PERFORM public.business_patch_event_taxonomy_with_place(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.4325, 3.4236, NULL, '', NULL);
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'E-3: the same pin resent without an id lost the id';
  END IF;
  SET LOCAL session_replication_role = origin;

  -- ── S-* the same place re-picked onto refined coordinates keeps its id ───
  -- S-1 venue in review (v_venue is live now; use a second venue in review)
  v_venue := public.biz_create_venue_listing(
    v_brand, 'Refine venue', 'refinevenue4334', 'A venue.', '', 6.4325, 3.4236, 'Lagos', 'NG',
    '175 Akin Adesola St', 'restaurant', 'refine-venue-4334@example.test', '+2348031234567', '', '', v_hours,
    NULL, 'approximate', p_location_place_id => v_id1);
  v_result := public.biz_update_venue_identity_in_review(v_venue, p_address => '175 Akin Adesola St',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.43251, p_lng => 3.42362,
    p_coordinate_precision => 'exact', p_location_place_id => v_id1);
  SELECT location_provider_place_id, lat, coordinate_precision, location_geo_refresh_state INTO v_row
    FROM public.venue_listings WHERE id = v_venue;
  IF v_row.location_provider_place_id IS DISTINCT FROM v_id1 OR v_row.lat <> 6.43251
     OR v_row.coordinate_precision <> 'exact' OR v_row.location_geo_refresh_state IS DISTINCT FROM 'ok' THEN
    RAISE EXCEPTION 'S-1: refining the same place in review lost the id (%)', row_to_json(v_row);
  END IF;

  -- S-2 live venue: request + admin approval
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'admin-repick-4334@example.test');
  INSERT INTO public.admin_users(email, role, status) VALUES ('admin-repick-4334@example.test', 'admin', 'active')
    ON CONFLICT (email) DO UPDATE SET role = excluded.role, status = excluded.status;
  -- independent of S-1: the live venue holds v_id1 at the S-1 pin
  UPDATE public.venue_listings SET claim_status = 'verified', location_provider_place_id = v_id1 WHERE id = v_venue;
  v_result := public.biz_submit_venue_details_change_request(v_venue, p_address => '175 Akin Adesola St',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.43252, p_lng => 3.42363,
    p_coordinate_precision => 'exact', p_location_place_id => v_id1);
  v_request := (v_result ->> 'request_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated',
    'email', 'admin-repick-4334@example.test')::text, true);
  PERFORM public.admin_review_venue_details_change(v_venue, v_request, 'approve', NULL);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SELECT location_provider_place_id, lat INTO v_row FROM public.venue_listings WHERE id = v_venue;
  IF v_row.location_provider_place_id IS DISTINCT FROM v_id1 OR v_row.lat <> 6.43252 THEN
    RAISE EXCEPTION 'S-2: approving a refinement of the same place lost the id (%)', row_to_json(v_row);
  END IF;

  -- S-3 event taxonomy (v_event holds pin (3.4236,6.4325) with v_id1 from E-3)
  UPDATE public.events SET location_geo = point(3.4236, 6.4325), location_provider_place_id = v_id1 WHERE id = v_event;
  PERFORM public.business_patch_event_taxonomy_with_place(
    v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.43253, 3.42364, NULL, 'exact', v_id1);
  SELECT location_provider_place_id, location_geo INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.location_provider_place_id IS DISTINCT FROM v_id1 OR NOT (v_row.location_geo ~= point(3.42364, 6.43253)) THEN
    RAISE EXCEPTION 'S-3: refining the same place on a live event lost the id (%)', row_to_json(v_row);
  END IF;

  -- S-4 published RSVP (business_update_rsvp_graph live branch)
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme, party_types, city, location_geo, location_provider_place_id)
  VALUES (v_rsvp, v_brand, v_owner, 'Repick RSVP', 'repick-rsvp-4334', 'rsvp', 'scheduled', 'public',
    'Africa/Lagos', 'NGN', jsonb_build_object('business_event', jsonb_build_object('isRsvp', true, 'requestedVisibility', 'public')),
    ARRAY['house-party'], 'Lagos', point(3.4236, 6.4325), v_id1);
  PERFORM public.business_update_rsvp_graph(v_rsvp,
    jsonb_build_object('title', 'Repick RSVP', 'location_geo', '(3.42365,6.43254)',
      'coordinate_precision', 'exact', 'location_provider_place_id', v_id1),
    'Refining the RSVP pin for issue 4334', NULL);
  SELECT location_provider_place_id, location_geo INTO v_row FROM public.events WHERE id = v_rsvp;
  IF v_row.location_provider_place_id IS DISTINCT FROM v_id1 OR NOT (v_row.location_geo ~= point(3.42365, 6.43254)) THEN
    RAISE EXCEPTION 'S-4: refining the same place on a published RSVP lost the id (%)', row_to_json(v_row);
  END IF;

  -- S-5 event draft
  v_result := public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Refine draft', 'location_text', 'Didi Museum', 'location_geo', '(3.4236,6.4325)',
    'location_provider_place_id', v_id1, 'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme));
  PERFORM public.business_update_event_draft((v_result #>> '{event,id}')::uuid, jsonb_build_object(
    'title', 'Refine draft', 'location_text', 'Didi Museum', 'location_geo', '(3.42366,6.43255)',
    'location_provider_place_id', v_id1, 'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme), 1);
  IF (SELECT location_provider_place_id FROM public.events WHERE id = (v_result #>> '{event,id}')::uuid) IS DISTINCT FROM v_id1 THEN
    RAISE EXCEPTION 'S-5: refining the same place on a draft lost the id';
  END IF;

  -- S-6 a direct move without an id still clears, even right after an assertion
  PERFORM public.places_checked_place_id(v_id1);   -- asserted, then consumed below
  UPDATE public.venue_listings SET name = name WHERE id = v_venue;   -- consumes it
  UPDATE public.venue_listings SET lat = 6.40, lng = 3.40 WHERE id = v_venue;
  IF (SELECT location_provider_place_id FROM public.venue_listings WHERE id = v_venue) IS NOT NULL THEN
    RAISE EXCEPTION 'S-6a: a direct venue move without an id kept the id';
  END IF;
  UPDATE public.events SET location_geo = point(3.40, 6.40) WHERE id = v_event;
  IF (SELECT location_provider_place_id FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'S-6b: a direct event move without an id kept the id';
  END IF;

  -- ── C-* the asserted-id record never outlives its write ──────────────────
  v_venue_a := public.biz_create_venue_listing(
    v_brand, 'Record venue A', 'recordvenuea4334', 'A venue.', '', 6.5100, 3.3600, 'Lagos', 'NG',
    '1 Record Road', 'restaurant', 'record-a-4334@example.test', '+2348031234567', '', '', v_hours,
    NULL, 'exact', p_location_place_id => v_id2);
  IF COALESCE(current_setting('mingla.place_id_confirmed', true), '') <> '' THEN
    RAISE EXCEPTION 'C-1a: a venue create left the asserted id set';
  END IF;
  v_result := public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Record draft', 'location_geo', '(3.36,6.51)', 'location_provider_place_id', v_id2,
    'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme));
  IF COALESCE(current_setting('mingla.place_id_confirmed', true), '') <> '' THEN
    RAISE EXCEPTION 'C-1b: an event draft create left the asserted id set';
  END IF;
  v_venue_b := public.biz_create_venue_listing(
    v_brand, 'Record venue B', 'recordvenueb4334', 'A venue.', '', 6.5000, 3.3500, 'Lagos', 'NG',
    '2 Record Road', 'restaurant', 'record-b-4334@example.test', '+2348031234567', '', '', v_hours,
    NULL, 'exact', p_location_place_id => v_id2);
  v_result := public.biz_update_venue_identity_in_review(v_venue_a, p_address => '1 Record Road',
    p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.5100, p_lng => 3.3600,
    p_coordinate_precision => 'exact', p_location_place_id => v_id2);
  IF (v_result ->> 'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'C-2 fixture: the no-op in review changed something (%)', v_result;
  END IF;
  IF COALESCE(current_setting('mingla.place_id_confirmed', true), '') <> '' THEN
    RAISE EXCEPTION 'C-2a: an in-review save that changed nothing left the asserted id set';
  END IF;
  UPDATE public.venue_listings SET lat = 6.51 WHERE id = v_venue_b;
  IF (SELECT location_provider_place_id FROM public.venue_listings WHERE id = v_venue_b) IS NOT NULL THEN
    RAISE EXCEPTION 'C-2b: venue B kept its id on a direct move after a no-op on venue A';
  END IF;
  UPDATE public.venue_listings SET claim_status = 'verified' WHERE id = v_venue_a;
  BEGIN
    PERFORM public.biz_submit_venue_details_change_request(v_venue_a, p_address => '1 Record Road',
      p_city => 'Lagos', p_country_code => 'NG', p_lat => 6.5100, p_lng => 3.3600,
      p_coordinate_precision => 'exact', p_location_place_id => v_id2);
    RAISE EXCEPTION 'C-3 fixture: the no-op request was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF COALESCE(current_setting('mingla.place_id_confirmed', true), '') <> '' THEN
    RAISE EXCEPTION 'C-3: a refused no-op request left the asserted id set';
  END IF;

  RAISE NOTICE 'issue_4334_place_id_repick: all checks passed';
END;
$test$;

ROLLBACK;
