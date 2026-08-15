-- Issue #1919 independent tester adversarial proof.
-- Executes the real event publisher, public experience read, and batch helper.
-- Every randomized fixture is transaction-local and rolled back.
\set ON_ERROR_STOP on

BEGIN;
DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_paystack uuid := gen_random_uuid();
  v_unready uuid := gen_random_uuid();
  v_pending uuid := gen_random_uuid();
  v_paid_event uuid := gen_random_uuid();
  v_free_event uuid := gen_random_uuid();
  v_pending_event uuid := gen_random_uuid();
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_payload jsonb;
  v_result jsonb;
  v_count integer;
  v_ids uuid[];
  v_acl aclitem[];
  v_config text[];
  v_definition text;
BEGIN
  -- #1902 is the latest prior writer of this shared feed. #1919 may replace
  -- only its payment predicate; RSVP lifecycle support is explicitly excluded.
  SELECT pg_catalog.pg_get_functiondef(
    'public.pg_public_brand_upcoming(text,timestamptz,integer)'::regprocedure
  ) INTO v_definition;
  IF position('WHEN ''rsvp''::text THEN ed.start_at' IN v_definition) = 0
     AND position('WHEN ''rsvp'' THEN ed.start_at' IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'I1919-T00: pg_public_brand_upcoming reverted #1902 RSVP admission';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, payment_provider,
    payment_country, paystack_subaccount_code
  ) VALUES
    (v_paystack, v_user, 'I1919 tester Paystack', 'i1919-pay-' || v_suffix,
      'NGN', 'paystack', 'NG', 'ACCT_i1919_tester'),
    (v_unready, v_user, 'I1919 tester unready', 'i1919-none-' || v_suffix,
      'USD', 'stripe', NULL, NULL),
    (v_pending, v_user, 'I1919 tester pending', 'i1919-pending-' || v_suffix,
      'NGN', 'paystack', 'NG', 'ACCT_i1919_pending');

  INSERT INTO public.brand_currency_reconciliations (
    brand_id, from_currency_code, to_currency_code, reason, status
  ) VALUES (v_pending, 'USD', 'NGN', 'bank_changed', 'pending');

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_payload := jsonb_build_object(
    'title', 'I1919 paid Paystack event', 'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Paid online', 'isFree', false, 'price', 100,
        'capacity', 10, 'availableAt', 'online')),
      'city', 'Lagos', 'partyTypes', jsonb_build_array('club-night'),
      'requestedVisibility', 'public',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'))));

  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone
  ) VALUES (
    v_paid_event, v_paystack, 'I1919 paid draft', 'i1919-paid-' || v_suffix,
    'event', 'draft', 'draft', 'UTC'
  );
  v_result := public.business_publish_event_draft(v_paid_event, v_payload);
  IF (SELECT status FROM public.events WHERE id = v_paid_event) <> 'scheduled' THEN
    RAISE EXCEPTION 'I1919-T01: Paystack-ready paid event did not publish';
  END IF;

  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone
  ) VALUES (
    gen_random_uuid(), v_unready, 'I1919 denied draft', 'i1919-denied-' || v_suffix,
    'event', 'draft', 'draft', 'UTC'
  ) RETURNING id INTO v_free_event;
  BEGIN
    v_result := public.business_publish_event_draft(v_free_event, v_payload);
    RAISE EXCEPTION 'I1919-T02: rail-unready paid event unexpectedly published';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'stripe_charges_disabled' THEN
      RAISE EXCEPTION 'I1919-T02: expected exact transitional alias, got %', SQLERRM;
    END IF;
  END;

  -- A free control must not consult rail readiness.
  v_payload := jsonb_set(
    v_payload,
    '{theme,business_draft,tickets}',
    jsonb_build_array(jsonb_build_object(
      'name', 'Free', 'isFree', true, 'price', 0,
      'capacity', 10, 'availableAt', 'online'))
  );
  v_result := public.business_publish_event_draft(v_free_event, v_payload);
  IF (SELECT status FROM public.events WHERE id = v_free_event) <> 'scheduled' THEN
    RAISE EXCEPTION 'I1919-T03: free event was gated by payment readiness';
  END IF;

  -- Execute a public server read with three different rail states.
  INSERT INTO public.events (
    id, brand_id, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone
  ) VALUES
    (gen_random_uuid(), v_paystack, 'experience', 'Paystack visible',
      'paystack-visible-' || v_suffix, 'desc', 'scheduled', 'public', now(), 'NGN', 'UTC'),
    (v_pending_event, v_pending, 'experience', 'Pending hidden',
      'pending-hidden-' || v_suffix, 'desc', 'scheduled', 'public', now(), 'NGN', 'UTC');
  INSERT INTO public.ticket_types (
    event_id, name, price_cents, currency, is_unlimited, is_free,
    available_online, available_in_person, display_order
  ) SELECT id, 'Paid', 10000, 'NGN', true, false, true, false, 0
    FROM public.events
    WHERE slug IN ('paystack-visible-' || v_suffix, 'pending-hidden-' || v_suffix);

  SELECT count(*) INTO v_count
  FROM public.pg_public_experiences_by_brand('i1919-pay-' || v_suffix)
  WHERE title = 'Paystack visible';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'I1919-T04: Paystack-ready paid supply missing (count=%)', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.pg_public_experiences_by_brand('i1919-pending-' || v_suffix)
  WHERE experience_id = v_pending_event;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'I1919-T05: pending-reconciliation paid supply leaked';
  END IF;

  SET LOCAL ROLE anon;
  SELECT array_agg(brand_id ORDER BY brand_id) INTO v_ids
  FROM public.pg_brands_can_collect(
    ARRAY[v_paystack, v_paystack, v_pending, v_unready, gen_random_uuid(), NULL]
  );
  RESET ROLE;
  IF v_ids IS DISTINCT FROM ARRAY[v_paystack] THEN
    RAISE EXCEPTION 'I1919-T06: anon batch returned unexpected IDs %', v_ids;
  END IF;

  SELECT proacl, proconfig INTO v_acl, v_config
  FROM pg_catalog.pg_proc
  WHERE oid = 'public.pg_brands_can_collect(uuid[])'::regprocedure;
  IF EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(COALESCE(
         v_acl,
         pg_catalog.acldefault('f', (
           SELECT proowner FROM pg_catalog.pg_proc
           WHERE oid = 'public.pg_brands_can_collect(uuid[])'::regprocedure
         ))
       ))
       WHERE grantee = 0 AND privilege_type = 'EXECUTE'
     )
     OR NOT has_function_privilege('anon', 'public.pg_brands_can_collect(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.pg_brands_can_collect(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.pg_brands_can_collect(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'I1919-T07: helper ACL is not explicit least privilege: %', v_acl;
  END IF;
  IF cardinality(v_config) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_options_to_table(v_config) AS option
       WHERE option.option_name = 'search_path'
         AND option.option_value IN ('', '""')
     ) THEN
    RAISE EXCEPTION 'I1919-T08: helper search_path is not exactly empty: %', v_config;
  END IF;
END
$test$;
ROLLBACK;

\echo 'issue #1919 tester executable provider-neutral readiness PASS'
