\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_policy_count integer;
  v_rls_count integer;
  v_reconcile text;
  v_activate text;
  v_resolve text;
  v_admin_atomic text;
  v_price_aware text;
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

  SELECT pg_get_functiondef(
    'public.issue_1384_resolve_reconciliation(uuid,uuid,text,uuid,jsonb,uuid)'::regprocedure
  ) INTO v_resolve;
  IF v_resolve NOT LIKE '%WHEN default_currency IS NULL%'
     OR v_resolve NOT LIKE '%v_rec.reason = ''provisional_changed''%'
     OR v_resolve NOT LIKE '%THEN v_rec.to_currency_code%' THEN
    RAISE EXCEPTION
      'issue_1384 adversarial: provisional target is lost after reconciliation';
  END IF;

  SELECT pg_get_functiondef(
    'public.issue_1384_admin_update_place_and_discovery_range(uuid,text,text,text[],boolean,text[],bigint,bigint,bigint,text,uuid)'::regprocedure
  ) INTO v_admin_atomic;
  IF v_admin_atomic NOT LIKE '%admin_reason_required%'
     OR v_admin_atomic NOT LIKE '%range_version_conflict%'
     OR v_admin_atomic NOT LIKE '%admin_edit_place%'
     OR v_admin_atomic NOT LIKE '%issue_1384_save_discovery_price_range%' THEN
    RAISE EXCEPTION
      'issue_1384 adversarial: Admin edit is not one reasoned CAS transaction';
  END IF;

  SELECT pg_get_functiondef(
    'public.issue_1384_query_servable_places_by_signal(text,numeric,double precision,double precision,double precision,uuid[],integer,bigint,bigint,character,uuid)'::regprocedure
  ) INTO v_price_aware;
  IF position('p_price_filter_currency' IN v_price_aware) = 0
     OR position('ORDER BY ps.score' IN v_price_aware) = 0
     OR position('LIMIT p_limit' IN v_price_aware) = 0
     OR position('p_price_filter_currency' IN v_price_aware)
        > position('ORDER BY ps.score' IN v_price_aware) THEN
    RAISE EXCEPTION
      'issue_1384 adversarial: filter is not inside the pre-order/pre-limit RPC';
  END IF;
END;
$test$;

ROLLBACK;
