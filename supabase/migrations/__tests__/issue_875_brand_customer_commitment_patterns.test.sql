-- ISSUE #875 — implementor happy-path regression suite.
-- Apply all repository migrations first, then execute this file on PostgreSQL 17.
-- The fixture is transaction-local and leaves no rows behind.

\set ON_ERROR_STOP on
BEGIN;

-- H-1: exact catalog and ACL contract.
DO $test$
DECLARE
  v_oid oid;
BEGIN
  SELECT function_proc.oid
  INTO v_oid
  FROM pg_catalog.pg_proc function_proc
  JOIN pg_catalog.pg_namespace function_namespace
    ON function_namespace.oid = function_proc.pronamespace
  WHERE function_namespace.nspname = 'public'
    AND function_proc.proname = 'brand_customer_commitment_patterns_rollup'
    AND pg_catalog.pg_get_function_identity_arguments(function_proc.oid) = 'p_brand_id uuid';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'H-1 FAIL: exact function signature missing';
  END IF;

  IF NOT (
    SELECT function_proc.prosecdef
      AND function_proc.provolatile = 's'
      AND COALESCE(function_proc.proconfig, '{}'::text[]) @> ARRAY['search_path=public']
    FROM pg_catalog.pg_proc function_proc
    WHERE function_proc.oid = v_oid
  ) THEN
    RAISE EXCEPTION 'H-1 FAIL: SECURITY DEFINER/STABLE/search_path contract mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc function_proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function_proc.proacl,
        pg_catalog.acldefault('f', function_proc.proowner)
      )
    ) function_acl
    WHERE function_proc.oid = v_oid
      AND function_acl.grantee = 0
      AND function_acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'H-1 FAIL: PUBLIC can execute';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.brand_customer_commitment_patterns_rollup(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'H-1 FAIL: anon can execute';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.brand_customer_commitment_patterns_rollup(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'H-1 FAIL: authenticated cannot execute';
  END IF;

  IF public.brand_customer_commitment_patterns_rollup(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'H-1 FAIL: NULL input did not return SQL NULL';
  END IF;

  RAISE NOTICE 'H-1 PASS: exact signature, SECURITY DEFINER, STABLE, pinned search_path, ACL, NULL';
END;
$test$;

-- Two brands owned by the same fixture user: one populated and one empty.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES (
  '00000000-0875-4000-8000-000000000a01',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'issue875-owner@example.test',
  now(),
  now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-0875-4000-8000-000000000a01', now());

INSERT INTO public.place_pool (id, name, lat, lng, created_at)
VALUES (
  '00000000-0875-4000-8000-000000000c01',
  'Issue 875 place',
  40.7,
  -74.0,
  now()
);

INSERT INTO public.brands (
  id,
  account_id,
  place_pool_id,
  default_currency,
  name,
  slug,
  created_at
)
VALUES
  (
    '00000000-0875-4000-8000-000000000b01',
    '00000000-0875-4000-8000-000000000a01',
    '00000000-0875-4000-8000-000000000c01',
    'GBP',
    'Issue 875 populated brand',
    'issue-875-populated-' || substr(md5(random()::text), 1, 8),
    now()
  ),
  (
    '00000000-0875-4000-8000-000000000b02',
    '00000000-0875-4000-8000-000000000a01',
    '00000000-0875-4000-8000-000000000c01',
    'USD',
    'Issue 875 empty brand',
    'issue-875-empty-' || substr(md5(random()::text), 1, 8),
    now()
  );

INSERT INTO public.venue_listings (
  id,
  brand_id,
  slug,
  name,
  lat,
  lng,
  venue_category
)
VALUES (
  '00000000-0875-4000-8000-000000000d01',
  '00000000-0875-4000-8000-000000000b01',
  'issue875venue' || substr(md5(random()::text), 1, 8),
  'Issue 875 venue',
  40.7,
  -74.0,
  'restaurant'
);

INSERT INTO public.venue_availability_config (
  id,
  brand_id,
  venue_id,
  place_pool_id,
  iana_timezone
)
VALUES (
  '00000000-0875-4000-8000-000000000d02',
  '00000000-0875-4000-8000-000000000b01',
  '00000000-0875-4000-8000-000000000d01',
  '00000000-0875-4000-8000-000000000c01',
  'UTC'
);

-- H-2: an unrelated authenticated caller receives the exact non-leaking shape.
DO $test$
DECLARE
  v_actual jsonb;
  v_expected jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0875-4000-8000-000000000fff',
    true
  );
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '00000000-0875-4000-8000-000000000fff',
      'role', 'authenticated'
    )::text,
    true
  );

  v_actual := public.brand_customer_commitment_patterns_rollup(
    '00000000-0875-4000-8000-000000000b01'
  );
  v_expected := jsonb_build_object(
    'brand_id', '00000000-0875-4000-8000-000000000b01'::uuid,
    'authorized', false,
    'generated_at', NULL,
    'window_days', 180,
    'metric', 'qualified_customer_commitments',
    'days', jsonb_build_object(
      'state', 'unauthorized',
      'sample_commitments', 0,
      'distinct_dates', 0,
      'positive_buckets', 0,
      'winner', NULL,
      'buckets', '[]'::jsonb
    ),
    'dayparts', jsonb_build_object(
      'state', 'unauthorized',
      'sample_commitments', 0,
      'distinct_dates', 0,
      'positive_buckets', 0,
      'winner', NULL,
      'buckets', '[]'::jsonb
    ),
    'types', jsonb_build_object(
      'state', 'unauthorized',
      'sample_commitments', 0,
      'distinct_dates', 0,
      'positive_buckets', 0,
      'winner', NULL,
      'buckets', '[]'::jsonb
    )
  );

  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'H-2 FAIL: unauthorized shape mismatch: %', v_actual;
  END IF;
  IF v_actual::text ~ 'issue875-owner@example\.test' THEN
    RAISE EXCEPTION 'H-2 FAIL: unauthorized response leaked seeded PII';
  END IF;

  RAISE NOTICE 'H-2 PASS: exact unauthorized response with no data leak';
END;
$test$;

-- Authenticate as the owner for every remaining assertion.
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0875-4000-8000-000000000a01',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0875-4000-8000-000000000a01',
    'role', 'authenticated'
  )::text,
  true
);

-- H-3: an authorized brand with no qualified rows reports honest no-data.
DO $test$
DECLARE
  v_result jsonb;
  v_view text;
BEGIN
  v_result := public.brand_customer_commitment_patterns_rollup(
    '00000000-0875-4000-8000-000000000b02'
  );

  IF (v_result->>'authorized')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'H-3 FAIL: owner was not authorized: %', v_result;
  END IF;

  FOREACH v_view IN ARRAY ARRAY['days', 'dayparts', 'types'] LOOP
    IF v_result->v_view->>'state' <> 'no_data'
      OR (v_result->v_view->>'sample_commitments')::bigint <> 0
      OR (v_result->v_view->>'distinct_dates')::bigint <> 0
      OR (v_result->v_view->>'positive_buckets')::integer <> 0
      OR v_result->v_view->'winner' <> 'null'::jsonb
      OR v_result->v_view->'buckets' <> '[]'::jsonb
    THEN
      RAISE EXCEPTION 'H-3 FAIL: % was not exact no_data: %', v_view, v_result->v_view;
    END IF;
  END LOOP;

  RAISE NOTICE 'H-3 PASS: authorized empty brand returns exact no_data views';
END;
$test$;

-- Offering fixtures. E1 has an explicitly-linked occurrence; E2/E3/E4 have one
-- occurrence each and exercise the unambiguous NULL-link/RSVP fallback.
INSERT INTO public.events (
  id,
  brand_id,
  created_by,
  title,
  slug,
  timezone,
  event_type,
  created_at
)
VALUES
  ('00000000-0875-4000-8000-000000000e01','00000000-0875-4000-8000-000000000b01','00000000-0875-4000-8000-000000000a01','Event','issue875-event-'||substr(md5(random()::text),1,8),'UTC','event',now()),
  ('00000000-0875-4000-8000-000000000e02','00000000-0875-4000-8000-000000000b01','00000000-0875-4000-8000-000000000a01','Trip','issue875-trip-'||substr(md5(random()::text),1,8),'UTC','trip',now()),
  ('00000000-0875-4000-8000-000000000e03','00000000-0875-4000-8000-000000000b01','00000000-0875-4000-8000-000000000a01','Experience','issue875-experience-'||substr(md5(random()::text),1,8),'UTC','experience',now()),
  ('00000000-0875-4000-8000-000000000e04','00000000-0875-4000-8000-000000000b01','00000000-0875-4000-8000-000000000a01','RSVP','issue875-rsvp-'||substr(md5(random()::text),1,8),'UTC','rsvp',now()),
  ('00000000-0875-4000-8000-000000000e05','00000000-0875-4000-8000-000000000b01','00000000-0875-4000-8000-000000000a01','Boundary','issue875-boundary-'||substr(md5(random()::text),1,8),'UTC','event',now()),
  ('00000000-0875-4000-8000-000000000e06','00000000-0875-4000-8000-000000000b01','00000000-0875-4000-8000-000000000a01','Exactly now','issue875-now-'||substr(md5(random()::text),1,8),'UTC','event',now()),
  ('00000000-0875-4000-8000-000000000e07','00000000-0875-4000-8000-000000000b01','00000000-0875-4000-8000-000000000a01','Future','issue875-future-'||substr(md5(random()::text),1,8),'UTC','event',now()),
  ('00000000-0875-4000-8000-000000000e08','00000000-0875-4000-8000-000000000b01','00000000-0875-4000-8000-000000000a01','Outside','issue875-outside-'||substr(md5(random()::text),1,8),'UTC','event',now());

INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
SELECT
  fixture.id,
  fixture.event_id,
  fixture.start_at,
  fixture.start_at + interval '2 hours',
  'UTC',
  true
FROM (
  VALUES
    ('00000000-0875-4000-8000-000000000f01'::uuid, '00000000-0875-4000-8000-000000000e01'::uuid, (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '7 days' + interval '18 hours') AT TIME ZONE 'UTC'),
    ('00000000-0875-4000-8000-000000000f02'::uuid, '00000000-0875-4000-8000-000000000e02'::uuid, (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '14 days' + interval '18 hours') AT TIME ZONE 'UTC'),
    ('00000000-0875-4000-8000-000000000f03'::uuid, '00000000-0875-4000-8000-000000000e03'::uuid, (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '21 days' + interval '13 hours') AT TIME ZONE 'UTC'),
    ('00000000-0875-4000-8000-000000000f04'::uuid, '00000000-0875-4000-8000-000000000e04'::uuid, (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '28 days' + interval '9 hours') AT TIME ZONE 'UTC'),
    ('00000000-0875-4000-8000-000000000f05'::uuid, '00000000-0875-4000-8000-000000000e05'::uuid, now() - interval '180 days'),
    ('00000000-0875-4000-8000-000000000f06'::uuid, '00000000-0875-4000-8000-000000000e06'::uuid, now()),
    ('00000000-0875-4000-8000-000000000f07'::uuid, '00000000-0875-4000-8000-000000000e07'::uuid, now() + interval '1 second'),
    ('00000000-0875-4000-8000-000000000f08'::uuid, '00000000-0875-4000-8000-000000000e08'::uuid, now() - interval '180 days 1 second')
) AS fixture(id, event_id, start_at);

-- Six distinct E1 customers plus one duplicate order for the same normalized
-- customer/occurrence. E2 includes that same customer on another occurrence.
INSERT INTO public.orders (
  id,
  event_id,
  event_date_id,
  buyer_email,
  buyer_phone_e164,
  confirmed_at,
  created_at,
  total_cents,
  refunded_amount_cents,
  payment_status,
  currency,
  source
)
VALUES
  ('00000000-0875-4000-8000-000000001001','00000000-0875-4000-8000-000000000e01','00000000-0875-4000-8000-000000000f01','alpha@example.test','+15550875001',now(),now(),1000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001002','00000000-0875-4000-8000-000000000e01','00000000-0875-4000-8000-000000000f01','bravo@example.test','+15550875002',now(),now(),2000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001003','00000000-0875-4000-8000-000000000e01','00000000-0875-4000-8000-000000000f01','charlie@example.test','+15550875003',now(),now(),3000,0,'partial_refund','USD','online_checkout'),
  ('00000000-0875-4000-8000-000000001004','00000000-0875-4000-8000-000000000e01','00000000-0875-4000-8000-000000000f01','delta@example.test','+15550875004',now(),now(),4000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001005','00000000-0875-4000-8000-000000000e01','00000000-0875-4000-8000-000000000f01','echo@example.test','+15550875005',now(),now(),5000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001006','00000000-0875-4000-8000-000000000e01','00000000-0875-4000-8000-000000000f01','foxtrot@example.test','+15550875006',now(),now(),6000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001007','00000000-0875-4000-8000-000000000e01','00000000-0875-4000-8000-000000000f01',' ALPHA@example.test ','+15550875999',now(),now(),999999,0,'paid','NGN','online_checkout'),
  ('00000000-0875-4000-8000-000000001008','00000000-0875-4000-8000-000000000e02',NULL,'alpha@example.test','+15550875001',now(),now(),7000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001009','00000000-0875-4000-8000-000000000e02',NULL,'golf@example.test','+15550875007',now(),now(),8000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001010','00000000-0875-4000-8000-000000000e03',NULL,'hotel@example.test','+15550875008',now(),now(),9000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001011','00000000-0875-4000-8000-000000000e05',NULL,'boundary@example.test','+15550875009',now(),now(),10000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001012','00000000-0875-4000-8000-000000000e06',NULL,'now@example.test','+15550875010',now(),now(),11000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001013','00000000-0875-4000-8000-000000000e07',NULL,'future@example.test','+15550875011',now(),now(),12000,0,'paid','GBP','online_checkout'),
  ('00000000-0875-4000-8000-000000001014','00000000-0875-4000-8000-000000000e08',NULL,'outside@example.test','+15550875012',now(),now(),13000,0,'paid','GBP','online_checkout');

INSERT INTO public.event_rsvps (
  id,
  event_id,
  guest_name,
  guest_email,
  guest_phone,
  rsvp_status,
  approval_status,
  plus_count
)
VALUES (
  '00000000-0875-4000-8000-000000001101',
  '00000000-0875-4000-8000-000000000e04',
  'India',
  'india@example.test',
  '+15550875013',
  'going',
  'approved',
  9
);

INSERT INTO public.reservations (
  id,
  brand_id,
  venue_id,
  reserved_for,
  party_size,
  status,
  source,
  guest_email,
  guest_phone_e164,
  fee_cents,
  fee_currency,
  payment_status,
  created_at
)
VALUES (
  '00000000-0875-4000-8000-000000001201',
  '00000000-0875-4000-8000-000000000b01',
  '00000000-0875-4000-8000-000000000d01',
  (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '35 days' + interval '18 hours') AT TIME ZONE 'UTC',
  40,
  'completed',
  'mingla',
  'juliet@example.test',
  '+15550875014',
  777777,
  'USD',
  'paid',
  now()
);

-- H-4 through H-8: all five sources/types, dedupe, occurrence mapping, cohort,
-- deterministic buckets, and exact winner rules.
DO $test$
DECLARE
  v_result jsonb;
  v_expected_day_key text;
  v_expected_day_label text;
  v_expected_evening bigint;
  v_type_keys text[];
BEGIN
  v_result := public.brand_customer_commitment_patterns_rollup(
    '00000000-0875-4000-8000-000000000b01'
  );
  v_expected_day_key := lower(trim(to_char(
    (now() AT TIME ZONE 'UTC' - interval '7 days')::date,
    'FMDay'
  )));
  v_expected_day_label := initcap(v_expected_day_key);
  v_expected_evening := 9 + CASE
    WHEN (now() AT TIME ZONE 'UTC')::time >= time '17:00:00'
      AND (now() AT TIME ZONE 'UTC')::time < time '21:00:00'
    THEN 1 ELSE 0
  END;

  IF (v_result->>'authorized')::boolean IS DISTINCT FROM true
    OR v_result->>'metric' <> 'qualified_customer_commitments'
    OR (v_result->>'window_days')::integer <> 180
    OR v_result->>'generated_at' IS NULL
  THEN
    RAISE EXCEPTION 'H-4 FAIL: authorized envelope mismatch: %', v_result;
  END IF;

  -- Eligible normalized commitments:
  -- E1=6 (duplicate alpha removed), E2=2 (NULL sole-date fallback),
  -- E3=1, RSVP=1, reservation=1, exact-180-day boundary=1 => 12.
  IF (v_result->'days'->>'sample_commitments')::bigint <> 12
    OR (v_result->'dayparts'->>'sample_commitments')::bigint <> 12
    OR (v_result->'types'->>'sample_commitments')::bigint <> 12
  THEN
    RAISE EXCEPTION 'H-4/H-5/H-6/H-7/H-8 FAIL: expected 12 deduped eligible commitments before exact winner checks: %', v_result;
  END IF;

  IF (v_result->'days'->>'distinct_dates')::bigint <> 6 THEN
    RAISE EXCEPTION 'H-4/H-7 FAIL: expected 6 distinct scheduled-local dates: %', v_result->'days';
  END IF;

  SELECT array_agg(bucket->>'key' ORDER BY bucket->>'key')
  INTO v_type_keys
  FROM jsonb_array_elements(v_result->'types'->'buckets') bucket;
  IF v_type_keys IS DISTINCT FROM ARRAY[
    'event',
    'experience',
    'rsvp',
    'trip',
    'venue_reservation'
  ]::text[] THEN
    RAISE EXCEPTION 'H-4/H-11 FAIL: exact five type keys missing: %', v_type_keys;
  END IF;

  IF (SELECT (bucket->>'commitments')::bigint FROM jsonb_array_elements(v_result->'types'->'buckets') bucket WHERE bucket->>'key'='event') <> 7
    OR (SELECT (bucket->>'commitments')::bigint FROM jsonb_array_elements(v_result->'types'->'buckets') bucket WHERE bucket->>'key'='trip') <> 2
    OR (SELECT (bucket->>'commitments')::bigint FROM jsonb_array_elements(v_result->'types'->'buckets') bucket WHERE bucket->>'key'='experience') <> 1
    OR (SELECT (bucket->>'commitments')::bigint FROM jsonb_array_elements(v_result->'types'->'buckets') bucket WHERE bucket->>'key'='rsvp') <> 1
    OR (SELECT (bucket->>'commitments')::bigint FROM jsonb_array_elements(v_result->'types'->'buckets') bucket WHERE bucket->>'key'='venue_reservation') <> 1
  THEN
    RAISE EXCEPTION 'H-4/H-5/H-6 FAIL: type commitment counts mismatch: %', v_result->'types';
  END IF;

  IF v_result->'days'->>'state' <> 'winner'
    OR v_result->'days'->'winner'->>'key' <> v_expected_day_key
    OR v_result->'days'->'winner'->>'label' <> v_expected_day_label
    OR (v_result->'days'->'winner'->>'commitments')::bigint <> 11
  THEN
    RAISE EXCEPTION 'H-8 FAIL: day winner mismatch: expected %/11, got %',
      v_expected_day_key, v_result->'days';
  END IF;

  IF v_result->'dayparts'->>'state' <> 'winner'
    OR v_result->'dayparts'->'winner'->>'key' <> 'evening'
    OR v_result->'dayparts'->'winner'->>'label' <> 'Evening'
    OR (v_result->'dayparts'->'winner'->>'commitments')::bigint <> v_expected_evening
  THEN
    RAISE EXCEPTION 'H-8 FAIL: daypart winner mismatch: expected evening/%, got %',
      v_expected_evening, v_result->'dayparts';
  END IF;

  IF v_result->'types'->>'state' <> 'winner'
    OR v_result->'types'->'winner' <> '{"key":"event","label":"Event","commitments":7}'::jsonb
  THEN
    RAISE EXCEPTION 'H-8 FAIL: type winner mismatch: %', v_result->'types';
  END IF;

  IF v_result->'days'->'buckets'->0->>'key' <> v_expected_day_key
    OR v_result->'dayparts'->'buckets'->0->>'key' <> 'evening'
    OR v_result->'types'->'buckets'->0->>'key' <> 'event'
  THEN
    RAISE EXCEPTION 'H-8 FAIL: descending deterministic winner order mismatch: %', v_result;
  END IF;

  RAISE NOTICE 'H-4/H-5/H-6/H-7/H-8 PASS: qualification, dedupe, occurrence, cohort, exact winners';
END;
$test$;

-- Add five more distinct trip customers on the existing trip occurrence.
-- Days/dayparts keep a strong winner while type becomes an exact 7–7 tie.
INSERT INTO public.orders (
  event_id,
  event_date_id,
  buyer_email,
  buyer_phone_e164,
  confirmed_at,
  total_cents,
  payment_status,
  currency,
  source
)
SELECT
  '00000000-0875-4000-8000-000000000e02',
  NULL,
  'type-tie-' || series_number || '@example.test',
  '+15550876' || lpad(series_number::text, 3, '0'),
  now(),
  1,
  'paid',
  'GBP',
  'online_checkout'
FROM generate_series(1, 5) AS series_number;

-- H-9: each view evaluates its state independently.
DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.brand_customer_commitment_patterns_rollup(
    '00000000-0875-4000-8000-000000000b01'
  );

  IF v_result->'days'->>'state' <> 'winner'
    OR v_result->'dayparts'->>'state' <> 'winner'
    OR v_result->'types'->>'state' <> 'no_clear_pattern'
    OR v_result->'types'->'winner' <> 'null'::jsonb
  THEN
    RAISE EXCEPTION 'H-9 FAIL: per-view states were not independent: %', v_result;
  END IF;

  IF (SELECT (bucket->>'commitments')::bigint FROM jsonb_array_elements(v_result->'types'->'buckets') bucket WHERE bucket->>'key'='event') <> 7
    OR (SELECT (bucket->>'commitments')::bigint FROM jsonb_array_elements(v_result->'types'->'buckets') bucket WHERE bucket->>'key'='trip') <> 7
  THEN
    RAISE EXCEPTION 'H-9 FAIL: expected exact event/trip tie: %', v_result->'types';
  END IF;

  RAISE NOTICE 'H-9 PASS: days/dayparts winner while types independently reports no_clear_pattern';
END;
$test$;

-- H-10: response contains only aggregate contract keys and no seeded PII/money/
-- occurrence identifiers or predictive language.
DO $test$
DECLARE
  v_result jsonb;
  v_top_keys text[];
  v_view text;
  v_view_keys text[];
BEGIN
  v_result := public.brand_customer_commitment_patterns_rollup(
    '00000000-0875-4000-8000-000000000b01'
  );

  SELECT array_agg(key ORDER BY key)
  INTO v_top_keys
  FROM jsonb_object_keys(v_result) AS key;
  IF v_top_keys IS DISTINCT FROM ARRAY[
    'authorized',
    'brand_id',
    'dayparts',
    'days',
    'generated_at',
    'metric',
    'types',
    'window_days'
  ]::text[] THEN
    RAISE EXCEPTION 'H-10 FAIL: top-level key whitelist mismatch: %', v_top_keys;
  END IF;

  FOREACH v_view IN ARRAY ARRAY['days', 'dayparts', 'types'] LOOP
    SELECT array_agg(key ORDER BY key)
    INTO v_view_keys
    FROM jsonb_object_keys(v_result->v_view) AS key;
    IF v_view_keys IS DISTINCT FROM ARRAY[
      'buckets',
      'distinct_dates',
      'positive_buckets',
      'sample_commitments',
      'state',
      'winner'
    ]::text[] THEN
      RAISE EXCEPTION 'H-10 FAIL: % key whitelist mismatch: %', v_view, v_view_keys;
    END IF;
  END LOOP;

  IF lower(v_result::text) ~ '"(email|phone|customer|order|rsvp|reservation|occurrence|timezone|revenue|currency|scan|cover|party_size|source|confidence|recommendation|prediction)"[ ]*:'
    OR position('alpha@example.test' IN v_result::text) > 0
    OR position('+15550875' IN v_result::text) > 0
    OR position('999999' IN v_result::text) > 0
    OR position('777777' IN v_result::text) > 0
    OR position('00000000-0875-4000-8000-000000000f01' IN v_result::text) > 0
    OR position('00000000-0875-4000-8000-000000001001' IN v_result::text) > 0
  THEN
    RAISE EXCEPTION 'H-10 FAIL: PII/money/internal-id/predictive data leaked: %', v_result;
  END IF;

  RAISE NOTICE 'H-10 PASS: aggregate-only key whitelist; no PII, money, internal ids, or prediction';
END;
$test$;

ROLLBACK;
