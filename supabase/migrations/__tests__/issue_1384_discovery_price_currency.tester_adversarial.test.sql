\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_policy_count integer;
  v_rls_count integer;
  v_reconcile text;
  v_activate text;
BEGIN
  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'place_discovery_price_ranges',
      'place_discovery_price_range_revisions',
      'fx_rate_snapshots',
      'fx_rates',
      'brand_currency_reconciliations'
    );
  SELECT count(*) INTO v_rls_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'place_discovery_price_ranges',
      'place_discovery_price_range_revisions',
      'fx_rate_snapshots',
      'fx_rates',
      'brand_currency_reconciliations'
    )
    AND c.relrowsecurity;
  IF v_policy_count <> 3 OR v_rls_count <> 5 THEN
    RAISE EXCEPTION 'issue_1384 adversarial: RLS enablement/read policy coverage missing';
  END IF;

  IF has_table_privilege('anon', 'public.place_discovery_price_ranges', 'INSERT')
     OR has_table_privilege('authenticated', 'public.fx_rates', 'UPDATE')
     OR has_table_privilege('anon', 'public.brand_currency_reconciliations', 'SELECT') THEN
    RAISE EXCEPTION 'issue_1384 adversarial: base-table privilege leaked';
  END IF;

  SELECT pg_get_functiondef(
    'public.issue_1384_reconcile_bank_currency()'::regprocedure
  ) INTO v_reconcile;
  IF v_reconcile NOT LIKE '%reconciliation_required%'
     OR v_reconcile NOT LIKE '%v_from = NEW.default_currency%'
     OR v_reconcile NOT LIKE '%status = ''pending''%' THEN
    RAISE EXCEPTION 'issue_1384 adversarial: bank mismatch no longer blocks paid ranges';
  END IF;

  SELECT pg_get_functiondef(
    'public.issue_1384_activate_fx_snapshot(timestamptz,timestamptz,timestamptz,text,jsonb,jsonb)'::regprocedure
  ) INTO v_activate;
  IF v_activate NOT LIKE '%service_role%'
     OR v_activate NOT LIKE '%incomplete_fx_snapshot%'
     OR v_activate NOT LIKE '%status = ''superseded''%' THEN
    RAISE EXCEPTION 'issue_1384 adversarial: atomic FX activation guard incomplete';
  END IF;
END;
$test$;

ROLLBACK;
