-- issue #3281 Round 2c — columns exist; quote prices group/block; public options[].
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3281r2c_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 R2c FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3281r2c_act(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
END $$;

DO $body$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid;
  v_res jsonb;
  v_day text := to_char(now() + interval '21 days', 'YYYY-MM-DD');
  v_payload jsonb;
  v_quote jsonb;
  v_tt_group uuid;
  v_tt_block uuid;
  v_pub jsonb;
  v_opts int;
BEGIN
  PERFORM pg_temp.i3281r2c_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders'
         AND column_name = 'booked_end_at'
    ),
    'orders.booked_end_at exists'
  );
  PERFORM pg_temp.i3281r2c_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ticket_checkout_sessions'
         AND column_name = 'booked_party_size'
    ),
    'sessions.booked_party_size exists'
  );
  PERFORM pg_temp.i3281r2c_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tickets'
         AND column_name = 'admits_count'
    ),
    'tickets.admits_count exists'
  );

  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'i3281r2c-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'i3281r2c', 'i3281r2c-' || v_brand, 'NGN');
  PERFORM pg_temp.i3281r2c_act(v_user);

  v_payload := jsonb_build_object(
    'title', 'Unit hire studio',
    'description', 'Group and block options.',
    'currency', 'NGN',
    'is_free', true,
    'pricing_mode', 'whole',
    'whole_price_cents', 0,
    'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'Africa/Lagos',
    'whenMode', 'single',
    'when', jsonb_build_object('date', v_day, 'doorsOpen', '10:00', 'endsAt', '18:00'),
    'stops', jsonb_build_array(jsonb_build_object(
      'stop_order', 0,
      'place_name', 'Studio',
      'ai_description', 'Hire room.',
      'address', '1 Studio St',
      'place_id', 'i3281r2c-place-1',
      'lat', 6.45, 'lng', 3.39
    )),
    'price_options', jsonb_build_array(
      jsonb_build_object(
        'name', 'Private group', 'price_cents', 0, 'price_basis', 'group',
        'group_max', 8),
      jsonb_build_object(
        'name', 'Hourly hire', 'price_cents', 0, 'price_basis', 'block',
        'block_minutes', 60, 'min_blocks', 1, 'max_blocks', 4)
    )
  );

  v_res := public.biz_create_experience(v_brand, v_payload, true);
  v_event := (v_res->'event'->>'id')::uuid;
  PERFORM pg_temp.i3281r2c_assert(v_event IS NOT NULL, 'create+publish returns event');

  SELECT id INTO v_tt_group FROM public.ticket_types
   WHERE event_id = v_event AND price_basis = 'group' LIMIT 1;
  SELECT id INTO v_tt_block FROM public.ticket_types
   WHERE event_id = v_event AND price_basis = 'block' LIMIT 1;
  PERFORM pg_temp.i3281r2c_assert(v_tt_group IS NOT NULL, 'group option row');
  PERFORM pg_temp.i3281r2c_assert(v_tt_block IS NOT NULL, 'block option row');

  PERFORM pg_temp.i3281r2c_assert(
    (SELECT available_online FROM public.ticket_types WHERE id = v_tt_group),
    'group option online after 2c reopen'
  );

  v_quote := public.pg_experience_booking_quote(v_event, v_tt_group, 4, 1);
  PERFORM pg_temp.i3281r2c_assert(
    (v_quote->>'unitPriceCents') IS NOT NULL
      AND (v_quote->>'priceBasis') = 'group',
    'group quote callable'
  );

  SELECT public.pg_public_experience_by_slug(
    (SELECT slug FROM public.brands WHERE id = v_brand),
    (SELECT slug FROM public.events WHERE id = v_event)
  ) INTO v_pub;
  v_opts := jsonb_array_length(COALESCE(v_pub->'options', '[]'::jsonb));
  PERFORM pg_temp.i3281r2c_assert(v_opts >= 2, 'public experience emits options[]');
END
$body$;

ROLLBACK;
