\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_account uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_missing uuid := gen_random_uuid();
  v_null uuid := gen_random_uuid();
  v_after uuid := gen_random_uuid();
  v_boundary uuid := gen_random_uuid();
  v_hidden uuid := gen_random_uuid();
  v_unpublished uuid := gen_random_uuid();
  v_order_a uuid := gen_random_uuid();
  v_order_b uuid := gen_random_uuid();
  v_state text;
  v_message text;
  v_after_count bigint;
  v_rows uuid[];
  v_price bigint;
  v_limit_count integer;
  v_function text;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, created_at, updated_at
  ) VALUES
    (v_account, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'issue1902-owner-adv@example.test',
     clock_timestamp(), clock_timestamp()),
    (v_user, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'issue1902-user-adv@example.test',
     clock_timestamp(), clock_timestamp());
  INSERT INTO public.creator_accounts (id, email, created_at)
  VALUES (v_account, 'issue1902-owner-adv@example.test', clock_timestamp());

  INSERT INTO public.brands (
    id, account_id, slug, name, default_currency, created_at, updated_at
  ) VALUES (
    v_brand, v_account, 'issue-1902-tester-adversarial', 'Issue 1902 Tester',
    'USD', clock_timestamp(), clock_timestamp()
  );

  INSERT INTO public.events (
    id, brand_id, created_by, event_type, title, slug, description, status, visibility,
    published_at, currency, timezone, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, created_at, updated_at
  ) VALUES
    (v_missing, v_brand, v_account, 'rsvp', 'Missing master', 'missing-master-1902', '',
     'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto', false, 0,
     clock_timestamp(), clock_timestamp()),
    (v_null, v_brand, v_account, 'rsvp', 'Null master', 'null-master-1902', '',
     'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto', false, 0,
     clock_timestamp(), clock_timestamp()),
    (v_after, v_brand, v_account, 'rsvp', 'After end', 'after-end-1902', '',
     'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto', false, 0,
     clock_timestamp(), clock_timestamp()),
    (v_boundary, v_brand, v_account, 'rsvp', 'Boundary race', 'boundary-race-1902', '',
     'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto', false, 0,
     clock_timestamp(), clock_timestamp()),
    (v_hidden, v_brand, v_account, 'rsvp', 'Hidden future', 'hidden-future-1902', '',
     'scheduled', 'hidden', clock_timestamp(), 'USD', 'UTC', 'auto', false, 0,
     clock_timestamp(), clock_timestamp()),
    (v_unpublished, v_brand, v_account, 'rsvp', 'Unpublished future', 'unpublished-future-1902', '',
     'scheduled', 'public', NULL, 'USD', 'UTC', 'auto', false, 0,
     clock_timestamp(), clock_timestamp()),
    (v_order_a, v_brand, v_account, 'rsvp', 'Earlier future', 'earlier-future-1902', '',
     'scheduled', 'public', clock_timestamp() - interval '1 minute', 'USD', 'UTC', 'auto', false, 0,
     clock_timestamp(), clock_timestamp()),
    (v_order_b, v_brand, v_account, 'rsvp', 'Later future', 'later-future-1902', '',
     'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto', false, 0,
     clock_timestamp(), clock_timestamp());

  -- Production schema normally prevents NULL end_at. Temporarily relax it in
  -- this rolled-back disposable transaction to prove the RPC still fails
  -- closed if legacy/corrupt truth reaches the function.
  EXECUTE 'ALTER TABLE public.event_dates ALTER COLUMN end_at DROP NOT NULL';

  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES
    (v_null, clock_timestamp() - interval '1 hour', NULL, 'UTC', true),
    (v_after, clock_timestamp() - interval '2 hour', clock_timestamp() - interval '1 second', 'UTC', true),
    (v_boundary, clock_timestamp() - interval '1 hour', clock_timestamp() + interval '250 milliseconds', 'UTC', true),
    (v_hidden, clock_timestamp() + interval '1 hour', clock_timestamp() + interval '2 hour', 'UTC', true),
    (v_unpublished, clock_timestamp() + interval '1 hour', clock_timestamp() + interval '2 hour', 'UTC', true),
    (v_order_a, clock_timestamp() + interval '2 hour', clock_timestamp() + interval '3 hour', 'UTC', true),
    (v_order_b, clock_timestamp() + interval '3 hour', clock_timestamp() + interval '4 hour', 'UTC', true);

  -- Both auth modes and all unavailable shapes reject before input validation.
  BEGIN
    PERFORM public.submit_event_rsvp_with_delivery(
      v_missing, NULL, NULL, NULL, NULL, 'definitely-invalid', 9,
      '[{"name":"would-write","email":"write@example.test","phone":"+15551902100"}]'::jsonb,
      'tester-pepper'
    );
    RAISE EXCEPTION 'missing-master anon request unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P1902' THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    IF v_state <> 'P1902' OR v_message <> 'rsvp_date_unavailable' THEN
      RAISE EXCEPTION 'missing master returned % / %', v_state, v_message;
    END IF;
  END;

  BEGIN
    PERFORM public.submit_event_rsvp_with_delivery(
      v_null, v_user, NULL, NULL, NULL, 'going', 0, '[]'::jsonb, 'tester-pepper'
    );
    RAISE EXCEPTION 'null-master authenticated request unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P1902' THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    IF v_state <> 'P1902' OR v_message <> 'rsvp_date_unavailable' THEN
      RAISE EXCEPTION 'null master returned % / %', v_state, v_message;
    END IF;
  END;

  BEGIN
    PERFORM public.submit_event_rsvp_with_delivery(
      v_after, v_user, NULL, NULL, NULL, 'going', 0, '[]'::jsonb, 'tester-pepper'
    );
    RAISE EXCEPTION 'after-end authenticated request unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P1901' THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    IF v_state <> 'P1901' OR v_message <> 'rsvp_event_ended' THEN
      RAISE EXCEPTION 'after end returned % / %', v_state, v_message;
    END IF;
  END;

  -- Storage normally rejects a second master. Prove that posture first, then
  -- temporarily remove the disposable index to drive the RPC's independent
  -- ambiguous-master defense against legacy/corrupt truth.
  BEGIN
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_after, clock_timestamp(), clock_timestamp() + interval '1 hour', 'UTC', true);
    RAISE EXCEPTION 'duplicate master unexpectedly inserted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  EXECUTE 'DROP INDEX public.event_dates_master_unique';
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (v_after, clock_timestamp(), clock_timestamp() + interval '1 hour', 'UTC', true);
  BEGIN
    PERFORM public.submit_event_rsvp_with_delivery(
      v_after, NULL, 'Ambiguous', 'ambiguous@example.test', '+15551902102',
      'going', 0, '[]'::jsonb, 'tester-pepper'
    );
    RAISE EXCEPTION 'ambiguous-master anon request unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P1902' THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    IF v_state <> 'P1902' OR v_message <> 'rsvp_date_unavailable' THEN
      RAISE EXCEPTION 'ambiguous master returned % / %', v_state, v_message;
    END IF;
  END;

  -- A boundary that was future at statement setup must be re-read against the
  -- database clock at admission, not accepted from a stale caller clock.
  PERFORM pg_sleep(0.35);
  BEGIN
    PERFORM public.submit_event_rsvp_with_delivery(
      v_boundary, NULL, 'Boundary', 'boundary@example.test', '+15551902101',
      'going', 0, '[]'::jsonb, 'tester-pepper'
    );
    RAISE EXCEPTION 'boundary-race anon request unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P1901' THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    IF v_state <> 'P1901' OR v_message <> 'rsvp_event_ended' THEN
      RAISE EXCEPTION 'boundary race returned % / %', v_state, v_message;
    END IF;
  END;

  -- No rejected request may alter any write surface. Count the whole tables in
  -- this isolated transaction, including recovery/outbox/delivery material.
  SELECT count(*) INTO v_after_count FROM public.event_rsvps;
  IF v_after_count <> 0 THEN RAISE EXCEPTION 'rejections wrote % RSVP rows', v_after_count; END IF;
  SELECT count(*) INTO v_after_count FROM public.event_rsvp_guests;
  IF v_after_count <> 0 THEN RAISE EXCEPTION 'rejections wrote % guest/pass rows', v_after_count; END IF;
  SELECT count(*) INTO v_after_count FROM public.rsvp_notifications;
  IF v_after_count <> 0 THEN RAISE EXCEPTION 'rejections wrote % notification/outbox rows', v_after_count; END IF;
  SELECT count(*) INTO v_after_count FROM public.rsvp_notification_deliveries;
  IF v_after_count <> 0 THEN RAISE EXCEPTION 'rejections wrote % delivery rows', v_after_count; END IF;

  -- Upcoming must include only public + published future RSVP rows, keep
  -- canonical ordering, return NULL price, and preserve cursor/limit+1.
  SELECT array_agg(u.offering_id ORDER BY u.starts_at, u.published_at DESC),
         max(u.price_from_cents), count(*)
    INTO v_rows, v_price, v_limit_count
    FROM public.pg_public_brand_upcoming(
      'issue-1902-tester-adversarial', clock_timestamp(), 1
    ) u;
  IF v_rows IS DISTINCT FROM ARRAY[v_order_a, v_order_b]::uuid[] THEN
    RAISE EXCEPTION 'Upcoming RSVP order/limit+1/visibility drift: %', v_rows;
  END IF;
  IF v_price IS NOT NULL OR v_limit_count <> 2 THEN
    RAISE EXCEPTION 'Upcoming RSVP fabricated price or lost limit+1: % / %', v_price, v_limit_count;
  END IF;

  SELECT count(*) INTO v_after_count
    FROM public.pg_public_brand_upcoming(
      'issue-1902-tester-adversarial', clock_timestamp() + interval '2 hours 30 minutes', 30
    ) u;
  IF v_after_count <> 1 THEN
    RAISE EXCEPTION 'Upcoming RSVP cursor did not retain exactly the later row: %', v_after_count;
  END IF;

  SELECT pg_get_functiondef(
    'public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)'::regprocedure
  ) INTO v_function;
  IF position('SECURITY DEFINER' IN v_function) = 0
     OR position('SET search_path TO ''public'', ''pg_temp''' IN v_function) = 0 THEN
    RAISE EXCEPTION 'submit RSVP security posture drifted';
  END IF;
  IF has_function_privilege('anon', 'public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'submit RSVP grants drifted';
  END IF;

  RAISE NOTICE 'issue #1914 tester PG17 adversarial PASS';
END
$test$;

ROLLBACK;
