-- issue #3281 Round 2 — refuse 0-stop publish, bad basis, and per_stop+group.
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
END $$;

DO $body$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_day text := to_char(now() + interval '21 days', 'YYYY-MM-DD');
  v_base jsonb;
  v_err text;
BEGIN
  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'i3281r2a-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'i3281r2a', 'i3281r2a-' || v_brand, 'NGN');
  PERFORM pg_temp.i3281r2_act(v_user);

  v_base := jsonb_build_object(
    'title', 'Bad stop count',
    'description', 'Should refuse.',
    'currency', 'NGN',
    'is_free', true,
    'pricing_mode', 'whole',
    'whole_price_cents', 0,
    'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'Africa/Lagos',
    'whenMode', 'single',
    'when', jsonb_build_object('date', v_day, 'doorsOpen', '10:00', 'endsAt', '12:00'),
    'stops', '[]'::jsonb
  );

  v_err := NULL;
  BEGIN
    PERFORM public.biz_create_experience(v_brand, v_base, true);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM pg_temp.i3281r2_assert(
    v_err = 'experience_stop_count_invalid',
    '0-stop publish → experience_stop_count_invalid'
  );

  v_err := NULL;
  BEGIN
    PERFORM public.issue_3281_apply_experience_price_options(
      gen_random_uuid(), 'NGN', 'whole', 1000, NULL,
      jsonb_build_array(jsonb_build_object(
        'name', 'Hourly', 'price_cents', 1000, 'price_basis', 'block',
        'block_minutes', 20, 'min_blocks', 1, 'max_blocks', 2
      )),
      false
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM pg_temp.i3281r2_assert(
    v_err = 'experience_price_invalid',
    'block_minutes 20 → experience_price_invalid'
  );

  v_err := NULL;
  BEGIN
    PERFORM public.issue_3281_apply_experience_price_options(
      gen_random_uuid(), 'NGN', 'per_stop', 1000, NULL,
      jsonb_build_array(jsonb_build_object(
        'name', 'Group', 'price_cents', 5000, 'price_basis', 'group',
        'group_max', 4
      )),
      false
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM pg_temp.i3281r2_assert(
    v_err = 'experience_price_invalid',
    'per_stop + group basis → experience_price_invalid'
  );

  -- Empty price_options with sales must refuse (never soft-delete sold inventory).
  v_err := NULL;
  BEGIN
    PERFORM public.issue_3281_apply_experience_price_options(
      gen_random_uuid(), 'NGN', 'whole', 0, NULL,
      '[]'::jsonb,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM pg_temp.i3281r2_assert(
    v_err = 'price_change_with_sales',
    'empty options + sales → price_change_with_sales'
  );

END
$body$;

ROLLBACK;
