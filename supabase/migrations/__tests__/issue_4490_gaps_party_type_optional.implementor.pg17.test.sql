-- #4490 gap list 07-A (20280809264490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-PARTY-TYPE-OPTIONAL-AT-VENUE | issue #4490 | an event linked to a venue (events.venue_id) may publish and be live-edited with no party type; an event with no venue still needs one, a non-empty list must still be canonical, and a non-draft event with no party type cannot be moved away from its venue (party_types_required).
--
-- A-1 live patch (both patchers) with an empty list: refused without a venue, accepted with one.
-- A-2 a non-canonical list is still refused at a venue.
-- A-3 clearing the venue of a scheduled event with no party type is refused; a draft may clear it.
-- A-4 the publish (event + RSVP) gates carry the venue clause and keep the literal the #2333 gate bounds on.
--
-- FAILS-ON-REVERT (seen 19 Nov): with the pre-264490 patchers and set_event_venue re-emitted in the same transaction,
-- A-1b fails with party_types_required (A-3a and A-4 would fail next: no refusal, no venue clause).
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
  END LOOP;
  RAISE NOTICE 'PASS  A-4 all four gates carry the venue clause';
END
$test$;

ROLLBACK;
\echo 'issue #4490 07-A: all cases passed'
