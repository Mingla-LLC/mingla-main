-- issue #3281 bundle 3 — Ari experience parity, TESTER adversarial suite.
--
-- Drives the real server through ari_execute_experience_operation, the way a
-- confirmed Ari proposal does (agent_pending_actions row, exact bound args).
-- No migration ships with bundle 3: these lock the server behaviour the Ari
-- tool changes rely on, and show why each change is needed.
--
--   C1  create_experience stops carry start_offset_minutes into the stops.
--   S1  draft manage_experience_stops with canonical args (stop_order by
--       position, offsets said) saves the offsets.
--   S2  draft: a stop sent WITHOUT start_offset_minutes loses its offset
--       (why canonicalizeExperienceStopsArgs refuses such a stop).
--   S3  live: a stop sent WITHOUT stop_order keeps its old offset and the new
--       one is dropped (why the canonicalizer numbers stops by position).
--   S4  live: canonical args save the new offsets.
--   P1  update_experience price options with their ids keep the stored
--       ticket_types ids; without ids every option is re-created.
--   P2  once an option has sold, dropping it or changing its price terms by id
--       is refused (price_change_with_sales); renaming it by id is not.
--
-- Every check RAISEs on failure. One transaction, ends in ROLLBACK.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.b3_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 bundle 3 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.b3_day()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char((now() AT TIME ZONE 'America/New_York')::date + 25, 'YYYY-MM-DD')
$$;

-- A user, a brand, and a draft (or scheduled) two-stop open-hours experience
-- with one option (free unless p_price; the brand cannot take payments, so a
-- live paid edit is refused). Offsets start at 0 and 30.
CREATE OR REPLACE FUNCTION pg_temp.b3_experience(p_tag text, p_live boolean, p_price integer DEFAULT 0)
RETURNS TABLE(o_user uuid, o_brand uuid, o_event uuid, o_tier uuid, o_date_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
  v_day text := pg_temp.b3_day();
  v_start timestamptz;
BEGIN
  o_user := gen_random_uuid();
  o_brand := gen_random_uuid();
  o_event := gen_random_uuid();
  o_tier := gen_random_uuid();
  v_start := (v_day || ' 10:00:00')::timestamp AT TIME ZONE 'America/New_York';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO auth.users(id, email)
    VALUES (o_user, 'b3-' || p_tag || '-' || o_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (o_brand, o_user, 'b3 ' || p_tag, 'b3-' || p_tag || '-' || o_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', o_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode,
    experience_intents, experience_intent, whole_price_cents, theme
  ) VALUES (
    o_event, o_brand, o_user, 'b3 walk', 'Two rooms, one walk.',
    'b3-' || o_event, 'experience', 'draft', 'draft', 'America/New_York', 'USD',
    'per_stop', 'whole', ARRAY['group-fun'], 'group-fun', p_price,
    jsonb_build_object('experience_meta', jsonb_build_object(
      'when_draft', jsonb_build_object(
        'whenMode', 'single',
        'when', jsonb_build_object('date', v_day, 'doorsOpen', '10:00', 'endsAt', '16:00'),
        'timezone', 'America/New_York')))
  );
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, v_start, v_start + interval '6 hours', 'America/New_York', true)
    RETURNING id INTO o_date_id;
  INSERT INTO public.experience_stops(
    event_id, stop_order, place_id, place_name, address, lat, lng, price_cents,
    start_offset_minutes
  ) VALUES
    (o_event, 0, 'place-one', 'First Room', '11 Secret Lane', 40.71, -73.95, 0, 0),
    (o_event, 1, 'place-two', 'Second Room', '22 Hidden Row', 40.72, -73.96, 0, 30);
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, display_order)
    VALUES (o_tier, o_event, 'Standard', p_price, 'USD', p_price = 0, 0);
  IF p_live THEN
    UPDATE public.events
       SET status = 'scheduled', visibility = 'public', published_at = now()
     WHERE id = o_event;
  END IF;
  RETURN NEXT;
END $$;

-- Runs one Ari operation exactly as a confirmed proposal does.
CREATE OR REPLACE FUNCTION pg_temp.b3_ari(
  p_user uuid, p_brand uuid, p_tool text, p_args jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_op uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  INSERT INTO public.agent_pending_actions(
    id, user_id, tool_name, tool_args, status, source, related_brand_id,
    server_proposed_at, execution_attested_at
  ) VALUES (v_op, p_user, p_tool, p_args, 'executing', 'hub_experience', p_brand, now(), now());
  v_result := public.ari_execute_experience_operation(
    v_op, p_tool, (SELECT tool_args FROM public.agent_pending_actions WHERE id = v_op));
  -- A live edit can answer {ok:false} without raising: never pass on that.
  IF v_result ? 'ok' AND NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'b3 soft refusal: %', v_result->>'reason';
  END IF;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.b3_revision(p_event uuid)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT updated_at FROM public.events WHERE id = p_event
$$;

CREATE OR REPLACE FUNCTION pg_temp.b3_offsets(p_event uuid)
RETURNS integer[] LANGUAGE sql STABLE AS $$
  SELECT array_agg(start_offset_minutes ORDER BY stop_order)
    FROM public.experience_stops WHERE event_id = p_event
$$;

CREATE OR REPLACE FUNCTION pg_temp.b3_stop(p_order int, p_name text, p_place text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'place_id', p_place, 'place_name', p_name, 'address', '11 Secret Lane',
    'lat', 40.71, 'lng', -73.95, 'price_cents', 0,
    'ai_description', 'A room on the walk.', 'image_urls', '[]'::jsonb)
$$;

-- ─── C1 create carries offsets ──────────────────────────────────────────────
DO $c1$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_result jsonb;
  v_event uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO auth.users(id, email) VALUES (v_user, 'b3-c1-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'b3 c1', 'b3-c1-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_result := pg_temp.b3_ari(v_user, v_brand, 'create_experience', jsonb_build_object(
    'brand_id', v_brand, 'title', 'Offset walk', 'narrative', 'Two rooms, one walk.',
    'is_free', true,
    'stops', jsonb_build_array(
      pg_temp.b3_stop(0, 'First Room', 'place-one') || '{"start_offset_minutes": 0}',
      pg_temp.b3_stop(1, 'Second Room', 'place-two') || '{"start_offset_minutes": 45}')));
  v_event := COALESCE(v_result->'event'->>'id', v_result->>'event_id')::uuid;
  PERFORM pg_temp.b3_assert(
    pg_temp.b3_offsets(v_event) = ARRAY[0, 45], 'C1 Ari create saves stop offsets [0, 45]');
END $c1$;

-- ─── S1 / S2 draft stop edits ───────────────────────────────────────────────
DO $s12$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_experience('s1', false);
  PERFORM pg_temp.b3_ari(f.o_user, f.o_brand, 'manage_experience_stops', jsonb_build_object(
    'event_id', f.o_event, 'expected_revision', pg_temp.b3_revision(f.o_event),
    'experience_intents', jsonb_build_array('group-fun'),
    'stops', jsonb_build_array(
      pg_temp.b3_stop(0, 'First Room', 'place-one') || '{"stop_order": 0, "start_offset_minutes": 0}',
      pg_temp.b3_stop(1, 'Second Room', 'place-two') || '{"stop_order": 1, "start_offset_minutes": 90}')));
  PERFORM pg_temp.b3_assert(
    pg_temp.b3_offsets(f.o_event) = ARRAY[0, 90], 'S1 draft canonical stop edit saves offsets [0, 90]');

  SELECT * INTO f FROM pg_temp.b3_experience('s2', false);
  PERFORM pg_temp.b3_ari(f.o_user, f.o_brand, 'manage_experience_stops', jsonb_build_object(
    'event_id', f.o_event, 'expected_revision', pg_temp.b3_revision(f.o_event),
    'experience_intents', jsonb_build_array('group-fun'),
    'stops', jsonb_build_array(
      pg_temp.b3_stop(0, 'First Room', 'place-one') || '{"stop_order": 0}',
      pg_temp.b3_stop(1, 'Renamed Room', 'place-two') || '{"stop_order": 1}')));
  PERFORM pg_temp.b3_assert(
    pg_temp.b3_offsets(f.o_event) = ARRAY[NULL, NULL]::integer[],
    'S2 draft stop edit that omits offsets loses them (the canonicalizer refuses such a stop)');
END $s12$;

-- ─── S3 / S4 live stop edits ────────────────────────────────────────────────
DO $s34$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_experience('s3', true);
  PERFORM pg_temp.b3_ari(f.o_user, f.o_brand, 'manage_experience_stops', jsonb_build_object(
    'event_id', f.o_event, 'expected_revision', pg_temp.b3_revision(f.o_event),
    'edit_reason', 'Host moved the second room later in the walk',
    'experience_intents', jsonb_build_array('group-fun'),
    'stops', jsonb_build_array(
      pg_temp.b3_stop(0, 'First Room', 'place-one') || '{"start_offset_minutes": 0}',
      pg_temp.b3_stop(1, 'Second Room', 'place-two') || '{"start_offset_minutes": 75}')));
  PERFORM pg_temp.b3_assert(
    pg_temp.b3_offsets(f.o_event) = ARRAY[0, 30],
    'S3 live stop edit without stop_order drops the new offset (the canonicalizer numbers stops)');

  SELECT * INTO f FROM pg_temp.b3_experience('s4', true);
  PERFORM pg_temp.b3_ari(f.o_user, f.o_brand, 'manage_experience_stops', jsonb_build_object(
    'event_id', f.o_event, 'expected_revision', pg_temp.b3_revision(f.o_event),
    'edit_reason', 'Host moved the second room later in the walk',
    'experience_intents', jsonb_build_array('group-fun'),
    'stops', jsonb_build_array(
      pg_temp.b3_stop(0, 'First Room', 'place-one') || '{"stop_order": 0, "start_offset_minutes": 0}',
      pg_temp.b3_stop(1, 'Second Room', 'place-two') || '{"stop_order": 1, "start_offset_minutes": 75}')));
  PERFORM pg_temp.b3_assert(
    pg_temp.b3_offsets(f.o_event) = ARRAY[0, 75], 'S4 live canonical stop edit saves offsets [0, 75]');
END $s34$;

-- ─── P1 option ids ──────────────────────────────────────────────────────────
DO $p1$
DECLARE
  f record;
  v_ids uuid[];
BEGIN
  SELECT * INTO f FROM pg_temp.b3_experience('p1', false, 2500);
  PERFORM pg_temp.b3_ari(f.o_user, f.o_brand, 'update_experience', jsonb_build_object(
    'event_id', f.o_event, 'expected_revision', pg_temp.b3_revision(f.o_event),
    'price_options', jsonb_build_array(
      jsonb_build_object('id', f.o_tier, 'name', 'Standard', 'price_cents', 3000,
        'price_basis', 'person'),
      jsonb_build_object('name', 'Pair', 'price_cents', 5000, 'price_basis', 'person'))));
  SELECT array_agg(id ORDER BY display_order) INTO v_ids
    FROM public.ticket_types WHERE event_id = f.o_event AND deleted_at IS NULL;
  PERFORM pg_temp.b3_assert(
    v_ids[1] = f.o_tier AND array_length(v_ids, 1) = 2,
    'P1 an option sent with its id keeps its ticket_types id; a new one is added');
  PERFORM pg_temp.b3_assert(
    (SELECT price_cents FROM public.ticket_types WHERE id = f.o_tier) = 3000,
    'P1 the kept option is re-priced in place (unsold)');

  SELECT * INTO f FROM pg_temp.b3_experience('p1b', false, 2500);
  PERFORM pg_temp.b3_ari(f.o_user, f.o_brand, 'update_experience', jsonb_build_object(
    'event_id', f.o_event, 'expected_revision', pg_temp.b3_revision(f.o_event),
    'price_options', jsonb_build_array(
      jsonb_build_object('name', 'Standard', 'price_cents', 2500, 'price_basis', 'person'))));
  PERFORM pg_temp.b3_assert(
    NOT EXISTS (SELECT 1 FROM public.ticket_types
                 WHERE id = f.o_tier AND deleted_at IS NULL),
    'P1 without its id the same option is deleted and re-created');
END $p1$;

-- ─── P2 sold options ────────────────────────────────────────────────────────
DO $p2$
DECLARE
  f record;
  v_order uuid := gen_random_uuid();
  v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.b3_experience('p2', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  -- One free sale on the option (the live-edit suite's order fixture).
  INSERT INTO public.orders(
    id, event_id, event_date_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    payment_method, payment_status, source
  ) VALUES (
    v_order, f.o_event, f.o_date_id, 'buyer@example.test', 'Guest', '+15550003281', 0,
    'free', 'paid', 'online_checkout'
  );
  INSERT INTO public.order_line_items(order_id, ticket_type_id, quantity, unit_price_cents)
    VALUES (v_order, f.o_tier, 1, 0);
  INSERT INTO public.tickets(
    id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status
  ) VALUES (
    gen_random_uuid(), v_order, f.o_tier, f.o_event,
    'mingla:v1:ticket:' || gen_random_uuid()::text,
    md5(gen_random_uuid()::text), 'valid', 'auto'
  );
  PERFORM set_config('request.jwt.claim.sub', f.o_user::text, true);

  BEGIN
    PERFORM pg_temp.b3_ari(f.o_user, f.o_brand, 'update_experience', jsonb_build_object(
      'event_id', f.o_event, 'expected_revision', pg_temp.b3_revision(f.o_event),
      'edit_reason', 'Host asked Ari to replace the ticket option',
      'price_options', jsonb_build_array(
        jsonb_build_object('name', 'Standard', 'price_cents', 0, 'price_basis', 'person'))));
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.b3_assert(
    v_err LIKE '%price_change_with_sales%', 'P2 a sold option left out is refused');

  v_err := NULL;
  BEGIN
    PERFORM pg_temp.b3_ari(f.o_user, f.o_brand, 'update_experience', jsonb_build_object(
      'event_id', f.o_event, 'expected_revision', pg_temp.b3_revision(f.o_event),
      'edit_reason', 'Host asked Ari to sell the option per group',
      'price_options', jsonb_build_array(
        jsonb_build_object('id', f.o_tier, 'name', 'Standard', 'price_cents', 0,
          'price_basis', 'group', 'group_max', 4))));
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.b3_assert(
    v_err LIKE '%price_change_with_sales%', 'P2 a sold option changed to a different price basis by id is refused');

  PERFORM pg_temp.b3_ari(f.o_user, f.o_brand, 'update_experience', jsonb_build_object(
    'event_id', f.o_event, 'expected_revision', pg_temp.b3_revision(f.o_event),
    'edit_reason', 'Host asked Ari to rename the ticket option',
    'price_options', jsonb_build_array(
      jsonb_build_object('id', f.o_tier, 'name', 'General admission', 'price_cents', 0,
        'price_basis', 'person'))));
  PERFORM pg_temp.b3_assert(
    (SELECT name FROM public.ticket_types WHERE id = f.o_tier AND deleted_at IS NULL)
      = 'General admission',
    'P2 a sold option renamed by id keeps its id and its sales');
END $p2$;

ROLLBACK;
