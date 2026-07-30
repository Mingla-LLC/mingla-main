\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_can_charge text;
  v_can_collect text;
  v_save_range text;
  v_project text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brands'
      AND column_name = 'provisional_currency_code'
  ) THEN
    RAISE EXCEPTION 'issue_1384: provisional brand currency missing';
  END IF;

  IF (SELECT count(*) FROM public.supported_brand_currencies WHERE active) < 15
     OR NOT EXISTS (
       SELECT 1 FROM public.supported_brand_currencies
       WHERE code = 'NGN' AND minor_unit_exponent = 2
     ) THEN
    RAISE EXCEPTION 'issue_1384: supported currency registry incomplete';
  END IF;

  SELECT pg_get_functiondef(
    'public.pg_brand_can_charge(uuid)'::regprocedure
  ) INTO v_can_charge;
  SELECT pg_get_functiondef(
    'public.pg_brand_can_collect(uuid)'::regprocedure
  ) INTO v_can_collect;
  IF v_can_charge NOT LIKE '%brand_currency_reconciliations%'
     OR v_can_charge NOT LIKE '%stripe_connect_accounts%'
     OR v_can_collect NOT LIKE '%paystack_subaccount_code%'
     OR v_can_collect NOT LIKE '%brand_currency_reconciliations%' THEN
    RAISE EXCEPTION 'issue_1384: provider-aware paid readiness was not preserved';
  END IF;

  SELECT pg_get_functiondef(
    'public.issue_1384_save_discovery_price_range(uuid,uuid,uuid,bigint,bigint,character,bigint,text,uuid)'::regprocedure
  ) INTO v_save_range;
  IF v_save_range NOT LIKE '%p_expected_version%'
     OR v_save_range NOT LIKE '%currency_reconciliation_required%'
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.place_discovery_price_ranges'::regclass
         AND tgname = 'place_discovery_price_revision'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'issue_1384: canonical CAS range writer is incomplete';
  END IF;

  SELECT pg_get_functiondef(
    'public.place_discovery_range_for_viewer(uuid,character,uuid)'::regprocedure
  ) INTO v_project;
  IF v_project NOT LIKE '%fx_convert_minor%'
     OR v_project NOT LIKE '%source_min_minor%'
     OR v_project NOT LIKE '%price_is_approximate%' THEN
    RAISE EXCEPTION 'issue_1384: viewer projection is not canonical/pinned';
  END IF;
END;
$test$;

DO $math$
DECLARE
  v_snapshot uuid := gen_random_uuid();
  v_value bigint;
BEGIN
  INSERT INTO public.supported_brand_currencies (
    code, minor_unit_exponent, active, rail_source, display_order
  ) VALUES ('TST', 0, true, 'test', 9999);
  INSERT INTO public.fx_rate_snapshots (
    id, provider, base_currency_code,
    provider_updated_at, provider_next_update_at, provider_eol_at,
    stale_after, expires_at, payload_sha256, status
  ) VALUES (
    v_snapshot, 'exchange_rate_api_open_v6', 'USD',
    now() - interval '1 hour', now() + interval '23 hours',
    now() + interval '2 days', now() + interval '1 day',
    now() + interval '7 days', 'issue-1384-math-fixture', 'active'
  );
  INSERT INTO public.fx_rates (snapshot_id, currency_code, rate_per_base)
  VALUES (v_snapshot, 'USD', 1), (v_snapshot, 'TST', 2.5);

  SELECT public.fx_convert_minor(150, 'USD', 'TST', v_snapshot)
    INTO v_value;
  IF v_value <> 4 THEN
    RAISE EXCEPTION 'issue_1384: exponent-0 half-away rounding failed: %', v_value;
  END IF;
  SELECT public.fx_convert_minor(4, 'TST', 'USD', v_snapshot)
    INTO v_value;
  IF v_value <> 160 THEN
    RAISE EXCEPTION 'issue_1384: target/source ratio failed: %', v_value;
  END IF;
  SELECT public.fx_convert_minor(12345, 'USD', 'USD', NULL)
    INTO v_value;
  IF v_value <> 12345 THEN
    RAISE EXCEPTION 'issue_1384: same-currency identity failed: %', v_value;
  END IF;
END;
$math$;

ROLLBACK;
