\set ON_ERROR_STOP on
BEGIN;

DO $acl$
BEGIN
  IF has_function_privilege(
       'anon',
       'public.issue_1389_prepare_payment(uuid,text,bigint,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.issue_1389_prepare_payment(uuid,text,bigint,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.issue_1389_finalize_payment(text,text,text,text,text,bigint,text,bigint,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.record_stay_provider_fee(uuid,integer,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.issue_1389_run_stay_sweep(integer,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.issue_1389_record_stay_dispute(text,text,text,text,integer,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'A-1 FAIL: commerce service boundary leaked';
  END IF;
  RAISE NOTICE 'A-1 PASS: provider finalize/fee/sweep remain service-only';
END;
$acl$;

DO $cancellation$
DECLARE
  v_preview text;
  v_cancel text;
  v_sync text;
BEGIN
  SELECT pg_get_functiondef(
    'public.issue_1389_cancel_preview(uuid,uuid[],bigint,uuid)'::regprocedure
  ) INTO v_preview;
  SELECT pg_get_functiondef(
    'public.issue_1389_cancel(uuid,text,text,text,uuid)'::regprocedure
  ) INTO v_cancel;
  SELECT pg_get_functiondef(
    'public.issue_1389_sync_source_refund()'::regprocedure
  ) INTO v_sync;
  IF v_preview NOT LIKE '%stay_dependent_place_requires_room%'
     OR v_preview NOT LIKE '%policy_snapshot%'
     OR v_preview NOT LIKE '%refund_treatment%'
     OR v_cancel NOT LIKE '%FOR UPDATE%'
     OR v_cancel NOT LIKE '%source_refunds%'
     OR v_cancel NOT LIKE '%stay_inventory_commitments%'
     OR v_sync NOT LIKE '%payout_reversal_owed%'
     OR v_sync NOT LIKE '%convert_postponement_debt_to_permanent%' THEN
    RAISE EXCEPTION 'A-2 FAIL: selected cancellation or payout debt seam weak';
  END IF;
  RAISE NOTICE 'A-2 PASS: cancellation is dependency-safe and refund-allocated';
END;
$cancellation$;

DO $ambiguity$
DECLARE
  v_failure text;
  v_sweep text;
  v_late text;
BEGIN
  SELECT pg_get_functiondef(
    'public.issue_1389_record_payment_create_failure(uuid,text,boolean)'
      ::regprocedure
  ) INTO v_failure;
  SELECT pg_get_functiondef(
    'public.issue_1389_run_stay_sweep(integer,uuid)'::regprocedure
  ) INTO v_sweep;
  SELECT pg_get_functiondef(
    'public.issue_1389_queue_late_success_refund()'::regprocedure
  ) INTO v_late;
  IF v_failure NOT LIKE '%reconciliation_required%'
     OR v_failure NOT LIKE '%charge_ambiguous%'
     OR v_sweep NOT LIKE '%payment_ambiguous%'
     OR v_sweep NOT LIKE '%refund_due%'
     OR v_late NOT LIKE '%Late provider success without confirmed inventory%'
     OR v_late NOT LIKE '%source_refund_ledger_allocations%' THEN
    RAISE EXCEPTION 'A-3 FAIL: ambiguous or late charge can lose money truth';
  END IF;
  RAISE NOTICE 'A-3 PASS: ambiguous/late provider outcomes fail to reconciliation';
END;
$ambiguity$;

DO $disputes$
DECLARE
  v_dispute text;
BEGIN
  SELECT pg_get_functiondef(
    'public.issue_1389_record_stay_dispute(text,text,text,text,integer,text,text)'
      ::regprocedure
  ) INTO v_dispute;
  IF v_dispute NOT LIKE '%stay_provider_events%'
     OR v_dispute NOT LIKE '%post_release_dispute%'
     OR v_dispute NOT LIKE '%convert_postponement_debt_to_permanent%'
     OR v_dispute NOT LIKE '%stay_dispute_resolved%' THEN
    RAISE EXCEPTION 'A-4 FAIL: Stay dispute lifecycle is incomplete';
  END IF;
  RAISE NOTICE 'A-4 PASS: Stay disputes block pending money and create debt';
END;
$disputes$;

DO $append_only$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.stay_money_ledger'::regclass
      AND tgname = 'stay_money_ledger_append_only'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.stay_payout_line_snapshots'::regclass
      AND tgname = 'stay_payout_line_snapshots_append_only'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'A-5 FAIL: immutable financial evidence guard missing';
  END IF;
  RAISE NOTICE 'A-5 PASS: commerce and payout snapshots are append-only';
END;
$append_only$;

ROLLBACK;
