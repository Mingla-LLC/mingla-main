\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_account uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_future uuid := gen_random_uuid();
  v_equal uuid := gen_random_uuid();
  v_missing uuid := gen_random_uuid();
  v_result jsonb;
  v_state text;
  v_message text;
  v_count integer;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, created_at, updated_at
  ) VALUES (
    v_account, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'issue1902-owner@example.test',
    clock_timestamp(), clock_timestamp()
  );
  INSERT INTO public.creator_accounts (id, email, created_at)
  VALUES (v_account, 'issue1902-owner@example.test', clock_timestamp());

  INSERT INTO public.brands (
    id, account_id, slug, name, default_currency, created_at, updated_at
  ) VALUES (
    v_brand, v_account, 'issue-1902-rsvp-backend', 'Issue 1902 RSVP Backend',
    'USD', clock_timestamp(), clock_timestamp()
  );

  INSERT INTO public.events (
    id, brand_id, created_by, event_type, title, slug, description, status, visibility,
    published_at, currency, timezone, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, created_at, updated_at
  ) VALUES
    (v_future, v_brand, v_account, 'rsvp', 'Future RSVP', 'future-rsvp-1902', 'future',
     'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto',
     false, 0, clock_timestamp(), clock_timestamp()),
    (v_equal, v_brand, v_account, 'rsvp', 'Boundary RSVP', 'boundary-rsvp-1902', 'boundary',
     'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto',
     false, 0, clock_timestamp(), clock_timestamp()),
    (v_missing, v_brand, v_account, 'rsvp', 'Missing RSVP', 'missing-rsvp-1902', 'missing',
     'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto',
     false, 0, clock_timestamp(), clock_timestamp());

  INSERT INTO public.event_dates (
    event_id, start_at, end_at, timezone, is_master
  ) VALUES
    (v_future, clock_timestamp() + interval '1 hour',
     clock_timestamp() + interval '2 hour', 'UTC', true),
    (v_equal, clock_timestamp() - interval '1 hour',
     clock_timestamp(), 'UTC', true);

  -- A valid pre-end RSVP still traverses the wrapper and succeeds.
  v_result := public.submit_event_rsvp_with_delivery(
    v_future, NULL, 'Future Guest', 'future@example.com', '+15550001902',
    'going', 0, '[]'::jsonb, NULL
  );
  IF v_result->>'status' <> 'going'
     OR v_result->>'approvalStatus' <> 'approved' THEN
    RAISE EXCEPTION 'pre-end RSVP did not preserve success contract: %', v_result;
  END IF;
  SELECT count(*) INTO v_count
    FROM public.event_rsvps WHERE event_id = v_future;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'pre-end RSVP expected one row, got %', v_count;
  END IF;

  -- Equality is ended. The stored boundary is already <= the guard's fresh
  -- clock_timestamp() when the RPC evaluates it.
  BEGIN
    PERFORM public.submit_event_rsvp_with_delivery(
      v_equal, NULL, 'Boundary Guest', 'boundary@example.com', '+15550001903',
      'going', 0, '[]'::jsonb, 'test-pepper'
    );
    RAISE EXCEPTION 'boundary RSVP unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P1901' THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE,
                            v_message = MESSAGE_TEXT;
    IF v_state <> 'P1901' OR v_message <> 'rsvp_event_ended' THEN
      RAISE EXCEPTION 'wrong ended transport: % / %', v_state, v_message;
    END IF;
  END;

  -- Missing canonical master data fails closed with the distinct stable code.
  BEGIN
    PERFORM public.submit_event_rsvp_with_delivery(
      v_missing, NULL, 'Missing Guest', 'missing@example.com', '+15550001904',
      'going', 0, '[]'::jsonb, 'test-pepper'
    );
    RAISE EXCEPTION 'missing-date RSVP unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P1902' THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE,
                            v_message = MESSAGE_TEXT;
    IF v_state <> 'P1902' OR v_message <> 'rsvp_date_unavailable' THEN
      RAISE EXCEPTION 'wrong unavailable transport: % / %', v_state, v_message;
    END IF;
  END;

  -- Both rejection paths must leave every RSVP/guest/pass/outbox/delivery
  -- surface at zero. The future success control is intentionally excluded.
  SELECT count(*) INTO v_count
    FROM public.event_rsvps WHERE event_id IN (v_equal, v_missing);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rejected RSVP wrote % parent rows', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.event_rsvp_guests g
    JOIN public.event_rsvps r ON r.id = g.rsvp_id
   WHERE r.event_id IN (v_equal, v_missing);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rejected RSVP wrote % guest/pass rows', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.rsvp_notifications
   WHERE event_id IN (v_equal, v_missing);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rejected RSVP wrote % notification/outbox rows', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.rsvp_notification_deliveries d
    JOIN public.rsvp_notifications n ON n.id = d.notification_id
   WHERE n.event_id IN (v_equal, v_missing);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rejected RSVP wrote % delivery rows', v_count;
  END IF;

  -- Future RSVP inventory enters Upcoming through its canonical master start,
  -- with no fabricated ticket price.
  SELECT count(*) INTO v_count
    FROM public.pg_public_brand_upcoming(
      'issue-1902-rsvp-backend', clock_timestamp(), 30
    ) u
   WHERE u.offering_id = v_future
     AND u.offering_type = 'rsvp'
     AND u.price_from_cents IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'future RSVP missing or price-fabricated in Upcoming';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'submit_event_rsvp grant posture widened or service grant lost';
  END IF;

  IF NOT has_function_privilege(
       'anon',
       'public.pg_public_brand_upcoming(text,timestamp with time zone,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.pg_public_brand_upcoming(text,timestamp with time zone,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Upcoming public grants were not preserved';
  END IF;

  RAISE NOTICE 'issue #1902/#1914 PG17 happy path PASS';
END
$test$;

ROLLBACK;
