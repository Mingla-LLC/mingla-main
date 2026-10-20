-- issue #3281 Round 3 — columns exist; spacing/notice/capacity apply; public fields.
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3281r3_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 R3 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3281r3_act(p_user uuid)
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
  v_day text := to_char(now() + interval '28 days', 'YYYY-MM-DD');
  v_payload jsonb;
  v_pub jsonb;
  v_spacing integer;
  v_scope text;
BEGIN
  PERFORM pg_temp.i3281r3_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='events'
         AND column_name='booking_spacing_minutes'
    ),
    'events.booking_spacing_minutes exists'
  );
  PERFORM pg_temp.i3281r3_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='events'
         AND column_name='capacity_scope'
    ),
    'events.capacity_scope exists'
  );

  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'i3281r3-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'i3281r3', 'i3281r3-' || v_brand, 'NGN');
  PERFORM pg_temp.i3281r3_act(v_user);

  v_payload := jsonb_build_object(
    'title', 'R3 spacing studio',
    'description', 'Hourly starts.',
    'currency', 'NGN',
    'is_free', true,
    'pricing_mode', 'whole',
    'whole_price_cents', 0,
    'capacity', 2,
    'capacity_scope', 'per_start',
    'booking_spacing_minutes', 60,
    'min_notice_minutes', 120,
    'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'Africa/Lagos',
    'whenMode', 'single',
    'when', jsonb_build_object('date', v_day, 'doorsOpen', '10:00', 'endsAt', '14:00'),
    'stops', jsonb_build_array(jsonb_build_object(
      'stop_order', 0,
      'place_name', 'Studio',
      'ai_description', 'Room.',
      'address', '1 Studio St',
      'place_id', 'i3281r3-place-1',
      'lat', 6.45, 'lng', 3.39,
      'start_offset_minutes', 0
    )),
    'price_options', jsonb_build_array(
      jsonb_build_object('name', 'Standard', 'price_cents', 0, 'price_basis', 'person')
    )
  );

  v_res := public.biz_create_experience(v_brand, v_payload, true);
  v_event := (v_res->'event'->>'id')::uuid;
  PERFORM pg_temp.i3281r3_assert(v_event IS NOT NULL, 'create+publish returns event');

  SELECT booking_spacing_minutes, capacity_scope
    INTO v_spacing, v_scope
    FROM public.events WHERE id = v_event;
  PERFORM pg_temp.i3281r3_assert(v_spacing = 60, 'spacing 60 persisted');
  PERFORM pg_temp.i3281r3_assert(v_scope = 'per_start', 'capacity_scope per_start');

  SELECT public.pg_public_experience_by_slug(
    (SELECT slug FROM public.brands WHERE id = v_brand),
    (SELECT slug FROM public.events WHERE id = v_event)
  ) INTO v_pub;
  PERFORM pg_temp.i3281r3_assert(
    (v_pub->>'spacingMinutes')::integer = 60, 'public spacingMinutes'
  );
  PERFORM pg_temp.i3281r3_assert(
    (v_pub->>'minNoticeMinutes')::integer = 120, 'public minNoticeMinutes'
  );
  PERFORM pg_temp.i3281r3_assert(
    (v_pub->>'capacityScope') = 'per_start', 'public capacityScope'
  );
  PERFORM pg_temp.i3281r3_assert(
    (v_pub->'stops'->0->>'startOffsetMinutes')::integer = 0,
    'public startOffsetMinutes on stop'
  );
END
$body$;

ROLLBACK;
