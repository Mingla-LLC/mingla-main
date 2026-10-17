-- issue #3281 Experience Round 1 PR 1c — TESTER adversarial suite (independent).
--
-- Proves the refund-gate and hold refusal still bite after reconcile-in-place,
-- and that stop reorder keeps ids while a sold stop removal is refused.
--
--   A-01  shift a date with sales → dates_shifted_with_sales; ids untouched
--   A-02  remove a stop with sales → stop_removed_with_sales; stop ids untouched
--   A-03  reorder stops (unsold) keeps ids by stop_order identity (order 0/1 swap
--         of place names updates in place — ids follow stop_order)
--   A-04  held date cannot be deleted even when unsold (scan hold)
--   A-05  wholesale DELETE strings are absent from the live-edit body (revert pin)
--
-- FAILS-ON-REVERT: reintroduce DELETE FROM event_dates WHERE event_id = … → A-05
-- goes red; A-01/A-04 may also fail if delete cascades/nulls anchors.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.a3281c_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 1c ADV FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.a3281c_day()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char((now() AT TIME ZONE 'America/New_York')::date + 30, 'YYYY-MM-DD')
$$;

CREATE OR REPLACE FUNCTION pg_temp.a3281c_experience(p_tag text)
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
  o_date := pg_temp.a3281c_day();
  v_start := (o_date || ' 18:00:00')::timestamp AT TIME ZONE 'America/New_York';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO auth.users(id, email)
    VALUES (o_user, 'a3281c-' || p_tag || '-' || o_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (o_brand, o_user, 'a3281c ' || p_tag, 'a3281c-' || p_tag || '-' || o_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', o_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode,
    experience_intents, experience_intent, whole_price_cents
  ) VALUES (
    o_event, o_brand, o_user, 'a3281c walk', 'Two rooms.',
    'a3281c-' || o_event, 'experience', 'draft', 'draft', 'America/New_York', 'USD',
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
     SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = o_event;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.a3281c_base_payload(p_date text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'title', 'a3281c walk',
    'description', 'Two rooms.',
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

CREATE OR REPLACE FUNCTION pg_temp.a3281c_order(
  p_event uuid, p_tier uuid, p_date_id uuid, p_email text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_order uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders(
    id, event_id, event_date_id, buyer_email, buyer_name, total_cents,
    payment_method, payment_status, source
  ) VALUES (
    v_order, p_event, p_date_id, p_email, 'Guest', 0, 'free', 'paid', 'online_checkout'
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

-- ─── A-01 date shift with sales refused ─────────────────────────────────────
DO $a01$
DECLARE
  f record;
  v_result jsonb;
  v_day2 text;
  v_date_id uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.a3281c_experience('a01');
  PERFORM pg_temp.a3281c_order(f.o_event, f.o_tier, f.o_date_id, 'shift@example.test');
  v_day2 := to_char((f.o_date::date + 2), 'YYYY-MM-DD');

  v_result := public.biz_update_live_experience(
    f.o_event,
    jsonb_set(
      pg_temp.a3281c_base_payload(f.o_date),
      '{when}',
      jsonb_build_object('date', v_day2, 'doorsOpen', '18:00', 'endsAt', '21:00')
    ),
    'Moving the day after guests have already booked'
  );
  PERFORM pg_temp.a3281c_assert(
    COALESCE(v_result->>'ok', 'true') = 'false'
    AND v_result->>'reason' = 'dates_shifted_with_sales',
    'A-01 date shift with sales refused');
  SELECT id INTO v_date_id FROM public.event_dates WHERE event_id = f.o_event;
  PERFORM pg_temp.a3281c_assert(v_date_id = f.o_date_id, 'A-01 date id untouched on refusal');
END;
$a01$;

-- ─── A-02 stop removal with sales refused ───────────────────────────────────
DO $a02$
DECLARE
  f record;
  v_result jsonb;
  v_stop0 uuid;
  v_stop1 uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.a3281c_experience('a02');
  PERFORM pg_temp.a3281c_order(f.o_event, f.o_tier, f.o_date_id, 'stop@example.test');

  v_result := public.biz_update_live_experience(
    f.o_event,
    jsonb_set(
      pg_temp.a3281c_base_payload(f.o_date),
      '{stops}',
      jsonb_build_array(
        jsonb_build_object(
          'stop_order', 0, 'place_id', 'place-one', 'place_name', 'First Room',
          'address', '11 Secret Lane', 'lat', 40.71, 'lng', -73.95, 'start_time', '18:00',
          'price_cents', 0),
        jsonb_build_object(
          'stop_order', 1, 'place_id', 'place-three', 'place_name', 'Brand New Room',
          'address', '33 New Ave', 'lat', 40.73, 'lng', -73.97, 'start_time', '19:30',
          'price_cents', 0))
    ),
    'Replacing the second stop after guests have booked'
  );
  PERFORM pg_temp.a3281c_assert(
    COALESCE(v_result->>'ok', 'true') = 'false'
    AND v_result->>'reason' = 'stop_removed_with_sales',
    'A-02 stop removal with sales refused');
  SELECT id INTO v_stop0 FROM public.experience_stops
   WHERE event_id = f.o_event AND stop_order = 0;
  SELECT id INTO v_stop1 FROM public.experience_stops
   WHERE event_id = f.o_event AND stop_order = 1;
  PERFORM pg_temp.a3281c_assert(
    v_stop0 = f.o_stop0 AND v_stop1 = f.o_stop1,
    'A-02 stop ids untouched on refusal');
END;
$a02$;

-- ─── A-03 reorder by stop_order keeps ids (unsold) ──────────────────────────
DO $a03$
DECLARE
  f record;
  v_result jsonb;
  v_stop0 uuid;
  v_stop1 uuid;
  v_name0 text;
BEGIN
  SELECT * INTO f FROM pg_temp.a3281c_experience('a03');

  -- Swap place names at the same stop_orders: ids stay with stop_order.
  v_result := public.biz_update_live_experience(
    f.o_event,
    jsonb_set(
      pg_temp.a3281c_base_payload(f.o_date),
      '{stops}',
      jsonb_build_array(
        jsonb_build_object(
          'stop_order', 0, 'place_id', 'place-two', 'place_name', 'Second Room',
          'address', '22 Hidden Row', 'lat', 40.72, 'lng', -73.96, 'start_time', '18:00',
          'price_cents', 0),
        jsonb_build_object(
          'stop_order', 1, 'place_id', 'place-one', 'place_name', 'First Room',
          'address', '11 Secret Lane', 'lat', 40.71, 'lng', -73.95, 'start_time', '19:30',
          'price_cents', 0))
    ),
    'Swapping the stop order for a clearer route'
  );
  PERFORM pg_temp.a3281c_assert(
    COALESCE((v_result->>'ok')::boolean, false),
    'A-03 unsold stop rewrite accepted');
  SELECT id, place_name INTO v_stop0, v_name0 FROM public.experience_stops
   WHERE event_id = f.o_event AND stop_order = 0;
  SELECT id INTO v_stop1 FROM public.experience_stops
   WHERE event_id = f.o_event AND stop_order = 1;
  PERFORM pg_temp.a3281c_assert(
    v_stop0 = f.o_stop0 AND v_stop1 = f.o_stop1,
    'A-03 stop ids stay bound to stop_order');
  PERFORM pg_temp.a3281c_assert(v_name0 = 'Second Room', 'A-03 stop 0 content updated in place');
END;
$a03$;

-- ─── A-04 held date (scan) cannot be removed ────────────────────────────────
DO $a04$
DECLARE
  f record;
  v_scanner uuid := gen_random_uuid();
  v_ticket uuid;
  v_order uuid;
  v_result jsonb;
  v_day2 text;
  v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.a3281c_experience('a04');
  -- Cancelled order so sold_count = 0, but a scan still holds the day.
  v_order := pg_temp.a3281c_order(f.o_event, f.o_tier, f.o_date_id, 'held@example.test');
  UPDATE public.orders SET payment_status = 'cancelled' WHERE id = v_order;
  UPDATE public.tickets SET status = 'refunded' WHERE order_id = v_order;
  SELECT t.id INTO v_ticket FROM public.tickets t WHERE t.order_id = v_order LIMIT 1;
  INSERT INTO auth.users(id) VALUES (v_scanner);
  INSERT INTO public.scan_events(
    ticket_id, event_id, scanner_user_id, scan_result, client_offline, event_date_id
  ) VALUES (v_ticket, f.o_event, v_scanner, 'valid', false, f.o_date_id);

  v_day2 := to_char((f.o_date::date + 3), 'YYYY-MM-DD');
  BEGIN
    v_result := public.biz_update_live_experience(
      f.o_event,
      jsonb_set(
        pg_temp.a3281c_base_payload(f.o_date),
        '{when}',
        jsonb_build_object('date', v_day2, 'doorsOpen', '18:00', 'endsAt', '21:00')
      ),
      'Moving the only day after a door scan was recorded'
    );
    -- If sold_count still > 0 somehow, the soft refuse is also fine.
    IF COALESCE((v_result->>'ok')::boolean, true) THEN
      RAISE EXCEPTION 'A-04 expected a refusal or hold exception, got ok';
    END IF;
    v_err := v_result->>'reason';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  PERFORM pg_temp.a3281c_assert(
    v_err LIKE '%dates_shifted_with_sales%'
    OR v_err LIKE '%multi_date_remove_with_sales%'
    OR v_err LIKE '%held%',
    'A-04 held/shifted day refused (' || COALESCE(v_err, 'null') || ')');
  PERFORM pg_temp.a3281c_assert(
    EXISTS (SELECT 1 FROM public.event_dates WHERE id = f.o_date_id),
    'A-04 held date id still present');
END;
$a04$;

-- ─── A-05 revert pin: no wholesale wipe in the live body ────────────────────
DO $a05$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef('public.biz_update_live_experience(uuid,jsonb,text)'::regprocedure)
    INTO v_src;
  PERFORM pg_temp.a3281c_assert(
    position('DELETE FROM public.event_dates WHERE event_id = p_event_id' IN v_src) = 0,
    'A-05 no wholesale event_dates delete');
  PERFORM pg_temp.a3281c_assert(
    position('DELETE FROM public.experience_stops WHERE event_id = p_event_id' IN v_src) = 0,
    'A-05 no wholesale experience_stops delete');
  PERFORM pg_temp.a3281c_assert(
    position('issue_3285_event_date_hold_reason' IN v_src) > 0,
    'A-05 hold_reason used in reconcile');
END;
$a05$;

ROLLBACK;
