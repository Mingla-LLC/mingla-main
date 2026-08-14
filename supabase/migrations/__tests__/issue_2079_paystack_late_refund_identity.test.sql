\set ON_ERROR_STOP on

DO $$
DECLARE v_definition text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='source_refunds'
      AND column_name='paystack_transaction_id' AND data_type='numeric') THEN
    RAISE EXCEPTION '#2079 paystack transaction identity missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='source_refunds'
      AND column_name='stripe_charge_id' AND data_type='text') THEN
    RAISE EXCEPTION '#2079 Stripe charge identity missing';
  END IF;
  IF has_function_privilege('anon',
      'public.issue_2079_capture_ticket_paid_identity_attention(uuid,text,text,text,text,text,text)','EXECUTE')
     OR has_function_privilege('authenticated',
      'public.issue_2079_capture_ticket_paid_identity_attention(uuid,text,text,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '#2079 capture RPC leaked';
  END IF;
  IF NOT has_function_privilege('service_role',
      'public.issue_2079_capture_ticket_paid_identity_attention(uuid,text,text,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '#2079 service capture grant missing';
  END IF;
  IF has_function_privilege('anon',
      'public.issue_2079_record_paid_identity_retry(uuid,text,text)','EXECUTE')
     OR has_function_privilege('authenticated',
      'public.issue_2079_record_paid_identity_retry(uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role',
      'public.issue_2079_record_paid_identity_retry(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '#2079 paid identity retry RPC privilege mismatch';
  END IF;
  SELECT pg_get_functiondef('public.claim_source_refund_operations(text,integer,timestamptz)'::regprocedure)
    INTO v_definition;
  IF v_definition !~ 'source_type\s*=\s*''ticket_checkout_session'''
     OR v_definition !~ 'buyer_state\s*=\s*''needs_attention'''
     OR v_definition !~ 'paystack_transaction_id\s+IS\s+NULL'
     OR v_definition !~ 'stripe_charge_id\s+IS\s+NULL' THEN
    RAISE EXCEPTION '#2079 ticket-only claim exclusion missing';
  END IF;
  SELECT pg_get_functiondef('public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean)'::regprocedure)
    INTO v_definition;
  IF v_definition NOT LIKE '%issue_1930_mint_ticket_late_reversal%'
     OR v_definition LIKE '%FROM public.brands WHERE id=v_session.brand_id%' THEN
    RAISE EXCEPTION '#2079 immutable provider authority missing';
  END IF;
END $$;

-- Executable contract: incomplete paid evidence is durably held, exact replay
-- is stable, conflicting replay cannot rewrite identity, and only a complete
-- provider-authoritative row is claimable by the refund worker.
BEGIN;
DELETE FROM public.source_refund_ledger_allocations
WHERE refund_id IN (
  SELECT id FROM public.source_refunds
  WHERE source_type='ticket_checkout_session'
    AND source_id IN ('20790000-0000-0000-0000-000000000721','20790000-0000-0000-0000-000000000722',
      '20790000-0000-0000-0000-000000000723','20790000-0000-0000-0000-000000000724')
);
DELETE FROM public.source_refunds
WHERE source_type='ticket_checkout_session'
  AND source_id IN ('20790000-0000-0000-0000-000000000721','20790000-0000-0000-0000-000000000722',
    '20790000-0000-0000-0000-000000000723','20790000-0000-0000-0000-000000000724');
DELETE FROM public.checkout_sale_revocation_outbox
WHERE event_id='20790000-0000-0000-0000-000000000711';
UPDATE public.ticket_checkout_sessions SET provider_attempt_id=NULL
WHERE id IN ('20790000-0000-0000-0000-000000000721','20790000-0000-0000-0000-000000000722');
DELETE FROM public.ticket_checkout_provider_attempts
WHERE checkout_session_id IN ('20790000-0000-0000-0000-000000000721','20790000-0000-0000-0000-000000000722',
  '20790000-0000-0000-0000-000000000723','20790000-0000-0000-0000-000000000724');
DELETE FROM public.ticket_checkout_sessions
WHERE id IN ('20790000-0000-0000-0000-000000000721','20790000-0000-0000-0000-000000000722',
  '20790000-0000-0000-0000-000000000723','20790000-0000-0000-0000-000000000724');
DELETE FROM public.ticket_types WHERE id='20790000-0000-0000-0000-000000000712';
DELETE FROM public.events WHERE id='20790000-0000-0000-0000-000000000711';
DELETE FROM public.brands WHERE id='20790000-0000-0000-0000-000000000710';
DELETE FROM public.creator_accounts WHERE id='20790000-0000-0000-0000-000000000701';
DELETE FROM auth.users WHERE id='20790000-0000-0000-0000-000000000701';

INSERT INTO auth.users(id) VALUES('20790000-0000-0000-0000-000000000701');
INSERT INTO public.creator_accounts(id) VALUES('20790000-0000-0000-0000-000000000701');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,pricing_currency,payment_provider)
VALUES('20790000-0000-0000-0000-000000000710','20790000-0000-0000-0000-000000000701',
  'Issue 2079 identity','issue-2079-identity','NGN','NGN','paystack');
INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone,currency)
VALUES('20790000-0000-0000-0000-000000000711','20790000-0000-0000-0000-000000000710',
  'Issue 2079 event','issue-2079-event','event','scheduled','public','UTC','NGN');
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,
  min_purchase_qty,available_online,available_in_person,display_order)
VALUES('20790000-0000-0000-0000-000000000712','20790000-0000-0000-0000-000000000711',
  'Issue 2079 ticket',1000,'NGN',false,10,1,true,false,0);

INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,
  buyer_phone_e164,currency,subtotal_cents,total_cents,status,idempotency_key,expires_at,
  application_fee_amount_cents)
VALUES
('20790000-0000-0000-0000-000000000721','20790000-0000-0000-0000-000000000711',
 '20790000-0000-0000-0000-000000000710','Attention buyer','attention@example.com',
 '+2348012345678','NGN',1000,1000,'requires_payment','issue-2079-attention',now()+interval '15 minutes',100),
('20790000-0000-0000-0000-000000000722','20790000-0000-0000-0000-000000000711',
 '20790000-0000-0000-0000-000000000710','Complete buyer','complete@example.com',
 '+2348012345678','NGN',1000,1000,'requires_payment','issue-2079-complete',now()+interval '15 minutes',100),
('20790000-0000-0000-0000-000000000723','20790000-0000-0000-0000-000000000711',
 '20790000-0000-0000-0000-000000000710','Stripe attention','stripe-attention@example.com',
 '+2348012345678','USD',1000,1000,'requires_payment','issue-2079-stripe-attention',now()+interval '15 minutes',100),
('20790000-0000-0000-0000-000000000724','20790000-0000-0000-0000-000000000711',
 '20790000-0000-0000-0000-000000000710','Stripe complete','stripe-complete@example.com',
 '+2348012345678','USD',1000,1000,'requires_payment','issue-2079-stripe-complete',now()+interval '15 minutes',100),
('20790000-0000-0000-0000-000000000725','20790000-0000-0000-0000-000000000711',
 '20790000-0000-0000-0000-000000000710','Missing attempt','missing-attempt@example.com',
 '+2348012345678','NGN',1000,1000,'failed','issue-2079-missing-attempt',now()+interval '15 minutes',100);
UPDATE public.ticket_checkout_sessions SET revoked_at=now(),revoked_reason='event_status',
  reversal_state='paid_reversal_pending'
WHERE id='20790000-0000-0000-0000-000000000725';

DO $test$
DECLARE v_claim jsonb; v_replay jsonb; v_conflict jsonb; v_complete jsonb;
  v_attempt uuid; v_epoch bigint; v_refund uuid; v_stripe_refund uuid;
BEGIN
  v_claim:=public.issue_1930_claim_ticket_provider_attempt(
    '20790000-0000-0000-0000-000000000721','20790000-0000-0000-0000-000000000711',
    'paystack','paystack_redirect','issue-2079-attention-fingerprint');
  v_attempt:=(v_claim->>'attemptId')::uuid; v_epoch:=(v_claim->>'epoch')::bigint;
  IF v_claim->>'outcome'<>'fresh_claim' THEN RAISE EXCEPTION '#2079 attention claim failed: %',v_claim; END IF;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(v_attempt,v_epoch,NULL,NULL,
    'issue-2079-paystack-attention-reference','issue-2079-attention-continuation');

  v_replay:=public.issue_2079_capture_ticket_paid_identity_attention(
    '20790000-0000-0000-0000-000000000721','paystack',
    'issue-2079-paystack-attention-reference',NULL,NULL,NULL,
    'paid_provider_transaction_id_invalid');
  IF v_replay->>'outcome'<>'attention' THEN RAISE EXCEPTION '#2079 incomplete identity was not held: %',v_replay; END IF;
  v_refund:=(v_replay->>'refundId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE id=v_refund
      AND buyer_state='needs_attention' AND financial_state='needs_attention'
      AND ops_status='needs_review' AND paystack_transaction_id IS NULL
      AND provider_payment_reference='issue-2079-paystack-attention-reference')
     OR (SELECT count(*) FROM public.source_refund_ledger_allocations WHERE refund_id=v_refund)<>3
     OR NOT EXISTS(SELECT 1 FROM public.ticket_checkout_provider_attempts
       WHERE id=v_attempt AND state='provider_unknown') THEN
    RAISE EXCEPTION '#2079 attention state/ledger/provider attempt mismatch';
  END IF;

  v_replay:=public.issue_2079_capture_ticket_paid_identity_attention(
    '20790000-0000-0000-0000-000000000721','paystack',
    'issue-2079-paystack-attention-reference',NULL,NULL,NULL,
    'paid_provider_transaction_id_invalid');
  IF v_replay->>'outcome'<>'existing'
     OR (SELECT count(*) FROM public.source_refunds WHERE source_id='20790000-0000-0000-0000-000000000721')<>1 THEN
    RAISE EXCEPTION '#2079 exact replay was not stable: %',v_replay;
  END IF;
  v_replay:=public.issue_1930_mint_ticket_late_reversal(
    '20790000-0000-0000-0000-000000000721','paystack',
    'issue-2079-paystack-attention-reference','2079001',NULL);
  IF v_replay->>'outcome'<>'promoted'
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE id=v_refund
       AND paystack_transaction_id=2079001 AND buyer_state='queued'
       AND financial_state='pending' AND ops_status='none') THEN
    RAISE EXCEPTION '#2079 authenticated secondary completion did not promote: %',v_replay;
  END IF;
  v_conflict:=public.issue_1930_mint_ticket_late_reversal(
    '20790000-0000-0000-0000-000000000721','paystack',
    'issue-2079-paystack-attention-reference','2079003',NULL);
  IF v_conflict->>'outcome'<>'conflict'
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE id=v_refund
       AND paystack_transaction_id=2079001 AND buyer_state='needs_attention'
       AND last_error_code='paid_provider_evidence_conflict') THEN
    RAISE EXCEPTION '#2079 conflicting complete replay rewrote canonical identity: %',v_conflict;
  END IF;

  v_claim:=public.issue_1930_claim_ticket_provider_attempt(
    '20790000-0000-0000-0000-000000000722','20790000-0000-0000-0000-000000000711',
    'paystack','paystack_redirect','issue-2079-complete-fingerprint');
  v_attempt:=(v_claim->>'attemptId')::uuid; v_epoch:=(v_claim->>'epoch')::bigint;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(v_attempt,v_epoch,NULL,NULL,
    'issue-2079-paystack-complete-reference','issue-2079-complete-continuation');
  -- Mutable brand routing must not override the attempt's immutable provider.
  UPDATE public.brands SET payment_provider='stripe'
  WHERE id='20790000-0000-0000-0000-000000000710';
  v_complete:=public.issue_1930_mint_ticket_late_reversal(
    '20790000-0000-0000-0000-000000000722','paystack',
    'issue-2079-paystack-complete-reference','2079002',NULL);
  IF v_complete->>'outcome'<>'queued'
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds
       WHERE source_id='20790000-0000-0000-0000-000000000722'
         AND provider='paystack' AND paystack_transaction_id=2079002
         AND buyer_state='queued' AND financial_state='pending') THEN
    RAISE EXCEPTION '#2079 complete immutable Paystack identity was not queued: %',v_complete;
  END IF;

  v_claim:=public.issue_1930_claim_ticket_provider_attempt(
    '20790000-0000-0000-0000-000000000723','20790000-0000-0000-0000-000000000711',
    'stripe','stripe_native','issue-2079-stripe-attention-fingerprint');
  v_attempt:=(v_claim->>'attemptId')::uuid; v_epoch:=(v_claim->>'epoch')::bigint;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(v_attempt,v_epoch,
    'pi_2079attention',NULL,NULL,'issue-2079-stripe-attention-continuation');
  UPDATE public.ticket_checkout_sessions SET stripe_account_id='acct_2079attention',
    stripe_payment_intent_id='pi_2079attention'
  WHERE id='20790000-0000-0000-0000-000000000723';
  v_replay:=public.issue_2079_verify_ticket_paid_identity(
    '20790000-0000-0000-0000-000000000723','stripe','pi_2079attention',NULL,NULL,
    'acct_2079attention');
  v_stripe_refund:=(v_replay->>'refundId')::uuid;
  IF v_replay->>'outcome'<>'attention'
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE id=v_stripe_refund
       AND provider='stripe' AND provider_payment_reference='pi_2079attention'
       AND stripe_charge_id IS NULL AND buyer_state='needs_attention'
       AND last_error_code='paid_provider_charge_missing') THEN
    RAISE EXCEPTION '#2079 missing Stripe charge was not held: %',v_replay;
  END IF;

  v_claim:=public.issue_1930_claim_ticket_provider_attempt(
    '20790000-0000-0000-0000-000000000724','20790000-0000-0000-0000-000000000711',
    'stripe','stripe_native','issue-2079-stripe-complete-fingerprint');
  v_attempt:=(v_claim->>'attemptId')::uuid; v_epoch:=(v_claim->>'epoch')::bigint;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(v_attempt,v_epoch,
    'pi_2079complete',NULL,NULL,'issue-2079-stripe-complete-continuation');
  UPDATE public.ticket_checkout_sessions SET stripe_account_id='acct_2079complete',
    stripe_payment_intent_id='pi_2079complete'
  WHERE id='20790000-0000-0000-0000-000000000724';
  v_complete:=public.issue_1930_mint_ticket_late_reversal(
    '20790000-0000-0000-0000-000000000724','stripe','pi_2079complete',NULL,'ch_2079complete');
  IF v_complete->>'outcome'<>'queued'
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds
       WHERE source_id='20790000-0000-0000-0000-000000000724'
         AND provider='stripe' AND provider_payment_reference='pi_2079complete'
         AND stripe_charge_id='ch_2079complete' AND buyer_state='queued') THEN
    RAISE EXCEPTION '#2079 complete Stripe identity was not queued: %',v_complete;
  END IF;

  v_replay:=public.biz_ticket_checkout_finalize(
    '20790000-0000-0000-0000-000000000725',
    'issue-2079-missing-attempt-reference','2079005','card','issue-2079-pepper');
  IF v_replay->>'outcome'<>'paid_reversal_pending'
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds
       WHERE source_id='20790000-0000-0000-0000-000000000725'
         AND provider='paystack' AND provider_payment_reference='issue-2079-missing-attempt-reference'
         AND paystack_transaction_id=2079005 AND buyer_state='needs_attention'
         AND last_error_code='paid_provider_attempt_missing') THEN
    RAISE EXCEPTION '#2079 missing-attempt paid evidence was dropped or relabelled: %',v_replay;
  END IF;

  PERFORM * FROM public.claim_source_refund_operations('issue-2079-worker',25,now());
  IF EXISTS(SELECT 1 FROM public.source_refunds
       WHERE id IN (v_refund,v_stripe_refund) AND lease_owner IS NOT NULL)
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds
       WHERE source_id='20790000-0000-0000-0000-000000000722'
         AND lease_owner='issue-2079-worker')
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds
       WHERE source_id='20790000-0000-0000-0000-000000000724'
         AND lease_owner='issue-2079-worker') THEN
    RAISE EXCEPTION '#2079 ticket-specific claim predicate is unsafe';
  END IF;

  UPDATE public.checkout_sale_revocation_outbox SET
    state='leased',lease_owner='issue-2079-retry-worker',leased_at=now(),
    attempt_count=3,next_retry_at=NULL
  WHERE subject_type='ticket_checkout_session'
    AND subject_id='20790000-0000-0000-0000-000000000725';
  PERFORM public.issue_2079_record_paid_identity_retry(
    (SELECT id FROM public.checkout_sale_revocation_outbox
      WHERE subject_type='ticket_checkout_session'
        AND subject_id='20790000-0000-0000-0000-000000000725'),
    'issue-2079-retry-worker','paid_provider_identity_pending');
  IF NOT EXISTS(SELECT 1 FROM public.checkout_sale_revocation_outbox
      WHERE subject_type='ticket_checkout_session'
        AND subject_id='20790000-0000-0000-0000-000000000725'
        AND state='provider_unknown' AND lease_owner IS NULL
        AND leased_at IS NULL AND next_retry_at>now()
        AND last_error_code='paid_provider_identity_pending') THEN
    RAISE EXCEPTION '#2079 paid identity retry did not release exact lease with bounded backoff';
  END IF;
END $test$;
ROLLBACK;
