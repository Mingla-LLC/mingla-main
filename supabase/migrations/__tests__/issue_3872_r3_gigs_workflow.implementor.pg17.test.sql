\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_tables integer;
  v_def text;
BEGIN
  SELECT count(*) INTO v_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
    AND c.relname IN ('gigs','gig_interest','gig_contracts','gig_terms_versions','gig_holds','gig_events','gig_shoot_plans','gig_scripts','gig_deliveries','gig_posts','gig_disputes','gig_dispute_offers','gig_ratings','brand_creator_roster');
  IF v_tables<>14 THEN RAISE EXCEPTION 'creator gig workflow tables missing: %',v_tables; END IF;

  IF has_table_privilege('anon','public.gig_contracts','select')
     OR has_table_privilege('anon','public.gig_holds','select')
     OR has_table_privilege('anon','public.gig_disputes','select') THEN
    RAISE EXCEPTION 'private gig workflow leaked to anon';
  END IF;
  IF has_function_privilege('anon','public.gig_contract_workspace(uuid)','execute')
     OR has_function_privilege('authenticated','public.gig_release_record(uuid,text)','execute')
     OR has_function_privilege('authenticated','public.gig_refund_record(uuid,text,bigint,bigint,text)','execute') THEN
    RAISE EXCEPTION 'workflow authority leaked';
  END IF;
  IF NOT has_function_privilege('authenticated','public.creator_gig_board(uuid,text)','execute')
     OR NOT has_function_privilege('authenticated','public.gig_delivery_decide(uuid,text,text[],text)','execute') THEN
    RAISE EXCEPTION 'expected creator or host workflow RPC missing';
  END IF;

  SELECT pg_get_functiondef('public.gig_transition(uuid,text,text,jsonb)'::regprocedure) INTO v_def;
  IF position('captured_hold_required' in v_def)=0
     OR position('technical_fix_limit' in pg_get_functiondef('public.gig_delivery_decide(uuid,text,text[],text)'::regprocedure))=0
     OR position('issue3872.script_lock' in v_def)=0 THEN
    RAISE EXCEPTION 'state, hold, script-lock or technical-fix authority missing';
  END IF;
  IF position('source_transaction' in pg_get_functiondef('public.gig_release_record(uuid,text)'::regprocedure))>0 THEN
    RAISE EXCEPTION 'provider release details must stay in the edge worker';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='issue_3872_terms_immutable' AND NOT tgisinternal)
     OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='issue_3872_scripts_immutable' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'immutable terms or script history guard missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='gig_delivery_fix_values')
     OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='gig_contracts_active_uq') THEN
    RAISE EXCEPTION 'fix categories or one-active-contract invariant missing';
  END IF;
END;
$test$;

ROLLBACK;
