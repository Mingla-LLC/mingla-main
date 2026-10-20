-- issue #3281 Round 2c adversarial — block length / party gates refuse bad inputs.
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3281r2c_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 R2c ADV FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

DO $body$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tt uuid := gen_random_uuid();
  v_date uuid;
  v_start timestamptz := date_trunc('hour', now() + interval '5 days') + interval '2 hours';
  v_end timestamptz := v_start + interval '8 hours';
  v_raised boolean;
BEGIN
  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'i3281r2c-adv-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'i3281r2c adv', 'i3281r2c-adv-' || v_brand, 'NGN');

  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode,
    experience_intents, experience_intent, whole_price_cents,
    is_recurring, recurrence_rules
  ) VALUES (
    v_event, v_brand, v_user, 'Block studio', 'Hire.',
    'i3281r2c-adv-' || v_event, 'experience', 'live', 'public', 'Africa/Lagos', 'NGN',
    'per_stop', 'whole', ARRAY['group-fun'], 'group-fun', 100000,
    true, '{"preset":"daily","termination":{"kind":"never"}}'::jsonb
  );

  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, v_start, v_end, 'Africa/Lagos', true)
    RETURNING id INTO v_date;

  INSERT INTO public.ticket_types(
    id, event_id, name, price_cents, currency, quantity_total,
    available_online, available_in_person, price_basis, block_minutes,
    min_blocks, max_blocks, display_order
  ) VALUES (
    v_tt, v_event, 'Hourly', 100000, 'NGN', 3,
    true, true, 'block', 60, 1, 3, 0
  );

  -- End before start must refuse at validate.
  v_raised := false;
  BEGIN
    PERFORM public.issue_3281_validate_booked_start(
      v_event, v_date, v_start + interval '2 hours', v_start + interval '1 hour'
    );
  EXCEPTION WHEN OTHERS THEN
    v_raised := position('booked_length' in SQLERRM) > 0
      OR position('booked_end' in SQLERRM) > 0;
  END;
  PERFORM pg_temp.i3281r2c_assert(v_raised, 'end-before-start refused');

  -- Party over group_max refused via quote.
  UPDATE public.ticket_types
     SET price_basis = 'group', group_max = 4,
         block_minutes = NULL, min_blocks = NULL, max_blocks = NULL
   WHERE id = v_tt;

  v_raised := false;
  BEGIN
    PERFORM public.pg_experience_booking_quote(v_event, v_tt, 99, 1);
  EXCEPTION WHEN OTHERS THEN
    v_raised := position('booked_party' in SQLERRM) > 0;
  END;
  PERFORM pg_temp.i3281r2c_assert(v_raised, 'party over max refused');

  -- Too many blocks refused via quote.
  UPDATE public.ticket_types
     SET price_basis = 'block', group_max = NULL,
         block_minutes = 60, min_blocks = 1, max_blocks = 2
   WHERE id = v_tt;

  v_raised := false;
  BEGIN
    PERFORM public.pg_experience_booking_quote(v_event, v_tt, 1, 9);
  EXCEPTION WHEN OTHERS THEN
    v_raised := position('booked_length' in SQLERRM) > 0;
  END;
  PERFORM pg_temp.i3281r2c_assert(v_raised, 'blocks over max refused');
END
$body$;

ROLLBACK;
