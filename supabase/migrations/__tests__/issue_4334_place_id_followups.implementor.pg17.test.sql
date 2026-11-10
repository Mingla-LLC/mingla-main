-- #4334 follow-ups (20280526004334) — the same place re-picked onto refined
-- coordinates keeps its Google place id on the brand profile pin, trip pins
-- and experience stops; a pin moved with no id still clears; an assertion
-- never reaches another pin or row.
--
-- MINGLA-INVARIANT: I-4334-PIN-ASSERTION-IS-KEYED | issue #4334 | A trip pin or experience stop keeps its place id across a coordinate move only when the writer asserted that id for that one pin of that one row in the same command (biz_*_repick); any other move clears it, and the assertion is gone when the command returns.
--
--   B-1 brand: biz_update_brand_pin with the same id onto refined coordinates keeps the id
--   B-2 brand: a moved pin with no id stores NULL; a cleared pin stores no id
--   B-3 brand: a direct table move (installed apps) still clears; the RPC runs under
--       the caller's RLS (a stranger gets brand_not_found) and anon cannot run it
--   B-4 brand: an invalid id is refused (location_place_id_invalid), nothing written
--   T-1 trip draft: _repick with the same id onto refined coordinates keeps both pins' ids
--   T-2 trip draft: the plain command (installed apps) still clears on that move
--   T-3 trip draft: _repick moving a pin with NO id sent clears it, while the other
--       pin (asserted) keeps its id
--   T-4 trip live: _repick with the same departure id onto refined coordinates keeps it
--   X-1 experience live: _repick with the same stop ids onto refined coordinates keeps them
--   X-2 experience live: the plain owner (installed apps) still clears on that move
--   X-3 single-location mode asserts stop 0's place for every stop
--   K-1 an assertion for one trip/stop never keeps another row's or pin's id, and the
--       record is empty after every _repick command returns
--
-- Fails-on-revert: restore the 20280525004334 tg_4334_events_place_stamp and the
-- 20280521004334 tg_4334_experience_stops_place_stamp → T-1, T-3 (kept half),
-- T-4, X-1 and X-3 red; drop biz_update_brand_pin → B-1..B-4 red.
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t4334f_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4334 follow-ups FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE TEMP TABLE t4334f (k text PRIMARY KEY, v text);
GRANT SELECT ON t4334f TO authenticated, anon;

-- ── fixtures ─────────────────────────────────────────────────────────────────
DO $fx$
DECLARE
  v_owner uuid := '43342600-0000-4000-8400-000000000001';
  v_stranger uuid := '43342600-0000-4000-8400-000000000002';
  v_brand uuid := '43342600-0000-4000-8400-000000000011';
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'followups-4334@example.test'), (v_stranger, 'stranger-4334@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'followups-4334@example.test'), (v_stranger, 'stranger-4334@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, paystack_subaccount_code,
                            lat, lng, location_provider_place_id)
    VALUES (v_brand, v_owner, 'Followups 4334', 'followups-4334', 'GBP', 'ACCT_followups4334',
            6.4300, 3.4200, 'ChIJ0Wq9hS_1OxARsFOw5qkW6Y0');
  INSERT INTO t4334f VALUES ('owner', v_owner), ('stranger', v_stranger), ('brand', v_brand),
    ('id1', 'ChIJ0Wq9hS_1OxARsFOw5qkW6Y0'), ('id2', 'ChIJ8bF1g3T1OxAR5Yx0Qn5pLk8'),
    ('id3', 'ChIJ3cX1a9T1OxARzz0Qn5pLk81');
END $fx$;

-- ── B: the brand profile pin (as the real authenticated role, RLS on) ───────
SELECT set_config('request.jwt.claim.sub', (SELECT v FROM t4334f WHERE k = 'owner'), true);
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT v FROM t4334f WHERE k = 'owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $b$
DECLARE
  v_brand uuid := (SELECT v FROM t4334f WHERE k = 'brand');
  v_id1 text := (SELECT v FROM t4334f WHERE k = 'id1');
  v_row jsonb;
  v_failed boolean := false;
BEGIN
  -- B-1 same place, refined coordinates
  v_row := public.biz_update_brand_pin(v_brand, 6.43251, 3.42361, v_id1);
  PERFORM pg_temp.t4334f_assert(
    v_row ->> 'location_provider_place_id' = v_id1 AND (v_row ->> 'lat')::double precision = 6.43251
    AND v_row ->> 'location_geo_refresh_state' = 'ok',
    'B-1 brand: the same id onto refined coordinates keeps the id and stamps the pin');

  -- B-2 a moved pin with no id, then a cleared pin
  v_row := public.biz_update_brand_pin(v_brand, 6.5000, 3.5000, NULL);
  PERFORM pg_temp.t4334f_assert(v_row -> 'location_provider_place_id' = 'null'::jsonb,
    'B-2a brand: a pin moved with no id stores NULL');
  v_row := public.biz_update_brand_pin(v_brand, 6.5100, 3.5100, v_id1);
  v_row := public.biz_update_brand_pin(v_brand, NULL, NULL, v_id1);
  PERFORM pg_temp.t4334f_assert(v_row -> 'location_provider_place_id' = 'null'::jsonb AND v_row -> 'lat' = 'null'::jsonb,
    'B-2b brand: a cleared pin stores no id');

  -- B-4 an invalid id is refused and nothing is written
  v_row := public.biz_update_brand_pin(v_brand, 6.5200, 3.5200, v_id1);
  BEGIN
    PERFORM public.biz_update_brand_pin(v_brand, 6.6000, 3.6000, 'not a place id');
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := SQLERRM = 'location_place_id_invalid';
  END;
  PERFORM pg_temp.t4334f_assert(v_failed
    AND (SELECT lat FROM public.brands WHERE id = v_brand) = 6.5200
    AND (SELECT location_provider_place_id FROM public.brands WHERE id = v_brand) = v_id1,
    'B-4 brand: an invalid id is refused and the pin is untouched');

  -- B-3a a direct table move (what installed apps send) still clears
  UPDATE public.brands SET lat = 6.52001, lng = 3.52001 WHERE id = v_brand;
  PERFORM pg_temp.t4334f_assert((SELECT location_provider_place_id FROM public.brands WHERE id = v_brand) IS NULL,
    'B-3a brand: a direct table move with no assertion still clears the id');
END $b$;

-- B-3b a stranger: the brands UPDATE policies apply (SECURITY INVOKER)
SELECT set_config('request.jwt.claim.sub', (SELECT v FROM t4334f WHERE k = 'stranger'), true);
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT v FROM t4334f WHERE k = 'stranger'), 'role', 'authenticated')::text, true);
DO $b3$
DECLARE
  v_failed boolean := false;
BEGIN
  BEGIN
    PERFORM public.biz_update_brand_pin((SELECT v FROM t4334f WHERE k = 'brand')::uuid, 1, 1,
                                        (SELECT v FROM t4334f WHERE k = 'id1'));
  EXCEPTION WHEN no_data_found THEN v_failed := SQLERRM = 'brand_not_found';
  END;
  PERFORM pg_temp.t4334f_assert(v_failed, 'B-3b brand: a non-member cannot move the pin (brand_not_found)');
END $b3$;
RESET ROLE;
DO $b3c$
BEGIN
  PERFORM pg_temp.t4334f_assert(
    NOT has_function_privilege('anon', 'public.biz_update_brand_pin(uuid,double precision,double precision,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.biz_update_brand_pin(uuid,double precision,double precision,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.biz_apply_trip_draft_graph_repick(uuid,jsonb,timestamp with time zone,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.biz_update_trip_live_command_repick(uuid,jsonb,text,timestamp with time zone,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.biz_update_live_experience_repick(uuid,jsonb,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.places_confirm_pin(text,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.places_confirm_trip_pins(uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.places_confirm_experience_pins(uuid,jsonb)', 'EXECUTE')
    AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.biz_update_brand_pin(uuid,double precision,double precision,text)'::regprocedure) = false
    AND (SELECT bool_and(prosecdef) FROM pg_proc WHERE proname IN ('biz_apply_trip_draft_graph_repick',
         'biz_update_trip_live_command_repick', 'biz_update_live_experience_repick')),
    'B-3c grants: no anon EXECUTE; the assertion writers are not callable by authenticated');
END $b3c$;

-- ── T: trip pins ─────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', (SELECT v FROM t4334f WHERE k = 'owner'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT v FROM t4334f WHERE k = 'owner'), 'role', 'authenticated')::text, true);

CREATE OR REPLACE FUNCTION pg_temp.t4334f_trip(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  g jsonb;
  v_event uuid;
BEGIN
  g := public.biz_create_trip_draft((SELECT v FROM t4334f WHERE k = 'brand')::uuid,
         jsonb_build_object('title', 'Trip ' || p_tag, 'timezone', 'Africa/Lagos'), gen_random_uuid());
  v_event := (g #>> '{event,id}')::uuid;
  PERFORM public.biz_apply_trip_draft_graph(v_event,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'departurePlaceId', (SELECT v FROM t4334f WHERE k = 'id1'), 'departureLat', 6.43, 'departureLng', 3.42,
      'destinationPlaceId', (SELECT v FROM t4334f WHERE k = 'id2'), 'destinationLat', 9.07, 'destinationLng', 7.49))),
    (SELECT updated_at FROM public.events WHERE id = v_event), gen_random_uuid());
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.t4334f_bt(p_event uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT theme -> 'business_trip' FROM public.events WHERE id = p_event
$$;

DO $t$
DECLARE
  v_id1 text := (SELECT v FROM t4334f WHERE k = 'id1');
  v_id2 text := (SELECT v FROM t4334f WHERE k = 'id2');
  v_a uuid;
  v_b uuid;
  v_bt jsonb;
BEGIN
  v_a := pg_temp.t4334f_trip('a');
  v_bt := pg_temp.t4334f_bt(v_a);
  PERFORM pg_temp.t4334f_assert(v_bt ->> 'departurePlaceId' = v_id1 AND v_bt ->> 'destinationPlaceId' = v_id2,
    'T-0 fixture: the first pick stores both ids');

  -- T-1 the same ids onto refined coordinates, through _repick
  PERFORM public.biz_apply_trip_draft_graph_repick(v_a,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'departurePlaceId', v_id1, 'departureLat', 6.43251, 'departureLng', 3.42361,
      'destinationPlaceId', v_id2, 'destinationLat', 9.07651, 'destinationLng', 7.49881))),
    (SELECT updated_at FROM public.events WHERE id = v_a), gen_random_uuid());
  v_bt := pg_temp.t4334f_bt(v_a);
  PERFORM pg_temp.t4334f_assert(v_bt ->> 'departurePlaceId' = v_id1 AND v_bt ->> 'destinationPlaceId' = v_id2
    AND (v_bt ->> 'departureLat')::numeric = 6.43251 AND v_bt ->> 'departureGeoRefreshState' = 'ok'
    AND v_bt ->> 'destinationGeoRefreshState' = 'ok',
    'T-1 trip draft: the same ids onto refined coordinates keep both pins'' ids');
  PERFORM pg_temp.t4334f_assert(COALESCE(current_setting('mingla.place_pins_confirmed', true), '') = '',
    'K-1a the record is empty after biz_apply_trip_draft_graph_repick returns');

  -- T-2 the plain command (installed apps) still clears on a move
  PERFORM public.biz_apply_trip_draft_graph(v_a,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'departurePlaceId', v_id1, 'departureLat', 6.43252, 'departureLng', 3.42362))),
    (SELECT updated_at FROM public.events WHERE id = v_a), gen_random_uuid());
  PERFORM pg_temp.t4334f_assert(pg_temp.t4334f_bt(v_a) -> 'departurePlaceId' = 'null'::jsonb,
    'T-2 trip draft: the plain command still clears a moved pin''s id');

  -- T-3 _repick: departure moves with NO id in the patch (stale stored id);
  -- destination re-sent with its id onto refined coordinates.
  PERFORM public.biz_apply_trip_draft_graph_repick(v_a,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'departurePlaceId', v_id1, 'departureLat', 6.43, 'departureLng', 3.42))),
    (SELECT updated_at FROM public.events WHERE id = v_a), gen_random_uuid());   -- re-pick restores the id
  PERFORM public.biz_apply_trip_draft_graph_repick(v_a,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'departureLat', 51.50, 'departureLng', -0.12,
      'destinationPlaceId', v_id2, 'destinationLat', 9.07652, 'destinationLng', 7.49882))),
    (SELECT updated_at FROM public.events WHERE id = v_a), gen_random_uuid());
  v_bt := pg_temp.t4334f_bt(v_a);
  PERFORM pg_temp.t4334f_assert(v_bt -> 'departurePlaceId' = 'null'::jsonb AND v_bt ->> 'destinationPlaceId' = v_id2,
    'T-3 trip draft: a pin moved with no id sent clears; the asserted pin keeps its id');

  -- K-1b an assertion for trip A (and for its departure) never keeps trip B's
  -- or another pin's id.
  v_b := pg_temp.t4334f_trip('b');
  PERFORM set_config('mingla.place_pins_confirmed',
    ' trip:' || v_a || ':departure=' || v_id1 || '  trip:' || v_b || ':departure=' || v_id2 || ' ', true);
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_trip}', (theme -> 'business_trip')
           || jsonb_build_object('departureLat', 6.44, 'destinationLat', 9.08))
   WHERE id = v_b;
  PERFORM set_config('mingla.place_pins_confirmed', '', true);
  v_bt := pg_temp.t4334f_bt(v_b);
  PERFORM pg_temp.t4334f_assert(v_bt -> 'departurePlaceId' = 'null'::jsonb AND v_bt -> 'destinationPlaceId' = 'null'::jsonb,
    'K-1b an assertion for another trip, or for a different id on this pin, keeps nothing');

  -- T-4 live: departure refined with its id, through the live _repick command
  PERFORM public.biz_apply_trip_draft_graph(v_b,
    jsonb_build_object('event_dates', jsonb_build_array(jsonb_build_object(
      'start_at', (now() + interval '60 days')::text, 'end_at', (now() + interval '67 days')::text,
      'is_master', true))),
    (SELECT updated_at FROM public.events WHERE id = v_b), gen_random_uuid());
  UPDATE public.events SET status = 'scheduled', published_at = now() WHERE id = v_b;
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_trip}', (theme -> 'business_trip')
           || jsonb_build_object('departurePlaceId', v_id1, 'departureLat', 6.43, 'departureLng', 3.42))
   WHERE id = v_b;
  PERFORM pg_temp.t4334f_assert(pg_temp.t4334f_bt(v_b) ->> 'departurePlaceId' = v_id1, 'T-4 fixture: live trip pin set');
  INSERT INTO t4334f VALUES ('trip_live', v_b);
END $t$;

DO $t4$
DECLARE
  v_b uuid := (SELECT v FROM t4334f WHERE k = 'trip_live');
  v_id1 text := (SELECT v FROM t4334f WHERE k = 'id1');
  v_result jsonb;
  v_bt jsonb;
BEGIN
  v_result := public.biz_update_trip_live_command_repick(v_b,
    jsonb_build_object('theme', jsonb_build_object('business_trip', jsonb_build_object(
      'departurePlaceId', v_id1, 'departureLat', 6.43251, 'departureLng', 3.42361))),
    'Refined the departure pin onto the same place',
    (SELECT updated_at FROM public.events WHERE id = v_b), gen_random_uuid());
  v_bt := pg_temp.t4334f_bt(v_b);
  PERFORM pg_temp.t4334f_assert(COALESCE((v_result ->> 'ok')::boolean, false)
    AND v_bt ->> 'departurePlaceId' = v_id1 AND (v_bt ->> 'departureLat')::numeric = 6.43251,
    'T-4 trip live: the same departure id onto refined coordinates keeps the id');
  PERFORM pg_temp.t4334f_assert(COALESCE(current_setting('mingla.place_pins_confirmed', true), '') = '',
    'K-1c the record is empty after biz_update_trip_live_command_repick returns');
END $t4$;

-- ── X: experience stops ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.t4334f_day() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char((now() AT TIME ZONE 'America/New_York')::date + 25, 'YYYY-MM-DD')
$$;

CREATE OR REPLACE FUNCTION pg_temp.t4334f_experience(p_mode text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_event uuid := gen_random_uuid();
  v_start timestamptz := (pg_temp.t4334f_day() || ' 18:00:00')::timestamp AT TIME ZONE 'America/New_York';
BEGIN
  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode,
    experience_intents, experience_intent, whole_price_cents
  ) VALUES (
    v_event, (SELECT v FROM t4334f WHERE k = 'brand')::uuid, (SELECT v FROM t4334f WHERE k = 'owner')::uuid,
    'Walk 4334', 'Two rooms.', 'walk-4334-' || v_event, 'experience', 'draft', 'draft',
    'America/New_York', 'USD', p_mode, 'whole', ARRAY['group-fun'], 'group-fun', 0);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, v_start, v_start + interval '3 hours', 'America/New_York', true);
  INSERT INTO public.experience_stops(event_id, stop_order, place_id, place_name, address, lat, lng, start_time, price_cents)
    VALUES
    (v_event, 0, (SELECT v FROM t4334f WHERE k = 'id1'), 'First Room', '11 Secret Lane', 40.71, -73.95, '18:00', 0),
    (v_event, 1, (SELECT v FROM t4334f WHERE k = CASE WHEN p_mode = 'single' THEN 'id1' ELSE 'id2' END),
     'Second Room', '22 Hidden Row', CASE WHEN p_mode = 'single' THEN 40.71 ELSE 40.72 END,
     CASE WHEN p_mode = 'single' THEN -73.95 ELSE -73.96 END, '19:30', 0);
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, display_order)
    VALUES (v_event, 'Standard', 0, true, 0);
  UPDATE public.events
     SET status = 'scheduled', visibility = 'public', published_at = now(),
         theme = jsonb_build_object('experience_meta', jsonb_build_object('when_draft', jsonb_build_object(
           'whenMode', 'single',
           'when', jsonb_build_object('date', pg_temp.t4334f_day(), 'doorsOpen', '18:00', 'endsAt', '21:00'),
           'timezone', 'America/New_York')))
   WHERE id = v_event;
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.t4334f_payload(p_mode text, p_s0 jsonb, p_s1 jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'title', 'Walk 4334', 'description', 'Two rooms.',
    'experience_intents', jsonb_build_array('group-fun'),
    'location_mode', p_mode, 'pricing_mode', 'whole', 'is_free', true,
    'timezone', 'America/New_York', 'whenMode', 'single',
    'when', jsonb_build_object('date', pg_temp.t4334f_day(), 'doorsOpen', '18:00', 'endsAt', '21:00'),
    'stops', jsonb_build_array(
      jsonb_build_object('stop_order', 0, 'place_name', 'First Room', 'address', '11 Secret Lane',
                         'start_time', '18:00', 'price_cents', 0) || p_s0,
      jsonb_build_object('stop_order', 1, 'place_name', 'Second Room', 'address', '22 Hidden Row',
                         'start_time', '19:30', 'price_cents', 0) || p_s1))
$$;

CREATE OR REPLACE FUNCTION pg_temp.t4334f_stop(p_event uuid, p_order int) RETURNS record LANGUAGE sql STABLE AS $$
  SELECT place_id, lat, geo_refresh_state FROM public.experience_stops WHERE event_id = p_event AND stop_order = p_order
$$;

DO $x$
DECLARE
  v_id1 text := (SELECT v FROM t4334f WHERE k = 'id1');
  v_id2 text := (SELECT v FROM t4334f WHERE k = 'id2');
  v_e uuid;
  v_result jsonb;
  v_s0 record;
  v_s1 record;
BEGIN
  -- X-1 per-stop: both stops re-sent with their ids onto refined coordinates
  v_e := pg_temp.t4334f_experience('per_stop');
  v_result := public.biz_update_live_experience_repick(v_e, pg_temp.t4334f_payload('per_stop',
      jsonb_build_object('place_id', v_id1, 'lat', 40.71001, 'lng', -73.95001),
      jsonb_build_object('place_id', v_id2, 'lat', 40.72001, 'lng', -73.96001)),
    'Refined both stop pins onto the same places');
  SELECT * INTO v_s0 FROM public.experience_stops WHERE event_id = v_e AND stop_order = 0;
  SELECT * INTO v_s1 FROM public.experience_stops WHERE event_id = v_e AND stop_order = 1;
  PERFORM pg_temp.t4334f_assert(COALESCE((v_result ->> 'ok')::boolean, false)
    AND v_s0.place_id = v_id1 AND v_s0.lat = 40.71001 AND v_s0.geo_refresh_state = 'ok'
    AND v_s1.place_id = v_id2 AND v_s1.lat = 40.72001,
    'X-1 experience live: the same stop ids onto refined coordinates keep them');
  PERFORM pg_temp.t4334f_assert(COALESCE(current_setting('mingla.place_pins_confirmed', true), '') = '',
    'K-1d the record is empty after biz_update_live_experience_repick returns');

  -- X-2 the plain owner (installed apps) still clears on a move
  v_result := public.biz_update_live_experience(v_e, pg_temp.t4334f_payload('per_stop',
      jsonb_build_object('place_id', v_id1, 'lat', 40.71002, 'lng', -73.95002),
      jsonb_build_object('place_id', v_id2, 'lat', 40.72001, 'lng', -73.96001)),
    'Refined the first stop through the old command');
  SELECT * INTO v_s0 FROM public.experience_stops WHERE event_id = v_e AND stop_order = 0;
  SELECT * INTO v_s1 FROM public.experience_stops WHERE event_id = v_e AND stop_order = 1;
  PERFORM pg_temp.t4334f_assert(v_s0.place_id IS NULL AND v_s1.place_id = v_id2,
    'X-2 experience live: the plain owner still clears a moved stop''s id (an unmoved stop keeps it)');

  -- K-1f an assertion for stop 0 never keeps stop 1's id
  PERFORM set_config('mingla.place_pins_confirmed', ' stop:' || v_e || ':0=' || v_id2 || ' ', true);
  UPDATE public.experience_stops SET lat = 40.73 WHERE event_id = v_e AND stop_order = 1;
  PERFORM set_config('mingla.place_pins_confirmed', '', true);
  PERFORM pg_temp.t4334f_assert(
    (SELECT place_id FROM public.experience_stops WHERE event_id = v_e AND stop_order = 1) IS NULL,
    'K-1f an assertion for another stop keeps nothing');

  -- X-3 single-location mode: every stop takes stop 0's place
  v_e := pg_temp.t4334f_experience('single');
  v_result := public.biz_update_live_experience_repick(v_e, pg_temp.t4334f_payload('single',
      jsonb_build_object('place_id', v_id1, 'lat', 40.71003, 'lng', -73.95003),
      jsonb_build_object('place_id', v_id2, 'lat', 40.9, 'lng', -73.9)),
    'Refined the shared address onto the same place');
  SELECT * INTO v_s0 FROM public.experience_stops WHERE event_id = v_e AND stop_order = 0;
  SELECT * INTO v_s1 FROM public.experience_stops WHERE event_id = v_e AND stop_order = 1;
  PERFORM pg_temp.t4334f_assert(COALESCE((v_result ->> 'ok')::boolean, false)
    AND v_s0.place_id = v_id1 AND v_s1.place_id = v_id1 AND v_s1.lat = 40.71003,
    'X-3 single-location: the shared place keeps its id on every stop');
END $x$;

ROLLBACK;
