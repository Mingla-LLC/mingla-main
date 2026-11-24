-- #4490 gap list 07-A (20281203254490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-PARTY-TYPE-OPTIONAL-AT-VENUE | issue #4490 | an event linked to a venue (events.venue_id) may publish and be live-edited with no party type; an event with no venue still needs one, a non-empty list must still be canonical, and a published event with no party type cannot be moved away from its venue (party_types_required).
--
-- A-1 live patch (both patchers) with an empty list: refused without a venue, accepted with one.
-- A-2 a non-canonical list is still refused at a venue.
-- A-3 clearing the venue of a scheduled event with no party type is refused; a draft may clear it.
-- A-4 the publish (event + RSVP) gates carry the venue clause and keep the literal the #2333 gate bounds on,
--     and both answer #4420's caller-scoped event json (issue_4420_event_json_for_caller).
-- A-5 publishing a hidden-address event at a venue: the host's answer keeps the street and place id the
--     stored row withholds, and equals #4420's caller rule applied to the row (fix 4, P1-B).
--
-- FAILS-ON-REVERT (seen 19 Nov): with the pre-264490 patchers and set_event_venue re-emitted in the same transaction,
-- A-1b fails with party_types_required (A-3a and A-4 would fail next: no refusal, no venue clause).
-- FAILS-ON-REVERT (fix 4, 24 Nov): with the 435a9edd8c publish gates ('event', to_jsonb(v_event)) A-4 fails
-- (no caller-scoped json) and, with A-4 removed, A-5b fails (the host's answer has no street or place id).
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '44902600-0000-4000-8000-000000000001';
  v_brand uuid := '44902600-0000-4000-9000-000000000010';
  v_venue uuid := '44902600-0000-4000-9000-0000000000a1';
  v_theme jsonb := '{"business_draft":{"requestedVisibility":"public"}}'::jsonb;
  v_event uuid;
  v_draft uuid;
  v_failed boolean;
  v_fn text;
  v_src text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'party-optional-4490@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'party-optional-4490@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Party optional 4490', 'party-optional-4490', 'NGN', 'paystack', 'NG', 'NG', 'NGN');
  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code)
    VALUES (v_venue, v_brand, 'partyoptional4490', 'Party Optional Hall', 6.45, 3.41, 'play', 'verified', 'NG');

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  v_event := (public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Venue night', 'location_text', 'Party Optional Hall', 'location_geo', '(3.41,6.45)',
    'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme)) #>> '{event,id}')::uuid;
  v_draft := (public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Draft night', 'location_text', 'Party Optional Hall', 'location_geo', '(3.41,6.45)',
    'timezone', 'Africa/Lagos', 'currency', 'NGN', 'theme', v_theme)) #>> '{event,id}')::uuid;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master, occurrence_key)
    VALUES (v_event, now() + interval '5 days', now() + interval '5 days 3 hours', 'Africa/Lagos', true, 'a');
  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now(), slug = 'venue-night-4490',
    theme = jsonb_build_object('business_event', jsonb_build_object('requestedVisibility', 'public', 'hideAddressUntilTicket', false)),
    city = 'Lagos', party_types = ARRAY['club-night']::text[] WHERE id = v_event;

  -- A-1a no venue + empty list: refused (old patcher)
  v_failed := false;
  BEGIN
    PERFORM public.business_patch_event_taxonomy(v_event, 'Lagos', ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'party_types_required';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A-1a FAIL: empty party types accepted with no venue'; END IF;
  RAISE NOTICE 'PASS  A-1a empty list refused without a venue (business_patch_event_taxonomy)';
  -- A-1c no venue + empty list: refused (_with_place)
  v_failed := false;
  BEGIN
    PERFORM public.business_patch_event_taxonomy_with_place(v_event, 'Lagos', ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 6.45, 3.41, 'Party Optional Hall', 'exact', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'party_types_required';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A-1c FAIL: empty party types accepted with no venue (_with_place)'; END IF;
  RAISE NOTICE 'PASS  A-1c empty list refused without a venue (_with_place)';

  -- link the venue (the Where step's writer)
  PERFORM public.issue_4490_set_event_venue(v_event, v_venue, NULL, 'shared', NULL, NULL);

  -- A-1b at a venue: accepted and stored empty
  PERFORM public.business_patch_event_taxonomy(v_event, 'Lagos', ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]);
  IF cardinality((SELECT party_types FROM public.events WHERE id = v_event)) <> 0 THEN
    RAISE EXCEPTION 'A-1b FAIL: party types not cleared';
  END IF;
  RAISE NOTICE 'PASS  A-1b empty list accepted at a venue (business_patch_event_taxonomy)';
  -- A-1d at a venue: _with_place accepts too
  PERFORM public.business_patch_event_taxonomy_with_place(v_event, 'Lagos', ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 6.45, 3.41, 'Party Optional Hall', 'exact', NULL);
  RAISE NOTICE 'PASS  A-1d empty list accepted at a venue (_with_place)';

  -- A-2 non-canonical list still refused at a venue
  v_failed := false;
  BEGIN
    PERFORM public.business_patch_event_taxonomy_with_place(v_event, 'Lagos', ARRAY['not-a-party-type']::text[], ARRAY[]::text[], ARRAY[]::text[], 6.45, 3.41, NULL, '', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A-2 FAIL: a non-canonical party type was accepted at a venue'; END IF;
  RAISE NOTICE 'PASS  A-2 non-canonical list still refused at a venue';

  -- A-3a clearing the venue of a scheduled event with no party type: refused
  v_failed := false;
  BEGIN
    PERFORM public.issue_4490_set_event_venue(v_event, NULL, NULL, 'shared', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'party_types_required';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A-3a FAIL: venue cleared from a live event with no party type'; END IF;
  IF (SELECT venue_id FROM public.events WHERE id = v_event) IS DISTINCT FROM v_venue THEN
    RAISE EXCEPTION 'A-3a FAIL: venue link lost';
  END IF;
  RAISE NOTICE 'PASS  A-3a venue cannot be cleared from a live event with no party type';
  -- A-3b with a party type it may move away
  PERFORM public.business_patch_event_taxonomy(v_event, 'Lagos', ARRAY['club-night']::text[], ARRAY[]::text[], ARRAY[]::text[]);
  PERFORM public.issue_4490_set_event_venue(v_event, NULL, NULL, 'shared', NULL, NULL);
  IF (SELECT venue_id FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'A-3b FAIL: venue not cleared';
  END IF;
  RAISE NOTICE 'PASS  A-3b a live event with a party type can leave its venue';
  -- A-3c a draft with no party type may clear its venue
  PERFORM public.issue_4490_set_event_venue(v_draft, v_venue, NULL, 'shared', NULL, NULL);
  PERFORM public.issue_4490_set_event_venue(v_draft, NULL, NULL, 'shared', NULL, NULL);
  RAISE NOTICE 'PASS  A-3c a draft can clear its venue';
  -- A-3d a live experience (no party types by design) may leave its venue
  UPDATE public.events SET event_type = 'experience', party_types = ARRAY[]::text[] WHERE id = v_event;
  PERFORM public.issue_4490_set_event_venue(v_event, v_venue, NULL, 'shared', NULL, NULL);
  PERFORM public.issue_4490_set_event_venue(v_event, NULL, NULL, 'shared', NULL, NULL);
  RAISE NOTICE 'PASS  A-3d a live experience can leave its venue';

  -- A-4 the publish gates carry the venue clause; the #2333 literal stays
  FOREACH v_fn IN ARRAY ARRAY[
    'public.business_publish_event_draft(uuid,jsonb,integer)',
    'public.business_publish_rsvp_draft(uuid,jsonb,integer)',
    'public.business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)',
    'public.business_patch_event_taxonomy_with_place(uuid,text,text[],text[],text[],numeric,numeric,text,text,text)'
  ] LOOP
    v_src := pg_get_functiondef(v_fn::regprocedure);
    IF position('array_length(v_party_types, 1) IS NULL AND v_event.venue_id IS NULL' in v_src) = 0
       OR position('party_types_required' in v_src) = 0 THEN
      RAISE EXCEPTION 'A-4 FAIL: % lost the venue clause or the literal', v_fn;
    END IF;
    IF v_fn LIKE 'public.business_publish_%'
       AND position('issue_4420_event_json_for_caller(to_jsonb(v_event))' in v_src) = 0 THEN
      RAISE EXCEPTION 'A-4 FAIL: % answers the raw event row, not #4420''s caller-scoped event json', v_fn;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS  A-4 all four gates carry the venue clause; both publish gates keep #4420''s caller-scoped event json';
END
$test$;

-- A-5 (08-O5 fix 4): publishing a hidden-address event at a venue answers the event the way
-- #4420's caller rule (issue_4420_event_json_for_caller) shows it: the host gets the street and
-- the place id back, though the stored row withholds them; a caller the rule hides it from
-- would get the row as stored.
DO $a5$
DECLARE
  v_owner uuid := '44902600-0000-4000-8000-000000000005';
  v_stranger uuid := '44902600-0000-4000-8000-000000000006';
  v_brand uuid := '44902600-0000-4000-9000-000000000050';
  v_venue uuid := '44902600-0000-4000-9000-0000000000a5';
  v_event uuid;
  v_res jsonb;
  v_row jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'hidden-4490@example.test'), (v_stranger, 'stranger-4490@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'hidden-4490@example.test'), (v_stranger, 'stranger-4490@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Hidden address 4490', 'hidden-address-4490', 'NGN', 'paystack', 'NG', 'NG', 'NGN');
  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code)
    VALUES (v_venue, v_brand, 'hiddenaddress4490', 'Hidden Hall', 6.45, 3.41, 'play', 'verified', 'NG');
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_event := (public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Secret night', 'timezone', 'Africa/Lagos', 'currency', 'NGN',
    'theme', '{"business_draft":{"requestedVisibility":"public"}}'::jsonb)) #>> '{event,id}')::uuid;
  PERFORM public.issue_4490_set_event_venue(v_event, v_venue, NULL, 'shared', NULL, NULL);
  v_res := public.business_publish_event_draft(v_event, jsonb_build_object(
    'title', 'Secret night', 'timezone', 'Africa/Lagos', 'currency', 'NGN',
    'location_text', 'Hidden Hall', 'location', jsonb_build_object('lat', 6.45, 'lng', 3.41),
    'locationProviderPlaceId', 'ChIJhidden4490',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'requestedVisibility', 'public', 'format', 'in_person', 'city', 'Lagos',
      'hideAddressUntilTicket', true,
      'location', jsonb_build_object('venueName', 'Hidden Hall', 'address', '12 Hidden Street, Lagos'),
      'locationProviderPlaceId', 'ChIJhidden4490',
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array(),
      'whenMode', 'single',
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'), 'doorsOpen', '20:00', 'endsAt', '23:00')))));
  SELECT to_jsonb(e.*) INTO v_row FROM public.events e WHERE e.id = v_event;

  IF v_row #> '{theme,business_event,location,address}' IS NOT NULL
     OR v_row #> '{theme,business_event,locationProviderPlaceId}' IS NOT NULL THEN
    RAISE EXCEPTION 'A-5a FAIL: the stored row of a hidden-address event still carries the street or place id';
  END IF;
  RAISE NOTICE 'PASS  A-5a the stored row withholds the street and place id (#4420)';
  IF v_res #>> '{event,theme,business_event,location,address}' IS DISTINCT FROM '12 Hidden Street, Lagos'
     OR v_res #>> '{event,theme,business_event,locationProviderPlaceId}' IS DISTINCT FROM 'ChIJhidden4490'
     OR v_res #>> '{event,theme,business_event,location,venueName}' IS DISTINCT FROM 'Hidden Hall' THEN
    RAISE EXCEPTION 'A-5b FAIL: the host''s publish answer lost the street, place id or venue name: %', v_res #> '{event,theme}';
  END IF;
  RAISE NOTICE 'PASS  A-5b the host''s publish answer keeps the street, place id and venue name';
  IF v_res -> 'event' IS DISTINCT FROM public.issue_4420_event_json_for_caller(v_row) THEN
    RAISE EXCEPTION 'A-5c FAIL: the publish answer is not #4420''s caller-scoped event json';
  END IF;
  RAISE NOTICE 'PASS  A-5c the publish answer is exactly issue_4420_event_json_for_caller of the row';
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  IF public.issue_4420_event_json_for_caller(v_row) #> '{theme,business_event,location,address}' IS NOT NULL
     OR public.issue_4420_event_json_for_caller(v_row) #>> '{theme,business_event,location,venueName}' IS DISTINCT FROM 'Hidden Hall' THEN
    RAISE EXCEPTION 'A-5d FAIL: the caller rule does not withhold the street from a stranger';
  END IF;
  RAISE NOTICE 'PASS  A-5d for a caller the rule hides it from, the same json omits only the street and place id';
END
$a5$;

-- A-6 (P3-a, retest): the RSVP publish gate (business_publish_rsvp_draft) answers a hidden-address
-- RSVP at a venue the same way as A-5: the host's answer keeps the street and place id the stored row
-- withholds, equals #4420's caller rule applied to the row, and the same rule hides them from a stranger.
-- FAILS-ON-REVERT: with the RSVP gate's answer back to ('event', to_jsonb(v_event)) A-6b fails.
DO $a6$
DECLARE
  v_owner uuid := '44902600-0000-4000-8000-000000000007';
  v_stranger uuid := '44902600-0000-4000-8000-000000000008';
  v_brand uuid := '44902600-0000-4000-9000-000000000060';
  v_venue uuid := '44902600-0000-4000-9000-0000000000a6';
  v_event uuid;
  v_res jsonb;
  v_row jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'hidden-rsvp-4490@example.test'), (v_stranger, 'stranger-rsvp-4490@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'hidden-rsvp-4490@example.test'), (v_stranger, 'stranger-rsvp-4490@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Hidden RSVP 4490', 'hidden-rsvp-4490', 'NGN', 'paystack', 'NG', 'NG', 'NGN');
  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code)
    VALUES (v_venue, v_brand, 'hiddenrsvp4490', 'Hidden RSVP Hall', 6.45, 3.41, 'play', 'verified', 'NG');
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_event := (public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Secret RSVP', 'timezone', 'Africa/Lagos', 'currency', 'NGN',
    'theme', '{"business_draft":{"requestedVisibility":"public"}}'::jsonb)) #>> '{event,id}')::uuid;
  PERFORM public.issue_4490_set_event_venue(v_event, v_venue, NULL, 'shared', NULL, NULL);
  v_res := public.business_publish_rsvp_draft(v_event, jsonb_build_object(
    'title', 'Secret RSVP', 'timezone', 'Africa/Lagos',
    'location_text', 'Hidden RSVP Hall',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'requestedVisibility', 'public', 'format', 'in_person', 'city', 'Lagos',
      'hideAddressUntilTicket', true,
      'location', jsonb_build_object('venueName', 'Hidden RSVP Hall', 'address', '14 Hidden Street, Lagos'),
      'locationGeo', jsonb_build_object('lat', 6.45, 'lng', 3.41),
      'locationProviderPlaceId', 'ChIJhiddenrsvp4490',
      'partyTypes', jsonb_build_array(),
      'whenMode', 'single',
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'), 'doorsOpen', '20:00', 'endsAt', '23:00')))));
  SELECT to_jsonb(e.*) INTO v_row FROM public.events e WHERE e.id = v_event;

  IF v_row ->> 'event_type' IS DISTINCT FROM 'rsvp' THEN
    RAISE EXCEPTION 'A-6 setup FAIL: the RSVP gate did not publish an rsvp (event_type %)', v_row ->> 'event_type';
  END IF;
  IF v_row #> '{theme,business_event,location,address}' IS NOT NULL
     OR v_row #> '{theme,business_event,locationProviderPlaceId}' IS NOT NULL THEN
    RAISE EXCEPTION 'A-6a FAIL: the stored row of a hidden-address RSVP still carries the street or place id';
  END IF;
  RAISE NOTICE 'PASS  A-6a the stored RSVP row withholds the street and place id (#4420)';
  IF v_res #>> '{event,theme,business_event,location,address}' IS DISTINCT FROM '14 Hidden Street, Lagos'
     OR v_res #>> '{event,theme,business_event,locationProviderPlaceId}' IS DISTINCT FROM 'ChIJhiddenrsvp4490'
     OR v_res #>> '{event,theme,business_event,location,venueName}' IS DISTINCT FROM 'Hidden RSVP Hall' THEN
    RAISE EXCEPTION 'A-6b FAIL: the host''s RSVP publish answer lost the street, place id or venue name: %', v_res #> '{event,theme}';
  END IF;
  RAISE NOTICE 'PASS  A-6b the host''s RSVP publish answer keeps the street, place id and venue name';
  IF v_res -> 'event' IS DISTINCT FROM public.issue_4420_event_json_for_caller(v_row) THEN
    RAISE EXCEPTION 'A-6c FAIL: the RSVP publish answer is not #4420''s caller-scoped event json';
  END IF;
  RAISE NOTICE 'PASS  A-6c the RSVP publish answer is exactly issue_4420_event_json_for_caller of the row';
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  IF public.issue_4420_event_json_for_caller(v_row) #> '{theme,business_event,location,address}' IS NOT NULL
     OR public.issue_4420_event_json_for_caller(v_row) #> '{theme,business_event,locationProviderPlaceId}' IS NOT NULL
     OR public.issue_4420_event_json_for_caller(v_row) #>> '{theme,business_event,location,venueName}' IS DISTINCT FROM 'Hidden RSVP Hall' THEN
    RAISE EXCEPTION 'A-6d FAIL: the caller rule does not withhold the RSVP street from a stranger';
  END IF;
  RAISE NOTICE 'PASS  A-6d for a stranger the same rule omits only the street and place id';
END
$a6$;

ROLLBACK;
\echo 'issue #4490 07-A: all cases passed'
