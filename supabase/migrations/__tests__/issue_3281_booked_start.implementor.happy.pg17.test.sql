-- issue #3281 Round 1 PR 1b — columns exist; validate accepts a future on-grid
-- start for an open-daily experience (flag off keeps NULL optional).

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
  v_date uuid;
  v_start timestamptz := date_trunc('hour', now() + interval '3 days') + interval '2 hours';
  v_end timestamptz := v_start + interval '8 hours';
  v_booked timestamptz := v_start + interval '2 hours';
BEGIN
  PERFORM pg_temp.i3281b_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders'
         AND column_name = 'booked_start_at'
    ),
    'orders.booked_start_at exists'
  );
  PERFORM pg_temp.i3281b_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ticket_checkout_sessions'
         AND column_name = 'booked_start_at'
    ),
    'ticket_checkout_sessions.booked_start_at exists'
  );
  PERFORM pg_temp.i3281b_assert(
    EXISTS (
      SELECT 1 FROM public.feature_flags
       WHERE flag_key = 'experience_require_booked_start' AND is_enabled = false
    ),
    'experience_require_booked_start flag exists and defaults off'
  );

  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'i3281b-happy-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'i3281b happy', 'i3281b-happy-' || v_brand, 'NGN');

  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode,
    experience_intents, experience_intent, whole_price_cents,
    is_recurring, recurrence_rules
  ) VALUES (
    v_event, v_brand, v_user, 'Open daily tasting', 'Hours.',
    'i3281b-happy-' || v_event, 'experience', 'live', 'public', 'Africa/Lagos', 'NGN',
    'per_stop', 'whole', ARRAY['group-fun'], 'group-fun', 500000,
    true, '{"preset":"daily","termination":{"kind":"never"}}'::jsonb
  );

  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, v_start, v_end, 'Africa/Lagos', true)
    RETURNING id INTO v_date;

  UPDATE public.feature_flags
     SET is_enabled = false
   WHERE flag_key = 'experience_require_booked_start';

  PERFORM public.issue_3281_validate_booked_start(v_event, v_date, v_booked);
  PERFORM pg_temp.i3281b_assert(true, 'on-grid future start accepted');

  PERFORM public.issue_3281_validate_booked_start(v_event, v_date, NULL);
  PERFORM pg_temp.i3281b_assert(true, 'NULL start accepted while flag off');
END
$body$;

ROLLBACK;
