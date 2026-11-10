-- #4334 follow-ups (20280526004334) — tester adversarial suite. Attacks what
-- the implementor suite does not: callers who are not the owner, the error
-- paths of the SECURITY DEFINER _repick wrappers, ids that try to forge a key,
-- and the grants / search_path of every new function.
--
--   S-1 a stranger's _repick on another brand's draft trip, live trip and live
--       experience is refused by the wrapped owner; nothing is written
--   S-2 a _repick that raises (PT409, stale revision) inside a caller's
--       exception block leaves no assertion behind: a later direct move of the
--       same pin in the same transaction still clears the id
--   S-3 a _repick whose owner returns ok:false (no raise) leaves no assertion
--   S-4 a non-Google id, a blank key, a key with '=' or a space, and an id that
--       smuggles a second key=value pair are never recorded
--   S-5 authenticated cannot call the assertion writers; anon cannot call the
--       commands; every new function pins search_path
--   S-6 biz_update_brand_pin: anon is refused; an authenticated caller with no
--       uid is refused; a soft-deleted brand is brand_not_found
--
-- Fails-on-revert: restore the 20280525004334 tg_4334_events_place_stamp (S-2
-- control assertion turns red because the kept half never keeps); grant
-- places_confirm_pin to authenticated or drop a SET search_path (S-5 red);
-- drop the places_is_google_place_id / key checks in places_confirm_pin (S-4 red).
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t4334x_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4334 follow-ups TESTER FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE TEMP TABLE t4334x (k text PRIMARY KEY, v text);
GRANT SELECT, INSERT ON t4334x TO authenticated, anon;

CREATE OR REPLACE FUNCTION pg_temp.t4334x_as(p_who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', (SELECT v FROM t4334x WHERE k = p_who), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT v FROM t4334x WHERE k = p_who), 'role', 'authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.t4334x_pins() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('mingla.place_pins_confirmed', true), '')
$$;

CREATE OR REPLACE FUNCTION pg_temp.t4334x_bt(p_event uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT theme -> 'business_trip' FROM public.events WHERE id = p_event
$$;

-- ── fixtures (as the owner) ──────────────────────────────────────────────────
DO $fx$
DECLARE
  v_owner uuid := '43342610-0000-4000-8400-000000000001';
  v_stranger uuid := '43342610-0000-4000-8400-000000000002';
  v_brand uuid := '43342610-0000-4000-8400-000000000011';
  v_gone uuid := '43342610-0000-4000-8400-000000000012';
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'tester-owner-4334@example.test'), (v_stranger, 'tester-stranger-4334@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'tester-owner-4334@example.test'), (v_stranger, 'tester-stranger-4334@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, paystack_subaccount_code,
                            lat, lng, location_provider_place_id)
    VALUES (v_brand, v_owner, 'Tester 4334', 'tester-4334', 'GBP', 'ACCT_tester4334',
            6.4300, 3.4200, 'ChIJ0Wq9hS_1OxARsFOw5qkW6Y0'),
           (v_gone, v_owner, 'Gone 4334', 'gone-4334', 'GBP', 'ACCT_gone4334',
            6.4300, 3.4200, NULL);
  UPDATE public.brands SET deleted_at = now() WHERE id = v_gone;
  INSERT INTO t4334x VALUES ('owner', v_owner), ('stranger', v_stranger), ('brand', v_brand),
    ('gone', v_gone), ('id1', 'ChIJ0Wq9hS_1OxARsFOw5qkW6Y0'), ('id2', 'ChIJ8bF1g3T1OxAR5Yx0Qn5pLk8');
END $fx$;

SELECT pg_temp.t4334x_as('owner');

DO $trips$
DECLARE
  g jsonb;
  v_draft uuid;
  v_live uuid;
  v_id1 text := (SELECT v FROM t4334x WHERE k = 'id1');
  v_id2 text := (SELECT v FROM t4334x WHERE k = 'id2');
  v_brand uuid := (SELECT v FROM t4334x WHERE k = 'brand')::uuid;
  v_patch jsonb;
BEGIN
  v_patch := jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
    'departurePlaceId', v_id1, 'departureLat', 6.43, 'departureLng', 3.42,
    'destinationPlaceId', v_id2, 'destinationLat', 9.07, 'destinationLng', 7.49)));
  g := public.biz_create_trip_draft(v_brand, jsonb_build_object('title', 'Tester draft', 'timezone', 'Africa/Lagos'), gen_random_uuid());
  v_draft := (g #>> '{event,id}')::uuid;
  PERFORM public.biz_apply_trip_draft_graph(v_draft, v_patch, (SELECT updated_at FROM public.events WHERE id = v_draft), gen_random_uuid());

  g := public.biz_create_trip_draft(v_brand, jsonb_build_object('title', 'Tester live', 'timezone', 'Africa/Lagos'), gen_random_uuid());
  v_live := (g #>> '{event,id}')::uuid;
  PERFORM public.biz_apply_trip_draft_graph(v_live, v_patch, (SELECT updated_at FROM public.events WHERE id = v_live), gen_random_uuid());
  PERFORM public.biz_apply_trip_draft_graph(v_live,
    jsonb_build_object('event_dates', jsonb_build_array(jsonb_build_object(
      'start_at', (now() + interval '60 days')::text, 'end_at', (now() + interval '67 days')::text, 'is_master', true))),
    (SELECT updated_at FROM public.events WHERE id = v_live), gen_random_uuid());
  UPDATE public.events SET status = 'scheduled', published_at = now() WHERE id = v_live;
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_trip}', (theme -> 'business_trip')
           || jsonb_build_object('departurePlaceId', v_id1, 'departureLat', 6.43, 'departureLng', 3.42))
   WHERE id = v_live;
  INSERT INTO t4334x VALUES ('draft', v_draft), ('live', v_live);
  PERFORM pg_temp.t4334x_assert(pg_temp.t4334x_bt(v_draft) ->> 'departurePlaceId' = v_id1
    AND pg_temp.t4334x_bt(v_live) ->> 'departurePlaceId' = v_id1, 'S-0 fixture: both trips carry the departure id');
END $trips$;

-- A live experience owned by the owner's brand.
DO $exp$
DECLARE
  v_event uuid := gen_random_uuid();
  v_day text := to_char((now() AT TIME ZONE 'America/New_York')::date + 25, 'YYYY-MM-DD');
  v_start timestamptz := (to_char((now() AT TIME ZONE 'America/New_York')::date + 25, 'YYYY-MM-DD') || ' 18:00:00')::timestamp AT TIME ZONE 'America/New_York';
BEGIN
  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode,
    experience_intents, experience_intent, whole_price_cents
  ) VALUES (
    v_event, (SELECT v FROM t4334x WHERE k = 'brand')::uuid, (SELECT v FROM t4334x WHERE k = 'owner')::uuid,
    'Tester walk', 'Two rooms.', 'tester-walk-4334-' || v_event, 'experience', 'draft', 'draft',
    'America/New_York', 'USD', 'per_stop', 'whole', ARRAY['group-fun'], 'group-fun', 0);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, v_start, v_start + interval '3 hours', 'America/New_York', true);
  INSERT INTO public.experience_stops(event_id, stop_order, place_id, place_name, address, lat, lng, start_time, price_cents)
    VALUES (v_event, 0, (SELECT v FROM t4334x WHERE k = 'id1'), 'First Room', '11 Secret Lane', 40.71, -73.95, '18:00', 0),
           (v_event, 1, (SELECT v FROM t4334x WHERE k = 'id2'), 'Second Room', '22 Hidden Row', 40.72, -73.96, '19:30', 0);
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, display_order)
    VALUES (v_event, 'Standard', 0, true, 0);
  UPDATE public.events
     SET status = 'scheduled', visibility = 'public', published_at = now(),
         theme = jsonb_build_object('experience_meta', jsonb_build_object('when_draft', jsonb_build_object(
           'whenMode', 'single', 'when', jsonb_build_object('date', v_day, 'doorsOpen', '18:00', 'endsAt', '21:00'),
           'timezone', 'America/New_York')))
   WHERE id = v_event;
  INSERT INTO t4334x VALUES ('exp', v_event), ('day', v_day);
END $exp$;

CREATE OR REPLACE FUNCTION pg_temp.t4334x_payload(p_lat0 double precision) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'title', 'Tester walk', 'description', 'Two rooms.',
    'experience_intents', jsonb_build_array('group-fun'),
    'location_mode', 'per_stop', 'pricing_mode', 'whole', 'is_free', true,
    'timezone', 'America/New_York', 'whenMode', 'single',
    'when', jsonb_build_object('date', (SELECT v FROM t4334x WHERE k = 'day'), 'doorsOpen', '18:00', 'endsAt', '21:00'),
    'stops', jsonb_build_array(
      jsonb_build_object('stop_order', 0, 'place_name', 'First Room', 'address', '11 Secret Lane',
                         'start_time', '18:00', 'price_cents', 0,
                         'place_id', (SELECT v FROM t4334x WHERE k = 'id1'), 'lat', p_lat0, 'lng', -73.95),
      jsonb_build_object('stop_order', 1, 'place_name', 'Second Room', 'address', '22 Hidden Row',
                         'start_time', '19:30', 'price_cents', 0,
                         'place_id', (SELECT v FROM t4334x WHERE k = 'id2'), 'lat', 40.72, 'lng', -73.96)))
$$;

-- ── S-1 a stranger, as the real authenticated role ───────────────────────────
SELECT pg_temp.t4334x_as('stranger');
SET LOCAL ROLE authenticated;
DO $s1$
DECLARE
  v_draft uuid := (SELECT v FROM t4334x WHERE k = 'draft')::uuid;
  v_live uuid := (SELECT v FROM t4334x WHERE k = 'live')::uuid;
  v_exp uuid := (SELECT v FROM t4334x WHERE k = 'exp')::uuid;
  v_id1 text := (SELECT v FROM t4334x WHERE k = 'id1');
  v_refused int := 0;
  v_result jsonb;
BEGIN
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph_repick(v_draft,
      jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
        'departurePlaceId', v_id1, 'departureLat', 1.0, 'departureLng', 1.0))),
      now(), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'insufficient_event_permission' THEN v_refused := v_refused + 1; END IF;
  END;
  BEGIN
    PERFORM public.biz_update_trip_live_command_repick(v_live,
      jsonb_build_object('theme', jsonb_build_object('business_trip', jsonb_build_object(
        'departurePlaceId', v_id1, 'departureLat', 1.0, 'departureLng', 1.0))),
      'A stranger moving someone else''s pin', now(), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'insufficient_event_permission' THEN v_refused := v_refused + 1; END IF;
  END;
  BEGIN
    v_result := public.biz_update_live_experience_repick(v_exp, pg_temp.t4334x_payload(1.0),
      'A stranger moving someone else''s stop');
    -- reaching here (no raise) is a breach
    RAISE NOTICE 'unexpected result %', v_result;
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'insufficient_event_permission' THEN v_refused := v_refused + 1; END IF;
  END;
  PERFORM pg_temp.t4334x_assert(v_refused = 3, 'S-1a a stranger''s three _repick calls are all refused');
  PERFORM pg_temp.t4334x_assert(pg_temp.t4334x_pins() = '', 'S-1b no assertion is left behind by a refused call');
END $s1$;
RESET ROLE;
DO $s1c$
BEGIN
  PERFORM pg_temp.t4334x_assert(
    (pg_temp.t4334x_bt((SELECT v FROM t4334x WHERE k = 'draft')::uuid) ->> 'departureLat')::numeric = 6.43
    AND (pg_temp.t4334x_bt((SELECT v FROM t4334x WHERE k = 'live')::uuid) ->> 'departureLat')::numeric = 6.43
    AND (SELECT lat FROM public.experience_stops WHERE event_id = (SELECT v FROM t4334x WHERE k = 'exp')::uuid AND stop_order = 0) = 40.71,
    'S-1c nothing the stranger sent was written');
END $s1c$;

-- ── S-2 / S-3 error paths, as the owner ──────────────────────────────────────
SELECT pg_temp.t4334x_as('owner');
DO $s2$
DECLARE
  v_draft uuid := (SELECT v FROM t4334x WHERE k = 'draft')::uuid;
  v_exp uuid := (SELECT v FROM t4334x WHERE k = 'exp')::uuid;
  v_id1 text := (SELECT v FROM t4334x WHERE k = 'id1');
  v_conflict boolean := false;
  v_result jsonb;
BEGIN
  -- S-2: a stale revision raises PT409 inside the wrapped owner, after the
  -- wrapper has recorded the assertion.
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph_repick(v_draft,
      jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
        'departurePlaceId', v_id1, 'departureLat', 6.43251, 'departureLng', 3.42361))),
      '2000-01-01T00:00:00Z'::timestamptz, gen_random_uuid());
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_conflict := true;
  END;
  PERFORM pg_temp.t4334x_assert(v_conflict, 'S-2a a stale revision is a PT409 conflict');
  PERFORM pg_temp.t4334x_assert(pg_temp.t4334x_pins() = '', 'S-2b the failed _repick left no assertion in the transaction');
  -- A later direct move of the same pin, same transaction, same id: must clear.
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_trip}', (theme -> 'business_trip')
           || jsonb_build_object('departureLat', 6.43252, 'departureLng', 3.42362))
   WHERE id = v_draft;
  PERFORM pg_temp.t4334x_assert(pg_temp.t4334x_bt(v_draft) -> 'departurePlaceId' = 'null'::jsonb,
    'S-2c a later unasserted move of that pin in the same transaction still clears its id');

  -- Control: the same move through _repick (fresh revision) keeps the id, so
  -- S-2c is not passing vacuously.
  PERFORM public.biz_apply_trip_draft_graph_repick(v_draft,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'departurePlaceId', v_id1, 'departureLat', 6.43, 'departureLng', 3.42))),
    (SELECT updated_at FROM public.events WHERE id = v_draft), gen_random_uuid());
  PERFORM public.biz_apply_trip_draft_graph_repick(v_draft,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'departurePlaceId', v_id1, 'departureLat', 6.43253, 'departureLng', 3.42363))),
    (SELECT updated_at FROM public.events WHERE id = v_draft), gen_random_uuid());
  PERFORM pg_temp.t4334x_assert(pg_temp.t4334x_bt(v_draft) ->> 'departurePlaceId' = v_id1,
    'S-2d control: the asserted re-pick keeps the id');

  -- S-3: the owner refuses without raising (an edit reason under 10 chars).
  v_result := public.biz_update_live_experience_repick(v_exp, pg_temp.t4334x_payload(40.71001), 'short');
  PERFORM pg_temp.t4334x_assert(NOT COALESCE((v_result ->> 'ok')::boolean, true)
    AND pg_temp.t4334x_pins() = '', 'S-3a an ok:false refusal leaves no assertion');
  UPDATE public.experience_stops SET lat = 40.71002 WHERE event_id = v_exp AND stop_order = 0;
  PERFORM pg_temp.t4334x_assert(
    (SELECT place_id FROM public.experience_stops WHERE event_id = v_exp AND stop_order = 0) IS NULL,
    'S-3b a later unasserted stop move in the same transaction still clears its id');
END $s2$;

-- ── S-4 forged ids and keys are never recorded ───────────────────────────────
DO $s4$
DECLARE
  v_id1 text := (SELECT v FROM t4334x WHERE k = 'id1');
BEGIN
  PERFORM set_config('mingla.place_pins_confirmed', '', true);
  PERFORM public.places_confirm_pin('trip:x:departure', 'dXJuOm1ieHBsYzpBYkNkRWZHaA');   -- Mapbox urn
  PERFORM public.places_confirm_pin('trip:x:departure', 'short');
  PERFORM public.places_confirm_pin('', v_id1);
  PERFORM public.places_confirm_pin(NULL, v_id1);
  PERFORM public.places_confirm_pin('trip:x=y', v_id1);
  PERFORM public.places_confirm_pin('trip:x departure', v_id1);
  PERFORM public.places_confirm_pin('trip:x:departure', v_id1 || ' trip:y:departure=' || v_id1);
  PERFORM pg_temp.t4334x_assert(pg_temp.t4334x_pins() = '',
    'S-4a non-Google ids, blank/null keys, keys with = or a space, and a smuggled pair record nothing');
  PERFORM public.places_confirm_pin('trip:x:departure', '  ' || v_id1 || '  ');
  PERFORM pg_temp.t4334x_assert(public.places_pin_confirmed('trip:x:departure', v_id1)
    AND NOT public.places_pin_confirmed('trip:x:destination', v_id1)
    AND NOT public.places_pin_confirmed('trip:x:departure', 'ChIJ0Wq9hS_1OxARsFOw5qkW6Y')   -- prefix of id1
    AND NOT public.places_pin_confirmed('trip:x', v_id1),
    'S-4b a recorded pin matches only its exact key and exact id (no prefix match)');
  PERFORM set_config('mingla.place_pins_confirmed', '', true);
END $s4$;

-- ── S-5 grants and search_path ───────────────────────────────────────────────
SET LOCAL ROLE authenticated;
DO $s5a$
DECLARE
  v_denied int := 0;
BEGIN
  BEGIN PERFORM public.places_confirm_pin('trip:x:departure', 'ChIJ0Wq9hS_1OxARsFOw5qkW6Y0');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := v_denied + 1; END;
  BEGIN PERFORM public.places_confirm_trip_pins(gen_random_uuid(), '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := v_denied + 1; END;
  BEGIN PERFORM public.places_confirm_experience_pins(gen_random_uuid(), '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := v_denied + 1; END;
  PERFORM pg_temp.t4334x_assert(v_denied = 3, 'S-5a authenticated cannot call any assertion writer');
END $s5a$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $s5b$
DECLARE
  v_denied int := 0;
BEGIN
  BEGIN PERFORM public.biz_apply_trip_draft_graph_repick(gen_random_uuid(), '{}'::jsonb, now(), gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_denied := v_denied + 1; END;
  BEGIN PERFORM public.biz_update_trip_live_command_repick(gen_random_uuid(), '{}'::jsonb, 'reason text', now(), gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_denied := v_denied + 1; END;
  BEGIN PERFORM public.biz_update_live_experience_repick(gen_random_uuid(), '{}'::jsonb, 'reason text');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := v_denied + 1; END;
  BEGIN PERFORM public.biz_update_brand_pin(gen_random_uuid(), 1, 1, NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := v_denied + 1; END;
  PERFORM pg_temp.t4334x_assert(v_denied = 4, 'S-5b anon cannot call any of the four commands');
END $s5b$;
RESET ROLE;
DO $s5c$
BEGIN
  PERFORM pg_temp.t4334x_assert(NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('places_confirm_pin', 'places_pin_confirmed', 'places_confirm_trip_pins',
                         'places_confirm_experience_pins', 'tg_4334_events_place_stamp',
                         'tg_4334_experience_stops_place_stamp', 'biz_apply_trip_draft_graph_repick',
                         'biz_update_trip_live_command_repick', 'biz_update_live_experience_repick',
                         'biz_update_brand_pin')
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')),
    'S-5c every new or replaced function pins search_path');
  PERFORM pg_temp.t4334x_assert(
    (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('places_confirm_pin', 'places_pin_confirmed', 'places_confirm_trip_pins',
                       'places_confirm_experience_pins', 'biz_update_brand_pin')
       AND prosecdef) = 0,
    'S-5d the assertion helpers and the brand pin command are SECURITY INVOKER');
END $s5c$;

-- ── S-6 biz_update_brand_pin edges ───────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $s6a$
DECLARE
  v_refused boolean := false;
BEGIN
  BEGIN PERFORM public.biz_update_brand_pin((SELECT v FROM t4334x WHERE k = 'brand')::uuid, 1, 1, NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := SQLERRM = 'not_authenticated'; END;
  PERFORM pg_temp.t4334x_assert(v_refused, 'S-6a an authenticated caller with no uid is not_authenticated');
END $s6a$;
RESET ROLE;
SELECT pg_temp.t4334x_as('owner');
SET LOCAL ROLE authenticated;
DO $s6b$
DECLARE
  v_missing boolean := false;
BEGIN
  BEGIN PERFORM public.biz_update_brand_pin((SELECT v FROM t4334x WHERE k = 'gone')::uuid, 1, 1,
                                            (SELECT v FROM t4334x WHERE k = 'id1'));
  EXCEPTION WHEN no_data_found THEN v_missing := SQLERRM = 'brand_not_found'; END;
  PERFORM pg_temp.t4334x_assert(v_missing AND COALESCE(current_setting('mingla.place_id_confirmed', true), '') = '',
    'S-6b the owner''s soft-deleted brand is brand_not_found and leaves no place_id assertion');
END $s6b$;
RESET ROLE;

ROLLBACK;
