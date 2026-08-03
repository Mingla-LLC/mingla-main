-- ISSUE #1403 — tester-owned adversarial proof.
-- Run after all migrations. The transaction is fully rolled back.
--
-- Different angle from the implementor suites:
--   * existing venue + forged sibling brand must be indistinguishable from denial;
--   * an authenticated outsider must not learn an existing venue's aggregates;
--   * sequential sibling calls must not retain source/currency/outcome data;
--   * positive and negative half-hour offsets must remain exact in the envelope.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES
  (
    '00000000-1403-4000-8000-000000000011',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'issue1403-tester-owner@example.com',
    now(),
    now()
  ),
  (
    '00000000-1403-4000-8000-000000000012',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'issue1403-tester-outsider@example.com',
    now(),
    now()
  );

INSERT INTO public.creator_accounts (id, created_at)
VALUES (
  '00000000-1403-4000-8000-000000000011',
  now()
);

INSERT INTO public.place_pool (
  id, name, lat, lng, utc_offset_minutes, created_at
) VALUES
  (
    '00000000-1403-4000-8000-000000000111',
    'Issue 1403 Tester Plus Half',
    28.6,
    77.2,
    330,
    now()
  ),
  (
    '00000000-1403-4000-8000-000000000112',
    'Issue 1403 Tester Minus Half',
    47.6,
    -52.7,
    -210,
    now()
  );

INSERT INTO public.brands (
  id, account_id, default_currency, name, slug, created_at
) VALUES
  (
    '00000000-1403-4000-8000-000000000211',
    '00000000-1403-4000-8000-000000000011',
    'USD',
    'Issue 1403 Tester Primary',
    'issue-1403-tester-primary-' || substr(md5(random()::text), 1, 8),
    now()
  ),
  (
    '00000000-1403-4000-8000-000000000212',
    '00000000-1403-4000-8000-000000000011',
    'GBP',
    'Issue 1403 Tester Forged Sibling',
    'issue-1403-tester-sibling-' || substr(md5(random()::text), 1, 8),
    now()
  );

INSERT INTO public.venue_listings (
  id, brand_id, place_pool_id, slug, name, lat, lng, venue_category
) VALUES
  (
    '00000000-1403-4000-8000-000000000311',
    '00000000-1403-4000-8000-000000000211',
    '00000000-1403-4000-8000-000000000111',
    'issue1403testerplus' || substr(md5(random()::text), 1, 8),
    'Issue 1403 Tester Plus Half',
    28.6,
    77.2,
    'restaurant'
  ),
  (
    '00000000-1403-4000-8000-000000000312',
    '00000000-1403-4000-8000-000000000211',
    '00000000-1403-4000-8000-000000000112',
    'issue1403testerminus' || substr(md5(random()::text), 1, 8),
    'Issue 1403 Tester Minus Half',
    47.6,
    -52.7,
    'restaurant'
  );

INSERT INTO public.reservations (
  id, brand_id, venue_id, reserved_for, party_size, status, source,
  guest_email, fee_cents, fee_currency, payment_status, created_at
) VALUES
  (
    gen_random_uuid(),
    '00000000-1403-4000-8000-000000000211',
    '00000000-1403-4000-8000-000000000311',
    now(),
    2,
    'completed',
    'website',
    'issue1403-tester-plus@example.com',
    1234,
    'USD',
    'paid',
    now()
  ),
  (
    gen_random_uuid(),
    '00000000-1403-4000-8000-000000000211',
    '00000000-1403-4000-8000-000000000312',
    now() + interval '7 days',
    3,
    'confirmed',
    'phone',
    'issue1403-tester-minus@example.com',
    NULL,
    NULL,
    'none',
    now()
  );

DO $test$
DECLARE
  v_plus jsonb;
  v_minus jsonb;
  v_forged_brand jsonb;
  v_outsider jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '00000000-1403-4000-8000-000000000011',
      'role', 'authenticated'
    )::text,
    true
  );
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1403-4000-8000-000000000011',
    true
  );

  v_plus := public.reservation_metrics_rollup(
    '00000000-1403-4000-8000-000000000211',
    '00000000-1403-4000-8000-000000000311'
  );
  v_minus := public.reservation_metrics_rollup(
    '00000000-1403-4000-8000-000000000211',
    '00000000-1403-4000-8000-000000000312'
  );
  v_forged_brand := public.reservation_metrics_rollup(
    '00000000-1403-4000-8000-000000000212',
    '00000000-1403-4000-8000-000000000311'
  );

  IF (v_plus->>'authorized')::boolean IS DISTINCT FROM true
    OR v_plus->>'resolved_timezone' <> 'UTC+05:30'
    OR v_plus->>'tz_confidence' <> 'offset'
    OR (v_plus->>'covers_lifetime')::bigint <> 2
    OR v_plus->'value_cents_lifetime' <> '{"USD": 1234}'::jsonb
    OR jsonb_array_length(v_plus->'by_source') <> 1
    OR v_plus->'by_source'->0->>'source' <> 'website'
  THEN
    RAISE EXCEPTION
      'T-1 FAIL: positive half-hour/source/currency contract: %',
      v_plus;
  END IF;

  IF (v_minus->>'authorized')::boolean IS DISTINCT FROM true
    OR v_minus->>'resolved_timezone' <> 'UTC-03:30'
    OR v_minus->>'tz_confidence' <> 'offset'
    OR (v_minus->>'covers_lifetime')::bigint <> 0
    OR (v_minus->>'avg_party_size')::numeric <> 3
    OR (v_minus->>'no_show_rate')::numeric <> 0
    OR v_minus->'value_cents_lifetime' <> '{}'::jsonb
    OR jsonb_array_length(v_minus->'by_source') <> 1
    OR v_minus->'by_source'->0->>'source' <> 'phone'
    OR (v_minus->'by_source'->0->>'reservations')::bigint <> 1
    OR (v_minus->'by_source'->0->>'covers')::bigint <> 0
  THEN
    RAISE EXCEPTION
      'T-2 FAIL: sibling stale-data/no-outcome/negative-half-hour contract: %',
      v_minus;
  END IF;

  IF (v_forged_brand->>'authorized')::boolean IS DISTINCT FROM false
    OR (v_forged_brand->>'covers_lifetime')::bigint <> 0
    OR v_forged_brand->'value_cents_lifetime' <> '{}'::jsonb
    OR v_forged_brand->'by_source' <> '[]'::jsonb
  THEN
    RAISE EXCEPTION
      'T-3 FAIL: existing venue accepted a forged sibling brand: %',
      v_forged_brand;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '00000000-1403-4000-8000-000000000012',
      'role', 'authenticated'
    )::text,
    true
  );
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1403-4000-8000-000000000012',
    true
  );
  v_outsider := public.reservation_metrics_rollup(
    '00000000-1403-4000-8000-000000000211',
    '00000000-1403-4000-8000-000000000311'
  );

  IF (v_outsider - 'brand_id' - 'venue_id')
      IS DISTINCT FROM (v_forged_brand - 'brand_id' - 'venue_id')
    OR (v_outsider->>'authorized')::boolean IS DISTINCT FROM false
    OR (v_outsider->>'covers_lifetime')::bigint <> 0
    OR v_outsider->'value_cents_lifetime' <> '{}'::jsonb
    OR v_outsider->'by_source' <> '[]'::jsonb
  THEN
    RAISE EXCEPTION
      'T-4 FAIL: outsider denial leaked existence or aggregate data: %',
      v_outsider;
  END IF;
END;
$test$;

ROLLBACK;
