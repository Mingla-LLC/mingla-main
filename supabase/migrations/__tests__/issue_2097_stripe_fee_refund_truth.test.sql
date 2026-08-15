\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE statuses text[];
BEGIN
  SELECT array_agg(x ORDER BY x) INTO statuses FROM unnest(ARRAY[
    'awaiting_application_fee','application_fee_timeout','application_fee_conflict',
    'rejected_preflight','pending_visibility','succeeded_positive',
    'fee_evidence_unavailable','evidence_conflict','not_applicable','unknown_legacy'
  ]) x;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='ticket_refund_attempts') THEN RAISE EXCEPTION 'attempt table missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='ticket_refund_fee_evidence') THEN RAISE EXCEPTION 'evidence table missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='ticket_refund_quarantine') THEN RAISE EXCEPTION 'quarantine table missing'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='refunds'
    AND column_name='application_fee_refunded_cents' AND is_nullable<>'YES') THEN RAISE EXCEPTION 'fee amount must be nullable'; END IF;
  IF has_table_privilege('authenticated','public.ticket_refund_attempts','INSERT')
    OR has_table_privilege('authenticated','public.ticket_refund_attempts','UPDATE') THEN RAISE EXCEPTION 'client can mutate attempts'; END IF;
  IF has_function_privilege('authenticated','public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'client can finalize'; END IF;
END $$;

DO $$ DECLARE definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conname='ticket_refund_attempt_amount_check';
  IF definition IS NULL OR definition NOT LIKE '%succeeded_positive%[1-9]%'
    OR definition NOT LIKE '%not_applicable%fee_refund_amount_text = ''0''%' THEN
    RAISE EXCEPTION 'positive/zero truth constraint drifted: %',definition;
  END IF;
END $$;

DO $$ DECLARE body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO body FROM pg_proc p
    WHERE p.proname='issue_2097_finalize_refund_attempt';
  IF body NOT LIKE '%v_attempt_count=v_expected_count%'
    OR body NOT LIKE '%a.refund_id=v.refund_id%'
    OR body NOT LIKE '%ticket_refund_quarantine%' THEN
    RAISE EXCEPTION 'multi-attempt aggregate/quarantine finalization drifted';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO body FROM pg_proc p
    WHERE p.proname='issue_2097_prepare_refund_attempt';
  IF body NOT LIKE '%provider_call_permitted%false%'
    OR body LIKE '%v_existing.provider_call_permitted_at%IS NOT NULL%' THEN
    RAISE EXCEPTION 'durable replay can repeat provider mutation';
  END IF;
END $$;

ROLLBACK;
