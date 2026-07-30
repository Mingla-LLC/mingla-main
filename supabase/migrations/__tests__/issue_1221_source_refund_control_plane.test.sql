\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE definition text;
BEGIN
  IF to_regclass('public.source_refunds') IS NULL
     OR to_regclass('public.source_refund_attempts') IS NULL
     OR to_regclass('public.source_refund_events') IS NULL
     OR to_regclass('public.source_refund_legacy_adoption_exceptions') IS NULL
     OR to_regclass('public.source_refund_ledger_allocations') IS NULL THEN
    RAISE EXCEPTION 'issue_1221_tables_missing';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
          WHERE oid='public.source_refunds'::regclass) THEN
    RAISE EXCEPTION 'issue_1221_rls_not_forced';
  END IF;
  IF has_table_privilege('anon','public.source_refunds','SELECT')
     OR has_table_privilege('authenticated','public.source_refunds','SELECT') THEN
    RAISE EXCEPTION 'issue_1221_browser_table_grant';
  END IF;
  SELECT pg_get_functiondef('public.record_source_refund_provider_event(uuid,text,integer,text,text,text,text,integer,text,text)'::regprocedure)
    INTO definition;
  IF definition NOT LIKE '%provider_amount_mismatch%'
     OR definition NOT LIKE '%stale_attempt%'
     OR definition NOT LIKE '%issue_1221_post_organizer_refund_liability%' THEN
    RAISE EXCEPTION 'issue_1221_exact_transition_missing';
  END IF;
  SELECT pg_get_functiondef(
    'public.adopt_legacy_venue_paystack_refund_attempts()'::regprocedure
  ) INTO definition;
  IF definition NOT LIKE '%FOR UPDATE%'
     OR definition NOT LIKE '%legacy_paystack_attempt:%'
     OR definition NOT LIKE '%legacy_paystack_reconciliation_required%'
     OR definition LIKE '%http_%' THEN
    RAISE EXCEPTION 'issue_1221_legacy_adoption_contract_missing';
  END IF;
  SELECT pg_get_functiondef(
    'public.ensure_source_refund_attempt(uuid,text)'::regprocedure
  ) INTO definition;
  IF definition NOT LIKE '%SELECT * INTO STRICT v_attempt%'
     OR definition NOT LIKE '%v_attempt.provider_idempotency_key%'
     OR definition NOT LIKE '%v_attempt.merchant_note%' THEN
    RAISE EXCEPTION 'issue_1221_conflict_winner_not_returned';
  END IF;
  IF has_function_privilege(
       'authenticated',
       'public.adopt_legacy_venue_paystack_refund_attempts()',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.adopt_legacy_venue_paystack_refund_attempts()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'issue_1221_legacy_adoption_grant_invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='issue_1221_source_refund_backstop')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='issue_1221_admin_refund_snapshot_cleanup') THEN
    RAISE EXCEPTION 'issue_1221_cron_missing';
  END IF;
  PERFORM * FROM public.admin_list_source_refund_operations(
    gen_random_uuid(),
    '{"sourceType":["rsvp_contribution"],"provider":["stripe"],"buyerState":["queued","processed"]}'::jsonb,
    repeat('c',64),NULL,0,25
  );
END $$;
ROLLBACK;
