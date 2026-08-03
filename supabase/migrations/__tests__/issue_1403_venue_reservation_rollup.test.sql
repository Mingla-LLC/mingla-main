-- ISSUE #1403 — implementor executable happy-path and isolation proof.
-- Apply all migrations first, then run with psql. Transaction rolls back.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_old_fingerprint text;
BEGIN
  IF to_regprocedure('public.reservation_metrics_rollup(uuid)') IS NULL
    OR to_regprocedure('public.reservation_metrics_rollup(uuid,uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'H-1 FAIL: both reservation rollup overloads must coexist';
  END IF;

  SELECT md5(
    pg_catalog.pg_get_functiondef(
      'public.reservation_metrics_rollup(uuid)'::regprocedure
    )
    || E'\nACL='
    || COALESCE(
      (
        SELECT function_proc.proacl::text
        FROM pg_catalog.pg_proc function_proc
        WHERE function_proc.oid =
          'public.reservation_metrics_rollup(uuid)'::regprocedure::oid
      ),
      '<default>'
    )
  )
  INTO v_old_fingerprint;

  IF v_old_fingerprint <> 'c713ed3f5c45b52d7f49ac3eb5ab4d42' THEN
    RAISE EXCEPTION 'H-1 FAIL: legacy overload changed: %', v_old_fingerprint;
  END IF;
  IF has_function_privilege(
    'anon',
    'public.reservation_metrics_rollup(uuid,uuid)',
    'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc function_proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function_proc.proacl,
        pg_catalog.acldefault('f', function_proc.proowner)
      )
    ) acl
    WHERE function_proc.oid =
      'public.reservation_metrics_rollup(uuid,uuid)'::regprocedure::oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.reservation_metrics_rollup(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'H-1 FAIL: overload ACL is not authenticated-only';
  END IF;
  IF NOT (
    SELECT function_proc.prosecdef
      AND function_proc.proconfig @> ARRAY['search_path=public']
    FROM pg_catalog.pg_proc function_proc
    WHERE function_proc.oid =
      'public.reservation_metrics_rollup(uuid,uuid)'::regprocedure::oid
  ) THEN
    RAISE EXCEPTION 'H-1 FAIL: SECURITY DEFINER/fixed search_path missing';
  END IF;
END;
$test$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1403-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'issue1403-owner@example.com',
  now(),
  now()
);
INSERT INTO public.creator_accounts (id, created_at)
VALUES (
  '00000000-1403-4000-8000-000000000001',
  now()
);
INSERT INTO public.place_pool (
  id, name, lat, lng, utc_offset_minutes, created_at
) VALUES
  (
    '00000000-1403-4000-8000-000000000101',
    'Issue 1403 Venue A',
    40.7,
    -74.0,
    -300,
    now()
  ),
  (
    '00000000-1403-4000-8000-000000000102',
    'Issue 1403 Venue B',
    51.5,
    -0.1,
    0,
    now()
  );
INSERT INTO public.brands (
  id, account_id, default_currency, name, slug, created_at
) VALUES (
  '00000000-1403-4000-8000-000000000201',
  '00000000-1403-4000-8000-000000000001',
  'GBP',
  'Issue 1403 Brand',
  'issue-1403-brand-' || substr(md5(random()::text), 1, 8),
  now()
);
INSERT INTO public.venue_listings (
  id, brand_id, place_pool_id, slug, name, lat, lng, venue_category
) VALUES
  (
    '00000000-1403-4000-8000-000000000301',
    '00000000-1403-4000-8000-000000000201',
    '00000000-1403-4000-8000-000000000101',
    'issue1403a' || substr(md5(random()::text), 1, 8),
    'Issue 1403 A',
    40.7,
    -74.0,
    'restaurant'
  ),
  (
    '00000000-1403-4000-8000-000000000302',
    '00000000-1403-4000-8000-000000000201',
    '00000000-1403-4000-8000-000000000102',
    'issue1403b' || substr(md5(random()::text), 1, 8),
    'Issue 1403 B',
    51.5,
    -0.1,
    'restaurant'
  );
INSERT INTO public.venue_availability_config (
  brand_id, venue_id, place_pool_id, iana_timezone
) VALUES
  (
    '00000000-1403-4000-8000-000000000201',
    '00000000-1403-4000-8000-000000000301',
    '00000000-1403-4000-8000-000000000101',
    'America/New_York'
  ),
  (
    '00000000-1403-4000-8000-000000000201',
    '00000000-1403-4000-8000-000000000302',
    '00000000-1403-4000-8000-000000000102',
    'Europe/London'
  );
INSERT INTO public.reservations (
  id, brand_id, venue_id, reserved_for, party_size, status, source,
  guest_email, fee_cents, fee_currency, payment_status, created_at
) VALUES
  (
    gen_random_uuid(),
    '00000000-1403-4000-8000-000000000201',
    '00000000-1403-4000-8000-000000000301',
    now(),
    4,
    'completed',
    'mingla',
    'issue1403-a@example.com',
    1500,
    'GBP',
    'paid',
    now()
  ),
  (
    gen_random_uuid(),
    '00000000-1403-4000-8000-000000000201',
    '00000000-1403-4000-8000-000000000301',
    now(),
    2,
    'no_show',
    'phone',
    'issue1403-b@example.com',
    250000,
    'NGN',
    'paid',
    now()
  ),
  (
    gen_random_uuid(),
    '00000000-1403-4000-8000-000000000201',
    '00000000-1403-4000-8000-000000000302',
    now() + interval '7 days',
    3,
    'confirmed',
    'website',
    'issue1403-c@example.com',
    NULL,
    NULL,
    'none',
    now()
  );

DO $test$
DECLARE
  v_a jsonb;
  v_b jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '00000000-1403-4000-8000-000000000001',
      'role', 'authenticated'
    )::text,
    true
  );
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1403-4000-8000-000000000001',
    true
  );
  v_a := public.reservation_metrics_rollup(
    '00000000-1403-4000-8000-000000000201',
    '00000000-1403-4000-8000-000000000301'
  );
  v_b := public.reservation_metrics_rollup(
    '00000000-1403-4000-8000-000000000201',
    '00000000-1403-4000-8000-000000000302'
  );

  IF (v_a->>'authorized')::boolean IS DISTINCT FROM true
    OR v_a->>'venue_id' <> '00000000-1403-4000-8000-000000000301'
    OR v_a->>'resolved_timezone' <> 'America/New_York'
    OR v_a->>'tz_confidence' <> 'iana'
    OR (v_a->>'covers_lifetime')::bigint <> 4
    OR (v_a->>'avg_party_size')::numeric <> 3
    OR (v_a->>'no_show_rate')::numeric <> 0.5
    OR (v_a->'value_cents_lifetime'->>'GBP')::bigint <> 1500
    OR (v_a->'value_cents_lifetime'->>'NGN')::bigint <> 250000
  THEN
    RAISE EXCEPTION 'H-2 FAIL: venue A definitions/currency/timezone: %', v_a;
  END IF;
  IF (v_b->>'covers_lifetime')::bigint <> 0
    OR (v_b->>'avg_party_size')::numeric <> 3
    OR v_b->>'resolved_timezone' <> 'Europe/London'
    OR jsonb_array_length(v_b->'by_source') <> 1
    OR v_b->'by_source'->0->>'source' <> 'website'
    OR (v_b->'by_source'->0->>'reservations')::bigint <> 1
  THEN
    RAISE EXCEPTION 'H-2 FAIL: sibling isolation/future confirmed state: %', v_b;
  END IF;
  IF v_a->'by_source'->0->>'source' <> 'mingla'
    OR (v_a->'by_source'->0->>'reservations')::bigint <> 1
  THEN
    RAISE EXCEPTION 'H-2 FAIL: deterministic source ordering: %', v_a;
  END IF;
END;
$test$;

ROLLBACK;
