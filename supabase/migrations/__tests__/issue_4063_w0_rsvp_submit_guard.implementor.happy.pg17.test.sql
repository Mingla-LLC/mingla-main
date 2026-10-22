-- #4063 W0 happy path. Executed after the complete migration chain in CI.
-- MINGLA-INVARIANT: I-4063-RSVP-SUBMIT-GUARD | issue #4063 | An anonymous RSVP submission never changes an RSVP that already exists for the same event and email.
BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_signed_in uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_result jsonb;
  v_state text;
  v_message text;
  v_count integer;
  v_definition text;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, created_at, updated_at
  ) VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'issue4063-owner@example.test',
     clock_timestamp(), clock_timestamp()),
    (v_signed_in, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'issue4063-signed@example.test',
     clock_timestamp(), clock_timestamp());

  INSERT INTO public.creator_accounts (id, email, created_at)
  VALUES (v_owner, 'issue4063-owner@example.test', clock_timestamp());

  INSERT INTO public.brands (
    id, account_id, slug, name, default_currency, created_at, updated_at
  ) VALUES (
    v_brand, v_owner, 'issue-4063-w0-happy', 'Issue 4063 W0 Happy',
    'USD', clock_timestamp(), clock_timestamp()
  );

  INSERT INTO public.events (
    id, brand_id, created_by, event_type, title, slug, description, status,
    visibility, published_at, currency, timezone, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, created_at, updated_at
  ) VALUES (
    v_event, v_brand, v_owner, 'rsvp', 'Wave 0 RSVP', 'wave-0-rsvp-4063', '',
    'scheduled', 'public', clock_timestamp(), 'USD', 'UTC', 'auto',
    false, 0, clock_timestamp(), clock_timestamp()
  );

  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (
    v_event, clock_timestamp() + interval '1 hour',
    clock_timestamp() + interval '2 hours', 'UTC', true
  );

  v_result := public.submit_event_rsvp(
    v_event, NULL, 'First Guest', 'first@example.test', '+15554063001',
    'going', 0, '[]'::jsonb, NULL, 'US'
  );
  IF v_result->>'status' <> 'going'
     OR v_result->>'approvalStatus' <> 'approved' THEN
    RAISE EXCEPTION 'first anonymous submission changed contract: %', v_result;
  END IF;

  BEGIN
    PERFORM public.submit_event_rsvp(
      v_event, NULL, 'Second Guest', 'first@example.test', '+15554063002',
      'not_going', 0, '[]'::jsonb, NULL, 'US'
    );
    RAISE EXCEPTION 'second anonymous submission unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P4063' THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE,
                            v_message = MESSAGE_TEXT;
    IF v_state <> 'P4063' OR v_message <> 'rsvp_already_exists' THEN
      RAISE EXCEPTION 'wrong stable rejection: % / %', v_state, v_message;
    END IF;
  END;

  v_result := public.submit_event_rsvp(
    v_event, NULL, 'Other Guest', 'other@example.test', '+15554063003',
    'going', 0, '[]'::jsonb, NULL, 'US'
  );
  IF v_result->>'status' <> 'going' THEN
    RAISE EXCEPTION 'different anonymous email was rejected: %', v_result;
  END IF;

  PERFORM public.submit_event_rsvp(
    v_event, v_signed_in, 'Signed Guest', 'signed@example.test', '+15554063004',
    'going', 0, '[]'::jsonb, NULL, 'US'
  );
  v_result := public.submit_event_rsvp(
    v_event, v_signed_in, 'Signed Guest', 'signed@example.test', '+15554063004',
    'maybe', 0, '[]'::jsonb, NULL, 'US'
  );
  IF v_result->>'status' <> 'maybe' THEN
    RAISE EXCEPTION 'signed-in resubmission no longer updates its own row: %', v_result;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.event_rsvps
   WHERE event_id = v_event;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'unexpected RSVP row count: %', v_count;
  END IF;

  SELECT pg_get_functiondef(
    'public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)'::regprocedure
  ) INTO v_definition;
  IF position('P4063' IN v_definition) = 0
     OR position('rsvp_already_exists' IN v_definition) = 0
     OR position('P4063' IN v_definition) > position('UPDATE public.event_rsvps' IN v_definition)
     OR position('P4063' IN v_definition) > position('INSERT INTO public.event_rsvps' IN v_definition)
     OR position('P4063' IN v_definition) > position('DELETE FROM public.event_rsvp_guests' IN v_definition) THEN
    RAISE EXCEPTION 'I-4063-RSVP-SUBMIT-GUARD missing or ordered after a write';
  END IF;

  RAISE NOTICE 'issue #4063 W0 PG17 happy path PASS';
END
$test$;

ROLLBACK;
