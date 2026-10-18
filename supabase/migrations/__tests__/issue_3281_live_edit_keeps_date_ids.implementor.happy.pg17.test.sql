-- issue #3281 Experience Round 1 PR 1c — IMPLEMENTOR happy suite.
--
-- DRAFT invariant I-PROPOSED-3281-LIVE-EDIT-KEEPS-DATE-IDS (registry frozen;
-- declared here beside the enforcing migration + tests):
--   A live edit never changes the id of an unchanged date; a held date is
--   never deleted. experience_stops.id is kept when stop_order matches.
--
-- WHAT THIS SUITE PROVES
--   T-01  title-only live edit with 2 paid orders + a scan keeps date id,
--         stop ids, orders.event_date_id, scan_events.event_date_id
--   T-02  Ari update_experience (title) with orders keeps orders.event_date_id
--   T-03  adding a date (unsold) keeps the prior date id
--   T-04  pg_topup_recurring_experiences body includes live, not published
--   T-05  notice still emitted exactly once on a material stop edit
--
-- FAILS-ON-REVERT: restore the 20271014103827 DELETE+reinsert body → T-01 and
-- T-02 go red (date / stop ids change; order anchors go NULL).
--
-- Every check RAISEs on failure. One transaction, ends in ROLLBACK.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3281c_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 1c FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3281c_day()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char((now() AT TIME ZONE 'America/New_York')::date + 25, 'YYYY-MM-DD')
$$;

CREATE OR REPLACE FUNCTION pg_temp.i3281c_experience(p_tag text)
RETURNS TABLE(
  o_user uuid, o_brand uuid, o_event uuid, o_tier uuid,
  o_date text, o_date_id uuid, o_stop0 uuid, o_stop1 uuid
)
LANGUAGE plpgsql AS $$
DECLARE
  v_start timestamptz;
BEGIN
  o_user := gen_random_uuid();
  o_brand := gen_random_uuid();
  o_event := gen_random_uuid();
  o_tier := gen_random_uuid();
  o_date := pg_temp.i3281c_day();
  v_start := (o_date || ' 18:00:00')::timestamp AT TIME ZONE 'America/New_York';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO auth.users(id, email)
    VALUES (o_user, 'i3281c-' || p_tag || '-' || o_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (o_brand, o_user, 'i3281c ' || p_tag, 'i3281c-' || p_tag || '-' || o_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', o_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode,
    experience_intents, experience_intent, whole_price_cents
  ) VALUES (
    o_event, o_brand, o_user, 'i3281c walk', 'Two rooms.',
    'i3281c-' || o_event, 'experience', 'draft', 'draft', 'America/New_York', 'USD',
    'per_stop', 'whole', ARRAY['group-fun'], 'group-fun', 0
  );
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, v_start, v_start + interval '3 hours', 'America/New_York', true)
    RETURNING id INTO o_date_id;
  INSERT INTO public.experience_stops(
    event_id, stop_order, place_id, place_name, address, lat, lng, start_time, price_cents
  ) VALUES
    (o_event, 0, 'place-one', 'First Room', '11 Secret Lane', 40.71, -73.95, '18:00', 0),
    (o_event, 1, 'place-two', 'Second Room', '22 Hidden Row', 40.72, -73.96, '19:30', 0);
  SELECT id INTO o_stop0 FROM public.experience_stops
   WHERE event_id = o_event AND stop_order = 0;
  SELECT id INTO o_stop1 FROM public.experience_stops
   WHERE event_id = o_event AND stop_order = 1;
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, is_free, display_order)
    VALUES (o_tier, o_event, 'Standard', 0, true, 0);
  UPDATE public.events
     SET status = 'scheduled',
         visibility = 'public',
         published_at = now(),
         theme = jsonb_build_object(
           'experience_meta', jsonb_build_object(
             'when_draft', jsonb_build_object(
               'whenMode', 'single',
               'when', jsonb_build_object(
                 'date', o_date, 'doorsOpen', '18:00', 'endsAt', '21:00'),
               'timezone', 'America/New_York')))
   WHERE id = o_event;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3281c_payload(
  p_date text,
  p_title text DEFAULT 'i3281c walk',
  p_desc text DEFAULT 'Two rooms.'
)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'title', p_title,
    'description', p_desc,
    'experience_intents', jsonb_build_array('group-fun'),
    'location_mode', 'per_stop',
    'pricing_mode', 'whole',
    'is_free', true,
    'timezone', 'America/New_York',
    'whenMode', 'single',
    'when', jsonb_build_object('date', p_date, 'doorsOpen', '18:00', 'endsAt', '21:00'),
    'stops', jsonb_build_array(
      jsonb_build_object(
        'stop_order', 0, 'place_id', 'place-one', 'place_name', 'First Room',
        'address', '11 Secret Lane', 'lat', 40.71, 'lng', -73.95, 'start_time', '18:00',
        'price_cents', 0),
      jsonb_build_object(
        'stop_order', 1, 'place_id', 'place-two', 'place_name', 'Second Room',
        'address', '22 Hidden Row', 'lat', 40.72, 'lng', -73.96, 'start_time', '19:30',
        'price_cents', 0)))
$$;

CREATE OR REPLACE FUNCTION pg_temp.i3281c_order(
  p_event uuid, p_tier uuid, p_date_id uuid, p_email text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_order uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders(
    id, event_id, event_date_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    payment_method, payment_status, source
  ) VALUES (
    v_order, p_event, p_date_id, p_email, 'Guest', '+15550003281', 0,
    'free', 'paid', 'online_checkout'
  );
  INSERT INTO public.order_line_items(order_id, ticket_type_id, quantity, unit_price_cents)
    VALUES (v_order, p_tier, 1, 0);
  INSERT INTO public.tickets(
    id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status
  ) VALUES (
    gen_random_uuid(), v_order, p_tier, p_event,
    'mingla:v1:ticket:' || gen_random_uuid()::text,
    md5(gen_random_uuid()::text), 'valid', 'auto'
  );
  RETURN v_order;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3281c_scan(
  p_event uuid, p_date_id uuid, p_tier uuid, p_scanner uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_order uuid;
  v_ticket uuid;
BEGIN
  v_order := pg_temp.i3281c_order(p_event, p_tier, p_date_id, 'scan@example.test');
  SELECT t.id INTO v_ticket FROM public.tickets t WHERE t.order_id = v_order LIMIT 1;
  INSERT INTO public.scan_events(
    ticket_id, event_id, scanner_user_id, scan_result, client_offline, event_date_id
  ) VALUES (v_ticket, p_event, p_scanner, 'success', false, p_date_id);
END $$;

-- ─── T-01 ───────────────────────────────────────────────────────────────────
DO $t01$
DECLARE
  f record;
  v_result jsonb;
  v_date_id uuid;
  v_stop0 uuid;
  v_stop1 uuid;
  v_anchored int;
  v_scans int;
  v_scanner uuid := gen_random_uuid();
BEGIN
  SELECT * INTO f FROM pg_temp.i3281c_experience('t01');
  PERFORM pg_temp.i3281c_order(f.o_event, f.o_tier, f.o_date_id, 'a@example.test');
  PERFORM pg_temp.i3281c_order(f.o_event, f.o_tier, f.o_date_id, 'b@example.test');
  INSERT INTO auth.users(id) VALUES (v_scanner);
  PERFORM pg_temp.i3281c_scan(f.o_event, f.o_date_id, f.o_tier, v_scanner);

  v_result := public.biz_update_live_experience(
    f.o_event,
    pg_temp.i3281c_payload(f.o_date, 'i3281c walk (renamed)', 'Two rooms.'),
    'Renaming the walk for guests who already booked'
  );
  PERFORM pg_temp.i3281c_assert(
    COALESCE((v_result->>'ok')::boolean, false),
    'T-01 live edit with sales is accepted for a title-only change');

  SELECT id INTO v_date_id FROM public.event_dates WHERE event_id = f.o_event;
  SELECT id INTO v_stop0 FROM public.experience_stops
   WHERE event_id = f.o_event AND stop_order = 0;
  SELECT id INTO v_stop1 FROM public.experience_stops
   WHERE event_id = f.o_event AND stop_order = 1;
  SELECT count(*) INTO v_anchored FROM public.orders
   WHERE event_id = f.o_event AND event_date_id = f.o_date_id;
  SELECT count(*) INTO v_scans FROM public.scan_events
   WHERE event_id = f.o_event AND event_date_id = f.o_date_id;

  PERFORM pg_temp.i3281c_assert(v_date_id = f.o_date_id, 'T-01 date id unchanged');
  PERFORM pg_temp.i3281c_assert(v_stop0 = f.o_stop0 AND v_stop1 = f.o_stop1, 'T-01 stop ids unchanged');
  PERFORM pg_temp.i3281c_assert(v_anchored = 3, 'T-01 all order anchors survive (2 buyers + scan order)');
  PERFORM pg_temp.i3281c_assert(v_scans = 1, 'T-01 scan day anchor survives');
END;
$t01$;

-- ─── T-02 Ari live edit keeps order date id ─────────────────────────────────
DO $t02$
DECLARE
  f record;
  v_op uuid := gen_random_uuid();
  v_anchored int;
  v_date_id uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i3281c_experience('t02');
  PERFORM pg_temp.i3281c_order(f.o_event, f.o_tier, f.o_date_id, 'ari@example.test');

  INSERT INTO public.agent_pending_actions(
    id, user_id, tool_name, tool_args, status, source, related_brand_id,
    server_proposed_at, execution_attested_at
  ) VALUES (
    v_op, f.o_user, 'update_experience',
    jsonb_build_object(
      'event_id', f.o_event,
      'expected_revision', (SELECT updated_at FROM public.events WHERE id = f.o_event),
      'title', 'Ari renamed walk',
      'edit_reason', 'Host asked Ari to rename the published walk'
    ),
    'executing', 'hub_experience', f.o_brand, now(), now()
  );

  PERFORM public.ari_execute_experience_operation(
    v_op, 'update_experience',
    (SELECT tool_args FROM public.agent_pending_actions WHERE id = v_op)
  );

  SELECT id INTO v_date_id FROM public.event_dates WHERE event_id = f.o_event;
  SELECT count(*) INTO v_anchored FROM public.orders
   WHERE event_id = f.o_event AND event_date_id = f.o_date_id;

  PERFORM pg_temp.i3281c_assert(v_date_id = f.o_date_id, 'T-02 Ari edit keeps date id');
  PERFORM pg_temp.i3281c_assert(v_anchored = 1, 'T-02 Ari edit keeps orders.event_date_id');
  PERFORM pg_temp.i3281c_assert(
    (SELECT title FROM public.events WHERE id = f.o_event) = 'Ari renamed walk',
    'T-02 Ari title patch applied');
END;
$t02$;

-- ─── T-03 add a date unsold keeps prior id ──────────────────────────────────
DO $t03$
DECLARE
  f record;
  v_result jsonb;
  v_kept boolean;
  v_count int;
  v_day2 text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3281c_experience('t03');
  v_day2 := to_char((f.o_date::date + 1), 'YYYY-MM-DD');

  v_result := public.biz_update_live_experience(
    f.o_event,
    jsonb_build_object(
      'title', 'i3281c walk',
      'description', 'Two rooms.',
      'experience_intents', jsonb_build_array('group-fun'),
      'location_mode', 'per_stop',
      'pricing_mode', 'whole',
      'is_free', true,
      'timezone', 'America/New_York',
      'whenMode', 'multi_date',
      'multiDates', jsonb_build_array(
        jsonb_build_object('date', f.o_date, 'startTime', '18:00', 'endTime', '21:00'),
        jsonb_build_object('date', v_day2, 'startTime', '18:00', 'endTime', '21:00')
      ),
      'stops', (pg_temp.i3281c_payload(f.o_date)->'stops')
    ),
    'Adding a second day while nobody has booked yet'
  );
  PERFORM pg_temp.i3281c_assert(
    COALESCE((v_result->>'ok')::boolean, false),
    'T-03 multi_date add accepted when unsold');

  SELECT EXISTS (
    SELECT 1 FROM public.event_dates WHERE id = f.o_date_id
  ) INTO v_kept;
  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = f.o_event;
  PERFORM pg_temp.i3281c_assert(v_kept, 'T-03 prior date id survives the add');
  PERFORM pg_temp.i3281c_assert(v_count = 2, 'T-03 exactly two dates after add');
END;
$t03$;

-- ─── T-04 top-up status filter (source contract) ────────────────────────────
DO $t04$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef('public.pg_topup_recurring_experiences(integer)'::regprocedure)
    INTO v_src;
  PERFORM pg_temp.i3281c_assert(
    position(CHR(39) || 'live' || CHR(39) IN v_src) > 0
    AND position(CHR(39) || 'published' || CHR(39) IN v_src) = 0,
    'T-04 top-up filters scheduled|live (not published)');
END;
$t04$;

-- ─── T-05 notice once on material stop edit ─────────────────────────────────
DO $t05$
DECLARE
  f record;
  v_result jsonb;
  v_notices int;
BEGIN
  SELECT * INTO f FROM pg_temp.i3281c_experience('t05');
  v_result := public.biz_update_live_experience(
    f.o_event,
    jsonb_build_object(
      'title', 'i3281c walk',
      'description', 'Two rooms.',
      'experience_intents', jsonb_build_array('group-fun'),
      'location_mode', 'per_stop',
      'pricing_mode', 'whole',
      'is_free', true,
      'timezone', 'America/New_York',
      'whenMode', 'single',
      'when', jsonb_build_object('date', f.o_date, 'doorsOpen', '18:00', 'endsAt', '21:00'),
      'stops', jsonb_build_array(
        jsonb_build_object(
          'stop_order', 0, 'place_id', 'place-one', 'place_name', 'First Room',
          'address', '11 Secret Lane', 'lat', 40.71, 'lng', -73.95, 'start_time', '18:00',
          'price_cents', 0),
        jsonb_build_object(
          'stop_order', 1, 'place_id', 'place-two', 'place_name', 'Second Room',
          'address', '99 Veiled Yard', 'lat', 40.72, 'lng', -73.96, 'start_time', '20:00',
          'price_cents', 0))
    ),
    'Moving the second stop later in the evening for clarity'
  );
  PERFORM pg_temp.i3281c_assert(
    COALESCE((v_result->>'ok')::boolean, false),
    'T-05 material stop edit accepted');
  PERFORM pg_temp.i3281c_assert(
    v_result ? 'buyer_notice',
    'T-05 buyer_notice key present (#3827 hunk kept)');
  SELECT count(*) INTO v_notices FROM public.event_edit_notices WHERE event_id = f.o_event;
  PERFORM pg_temp.i3281c_assert(v_notices = 1, 'T-05 exactly one edit notice');
END;
$t05$;

ROLLBACK;
