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
--
-- Fails-on-revert: run against 20280521004334's definitions (this migration's
-- functions restored) → V-1, V-3 and E-2 red.
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

  RAISE NOTICE 'issue_4334_place_id_repick: all checks passed';
END;
$test$;

ROLLBACK;
