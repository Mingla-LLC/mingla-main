-- issue #3281 Round 1 PR 1b — validate refuses bad starts; flag-on requires
-- a start for open-daily.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3281b_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 1b FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

DO $body$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_date uuid;
  v_other_date uuid;
  v_start timestamptz := date_trunc('hour', now() + interval '5 days') + interval '1 hour';
  v_end timestamptz := v_start + interval '6 hours';
  v_ok timestamptz := v_start + interval '90 minutes';
  v_err text;
BEGIN
  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'i3281b-adv-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'i3281b adv', 'i3281b-adv-' || v_brand, 'NGN');

  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode,
    experience_intents, experience_intent, whole_price_cents,
    is_recurring, recurrence_rules, master_start_at, master_end_at
  ) VALUES (
    v_event, v_brand, v_user, 'Open daily', 'Hours.',
    'i3281b-adv-exp-' || v_event, 'experience', 'live', 'public', 'Africa/Lagos', 'NGN',
    'per_stop', 'whole', ARRAY['group-fun'], 'group-fun', 0,
    true, '{"preset":"daily","termination":{"kind":"never"}}'::jsonb,
    v_start, v_end
  ), (
    v_other, v_brand, v_user, 'Other open daily', 'Hours.',
    'i3281b-adv-other-' || v_other, 'experience', 'live', 'public', 'Africa/Lagos', 'NGN',
    'per_stop', 'whole', ARRAY['group-fun'], 'group-fun', 0,
    true, '{"preset":"daily","termination":{"kind":"never"}}'::jsonb,
    v_start, v_end
  );

  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, v_start, v_end, 'Africa/Lagos', true)
    RETURNING id INTO v_date;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_other, v_start, v_end, 'Africa/Lagos', true)
    RETURNING id INTO v_other_date;

  UPDATE public.feature_flags
     SET is_enabled = false
   WHERE flag_key = 'experience_require_booked_start';

  PERFORM public.issue_3281_validate_booked_start(v_event, v_date, NULL);
  PERFORM pg_temp.i3281b_assert(true, 'flag-off NULL start ok');

  PERFORM public.issue_3281_validate_booked_start(v_event, v_date, v_ok);
  PERFORM pg_temp.i3281b_assert(true, 'on-grid start ok');

  BEGIN
    PERFORM public.issue_3281_validate_booked_start(
      v_event, v_date, v_start + interval '15 minutes'
    );
    RAISE EXCEPTION 'expected booked_start_off_grid';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM pg_temp.i3281b_assert(
      position('booked_start_off_grid' IN v_err) > 0,
      'off-grid → booked_start_off_grid'
    );
  END;

  BEGIN
    PERFORM public.issue_3281_validate_booked_start(
      v_event, v_date, v_start - interval '30 minutes'
    );
    RAISE EXCEPTION 'expected booked_start_invalid';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM pg_temp.i3281b_assert(
      position('booked_start_invalid' IN v_err) > 0,
      'before window → booked_start_invalid'
    );
  END;

  BEGIN
    PERFORM public.issue_3281_validate_booked_start(
      v_event, v_date, now() - interval '1 hour'
    );
    RAISE EXCEPTION 'expected booked_start_in_past';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM pg_temp.i3281b_assert(
      position('booked_start_in_past' IN v_err) > 0,
      'past → booked_start_in_past'
    );
  END;

  BEGIN
    PERFORM public.issue_3281_validate_booked_start(v_event, v_other_date, v_ok);
    RAISE EXCEPTION 'expected booked_start_invalid (foreign date)';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM pg_temp.i3281b_assert(
      position('booked_start_invalid' IN v_err) > 0,
      'foreign date → booked_start_invalid'
    );
  END;

  UPDATE public.feature_flags
     SET is_enabled = true
   WHERE flag_key = 'experience_require_booked_start';

  BEGIN
    PERFORM public.issue_3281_validate_booked_start(v_event, v_date, NULL);
    RAISE EXCEPTION 'expected booked_start_required';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM pg_temp.i3281b_assert(
      position('booked_start_required' IN v_err) > 0,
      'flag-on NULL → booked_start_required'
    );
  END;

  UPDATE public.feature_flags
     SET is_enabled = false
   WHERE flag_key = 'experience_require_booked_start';
END
$body$;

ROLLBACK;
