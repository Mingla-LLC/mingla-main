-- issue #3281 Round 3 adversarial — rule A refuses per_day when many starts fit.
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3281r3_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 R3 ADV FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

DO $body$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_date uuid;
  v_start timestamptz := date_trunc('hour', now() + interval '10 days') + interval '2 hours';
  v_end timestamptz := v_start + interval '8 hours';
  v_raised boolean;
BEGIN
  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'i3281r3-adv-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'i3281r3 adv', 'i3281r3-adv-' || v_brand, 'NGN');

  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode,
    experience_intents, experience_intent, whole_price_cents,
    is_recurring, recurrence_rules,
    capacity_scope, booking_spacing_minutes, min_notice_minutes
  ) VALUES (
    v_event, v_brand, v_user, 'Wide window', 'Many starts.',
    'i3281r3-adv-' || v_event, 'experience', 'live', 'public', 'Africa/Lagos', 'NGN',
    'per_stop', 'whole', ARRAY['group-fun'], 'group-fun', 0,
    true, '{"preset":"daily","termination":{"kind":"never"}}'::jsonb,
    'total', 30, 120
  );

  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, v_start, v_end, 'Africa/Lagos', true)
    RETURNING id INTO v_date;

  v_raised := false;
  BEGIN
    PERFORM public.issue_3281_apply_experience_r3_settings(
      v_event,
      jsonb_build_object(
        'capacity_scope', 'per_day',
        'booking_spacing_minutes', 30,
        'min_notice_minutes', 120
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_raised := position('spots_scope_requires_start_time' in SQLERRM) > 0;
  END;
  PERFORM pg_temp.i3281r3_assert(v_raised, 'per_day with multi-start window refused');

  -- Bad spacing refused.
  v_raised := false;
  BEGIN
    PERFORM public.issue_3281_apply_experience_r3_settings(
      v_event,
      jsonb_build_object('booking_spacing_minutes', 45)
    );
  EXCEPTION WHEN OTHERS THEN
    v_raised := position('booking_spacing_invalid' in SQLERRM) > 0;
  END;
  PERFORM pg_temp.i3281r3_assert(v_raised, 'spacing 45 refused');
END
$body$;

ROLLBACK;
