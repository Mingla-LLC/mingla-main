-- ISSUE #1406 — independent tester adversarial regression suite.
-- Apply every repository migration first. Every object and fixture below is
-- transaction-local and is removed by the final rollback.

\set ON_ERROR_STOP on
BEGIN;

-- A-1: independently prove the lookup's immutable contract, including an
-- actual duplicate insert rejection and coverage of every currently stored
-- schedule timezone before adversarial invalid fixtures are introduced.
DO $test$
DECLARE
  v_column_count integer;
  v_primary_key_count integer;
  v_timezone_count bigint;
  v_missing_timezone text;
  v_duplicate_rejected boolean := false;
BEGIN
  SELECT COUNT(*)::integer
  INTO v_column_count
  FROM pg_catalog.pg_attribute table_column
  WHERE table_column.attrelid = 'public.analytics_iana_timezones'::regclass
    AND table_column.attnum > 0
    AND NOT table_column.attisdropped;

  SELECT COUNT(*)::integer
  INTO v_primary_key_count
  FROM pg_catalog.pg_constraint table_constraint
  WHERE table_constraint.conrelid = 'public.analytics_iana_timezones'::regclass
    AND table_constraint.contype = 'p'
    AND table_constraint.conkey = ARRAY[
      (
        SELECT table_column.attnum
        FROM pg_catalog.pg_attribute table_column
        WHERE table_column.attrelid = 'public.analytics_iana_timezones'::regclass
          AND table_column.attname = 'name'
          AND NOT table_column.attisdropped
      )
    ]::smallint[];

  SELECT COUNT(*)
  INTO v_timezone_count
  FROM public.analytics_iana_timezones;

  WITH used_timezones AS (
    SELECT event_date.timezone AS timezone_name
    FROM public.event_dates event_date
    WHERE event_date.timezone IS NOT NULL

    UNION

    SELECT availability.iana_timezone
    FROM public.venue_availability_config availability
    WHERE availability.iana_timezone IS NOT NULL
  )
  SELECT used_timezones.timezone_name
  INTO v_missing_timezone
  FROM used_timezones
  LEFT JOIN public.analytics_iana_timezones recognized_timezone
    ON recognized_timezone.name = used_timezones.timezone_name
  WHERE recognized_timezone.name IS NULL
  ORDER BY used_timezones.timezone_name
  LIMIT 1;

  BEGIN
    INSERT INTO public.analytics_iana_timezones (name)
    VALUES ('UTC');
  EXCEPTION
    WHEN unique_violation THEN
      v_duplicate_rejected := true;
  END;

  IF v_column_count <> 1
    OR v_primary_key_count <> 1
    OR v_timezone_count < 1000
    OR v_missing_timezone IS NOT NULL
    OR NOT v_duplicate_rejected
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute table_column
      WHERE table_column.attrelid = 'public.analytics_iana_timezones'::regclass
        AND table_column.attname = 'name'
        AND table_column.atttypid = 'text'::regtype
        AND table_column.attnotnull
    )
  THEN
    RAISE EXCEPTION
      'A-1 FAIL: lookup contract mismatch columns=%, pk=%, count=%, missing=%, duplicate_rejected=%',
      v_column_count,
      v_primary_key_count,
      v_timezone_count,
      v_missing_timezone,
      v_duplicate_rejected;
  END IF;

  RAISE NOTICE 'A-1 PASS: lookup cardinality, sole text PK, duplicate rejection, and current-zone coverage';
END;
$test$;

-- A-2: execute real SELECT/INSERT/UPDATE/DELETE/TRUNCATE attempts as a role
-- having only PUBLIC rights and as all three Supabase API roles. SECURITY
-- INVOKER is deliberate: a catalog-only privilege check is not enough.
CREATE ROLE issue1406_public_probe NOLOGIN;
GRANT issue1406_public_probe TO postgres;

CREATE TABLE public.issue1406_tester_role_results (
  role_name text NOT NULL,
  operation text NOT NULL,
  denied boolean NOT NULL
);

GRANT INSERT ON TABLE public.issue1406_tester_role_results
  TO issue1406_public_probe, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue1406_tester_lookup_operation_denied(
  p_operation text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $helper$
BEGIN
  CASE p_operation
    WHEN 'select' THEN
      PERFORM timezone_name.name
      FROM public.analytics_iana_timezones timezone_name
      LIMIT 1;
    WHEN 'insert' THEN
      INSERT INTO public.analytics_iana_timezones (name)
      VALUES ('Issue1406/ForbiddenWrite');
    WHEN 'update' THEN
      UPDATE public.analytics_iana_timezones
      SET name = name
      WHERE name = 'UTC';
    WHEN 'delete' THEN
      DELETE FROM public.analytics_iana_timezones
      WHERE name = 'UTC';
    WHEN 'truncate' THEN
      TRUNCATE TABLE public.analytics_iana_timezones;
    ELSE
      RAISE EXCEPTION 'A-2 fixture error: unknown operation %', p_operation;
  END CASE;

  RETURN false;
EXCEPTION
  WHEN insufficient_privilege THEN
    RETURN true;
END;
$helper$;

GRANT EXECUTE ON FUNCTION public.issue1406_tester_lookup_operation_denied(text)
  TO PUBLIC;

SET LOCAL ROLE issue1406_public_probe;
INSERT INTO public.issue1406_tester_role_results
SELECT 'PUBLIC', operation_name, public.issue1406_tester_lookup_operation_denied(operation_name)
FROM unnest(ARRAY['select', 'insert', 'update', 'delete', 'truncate']) operation_name;
RESET ROLE;

SET LOCAL ROLE anon;
INSERT INTO public.issue1406_tester_role_results
SELECT 'anon', operation_name, public.issue1406_tester_lookup_operation_denied(operation_name)
FROM unnest(ARRAY['select', 'insert', 'update', 'delete', 'truncate']) operation_name;
RESET ROLE;

SET LOCAL ROLE authenticated;
INSERT INTO public.issue1406_tester_role_results
SELECT 'authenticated', operation_name, public.issue1406_tester_lookup_operation_denied(operation_name)
FROM unnest(ARRAY['select', 'insert', 'update', 'delete', 'truncate']) operation_name;
RESET ROLE;

SET LOCAL ROLE service_role;
INSERT INTO public.issue1406_tester_role_results
SELECT 'service_role', operation_name, public.issue1406_tester_lookup_operation_denied(operation_name)
FROM unnest(ARRAY['select', 'insert', 'update', 'delete', 'truncate']) operation_name;
RESET ROLE;

DO $test$
DECLARE
  v_attempt_count integer;
  v_allowed_attempts text;
BEGIN
  SELECT COUNT(*)::integer
  INTO v_attempt_count
  FROM public.issue1406_tester_role_results;

  SELECT string_agg(role_name || ':' || operation, ', ' ORDER BY role_name, operation)
  INTO v_allowed_attempts
  FROM public.issue1406_tester_role_results
  WHERE NOT denied;

  IF v_attempt_count <> 20 OR v_allowed_attempts IS NOT NULL THEN
    RAISE EXCEPTION 'A-2 FAIL: attempts=%, unexpectedly allowed=%',
      v_attempt_count,
      v_allowed_attempts;
  END IF;

  RAISE NOTICE 'A-2 PASS: PUBLIC/anon/authenticated/service_role actual reads and mutations denied';
END;
$test$;

-- Independent owner, unrelated identity, brand, and one valid candidate.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  (
    '00000000-1406-4000-8000-00000000a101',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'issue1406-tester-owner@example.test',
    now(),
    now()
  ),
  (
    '00000000-1406-4000-8000-00000000a102',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'issue1406-tester-unrelated@example.test',
    now(),
    now()
  );

INSERT INTO public.creator_accounts (id, created_at)
VALUES
  ('00000000-1406-4000-8000-00000000a101', now()),
  ('00000000-1406-4000-8000-00000000a102', now());

INSERT INTO public.place_pool (id, name, lat, lng, created_at)
VALUES (
  '00000000-1406-4000-8000-00000000c101',
  'Issue 1406 tester place',
  47.6,
  -52.7,
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
VALUES (
  '00000000-1406-4000-8000-00000000b101',
  '00000000-1406-4000-8000-00000000a101',
  '00000000-1406-4000-8000-00000000c101',
  'CAD',
  'Issue 1406 tester brand',
  'issue-1406-tester-brand-' || substr(md5(random()::text), 1, 8),
  now()
);

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
  (
    '00000000-1406-4000-8000-00000000e101',
    '00000000-1406-4000-8000-00000000b101',
    '00000000-1406-4000-8000-00000000a101',
    'Valid lookup-backed event',
    'issue-1406-tester-valid-' || substr(md5(random()::text), 1, 8),
    'America/St_Johns',
    'event',
    now()
  ),
  (
    '00000000-1406-4000-8000-00000000e102',
    '00000000-1406-4000-8000-00000000b101',
    '00000000-1406-4000-8000-00000000a101',
    'Invalid order timezone',
    'issue-1406-tester-order-invalid-' || substr(md5(random()::text), 1, 8),
    'UTC',
    'event',
    now()
  ),
  (
    '00000000-1406-4000-8000-00000000e103',
    '00000000-1406-4000-8000-00000000b101',
    '00000000-1406-4000-8000-00000000a101',
    'Invalid RSVP timezone',
    'issue-1406-tester-rsvp-invalid-' || substr(md5(random()::text), 1, 8),
    'UTC',
    'rsvp',
    now()
  );

INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
VALUES
  (
    '00000000-1406-4000-8000-00000000f101',
    '00000000-1406-4000-8000-00000000e101',
    now() - interval '10 days',
    now() - interval '10 days' + interval '2 hours',
    'America/St_Johns',
    true
  ),
  (
    '00000000-1406-4000-8000-00000000f102',
    '00000000-1406-4000-8000-00000000e102',
    now() - interval '11 days',
    now() - interval '11 days' + interval '2 hours',
    'Issue1406/BadOrder',
    true
  ),
  (
    '00000000-1406-4000-8000-00000000f103',
    '00000000-1406-4000-8000-00000000e103',
    now() - interval '12 days',
    now() - interval '12 days' + interval '2 hours',
    'Issue1406/BadRSVP',
    true
  );

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
  (
    '00000000-1406-4000-8000-000000001301',
    '00000000-1406-4000-8000-00000000e101',
    '00000000-1406-4000-8000-00000000f101',
    'valid-candidate@issue1406.test',
    '+15551406301',
    now(),
    now(),
    123456,
    0,
    'paid',
    'CAD',
    'online_checkout'
  ),
  (
    '00000000-1406-4000-8000-000000001302',
    '00000000-1406-4000-8000-00000000e102',
    '00000000-1406-4000-8000-00000000f102',
    'bad-order-zone@issue1406.test',
    '+15551406302',
    now(),
    now(),
    654321,
    0,
    'paid',
    'USD',
    'online_checkout'
  );

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
  '00000000-1406-4000-8000-000000001401',
  '00000000-1406-4000-8000-00000000e103',
  'Invalid RSVP zone',
  'bad-rsvp-zone@issue1406.test',
  '+15551406401',
  'going',
  'approved',
  50
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
  '00000000-1406-4000-8000-00000000d101',
  '00000000-1406-4000-8000-00000000b101',
  'issue1406tester' || substr(md5(random()::text), 1, 8),
  'Issue 1406 invalid-zone venue',
  47.6,
  -52.7,
  'restaurant'
);

-- Simulate a legacy/corrupted reservation timezone that bypassed the current
-- write-time trigger. The trigger state and fixture are transaction-local.
ALTER TABLE public.venue_availability_config
  DISABLE TRIGGER venue_availability_config_validate_tz;

INSERT INTO public.venue_availability_config (
  id,
  brand_id,
  venue_id,
  place_pool_id,
  iana_timezone
)
VALUES (
  '00000000-1406-4000-8000-00000000d102',
  '00000000-1406-4000-8000-00000000b101',
  '00000000-1406-4000-8000-00000000d101',
  '00000000-1406-4000-8000-00000000c101',
  'Issue1406/BadVenue'
);

ALTER TABLE public.venue_availability_config
  ENABLE TRIGGER venue_availability_config_validate_tz;

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
  '00000000-1406-4000-8000-000000001501',
  '00000000-1406-4000-8000-00000000b101',
  '00000000-1406-4000-8000-00000000d101',
  now() - interval '13 days',
  75,
  'completed',
  'mingla',
  'bad-venue-zone@issue1406.test',
  '+15551406501',
  987654,
  'USD',
  'paid',
  now()
);

CREATE TABLE public.issue1406_tester_rpc_results (
  scenario text PRIMARY KEY,
  rpc_result jsonb
);
GRANT INSERT ON TABLE public.issue1406_tester_rpc_results TO authenticated;

-- A-3: an unrelated authenticated caller receives the exact unauthorized
-- envelope, while NULL remains NULL before authorization.
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-1406-4000-8000-00000000a102',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1406-4000-8000-00000000a102',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SET LOCAL ROLE authenticated;
INSERT INTO public.issue1406_tester_rpc_results (scenario, rpc_result)
VALUES
  (
    'unrelated',
    public.brand_customer_commitment_patterns_rollup(
      '00000000-1406-4000-8000-00000000b101'
    )
  ),
  (
    'null',
    public.brand_customer_commitment_patterns_rollup(NULL)
  );
RESET ROLE;

DO $test$
DECLARE
  v_unauthorized jsonb;
  v_expected jsonb;
  v_null_result jsonb;
BEGIN
  SELECT rpc_result
  INTO v_unauthorized
  FROM public.issue1406_tester_rpc_results
  WHERE scenario = 'unrelated';

  SELECT rpc_result
  INTO v_null_result
  FROM public.issue1406_tester_rpc_results
  WHERE scenario = 'null';

  v_expected := jsonb_build_object(
    'brand_id', '00000000-1406-4000-8000-00000000b101'::uuid,
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

  IF v_unauthorized IS DISTINCT FROM v_expected OR v_null_result IS NOT NULL THEN
    RAISE EXCEPTION 'A-3 FAIL: exact unauthorized/NULL semantics drifted unauthorized=%, null=%',
      v_unauthorized,
      v_null_result;
  END IF;

  RAISE NOTICE 'A-3 PASS: NULL and exact unrelated-authenticated envelope preserved';
END;
$test$;

CREATE OR REPLACE FUNCTION public.issue1406_tester_rpc_execute_denied(
  p_brand_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $helper$
BEGIN
  PERFORM public.brand_customer_commitment_patterns_rollup(p_brand_id);
  RETURN false;
EXCEPTION
  WHEN insufficient_privilege THEN
    RETURN true;
END;
$helper$;
GRANT EXECUTE ON FUNCTION public.issue1406_tester_rpc_execute_denied(uuid)
  TO PUBLIC;

CREATE TABLE public.issue1406_tester_rpc_acl_results (
  role_name text PRIMARY KEY,
  denied boolean NOT NULL
);
GRANT INSERT ON TABLE public.issue1406_tester_rpc_acl_results
  TO issue1406_public_probe, anon;

SET LOCAL ROLE issue1406_public_probe;
INSERT INTO public.issue1406_tester_rpc_acl_results
VALUES (
  'PUBLIC',
  public.issue1406_tester_rpc_execute_denied(
    '00000000-1406-4000-8000-00000000b101'
  )
);
RESET ROLE;

SET LOCAL ROLE anon;
INSERT INTO public.issue1406_tester_rpc_acl_results
VALUES (
  'anon',
  public.issue1406_tester_rpc_execute_denied(
    '00000000-1406-4000-8000-00000000b101'
  )
);
RESET ROLE;

DO $test$
BEGIN
  IF (SELECT COUNT(*) FROM public.issue1406_tester_rpc_acl_results) <> 2
    OR EXISTS (
      SELECT 1
      FROM public.issue1406_tester_rpc_acl_results
      WHERE NOT denied
    )
  THEN
    RAISE EXCEPTION 'A-3 FAIL: PUBLIC/anon RPC execution was not denied: %',
      (SELECT jsonb_agg(to_jsonb(result_row))
       FROM public.issue1406_tester_rpc_acl_results result_row);
  END IF;

  RAISE NOTICE 'A-3 PASS: PUBLIC and anon cannot execute the private RPC';
END;
$test$;

-- A-4: the owner-authorized call must admit only the valid lookup-backed
-- order. Invalid timezone values in order, RSVP, and reservation arms must
-- disappear without SQLSTATE 22023, fallback, or inflated commitments.
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-1406-4000-8000-00000000a101',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1406-4000-8000-00000000a101',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SET LOCAL ROLE authenticated;
INSERT INTO public.issue1406_tester_rpc_results (scenario, rpc_result)
VALUES (
  'owner',
  public.brand_customer_commitment_patterns_rollup(
    '00000000-1406-4000-8000-00000000b101'
  )
);
RESET ROLE;

DO $test$
DECLARE
  v_result jsonb;
  v_top_keys text[];
  v_view_keys text[];
  v_type_keys text[];
BEGIN
  SELECT rpc_result
  INTO v_result
  FROM public.issue1406_tester_rpc_results
  WHERE scenario = 'owner';

  SELECT array_agg(object_key ORDER BY object_key)
  INTO v_top_keys
  FROM jsonb_object_keys(v_result) object_key;

  SELECT array_agg(object_key ORDER BY object_key)
  INTO v_view_keys
  FROM jsonb_object_keys(v_result->'days') object_key;

  SELECT array_agg(bucket->>'key' ORDER BY bucket->>'key')
  INTO v_type_keys
  FROM jsonb_array_elements(v_result->'types'->'buckets') bucket;

  IF (v_result->>'authorized')::boolean IS DISTINCT FROM true
    OR v_result->>'metric' <> 'qualified_customer_commitments'
    OR (v_result->>'window_days')::integer <> 180
    OR (v_result->'days'->>'sample_commitments')::integer <> 1
    OR (v_result->'dayparts'->>'sample_commitments')::integer <> 1
    OR (v_result->'types'->>'sample_commitments')::integer <> 1
    OR v_type_keys IS DISTINCT FROM ARRAY['event']::text[]
    OR v_top_keys IS DISTINCT FROM ARRAY[
      'authorized',
      'brand_id',
      'dayparts',
      'days',
      'generated_at',
      'metric',
      'types',
      'window_days'
    ]::text[]
    OR v_view_keys IS DISTINCT FROM ARRAY[
      'buckets',
      'distinct_dates',
      'positive_buckets',
      'sample_commitments',
      'state',
      'winner'
    ]::text[]
    OR v_result::text ~* '(buyer_email|guest_email|phone|currency|cents|revenue|customer_key|occurrence_key|scheduled_timezone)'
    OR v_result::text LIKE '%issue1406.test%'
    OR v_result::text LIKE '%+15551406%'
    OR v_result::text LIKE '%987654%'
  THEN
    RAISE EXCEPTION 'A-4 FAIL: invalid-arm exclusion/auth payload mismatch: %', v_result;
  END IF;

  RAISE NOTICE 'A-4 PASS: invalid order/RSVP/reservation timezones excluded without fallback or leakage';
END;
$test$;

-- A-5: deleting the valid candidate's timezone from the lookup must make the
-- candidate honestly disappear. Rolling back to the savepoint must restore
-- both the lookup row and the exact admitted sample.
SAVEPOINT issue1406_candidate_timezone_delete;

DELETE FROM public.analytics_iana_timezones
WHERE name = 'America/St_Johns';

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.analytics_iana_timezones
    WHERE name = 'America/St_Johns'
  ) THEN
    RAISE EXCEPTION 'A-5 fixture error: candidate timezone deletion did not occur';
  END IF;

  v_result := public.brand_customer_commitment_patterns_rollup(
    '00000000-1406-4000-8000-00000000b101'
  );

  IF (v_result->>'authorized')::boolean IS DISTINCT FROM true
    OR (v_result->'days'->>'sample_commitments')::integer <> 0
    OR v_result->'days'->>'state' <> 'no_data'
  THEN
    RAISE EXCEPTION 'A-5 FAIL: deleted lookup timezone did not honestly remove candidate: %',
      v_result;
  END IF;

  RAISE NOTICE 'A-5 PASS: transactional lookup deletion removes candidate without error/fallback';
END;
$test$;

ROLLBACK TO SAVEPOINT issue1406_candidate_timezone_delete;

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.analytics_iana_timezones
    WHERE name = 'America/St_Johns'
  ) THEN
    RAISE EXCEPTION 'A-5 FAIL: savepoint rollback did not restore candidate timezone';
  END IF;

  v_result := public.brand_customer_commitment_patterns_rollup(
    '00000000-1406-4000-8000-00000000b101'
  );

  IF (v_result->'days'->>'sample_commitments')::integer <> 1 THEN
    RAISE EXCEPTION 'A-5 FAIL: savepoint rollback did not restore candidate: %', v_result;
  END IF;

  RAISE NOTICE 'A-5 PASS: rollback restores lookup row and candidate';
END;
$test$;

-- A-6: reject dynamic-catalog references regardless of qualification, case,
-- whitespace/comment disguise, or aliasing. Also reject runtime dynamic SQL
-- that could synthesize a catalog name, and require the exact three inner
-- lookup joins plus the one approved materialization barrier.
DO $test$
DECLARE
  v_definition text;
  v_normalized text;
  v_lookup_reference_count integer;
  v_join_count integer;
  v_materialized_count integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.brand_customer_commitment_patterns_rollup(uuid)'::regprocedure
  )
  INTO v_definition;

  v_normalized := regexp_replace(lower(v_definition), '\s+', ' ', 'g');

  SELECT COUNT(*)::integer - 1
  INTO v_lookup_reference_count
  FROM regexp_split_to_table(lower(v_definition), 'analytics_iana_timezones');

  SELECT COUNT(*)::integer
  INTO v_join_count
  FROM regexp_matches(
    v_normalized,
    'join public\.analytics_iana_timezones timezone_name on timezone_name\.name = ',
    'g'
  );

  SELECT COUNT(*)::integer - 1
  INTO v_materialized_count
  FROM regexp_split_to_table(v_normalized, ' as materialized \(');

  IF v_definition ~* 'pg[[:space:]_]*timezone[[:space:]_]*names'
    OR v_definition ~* 'pg_catalog[[:space:]]*\.[[:space:]]*pg_timezone_names'
    OR v_definition ~* '\mexecute\M'
    OR v_definition ~* '\mformat[[:space:]]*\('
    OR v_definition ~* '\mto_reg(class|procedure)[[:space:]]*\('
    OR v_lookup_reference_count <> 3
    OR v_join_count <> 3
    OR v_materialized_count <> 1
    OR v_normalized NOT LIKE '%with candidate_rows as materialized (%'
  THEN
    RAISE EXCEPTION
      'A-6 FAIL: runtime shape permits disguised catalog access or lost lookup/barrier refs lookup=%, joins=%, materialized=%',
      v_lookup_reference_count,
      v_join_count,
      v_materialized_count;
  END IF;

  RAISE NOTICE 'A-6 PASS: no direct/disguised dynamic catalog path; exact three joins and one barrier';
END;
$test$;

-- A-7: independently fingerprint all indexes on the eight business relations
-- touched by the rollup, and the seven unrelated protected analytics RPCs.
-- Constants were captured from the fresh PG17 pre-test schema at branch head.
DO $test$
DECLARE
  v_index_count integer;
  v_index_fingerprint text;
  v_function_mismatch text;
BEGIN
  WITH index_rows AS (
    SELECT
      namespace.nspname
        || '.'
        || table_class.relname
        || '|'
        || index_class.relname
        || '|'
        || pg_catalog.pg_get_indexdef(index_class.oid) AS item
    FROM pg_catalog.pg_index table_index
    JOIN pg_catalog.pg_class table_class
      ON table_class.oid = table_index.indrelid
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = table_class.relnamespace
    JOIN pg_catalog.pg_class index_class
      ON index_class.oid = table_index.indexrelid
    WHERE namespace.nspname = 'public'
      AND table_class.relname IN (
        'orders',
        'events',
        'event_dates',
        'event_rsvps',
        'reservations',
        'venue_availability_config',
        'brands',
        'brand_team_members'
      )
  )
  SELECT COUNT(*)::integer, md5(string_agg(item, E'\n' ORDER BY item))
  INTO v_index_count, v_index_fingerprint
  FROM index_rows;

  WITH expected(signature, expected_fingerprint) AS (
    VALUES
      ('public.brand_mingla_drove_rollup(uuid)'::text, 'a9ca3764e1b49b7bb6ba7c9b3c435fb6'::text),
      ('public.entity_conversion_rollup(uuid)'::text, '817e6243a42bdebac0ef46ea5c3bd906'::text),
      ('public.reservation_metrics_rollup(uuid)'::text, 'c713ed3f5c45b52d7f49ac3eb5ab4d42'::text),
      ('public.brand_regulars_rollup(uuid)'::text, '2395341733d7b8a1cec1120aa193d70f'::text),
      ('public.brand_conversion_rollup(uuid)'::text, 'c57b570636a34b25732bb910f3f4c947'::text),
      ('public.ad_campaign_conversion_rollup(uuid)'::text, '09116db9216bb19a64b666c83000b033'::text),
      ('public.venue_intelligence_overview(uuid,uuid)'::text, 'd474d12571f53bd24f5d969c24fae87e'::text)
  ),
  actual AS (
    SELECT
      expected.signature,
      expected.expected_fingerprint,
      md5(
        pg_catalog.pg_get_functiondef(expected.signature::regprocedure)
        || E'\nACL='
        || COALESCE(
          (
            SELECT function_proc.proacl::text
            FROM pg_catalog.pg_proc function_proc
            WHERE function_proc.oid = expected.signature::regprocedure::oid
          ),
          '<default>'
        )
      ) AS actual_fingerprint
    FROM expected
  )
  SELECT string_agg(
    signature || ' expected=' || expected_fingerprint || ' actual=' || actual_fingerprint,
    '; '
  )
  INTO v_function_mismatch
  FROM actual
  WHERE actual_fingerprint <> expected_fingerprint;

  IF v_index_count <> 61
    OR v_index_fingerprint <> '6070f6b1331ff498899cfd34d77e3e61'
    OR v_function_mismatch IS NOT NULL
  THEN
    RAISE EXCEPTION
      'A-7 FAIL: business-index or unrelated-function drift count=%, index_hash=%, function_mismatch=%',
      v_index_count,
      v_index_fingerprint,
      v_function_mismatch;
  END IF;

  RAISE NOTICE 'A-7 PASS: business indexes and seven unrelated RPC definition+ACL fingerprints unchanged';
END;
$test$;

-- A-8: independent guarded authorized call. The structural A-6 assertion
-- prevents this from being accepted as a warm timing-only result.
SET LOCAL statement_timeout = '2000ms';
DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.brand_customer_commitment_patterns_rollup(
    '00000000-1406-4000-8000-00000000b101'
  );

  IF (v_result->'days'->>'sample_commitments')::integer <> 1 THEN
    RAISE EXCEPTION 'A-8 FAIL: guarded call returned unexpected result: %', v_result;
  END IF;

  RAISE NOTICE 'A-8 PASS: authorized seeded call completed under 2000 ms';
END;
$test$;
SET LOCAL statement_timeout = '0';

ROLLBACK;
