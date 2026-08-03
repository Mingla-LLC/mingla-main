-- ISSUE #1406 — implementor regression suite.
-- Apply every repository migration first. This fixture is transaction-local.

\set ON_ERROR_STOP on
BEGIN;

-- H-1: exact lookup schema, primary key, RLS/no-policy, ACL, cardinality,
-- and coverage of every currently stored schedule timezone.
DO $test$
DECLARE
  v_column_count integer;
  v_primary_key_count integer;
  v_timezone_count bigint;
  v_missing_timezone text;
BEGIN
  SELECT COUNT(*)::integer
  INTO v_column_count
  FROM pg_catalog.pg_attribute table_column
  WHERE table_column.attrelid = 'public.analytics_iana_timezones'::regclass
    AND table_column.attnum > 0
    AND NOT table_column.attisdropped;

  IF v_column_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute table_column
    WHERE table_column.attrelid = 'public.analytics_iana_timezones'::regclass
      AND table_column.attnum > 0
      AND NOT table_column.attisdropped
      AND table_column.attname = 'name'
      AND table_column.atttypid = 'text'::regtype
      AND table_column.attnotnull
  ) THEN
    RAISE EXCEPTION 'H-1 FAIL: lookup is not exactly one text NOT NULL name column';
  END IF;

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

  IF v_primary_key_count <> 1 THEN
    RAISE EXCEPTION 'H-1 FAIL: name is not the sole primary key';
  END IF;

  IF NOT (
    SELECT table_class.relrowsecurity
    FROM pg_catalog.pg_class table_class
    WHERE table_class.oid = 'public.analytics_iana_timezones'::regclass
  ) THEN
    RAISE EXCEPTION 'H-1 FAIL: lookup RLS is disabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy table_policy
    WHERE table_policy.polrelid = 'public.analytics_iana_timezones'::regclass
  ) THEN
    RAISE EXCEPTION 'H-1 FAIL: lookup has a client RLS policy';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class table_class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        table_class.relacl,
        pg_catalog.acldefault('r', table_class.relowner)
      )
    ) table_acl
    WHERE table_class.oid = 'public.analytics_iana_timezones'::regclass
      AND table_acl.grantee = 0
      AND table_acl.privilege_type IN (
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER'
      )
  ) OR EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('anon'::text),
        ('authenticated'::text),
        ('service_role'::text)
    ) denied_role(role_name)
    CROSS JOIN (
      VALUES
        ('SELECT'::text),
        ('INSERT'::text),
        ('UPDATE'::text),
        ('DELETE'::text),
        ('TRUNCATE'::text),
        ('REFERENCES'::text),
        ('TRIGGER'::text)
    ) table_privilege(privilege_name)
    WHERE has_table_privilege(
      denied_role.role_name,
      'public.analytics_iana_timezones',
      table_privilege.privilege_name
    )
  ) THEN
    RAISE EXCEPTION 'H-1 FAIL: denied role retains a table privilege';
  END IF;

  SELECT COUNT(*)
  INTO v_timezone_count
  FROM public.analytics_iana_timezones;

  IF v_timezone_count < 1000 THEN
    RAISE EXCEPTION 'H-1 FAIL: expected at least 1000 recognized names, got %', v_timezone_count;
  END IF;

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
  LIMIT 1;

  IF v_missing_timezone IS NOT NULL THEN
    RAISE EXCEPTION 'H-1 FAIL: currently stored timezone % is absent', v_missing_timezone;
  END IF;

  RAISE NOTICE 'H-1 PASS: exact lookup schema, PK, RLS/no-policy, ACL, cardinality, coverage';
END;
$test$;

-- H-2: exact function attributes/ACL and structural removal of the dynamic
-- timezone catalog. Exactly three runtime lookup joins must remain.
DO $test$
DECLARE
  v_oid oid;
  v_definition text;
  v_normalized_definition text;
  v_lookup_references integer;
  v_materialized_count integer;
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
    RAISE EXCEPTION 'H-2 FAIL: exact rollup signature missing';
  END IF;

  IF NOT (
    SELECT function_proc.prosecdef
      AND function_proc.provolatile = 's'
      AND COALESCE(function_proc.proconfig, '{}'::text[]) @> ARRAY['search_path=public']
    FROM pg_catalog.pg_proc function_proc
    WHERE function_proc.oid = v_oid
  ) THEN
    RAISE EXCEPTION 'H-2 FAIL: SECURITY DEFINER/STABLE/search_path mismatch';
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
  ) OR has_function_privilege(
    'anon',
    'public.brand_customer_commitment_patterns_rollup(uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.brand_customer_commitment_patterns_rollup(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'H-2 FAIL: function ACL mismatch';
  END IF;

  SELECT lower(pg_catalog.pg_get_functiondef(v_oid))
  INTO v_definition;

  v_normalized_definition := regexp_replace(v_definition, '\s+', ' ', 'g');

  IF v_definition LIKE '%pg_timezone_names%' THEN
    RAISE EXCEPTION 'H-2 FAIL: function still references pg_timezone_names';
  END IF;

  SELECT COUNT(*)::integer - 1
  INTO v_lookup_references
  FROM regexp_split_to_table(v_definition, 'analytics_iana_timezones');

  IF v_lookup_references <> 3 THEN
    RAISE EXCEPTION 'H-2 FAIL: expected three lookup references, got %', v_lookup_references;
  END IF;

  IF v_normalized_definition NOT LIKE '%with candidate_rows as materialized (%'
    OR v_normalized_definition LIKE '%with candidate_rows as (%'
  THEN
    RAISE EXCEPTION 'H-2 FAIL: candidate_rows materialization barrier missing';
  END IF;

  SELECT COUNT(*)::integer - 1
  INTO v_materialized_count
  FROM regexp_split_to_table(v_normalized_definition, ' as materialized \(');

  IF v_materialized_count <> 1 THEN
    RAISE EXCEPTION 'H-2 FAIL: expected only candidate_rows materialized, got % barriers',
      v_materialized_count;
  END IF;

  RAISE NOTICE 'H-2 PASS: exact attributes/ACL, zero dynamic/three indexed references, one candidate barrier';
END;
$test$;

-- Fixture owner and brand.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES (
  '00000000-1406-4000-8000-000000000a01',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'issue1406-owner@example.test',
  now(),
  now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1406-4000-8000-000000000a01', now());

INSERT INTO public.place_pool (id, name, lat, lng, created_at)
VALUES (
  '00000000-1406-4000-8000-000000000c01',
  'Issue 1406 place',
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
VALUES (
  '00000000-1406-4000-8000-000000000b01',
  '00000000-1406-4000-8000-000000000a01',
  '00000000-1406-4000-8000-000000000c01',
  'GBP',
  'Issue 1406 brand',
  'issue-1406-brand-' || substr(md5(random()::text), 1, 8),
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
    '00000000-1406-4000-8000-000000000e01',
    '00000000-1406-4000-8000-000000000b01',
    '00000000-1406-4000-8000-000000000a01',
    'Valid event',
    'issue-1406-valid-event-' || substr(md5(random()::text), 1, 8),
    'UTC',
    'event',
    now()
  ),
  (
    '00000000-1406-4000-8000-000000000e02',
    '00000000-1406-4000-8000-000000000b01',
    '00000000-1406-4000-8000-000000000a01',
    'Invalid event timezone',
    'issue-1406-invalid-event-' || substr(md5(random()::text), 1, 8),
    'UTC',
    'event',
    now()
  ),
  (
    '00000000-1406-4000-8000-000000000e03',
    '00000000-1406-4000-8000-000000000b01',
    '00000000-1406-4000-8000-000000000a01',
    'Valid RSVP',
    'issue-1406-valid-rsvp-' || substr(md5(random()::text), 1, 8),
    'UTC',
    'rsvp',
    now()
  );

INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
VALUES
  (
    '00000000-1406-4000-8000-000000000f01',
    '00000000-1406-4000-8000-000000000e01',
    now() - interval '7 days',
    now() - interval '7 days' + interval '2 hours',
    'UTC',
    true
  ),
  (
    '00000000-1406-4000-8000-000000000f02',
    '00000000-1406-4000-8000-000000000e02',
    now() - interval '8 days',
    now() - interval '8 days' + interval '2 hours',
    'Not/A_Real_Zone',
    true
  ),
  (
    '00000000-1406-4000-8000-000000000f03',
    '00000000-1406-4000-8000-000000000e03',
    now() - interval '14 days',
    now() - interval '14 days' + interval '2 hours',
    'UTC',
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
    '00000000-1406-4000-8000-000000001001',
    '00000000-1406-4000-8000-000000000e01',
    '00000000-1406-4000-8000-000000000f01',
    'valid-order@issue1406.test',
    '+15551406001',
    now(),
    now(),
    999999,
    0,
    'paid',
    'GBP',
    'online_checkout'
  ),
  (
    '00000000-1406-4000-8000-000000001002',
    '00000000-1406-4000-8000-000000000e02',
    '00000000-1406-4000-8000-000000000f02',
    'invalid-zone@issue1406.test',
    '+15551406002',
    now(),
    now(),
    888888,
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
  '00000000-1406-4000-8000-000000001101',
  '00000000-1406-4000-8000-000000000e03',
  'Issue 1406 RSVP',
  'valid-rsvp@issue1406.test',
  '+15551406101',
  'going',
  'approved',
  99
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
VALUES
  (
    '00000000-1406-4000-8000-000000000d01',
    '00000000-1406-4000-8000-000000000b01',
    'issue1406venue' || substr(md5(random()::text), 1, 8),
    'Issue 1406 configured venue',
    40.7,
    -74.0,
    'restaurant'
  ),
  (
    '00000000-1406-4000-8000-000000000d03',
    '00000000-1406-4000-8000-000000000b01',
    'issue1406missing' || substr(md5(random()::text), 1, 8),
    'Issue 1406 venue without timezone config',
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
  '00000000-1406-4000-8000-000000000d02',
  '00000000-1406-4000-8000-000000000b01',
  '00000000-1406-4000-8000-000000000d01',
  '00000000-1406-4000-8000-000000000c01',
  'UTC'
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
VALUES
  (
    '00000000-1406-4000-8000-000000001201',
    '00000000-1406-4000-8000-000000000b01',
    '00000000-1406-4000-8000-000000000d01',
    now() - interval '21 days',
    100,
    'completed',
    'mingla',
    'valid-reservation@issue1406.test',
    '+15551406201',
    777777,
    'NGN',
    'paid',
    now()
  ),
  (
    '00000000-1406-4000-8000-000000001202',
    '00000000-1406-4000-8000-000000000b01',
    '00000000-1406-4000-8000-000000000d03',
    now() - interval '22 days',
    100,
    'completed',
    'mingla',
    'missing-config@issue1406.test',
    '+15551406202',
    666666,
    'USD',
    'paid',
    now()
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-1406-4000-8000-000000000a01',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1406-4000-8000-000000000a01',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- H-3/H-4: valid rows from all three sources remain identical, while invalid
-- event timezone and missing venue timezone configuration disappear honestly.
DO $test$
DECLARE
  v_result jsonb;
  v_type_keys text[];
BEGIN
  v_result := public.brand_customer_commitment_patterns_rollup(
    '00000000-1406-4000-8000-000000000b01'
  );

  IF (v_result->>'authorized')::boolean IS DISTINCT FROM true
    OR (v_result->'days'->>'sample_commitments')::integer <> 3
    OR (v_result->'dayparts'->>'sample_commitments')::integer <> 3
    OR (v_result->'types'->>'sample_commitments')::integer <> 3
    OR (v_result->'days'->>'positive_buckets')::integer <> 1
    OR (v_result->'days'->'buckets'->0->>'commitments')::integer <> 3
    OR (v_result->'dayparts'->>'positive_buckets')::integer <> 1
    OR (v_result->'dayparts'->'buckets'->0->>'commitments')::integer <> 3
  THEN
    RAISE EXCEPTION 'H-3/H-4 FAIL: valid/invalid source parity mismatch: %', v_result;
  END IF;

  SELECT array_agg(bucket->>'key' ORDER BY bucket->>'key')
  INTO v_type_keys
  FROM jsonb_array_elements(v_result->'types'->'buckets') bucket;

  IF v_type_keys IS DISTINCT FROM ARRAY[
    'event',
    'rsvp',
    'venue_reservation'
  ]::text[] THEN
    RAISE EXCEPTION 'H-3/H-4 FAIL: expected one admitted row from each valid source: %', v_type_keys;
  END IF;

  IF v_result::text ~* '(buyer_email|guest_email|phone|currency|cents|revenue|customer_key|occurrence_key|scheduled_timezone)'
    OR v_result::text LIKE '%valid-order@issue1406.test%'
    OR v_result::text LIKE '%+15551406%'
    OR v_result::text LIKE '%999999%'
  THEN
    RAISE EXCEPTION 'H-3/H-4 FAIL: aggregate response leaked PII, money, or internal keys: %', v_result;
  END IF;

  RAISE NOTICE 'H-3/H-4 PASS: all valid sources preserved; invalid/missing zones excluded; aggregate-only';
END;
$test$;

-- H-5: prove an authenticated invoker cannot directly read the lookup, while
-- the owner-authorized SECURITY DEFINER RPC succeeds under that same role.
CREATE OR REPLACE FUNCTION pg_temp.issue1406_lookup_read_is_denied()
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
AS $helper$
BEGIN
  PERFORM name
  FROM public.analytics_iana_timezones
  LIMIT 1;
  RETURN false;
EXCEPTION
  WHEN insufficient_privilege THEN
    RETURN true;
END;
$helper$;

CREATE TEMP TABLE issue1406_role_proof (
  lookup_denied boolean NOT NULL,
  rpc_result jsonb NOT NULL
);
GRANT INSERT, SELECT ON issue1406_role_proof TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.issue1406_lookup_read_is_denied() TO authenticated;

SET LOCAL ROLE authenticated;
INSERT INTO issue1406_role_proof (lookup_denied, rpc_result)
SELECT
  pg_temp.issue1406_lookup_read_is_denied(),
  public.brand_customer_commitment_patterns_rollup(
    '00000000-1406-4000-8000-000000000b01'
  );
RESET ROLE;

DO $test$
DECLARE
  v_lookup_denied boolean;
  v_result jsonb;
BEGIN
  SELECT lookup_denied, rpc_result
  INTO v_lookup_denied, v_result
  FROM issue1406_role_proof;

  IF v_lookup_denied IS DISTINCT FROM true
    OR (v_result->>'authorized')::boolean IS DISTINCT FROM true
    OR (v_result->'days'->>'sample_commitments')::integer <> 3
  THEN
    RAISE EXCEPTION 'H-5 FAIL: direct denial/authorized SECURITY DEFINER behavior mismatch: denied=%, result=%',
      v_lookup_denied, v_result;
  END IF;

  RAISE NOTICE 'H-5 PASS: authenticated direct lookup denied while authorized RPC succeeds';
END;
$test$;

-- H-6: the seven pre-existing Phase-4 RPC definition+ACL fingerprints remain
-- unchanged from the constants locked before issue #875.
DO $test$
DECLARE
  v_mismatch text;
BEGIN
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
  INTO v_mismatch
  FROM actual
  WHERE actual_fingerprint <> expected_fingerprint;

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'H-6 FAIL: protected RPC fingerprint drift: %', v_mismatch;
  END IF;

  RAISE NOTICE 'H-6 PASS: seven protected RPC definition+ACL fingerprints unchanged';
END;
$test$;

-- H-7: a representative three-source call must finish below the unchanged
-- two-second contract. H-2 is the structural guard against warm-only passes.
SET LOCAL statement_timeout = '2000ms';
DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.brand_customer_commitment_patterns_rollup(
    '00000000-1406-4000-8000-000000000b01'
  );

  IF (v_result->'days'->>'sample_commitments')::integer <> 3 THEN
    RAISE EXCEPTION 'H-7 FAIL: guarded representative call returned wrong result: %', v_result;
  END IF;

  RAISE NOTICE 'H-7 PASS: representative seeded call completed under 2000 ms';
END;
$test$;
SET LOCAL statement_timeout = '0';

ROLLBACK;
