-- issue #3281 Round 2 — one-stop publish + two price_options land as ticket_types.
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3281r2_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 R2 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3281r2_act(p_user uuid)
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
  v_res jsonb;
  v_event uuid;
  v_n int;
  v_basis text;
  v_day text := to_char(now() + interval '14 days', 'YYYY-MM-DD');
  v_payload jsonb;
BEGIN
  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'i3281r2-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'i3281r2', 'i3281r2-' || v_brand, 'NGN');
  PERFORM pg_temp.i3281r2_act(v_user);

  -- Free publish (no Organiser Terms) still proves one-stop + multi options.
  v_payload := jsonb_build_object(
    'title', 'One-stop tasting',
    'description', 'A single room tasting.',
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
      'place_name', 'Tasting Room',
      'ai_description', 'Where the tasting happens.',
      'address', '1 Taste St',
      'place_id', 'i3281r2-place-1',
      'lat', 6.45, 'lng', 3.39
    )),
    'price_options', jsonb_build_array(
      jsonb_build_object(
        'name', 'Per person', 'price_cents', 0, 'price_basis', 'person'),
      jsonb_build_object(
        'name', 'Private group', 'price_cents', 0, 'price_basis', 'group',
        'group_max', 8)
    )
  );

  v_res := public.biz_create_experience(v_brand, v_payload, true);
  v_event := (v_res->'event'->>'id')::uuid;
  PERFORM pg_temp.i3281r2_assert(v_event IS NOT NULL, 'one-stop create+publish returns event');

  SELECT count(*) INTO v_n FROM public.experience_stops
   WHERE event_id = v_event;
  PERFORM pg_temp.i3281r2_assert(v_n = 1, 'exactly one stop persisted');

  SELECT count(*) INTO v_n FROM public.ticket_types
   WHERE event_id = v_event AND deleted_at IS NULL;
  PERFORM pg_temp.i3281r2_assert(v_n = 2, 'two price_options → two ticket_types');

  SELECT price_basis INTO v_basis FROM public.ticket_types
   WHERE event_id = v_event AND deleted_at IS NULL
   ORDER BY display_order LIMIT 1;
  PERFORM pg_temp.i3281r2_assert(v_basis = 'person', 'default option is person');

  SELECT price_basis INTO v_basis FROM public.ticket_types
   WHERE event_id = v_event AND deleted_at IS NULL
   ORDER BY display_order DESC LIMIT 1;
  PERFORM pg_temp.i3281r2_assert(v_basis = 'group', 'second option is group');
END
$body$;

ROLLBACK;
