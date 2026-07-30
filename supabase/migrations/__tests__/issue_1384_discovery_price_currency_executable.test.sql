-- Issue #1384 executable state-machine matrix.
--
-- Proves real rows and real RPC/trigger execution for:
--   * provisional and bank-derived currency authority
--   * canonical authoring CAS/error/rollback behavior
--   * bank mismatch conversion, re-entry, stale-set rollback, and one-pending
--   * Admin reason + revision CAS with statement rollback
--   * brand-scoped RLS and the no-direct-write boundary
--   * Paystack readiness blocked by reconciliation
--   * complete/idempotent FX activation and old-snapshot preservation
--
-- Run only against disposable/local Supabase Postgres. The transaction rolls
-- back every fixture and assertion.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('13840000-0000-4000-8000-000000000001', 'issue1384-owner-a@test.local'),
  ('13840000-0000-4000-8000-000000000002', 'issue1384-owner-b@test.local'),
  ('13840000-0000-4000-8000-000000000003', 'issue1384-owner-c@test.local'),
  ('13840000-0000-4000-8000-000000000004', 'issue1384-owner-d@test.local'),
  ('13840000-0000-4000-8000-000000000005', 'issue1384-scanner@test.local'),
  ('13840000-0000-4000-8000-000000000006', 'issue1384-admin@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts (id) VALUES
  ('13840000-0000-4000-8000-000000000001'),
  ('13840000-0000-4000-8000-000000000002'),
  ('13840000-0000-4000-8000-000000000003'),
  ('13840000-0000-4000-8000-000000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_users (email, role, status)
VALUES ('issue1384-admin@test.local', 'admin', 'active')
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, provisional_currency_code,
  paystack_subaccount_code
) VALUES
  (
    '13840000-0000-4000-8000-000000000101',
    '13840000-0000-4000-8000-000000000001',
    'Issue 1384 Brand A', 'issue1384branda', NULL, NULL, NULL
  ),
  (
    '13840000-0000-4000-8000-000000000102',
    '13840000-0000-4000-8000-000000000002',
    'Issue 1384 Brand B', 'issue1384brandb', NULL, 'USD', 'ACCT_1384_B'
  ),
  (
    '13840000-0000-4000-8000-000000000103',
    '13840000-0000-4000-8000-000000000003',
    'Issue 1384 Brand C', 'issue1384brandc', NULL, 'USD', NULL
  ),
  (
    '13840000-0000-4000-8000-000000000104',
    '13840000-0000-4000-8000-000000000004',
    'Issue 1384 Brand D', 'issue1384brandd', NULL, 'USD', NULL
  );

INSERT INTO public.brand_team_members (
  brand_id, user_id, role, accepted_at
) VALUES (
  '13840000-0000-4000-8000-000000000101',
  '13840000-0000-4000-8000-000000000005',
  'scanner',
  now()
);

INSERT INTO public.place_pool (
  id, name, lat, lng, is_active, is_servable
) VALUES
  ('13840000-0000-4000-8000-000000000201', 'Issue 1384 Place A', 6.45, 3.47, true, true),
  ('13840000-0000-4000-8000-000000000202', 'Issue 1384 Place B', 6.46, 3.48, true, true),
  ('13840000-0000-4000-8000-000000000203', 'Issue 1384 Place C', 6.47, 3.49, true, true),
  ('13840000-0000-4000-8000-000000000204', 'Issue 1384 Place D1', 6.48, 3.50, true, true),
  ('13840000-0000-4000-8000-000000000205', 'Issue 1384 Place D2', 6.49, 3.51, true, true);

INSERT INTO public.venue_listings (
  id, brand_id, place_pool_id, slug, name, lat, lng,
  venue_category, claim_status
) VALUES
  (
    '13840000-0000-4000-8000-000000000301',
    '13840000-0000-4000-8000-000000000101',
    '13840000-0000-4000-8000-000000000201',
    'venuea', 'Issue 1384 Venue A', 6.45, 3.47, 'restaurant', 'verified'
  ),
  (
    '13840000-0000-4000-8000-000000000302',
    '13840000-0000-4000-8000-000000000102',
    '13840000-0000-4000-8000-000000000202',
    'venueb', 'Issue 1384 Venue B', 6.46, 3.48, 'restaurant', 'verified'
  ),
  (
    '13840000-0000-4000-8000-000000000303',
    '13840000-0000-4000-8000-000000000103',
    '13840000-0000-4000-8000-000000000203',
    'venuec', 'Issue 1384 Venue C', 6.47, 3.49, 'restaurant', 'verified'
  ),
  (
    '13840000-0000-4000-8000-000000000304',
    '13840000-0000-4000-8000-000000000104',
    '13840000-0000-4000-8000-000000000204',
    'venued1', 'Issue 1384 Venue D1', 6.48, 3.50, 'restaurant', 'verified'
  ),
  (
    '13840000-0000-4000-8000-000000000305',
    '13840000-0000-4000-8000-000000000104',
    '13840000-0000-4000-8000-000000000205',
    'venued2', 'Issue 1384 Venue D2', 6.49, 3.51, 'restaurant', 'verified'
  );

CREATE TEMP TABLE issue_1384_context (
  key text PRIMARY KEY,
  value uuid NOT NULL
);

DO $canonical_admin_gate$
DECLARE
  v_config text[];
BEGIN
  SELECT proconfig INTO v_config
  FROM pg_proc
  WHERE oid = 'public.is_admin_user()'::regprocedure;
  IF v_config IS NULL
     OR NOT ('search_path=pg_catalog, public' = ANY(v_config)) THEN
    RAISE EXCEPTION
      'issue_1384 executable: canonical admin gate search_path is not pinned';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'place_pool'
      AND column_name = 'ai_categories'
  ) THEN
    RAISE EXCEPTION
      'issue_1384 executable: forbidden stored category authority was recreated';
  END IF;
END;
$canonical_admin_gate$;

-- Complete snapshots activate atomically, duplicate payloads are idempotent,
-- and an incomplete candidate cannot displace the last good snapshot.
DO $fx$
DECLARE
  v_rates jsonb;
  v_incomplete jsonb;
  v_first uuid;
  v_duplicate uuid;
  v_second uuid;
  v_active uuid;
  v_count integer;
BEGIN
  SELECT jsonb_object_agg(code::text, CASE code::text
    WHEN 'USD' THEN 1::numeric
    WHEN 'NGN' THEN 1000::numeric
    ELSE 2::numeric
  END)
  INTO v_rates
  FROM public.supported_brand_currencies
  WHERE active;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_first := public.issue_1384_activate_fx_snapshot(
    now() - interval '2 hours',
    now() + interval '22 hours',
    now() + interval '2 days',
    'issue-1384-executable-first',
    v_rates,
    '{"fixture":"first"}'::jsonb
  );

  v_duplicate := public.issue_1384_activate_fx_snapshot(
    now() - interval '2 hours',
    now() + interval '22 hours',
    now() + interval '2 days',
    'issue-1384-executable-first',
    v_rates,
    '{"fixture":"duplicate"}'::jsonb
  );
  SELECT count(*) INTO v_count
  FROM public.fx_rate_snapshots
  WHERE payload_sha256 = 'issue-1384-executable-first';
  IF v_duplicate IS DISTINCT FROM v_first OR v_count <> 1 THEN
    RAISE EXCEPTION 'issue_1384 executable: duplicate FX payload was not idempotent';
  END IF;

  v_incomplete := v_rates - 'NGN';
  BEGIN
    PERFORM public.issue_1384_activate_fx_snapshot(
      now() - interval '1 hour',
      now() + interval '23 hours',
      now() + interval '2 days',
      'issue-1384-executable-incomplete',
      v_incomplete,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'issue_1384 executable: incomplete FX snapshot activated';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%incomplete_fx_snapshot%' THEN
      RAISE;
    END IF;
  END;
  SELECT id INTO v_active
  FROM public.fx_rate_snapshots
  WHERE status = 'active';
  IF v_active IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'issue_1384 executable: incomplete FX attempt displaced old active';
  END IF;

  v_second := public.issue_1384_activate_fx_snapshot(
    now() - interval '30 minutes',
    now() + interval '23 hours 30 minutes',
    now() + interval '2 days',
    'issue-1384-executable-second',
    v_rates,
    '{"fixture":"second"}'::jsonb
  );
  IF (SELECT status FROM public.fx_rate_snapshots WHERE id = v_first) <> 'superseded'
     OR (SELECT status FROM public.fx_rate_snapshots WHERE id = v_second) <> 'active' THEN
    RAISE EXCEPTION 'issue_1384 executable: FX rotation was not atomic';
  END IF;
  INSERT INTO issue_1384_context VALUES ('snapshot', v_second);
END;
$fx$;

-- New authoring uses provisional authority, rejects currency mismatch, and
-- enforces optimistic concurrency without overwriting the winning update.
DO $authoring$
DECLARE
  v_state jsonb;
  v_saved public.place_discovery_price_ranges%ROWTYPE;
  v_version bigint;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '13840000-0000-4000-8000-000000000001', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"13840000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
  );
  v_state := public.issue_1384_set_provisional_currency(
    '13840000-0000-4000-8000-000000000101', 'NGN', 1
  );
  IF v_state->>'effectiveCurrencyCode' <> 'NGN' THEN
    RAISE EXCEPTION 'issue_1384 executable: provisional currency was not authoritative';
  END IF;

  BEGIN
    PERFORM public.issue_1384_save_discovery_price_range(
      '13840000-0000-4000-8000-000000000101',
      '13840000-0000-4000-8000-000000000301',
      '13840000-0000-4000-8000-000000000201',
      10000, 20000, 'USD', NULL, 'business_authored', gen_random_uuid()
    );
    RAISE EXCEPTION 'issue_1384 executable: cross-currency authoring was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%currency_mismatch%' THEN
      RAISE;
    END IF;
  END;

  SELECT * INTO v_saved
  FROM public.issue_1384_save_discovery_price_range(
    '13840000-0000-4000-8000-000000000101',
    '13840000-0000-4000-8000-000000000301',
    '13840000-0000-4000-8000-000000000201',
    10000, 20000, 'NGN', NULL, 'business_authored', gen_random_uuid()
  );
  v_version := v_saved.version;

  SELECT * INTO v_saved
  FROM public.issue_1384_save_discovery_price_range(
    '13840000-0000-4000-8000-000000000101',
    '13840000-0000-4000-8000-000000000301',
    '13840000-0000-4000-8000-000000000201',
    11000, 21000, 'NGN', v_version, 'business_authored', gen_random_uuid()
  );
  BEGIN
    PERFORM public.issue_1384_save_discovery_price_range(
      '13840000-0000-4000-8000-000000000101',
      '13840000-0000-4000-8000-000000000301',
      '13840000-0000-4000-8000-000000000201',
      12000, 22000, 'NGN', v_version, 'business_authored', gen_random_uuid()
    );
    RAISE EXCEPTION 'issue_1384 executable: stale concurrent writer succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%range_version_conflict%' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT source_min_minor FROM public.place_discovery_price_ranges
      WHERE place_pool_id = '13840000-0000-4000-8000-000000000201') <> 11000 THEN
    RAISE EXCEPTION 'issue_1384 executable: stale writer changed the winning value';
  END IF;
  RESET ROLE;
END;
$authoring$;

-- Matching bank settlement clears provisional state without changing the
-- source-authored range. A Paystack brand can collect only after no pending
-- currency reconciliation remains.
DO $matched$
BEGIN
  UPDATE public.brands
  SET default_currency = 'NGN'
  WHERE id = '13840000-0000-4000-8000-000000000101';
  IF (SELECT provisional_currency_code FROM public.brands
      WHERE id = '13840000-0000-4000-8000-000000000101') IS NOT NULL
     OR (SELECT status FROM public.place_discovery_price_ranges
         WHERE place_pool_id = '13840000-0000-4000-8000-000000000201') <> 'active'
     OR NOT EXISTS (
       SELECT 1 FROM public.brand_currency_reconciliations
       WHERE brand_id = '13840000-0000-4000-8000-000000000101'
         AND status = 'matched'
     ) THEN
    RAISE EXCEPTION 'issue_1384 executable: matching bank settlement failed';
  END IF;
END;
$matched$;

INSERT INTO public.place_discovery_price_ranges (
  place_pool_id, brand_id, venue_id, status,
  source_min_minor, source_max_minor, source_currency_code,
  source_type, source_recorded_at
) VALUES
  (
    '13840000-0000-4000-8000-000000000202',
    '13840000-0000-4000-8000-000000000102',
    '13840000-0000-4000-8000-000000000302',
    'active', 10000, 20000, 'USD', 'business_authored', now()
  ),
  (
    '13840000-0000-4000-8000-000000000203',
    '13840000-0000-4000-8000-000000000103',
    '13840000-0000-4000-8000-000000000303',
    'active', 5000, 7000, 'USD', 'business_authored', now()
  ),
  (
    '13840000-0000-4000-8000-000000000204',
    '13840000-0000-4000-8000-000000000104',
    '13840000-0000-4000-8000-000000000304',
    'active', 3000, 4000, 'USD', 'business_authored', now()
  ),
  (
    '13840000-0000-4000-8000-000000000205',
    '13840000-0000-4000-8000-000000000104',
    '13840000-0000-4000-8000-000000000305',
    'active', 8000, 9000, 'USD', 'business_authored', now()
  );

UPDATE public.brands SET default_currency = 'NGN'
WHERE id IN (
  '13840000-0000-4000-8000-000000000102',
  '13840000-0000-4000-8000-000000000103',
  '13840000-0000-4000-8000-000000000104'
);

DO $pending$
DECLARE
  v_pending uuid;
BEGIN
  SELECT id INTO v_pending
  FROM public.brand_currency_reconciliations
  WHERE brand_id = '13840000-0000-4000-8000-000000000102'
    AND status = 'pending';
  IF v_pending IS NULL
     OR (SELECT status FROM public.place_discovery_price_ranges
         WHERE place_pool_id = '13840000-0000-4000-8000-000000000202')
        <> 'reconciliation_required'
     OR public.pg_brand_can_collect('13840000-0000-4000-8000-000000000102') THEN
    RAISE EXCEPTION 'issue_1384 executable: bank mismatch did not block paid readiness';
  END IF;

  -- The partial unique index is the database arbitration point for concurrent
  -- bank callbacks: a second pending row cannot be committed.
  BEGIN
    INSERT INTO public.brand_currency_reconciliations (
      brand_id, from_currency_code, to_currency_code, reason, status
    ) VALUES (
      '13840000-0000-4000-8000-000000000102',
      'USD', 'NGN', 'bank_changed', 'pending'
    );
    RAISE EXCEPTION 'issue_1384 executable: duplicate concurrent pending row succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  IF (SELECT count(*) FROM public.brand_currency_reconciliations
      WHERE brand_id = '13840000-0000-4000-8000-000000000102'
        AND status = 'pending') <> 1 THEN
    RAISE EXCEPTION 'issue_1384 executable: one-pending invariant failed';
  END IF;
END;
$pending$;

-- Convert path uses the pinned snapshot and resolves paid readiness.
DO $convert$
DECLARE
  v_rec uuid;
  v_snapshot uuid;
  v_preview jsonb;
  v_version bigint;
BEGIN
  SELECT id INTO v_rec FROM public.brand_currency_reconciliations
  WHERE brand_id = '13840000-0000-4000-8000-000000000102'
    AND status = 'pending';
  SELECT value INTO v_snapshot FROM issue_1384_context WHERE key = 'snapshot';
  SELECT version INTO v_version FROM public.place_discovery_price_ranges
  WHERE place_pool_id = '13840000-0000-4000-8000-000000000202';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '13840000-0000-4000-8000-000000000002', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"13840000-0000-4000-8000-000000000002","role":"authenticated"}',
    true
  );
  v_preview := public.issue_1384_preview_reconciliation(
    '13840000-0000-4000-8000-000000000102', v_rec
  );
  IF v_preview#>>'{snapshot,id}' <> v_snapshot::text
     OR jsonb_array_length(v_preview->'ranges') <> 1 THEN
    RAISE EXCEPTION 'issue_1384 executable: reconciliation preview was not pinned';
  END IF;
  PERFORM public.issue_1384_resolve_reconciliation(
    '13840000-0000-4000-8000-000000000102',
    v_rec,
    'convert',
    v_snapshot,
    jsonb_build_array(jsonb_build_object(
      'placePoolId', '13840000-0000-4000-8000-000000000202',
      'expectedVersion', v_version
    )),
    gen_random_uuid()
  );
  RESET ROLE;

  IF (SELECT source_currency_code FROM public.place_discovery_price_ranges
      WHERE place_pool_id = '13840000-0000-4000-8000-000000000202') <> 'NGN'
     OR (SELECT source_min_minor FROM public.place_discovery_price_ranges
         WHERE place_pool_id = '13840000-0000-4000-8000-000000000202') <> 10000000
     OR NOT public.pg_brand_can_collect('13840000-0000-4000-8000-000000000102') THEN
    RAISE EXCEPTION 'issue_1384 executable: convert resolution/readiness failed';
  END IF;
END;
$convert$;

-- Re-entry path replaces every authoritative value in the bank currency.
DO $reentry$
DECLARE
  v_rec uuid;
  v_version bigint;
BEGIN
  SELECT id INTO v_rec FROM public.brand_currency_reconciliations
  WHERE brand_id = '13840000-0000-4000-8000-000000000103'
    AND status = 'pending';
  SELECT version INTO v_version FROM public.place_discovery_price_ranges
  WHERE place_pool_id = '13840000-0000-4000-8000-000000000203';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '13840000-0000-4000-8000-000000000003', true);
  PERFORM public.issue_1384_resolve_reconciliation(
    '13840000-0000-4000-8000-000000000103',
    v_rec,
    'reenter',
    NULL,
    jsonb_build_array(jsonb_build_object(
      'placePoolId', '13840000-0000-4000-8000-000000000203',
      'expectedVersion', v_version,
      'currencyCode', 'NGN',
      'sourceMinMinor', 750000,
      'sourceMaxMinor', 900000
    )),
    gen_random_uuid()
  );
  RESET ROLE;
  IF (SELECT source_type FROM public.place_discovery_price_ranges
      WHERE place_pool_id = '13840000-0000-4000-8000-000000000203')
      <> 'business_authored'
     OR (SELECT source_min_minor FROM public.place_discovery_price_ranges
         WHERE place_pool_id = '13840000-0000-4000-8000-000000000203')
        <> 750000 THEN
    RAISE EXCEPTION 'issue_1384 executable: re-entry resolution failed';
  END IF;
END;
$reentry$;

-- Missing/stale authoritative sets abort the whole statement. The second arm
-- proves a stale version cannot partially update the first item in a batch.
DO $stale_set$
DECLARE
  v_rec uuid;
  v_v1 bigint;
  v_v2 bigint;
  v_before1 jsonb;
  v_before2 jsonb;
BEGIN
  SELECT id INTO v_rec FROM public.brand_currency_reconciliations
  WHERE brand_id = '13840000-0000-4000-8000-000000000104'
    AND status = 'pending';
  SELECT version, to_jsonb(r) INTO v_v1, v_before1
  FROM public.place_discovery_price_ranges r
  WHERE place_pool_id = '13840000-0000-4000-8000-000000000204';
  SELECT version, to_jsonb(r) INTO v_v2, v_before2
  FROM public.place_discovery_price_ranges r
  WHERE place_pool_id = '13840000-0000-4000-8000-000000000205';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '13840000-0000-4000-8000-000000000004', true);
  BEGIN
    PERFORM public.issue_1384_resolve_reconciliation(
      '13840000-0000-4000-8000-000000000104',
      v_rec, 'reenter', NULL,
      jsonb_build_array(jsonb_build_object(
        'placePoolId', '13840000-0000-4000-8000-000000000204',
        'expectedVersion', v_v1,
        'currencyCode', 'NGN',
        'sourceMinMinor', 1,
        'sourceMaxMinor', 2
      )),
      gen_random_uuid()
    );
    RAISE EXCEPTION 'issue_1384 executable: incomplete range set resolved';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%range_set_changed%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.issue_1384_resolve_reconciliation(
      '13840000-0000-4000-8000-000000000104',
      v_rec, 'reenter', NULL,
      jsonb_build_array(
        jsonb_build_object(
          'placePoolId', '13840000-0000-4000-8000-000000000204',
          'expectedVersion', v_v1,
          'currencyCode', 'NGN',
          'sourceMinMinor', 1,
          'sourceMaxMinor', 2
        ),
        jsonb_build_object(
          'placePoolId', '13840000-0000-4000-8000-000000000205',
          'expectedVersion', v_v2 - 1,
          'currencyCode', 'NGN',
          'sourceMinMinor', 3,
          'sourceMaxMinor', 4
        )
      ),
      gen_random_uuid()
    );
    RAISE EXCEPTION 'issue_1384 executable: stale batch version resolved';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%range_version_conflict%' THEN
      RAISE;
    END IF;
  END;
  RESET ROLE;

  IF (SELECT to_jsonb(r) FROM public.place_discovery_price_ranges r
      WHERE place_pool_id = '13840000-0000-4000-8000-000000000204')
       IS DISTINCT FROM v_before1
     OR (SELECT to_jsonb(r) FROM public.place_discovery_price_ranges r
         WHERE place_pool_id = '13840000-0000-4000-8000-000000000205')
       IS DISTINCT FROM v_before2
     OR (SELECT status FROM public.brand_currency_reconciliations
         WHERE id = v_rec) <> 'pending' THEN
    RAISE EXCEPTION 'issue_1384 executable: failed reconciliation partially committed';
  END IF;
END;
$stale_set$;

-- RLS allows the owner to read only their brand; a scanner is under-ranked,
-- and authenticated users have no direct write capability.
DO $rls$
DECLARE
  v_count integer;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '13840000-0000-4000-8000-000000000001', true);
  SELECT count(*) INTO v_count
  FROM public.place_discovery_price_ranges
  WHERE brand_id = '13840000-0000-4000-8000-000000000101';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'issue_1384 executable: brand owner cannot read own range';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.place_discovery_price_ranges
  WHERE brand_id = '13840000-0000-4000-8000-000000000102';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'issue_1384 executable: cross-brand range leaked through RLS';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '13840000-0000-4000-8000-000000000005', true);
  SELECT count(*) INTO v_count
  FROM public.place_discovery_price_ranges
  WHERE brand_id = '13840000-0000-4000-8000-000000000101';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'issue_1384 executable: under-ranked scanner read protected range';
  END IF;

  BEGIN
    UPDATE public.place_discovery_price_ranges
    SET source_min_minor = 1
    WHERE place_pool_id = '13840000-0000-4000-8000-000000000201';
    RAISE EXCEPTION 'issue_1384 executable: authenticated direct write succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
END;
$rls$;

-- Admin reason and CAS failures occur before place mutation; a valid reasoned
-- request changes legacy display fields and canonical money in one statement.
DO $admin$
DECLARE
  v_version bigint;
  v_name text;
BEGIN
  SELECT version INTO v_version
  FROM public.place_discovery_price_ranges
  WHERE place_pool_id = '13840000-0000-4000-8000-000000000201';
  SELECT name INTO v_name FROM public.place_pool
  WHERE id = '13840000-0000-4000-8000-000000000201';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '13840000-0000-4000-8000-000000000006', true);
  PERFORM set_config('request.jwt.claim.email', 'issue1384-admin@test.local', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"13840000-0000-4000-8000-000000000006","role":"authenticated","email":"issue1384-admin@test.local"}',
    true
  );
  BEGIN
    PERFORM public.issue_1384_admin_update_place_and_discovery_range(
      '13840000-0000-4000-8000-000000000201',
      'Must Roll Back', NULL, NULL, true, NULL,
      13000, 23000, v_version, ' ', gen_random_uuid()
    );
    RAISE EXCEPTION 'issue_1384 executable: Admin blank reason succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%admin_reason_required%' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.issue_1384_admin_update_place_and_discovery_range(
      '13840000-0000-4000-8000-000000000201',
      'Must Also Roll Back', NULL, NULL, true, NULL,
      13000, 23000, v_version - 1, 'price correction', gen_random_uuid()
    );
    RAISE EXCEPTION 'issue_1384 executable: Admin stale revision succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%range_version_conflict%' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT name FROM public.place_pool
      WHERE id = '13840000-0000-4000-8000-000000000201') IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'issue_1384 executable: failed Admin CAS partially changed place';
  END IF;

  PERFORM public.issue_1384_admin_update_place_and_discovery_range(
    '13840000-0000-4000-8000-000000000201',
    'Admin Corrected Place', NULL, NULL, true, NULL,
    13000, 23000, v_version, 'price correction', gen_random_uuid()
  );
  RESET ROLE;
  IF (SELECT name FROM public.place_pool
      WHERE id = '13840000-0000-4000-8000-000000000201') <> 'Admin Corrected Place'
     OR (SELECT source_min_minor FROM public.place_discovery_price_ranges
         WHERE place_pool_id = '13840000-0000-4000-8000-000000000201') <> 13000
     OR (SELECT version FROM public.place_discovery_price_ranges
         WHERE place_pool_id = '13840000-0000-4000-8000-000000000201') <> v_version + 1 THEN
    RAISE EXCEPTION 'issue_1384 executable: reasoned Admin atomic edit failed';
  END IF;
END;
$admin$;

ROLLBACK;
