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

-- Refund status notices reach a real recipient.
--
-- A ticket checkout refunded because the ticket could not be confirmed used to
-- resolve NO recipient for its "refunded" notice on any channel: the resolver
-- served only open action-needed requests and never looked at ticket checkout
-- sessions. Every delivery ended failed_terminal / invalid_recipient and the
-- refund sat in needs_review. RESTORE the resolver's needs_attention-only gate
-- (or drop its ticket_checkout_session branch) and this block fails.
BEGIN;
INSERT INTO auth.users(id) VALUES('5eed0000-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES('5eed0000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,pricing_currency,payment_provider,
  contact_email,contact_phone)
VALUES('5eed0000-0000-4000-8000-000000000010','5eed0000-0000-4000-8000-000000000001',
  'Refund notice brand','refund-notice-brand','USD','USD','stripe',
  'brand-notices@example.com','+15555550100');
INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone,currency)
VALUES('5eed0000-0000-4000-8000-000000000011','5eed0000-0000-4000-8000-000000000010',
  'Refund notice event','refund-notice-event','event','scheduled','public','UTC','USD');
INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,
  buyer_phone_e164,currency,subtotal_cents,total_cents,status,idempotency_key,expires_at,
  application_fee_amount_cents)
VALUES('5eed0000-0000-4000-8000-000000000021','5eed0000-0000-4000-8000-000000000011',
  '5eed0000-0000-4000-8000-000000000010','Notice buyer','buyer-notices@example.com',
  '+15555550101','USD',300,300,'requires_payment','refund-notice-ticket',
  now()+interval '15 minutes',0);

DO $test$
DECLARE v_claim jsonb; v_attempt uuid; v_epoch bigint; v_minted jsonb;
  v_refund uuid; v_buyer_attempt jsonb; v_recorded jsonb; v_event bigint;
  v_outbox uuid; v_delivery uuid; v_resolved jsonb; v_channel text;
  v_audience text; v_state text; v_expected text; v_case record;
BEGIN
  v_claim:=public.issue_1930_claim_ticket_provider_attempt(
    '5eed0000-0000-4000-8000-000000000021','5eed0000-0000-4000-8000-000000000011',
    'stripe','stripe_native','refund-notice-fingerprint');
  v_attempt:=(v_claim->>'attemptId')::uuid; v_epoch:=(v_claim->>'epoch')::bigint;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(v_attempt,v_epoch,
    'pi_refundnotice',NULL,NULL,'refund-notice-continuation');
  UPDATE public.ticket_checkout_sessions SET stripe_account_id='acct_refundnotice',
    stripe_payment_intent_id='pi_refundnotice'
  WHERE id='5eed0000-0000-4000-8000-000000000021';
  v_minted:=public.issue_1930_mint_ticket_late_reversal(
    '5eed0000-0000-4000-8000-000000000021','stripe','pi_refundnotice',NULL,'ch_refundnotice');
  SELECT id INTO v_refund FROM public.source_refunds
  WHERE source_type='ticket_checkout_session'
    AND source_id='5eed0000-0000-4000-8000-000000000021'
    AND refund_kind='late_payment_no_value';
  IF v_minted->>'outcome'<>'queued' OR v_refund IS NULL THEN
    RAISE EXCEPTION 'refund notice fixture: ticket refund was not queued: %',v_minted;
  END IF;

  v_buyer_attempt:=public.ensure_source_refund_attempt(v_refund,'buyer_refund');
  v_recorded:=public.record_source_refund_provider_event(v_refund,'buyer_refund',
    (v_buyer_attempt->>'attempt_no')::integer,'refund-notice:processed',
    'worker_reconciliation','worker:refund-notice','processed',300,
    're_refundnotice','stripe_verified_refund');
  v_event:=(v_recorded->>'source_refund_event_id')::bigint;
  IF v_event IS NULL OR NOT EXISTS(SELECT 1 FROM public.source_refunds
      WHERE id=v_refund AND buyer_state='processed' AND attention_generation=0) THEN
    RAISE EXCEPTION 'refund notice fixture: refund did not reach processed: %',v_recorded;
  END IF;

  FOR v_case IN SELECT * FROM (VALUES
    ('buyer','email','processed','buyer-notices@example.com'),
    ('buyer','sms','processed','+15555550101'),
    ('brand','email','processed','brand-notices@example.com'),
    ('brand','inapp','processed','<resolved>'),
    ('buyer','email','provider_pending','buyer-notices@example.com'),
    ('buyer','email','needs_attention',NULL),
    ('buyer','email',NULL,NULL)
  ) AS t(audience,channel,state,expected) LOOP
    v_audience:=v_case.audience; v_channel:=v_case.channel;
    v_state:=v_case.state; v_expected:=v_case.expected;
    INSERT INTO public.notification_outbox(category_key,brand_id,payload,idempotency_key,
      channel,contract_version,attention_generation,source_refund_event_id,status,
      notification_group_key,next_attempt_at)
    VALUES(
      CASE WHEN v_audience='buyer' THEN 'source_refund_buyer_state' ELSE 'source_refund_brand_state' END,
      '5eed0000-0000-4000-8000-000000000010',
      jsonb_strip_nulls(jsonb_build_object('state',v_state,'source_refund_id',v_refund,
        'audience',v_audience,'amount','$3.00')),
      'refund-notice:'||v_audience||':'||v_channel||':'||COALESCE(v_state,'none'),
      v_channel,9,1,v_event,'pending','source_refund:'||v_refund||':1',now())
    RETURNING id INTO v_outbox;
    INSERT INTO public.source_refund_notification_deliveries(refund_id,source_refund_event_id,
      outbox_id,attention_generation,audience,channel,recipient_revision,recipient_key_id,
      recipient_fingerprint,payload_fingerprint,serializer_version,idempotency_key,status,
      next_attempt_at)
    VALUES(v_refund,v_event,v_outbox,1,v_audience,v_channel,0,
      CASE WHEN v_channel IN ('email','sms') THEN 'rec1' END,
      CASE WHEN v_channel IN ('email','sms')
        THEN 'v1:rec1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' END,
      repeat('a',64),9,'refund-notice:'||v_audience||':'||v_channel||':'||COALESCE(v_state,'none'),
      'queued',now())
    RETURNING id INTO v_delivery;
    PERFORM public.claim_source_refund_notification_delivery(v_outbox,
      '5eed0000-0000-4000-8000-0000000000c1',9,now());
    v_resolved:=public.resolve_source_refund_notification_recipient(v_delivery,
      '5eed0000-0000-4000-8000-0000000000c1');
    IF v_expected IS NULL THEN
      IF v_resolved IS NOT NULL THEN
        RAISE EXCEPTION 'refund notice: % % notice in state % must not resolve on a processed refund: %',
          v_audience,v_channel,COALESCE(v_state,'<none>'),v_resolved;
      END IF;
    ELSIF v_resolved IS NULL
       OR (v_expected<>'<resolved>'
         AND v_resolved->>'recipient' IS DISTINCT FROM v_expected)
       OR v_resolved->>'channel'<>v_channel THEN
      RAISE EXCEPTION 'refund notice: % % % notice resolved % (expected %)',
        v_audience,v_channel,v_state,v_resolved,v_expected;
    END IF;
  END LOOP;

  -- A contact corrected on the refund wins, exactly as the runner fingerprints it.
  UPDATE public.source_refunds SET attention_recipient_email_override='fixed-notices@example.com'
  WHERE id=v_refund;
  INSERT INTO public.notification_outbox(category_key,brand_id,payload,idempotency_key,
    channel,contract_version,attention_generation,source_refund_event_id,status,
    notification_group_key,next_attempt_at)
  VALUES('source_refund_buyer_state','5eed0000-0000-4000-8000-000000000010',
    jsonb_build_object('state','processed','source_refund_id',v_refund,'audience','buyer'),
    'refund-notice:override',
    'email',9,1,v_event,'pending','source_refund:'||v_refund||':1',now())
  RETURNING id INTO v_outbox;
  INSERT INTO public.source_refund_notification_deliveries(refund_id,source_refund_event_id,
    outbox_id,attention_generation,audience,channel,recipient_revision,recipient_key_id,
    recipient_fingerprint,payload_fingerprint,serializer_version,idempotency_key,status,
    next_attempt_at)
  VALUES(v_refund,v_event,v_outbox,1,'buyer','email',0,'rec1',
    'v1:rec1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',repeat('a',64),9,
    'refund-notice:override','queued',now())
  RETURNING id INTO v_delivery;
  PERFORM public.claim_source_refund_notification_delivery(v_outbox,
    '5eed0000-0000-4000-8000-0000000000c2',9,now());
  v_resolved:=public.resolve_source_refund_notification_recipient(v_delivery,
    '5eed0000-0000-4000-8000-0000000000c2');
  IF v_resolved->>'recipient' IS DISTINCT FROM 'fixed-notices@example.com' THEN
    RAISE EXCEPTION 'refund notice: corrected contact was not used: %',v_resolved;
  END IF;

  IF has_function_privilege('anon',
      'public.resolve_source_refund_notification_recipient(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
      'public.resolve_source_refund_notification_recipient(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role',
      'public.resolve_source_refund_notification_recipient(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'refund notice: recipient resolver privilege mismatch';
  END IF;
END $test$;
ROLLBACK;

-- A paid checkout held only because evidence was missing completes the sale.
--
-- A payment that succeeded, but whose first signal lacked a charge id (or a
-- Paystack transaction id), was held and its refund queued the moment complete
-- evidence arrived. release_ticket_checkout_evidence_hold() now lifts such a
-- hold when the provider proves the payment and the sale is still open, and
-- keeps the refund for every genuine conflict. DROP the release function's
-- migration, or weaken any gate below, and this block fails.
BEGIN;
INSERT INTO auth.users(id) VALUES('e71d0000-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES('e71d0000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,pricing_currency,payment_provider)
VALUES('e71d0000-0000-4000-8000-000000000010','e71d0000-0000-4000-8000-000000000001',
  'Evidence hold brand','evidence-hold-brand','USD','USD','stripe'),
('e71d0000-0000-4000-8000-000000000020','e71d0000-0000-4000-8000-000000000001',
  'Evidence hold NG brand','evidence-hold-ng-brand','NGN','NGN','paystack');
INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone,currency)
VALUES('e71d0000-0000-4000-8000-000000000011','e71d0000-0000-4000-8000-000000000010',
  'Evidence hold event','evidence-hold-event','event','scheduled','public','UTC','USD'),
('e71d0000-0000-4000-8000-000000000021','e71d0000-0000-4000-8000-000000000020',
  'Evidence hold NG event','evidence-hold-ng-event','event','scheduled','public','UTC','NGN');
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,
  min_purchase_qty,available_online,available_in_person,display_order)
VALUES('e71d0000-0000-4000-8000-000000000012','e71d0000-0000-4000-8000-000000000011',
  'General',1000,'USD',false,100,1,true,false,0),
('e71d0000-0000-4000-8000-000000000013','e71d0000-0000-4000-8000-000000000011',
  'Last seat',1000,'USD',false,1,1,true,false,1),
-- Section 10 needs a scarce type of its OWN. Section 5 sells 'Last seat' to the
-- other buyer to prove a sold-out hold keeps its refund, so by the time section
-- 10 runs that type has no seats left and its fixture cannot even be claimed —
-- the claim answers 'revoked' and the block dies in its own setup.
('e71d0000-0000-4000-8000-000000000014','e71d0000-0000-4000-8000-000000000011',
  'Last seat, second run',1000,'USD',false,1,1,true,false,2),
('e71d0000-0000-4000-8000-000000000022','e71d0000-0000-4000-8000-000000000021',
  'NG General',1000,'NGN',false,100,1,true,false,0);

-- A Stripe native checkout for one ticket, paid, whose first signal had no
-- charge id: exactly the hold the webhook used to create.
CREATE FUNCTION pg_temp.evidence_hold_stripe(p_id uuid,p_ticket_type uuid,p_pi text,p_charge text,
  p_fee integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v_claim jsonb; v_attempt uuid; v_epoch bigint;
BEGIN
  INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,
    buyer_phone_e164,currency,subtotal_cents,total_cents,status,idempotency_key,expires_at,
    application_fee_amount_cents)
  VALUES(p_id,'e71d0000-0000-4000-8000-000000000011','e71d0000-0000-4000-8000-000000000010',
    'Hold buyer','hold-buyer@example.com','+15555550111','USD',1000,1000,'requires_payment',
    'evidence-hold-'||p_id,now()+interval '15 minutes',p_fee);
  INSERT INTO public.ticket_checkout_session_items(checkout_session_id,ticket_type_id,
    ticket_name_at_purchase,quantity,unit_price_cents,total_cents)
  VALUES(p_id,p_ticket_type,'Ticket',1,1000,1000);
  v_claim:=public.issue_1930_claim_ticket_provider_attempt(p_id,
    'e71d0000-0000-4000-8000-000000000011','stripe','stripe_native','evidence-hold-fp-'||p_id);
  IF v_claim->>'outcome'<>'fresh_claim' THEN
    RAISE EXCEPTION 'evidence hold fixture: claim failed %',v_claim;
  END IF;
  v_attempt:=(v_claim->>'attemptId')::uuid; v_epoch:=(v_claim->>'epoch')::bigint;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(v_attempt,v_epoch,p_pi,NULL,NULL,
    'evidence-hold-cont-'||p_id);
  UPDATE public.ticket_checkout_sessions SET stripe_account_id='acct_evidencehold',
    stripe_payment_intent_id=p_pi WHERE id=p_id;
  RETURN public.issue_2079_verify_ticket_paid_identity(p_id,'stripe',p_pi,NULL,p_charge,
    'acct_evidencehold');
END $f$;

CREATE FUNCTION pg_temp.evidence_hold_release(p_id uuid,p_pi text,p_charge text,
  p_account text DEFAULT 'acct_evidencehold',p_amount bigint DEFAULT 1000,p_currency text DEFAULT 'usd')
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.release_ticket_checkout_evidence_hold(p_id,'stripe',p_pi,NULL,p_charge,
    p_account,p_amount,p_currency)
$f$;

-- Does source_refunds REFUSE this write? The probe runs inside a subtransaction
-- that is rolled back whether the write is accepted or rejected, so the row it
-- is aimed at is never actually changed. It answers true only for a CHECK
-- violation: any other error is re-raised rather than counted as a refusal, so
-- a probe that fails for the wrong reason cannot quietly pass.
CREATE FUNCTION pg_temp.evidence_hold_refuses(p_id uuid,p_set text) RETURNS boolean
LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE format('UPDATE public.source_refunds SET %s WHERE id=%L',p_set,p_id);
    RAISE EXCEPTION 'evidence_hold_probe_accepted';
  EXCEPTION
    WHEN check_violation THEN RETURN true;
    WHEN raise_exception THEN
      IF SQLERRM='evidence_hold_probe_accepted' THEN RETURN false; END IF;
      RAISE;
  END;
END $f$;

CREATE FUNCTION pg_temp.evidence_hold_intact(p_id uuid) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
      WHERE s.id=p_id AND s.status='failed' AND s.reversal_state='paid_reversal_pending'
        AND s.order_id IS NULL)
    AND EXISTS(SELECT 1 FROM public.source_refunds r
      WHERE r.source_type='ticket_checkout_session' AND r.source_id=p_id
        AND r.refund_kind='late_payment_no_value')
$f$;

DO $test$
DECLARE v jsonb; v_order jsonb; v_replay jsonb; v_claim jsonb; v_attempt uuid; v_epoch bigint;
  v_refund_a uuid;
  v_pepper text:='evidence-hold-test-pepper-0123456789abcdef';
  a uuid:='e71d0000-0000-4000-8000-0000000000a1'; b uuid:='e71d0000-0000-4000-8000-0000000000b1';
  c uuid:='e71d0000-0000-4000-8000-0000000000c1'; d uuid:='e71d0000-0000-4000-8000-0000000000d1';
  e uuid:='e71d0000-0000-4000-8000-0000000000e1'; e2 uuid:='e71d0000-0000-4000-8000-0000000000e2';
  f uuid:='e71d0000-0000-4000-8000-0000000000f1'; g uuid:='e71d0000-0000-4000-8000-0000000000a7';
  h uuid:='e71d0000-0000-4000-8000-0000000000a8'; i uuid:='e71d0000-0000-4000-8000-0000000000a9';
  j uuid:='e71d0000-0000-4000-8000-0000000000aa'; k uuid:='e71d0000-0000-4000-8000-0000000000ab';
  v_outbox uuid; v_handoff text;
  v_held integer; v_expires timestamptz; v_reopen jsonb;
BEGIN
  -- ── 1. Webhook without a charge, then the buyer's confirm with one ────────
  v:=pg_temp.evidence_hold_stripe(a,'e71d0000-0000-4000-8000-000000000012','pi_evidenceA',NULL);
  IF v->>'outcome'<>'attention' OR NOT pg_temp.evidence_hold_intact(a) THEN
    RAISE EXCEPTION 'evidence hold 1: fixture did not hold: %',v;
  END IF;
  SELECT id INTO v_refund_a FROM public.source_refunds WHERE source_id=a;
  v:=pg_temp.evidence_hold_release(a,'pi_evidenceA','ch_evidenceA');
  IF v->>'outcome'<>'released' OR (v->>'refundsReleased')::int<>1 THEN
    RAISE EXCEPTION 'evidence hold 1: complete evidence did not release the hold: %',v;
  END IF;
  -- #1221's money ledger is APPEND-ONLY: issue_1221_enforce_allocation_monotonic()
  -- rejects every DELETE on source_refund_ledger_allocations and allows only
  -- prepared -> posted, and refund_id is ON DELETE RESTRICT. The release
  -- therefore RETIRES the obligation in place — reconciled, ops-resolved, an
  -- appended ops_resolved event, no lease, no retry — and leaves the three
  -- prepared allocations exactly as they were: prepared, never posted. Make the
  -- release delete either of them again and this block fails on `append_only`.
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE id=v_refund_a
       AND financial_state='reconciled' AND ops_status='resolved'
       AND last_error_code='sale_completed_no_refund_due'
       AND buyer_refund_processed_cents=0 AND provider_refund_id IS NULL
       AND lease_owner IS NULL AND next_retry_at IS NULL
       AND attention_completed_at IS NOT NULL AND attention_expires_at IS NULL)
     OR (SELECT count(*) FROM public.source_refund_ledger_allocations
       WHERE refund_id=v_refund_a AND state='prepared'
         AND payout_release_id IS NULL AND payout_ledger_adjustment_id IS NULL)<>3
     OR NOT EXISTS(SELECT 1 FROM public.source_refund_events WHERE refund_id=v_refund_a
       AND event_type='ops_resolved' AND safe_reason_code='sale_completed_no_refund_due'
       AND to_state='reconciled' AND amount_observed_cents=0)
     OR NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions WHERE id=a
       AND status='processing_payment' AND reversal_state='none' AND failed_at IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.ticket_checkout_provider_attempts
       WHERE checkout_session_id=a AND state='ready')
     OR EXISTS(SELECT 1 FROM public.checkout_sale_revocation_outbox
       WHERE subject_type='ticket_checkout_session' AND subject_id=a AND state<>'sale_completed')
     OR NOT EXISTS(SELECT 1 FROM public.audit_log WHERE target_type='ticket_checkout_session'
       AND target_id=a::text AND action='ticket_checkout.evidence_hold_released') THEN
    RAISE EXCEPTION 'evidence hold 1: release left refund, session, attempt, outbox or audit wrong';
  END IF;
  -- RETIRED MEANS CANCELLED, NOT PAID.
  --
  -- #1221 had no word for "this refund was never owed and was never paid".
  -- Writing financial_state='reconciled' and leaving the legs alone is a row
  -- the table refuses; marking the legs 'processed' would drag
  -- buyer_refund_processed_cents up to buyer_refund_requested_cents, which
  -- would be the ledger asserting Mingla paid a refund it never paid. So both
  -- legs close on a real terminal state that means CANCELLED, the requested
  -- figures are untouched, both processed figures stay at zero, and the
  -- provider identity this hold was missing is now on the row. Delete the
  -- buyer_state or fee_state line from the release and this fails on a CHECK.
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE id=v_refund_a
       AND buyer_state='cancelled_no_refund_due'
       AND fee_state='cancelled_no_reversal_due'
       AND buyer_refund_requested_cents=1000 AND buyer_refund_processed_cents=0
       AND fee_reversal_required_cents=100 AND fee_reversal_processed_cents=0
       AND organizer_refund_liability_cents=900 AND platform_fee_absorption_cents=100
       AND stripe_charge_id='ch_evidenceA'
       AND stripe_application_fee_id IS NULL
       AND stripe_application_fee_refund_id IS NULL
       AND processed_at IS NULL) THEN
    RAISE EXCEPTION 'evidence hold 1: the retired obligation is not a cancelled, zero-paid, identified row';
  END IF;

  -- AND THE INVARIANT THAT BLOCKED THIS STILL BLOCKS EVERYTHING ELSE.
  --
  -- `reconciled` was widened to admit one new shape: an obligation cancelled
  -- with nothing owed and nothing paid. Every probe below was illegal before
  -- that widening and is still illegal now. Weaken
  -- source_refunds_issue_2079_reconciled_settlement,
  -- source_refunds_issue_2079_reconciled_stripe_fee_identity or
  -- source_refunds_issue_2079_cancelled_legs_moved_no_money and this fails.
  IF NOT pg_temp.evidence_hold_refuses(v_refund_a,
       -- the original CI failure: reconciled beside a leg a human is waiting on
       $probe$buyer_state='needs_attention'$probe$)
     OR NOT pg_temp.evidence_hold_refuses(v_refund_a,
       -- reconciled beside a fee leg still queued
       $probe$fee_state='queued'$probe$)
     OR NOT pg_temp.evidence_hold_refuses(v_refund_a,
       -- 'processed' cannot be claimed while nothing was processed
       $probe$buyer_state='processed'$probe$)
     OR NOT pg_temp.evidence_hold_refuses(v_refund_a,
       -- nor can a cancelled leg quietly acquire a processed amount
       $probe$buyer_refund_processed_cents=buyer_refund_requested_cents$probe$)
     OR NOT pg_temp.evidence_hold_refuses(v_refund_a,
       -- nor a provider refund id for a refund that never reached a provider
       $probe$provider_refund_id='re_forged'$probe$)
     OR NOT pg_temp.evidence_hold_refuses(v_refund_a,
       -- a cancelled leg may not sit beside any other financial_state: that is
       -- what stops a stray recompute silently re-opening a closed obligation
       $probe$financial_state='pending'$probe$)
     OR NOT pg_temp.evidence_hold_refuses(v_refund_a,
       $probe$financial_state='needs_attention'$probe$)
     OR NOT pg_temp.evidence_hold_refuses(v_refund_a,
       -- a genuinely processed refund may NOT borrow the cancelled fee value to
       -- escape naming the Stripe application fee it reversed
       $probe$buyer_state='processed',buyer_refund_processed_cents=buyer_refund_requested_cents,$probe$
       ||$probe$fee_state='processed',fee_reversal_processed_cents=fee_reversal_required_cents$probe$)
     OR NOT pg_temp.evidence_hold_refuses(v_refund_a,
       $probe$buyer_state='processed',buyer_refund_processed_cents=buyer_refund_requested_cents,$probe$
       ||$probe$fee_state='cancelled_no_reversal_due'$probe$) THEN
    RAISE EXCEPTION 'evidence hold 1: the widened reconciled invariant now accepts a row it must refuse';
  END IF;
  -- The row the probes were aimed at is unchanged: every probe rolled back.
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE id=v_refund_a
       AND buyer_state='cancelled_no_refund_due' AND financial_state='reconciled'
       AND buyer_refund_processed_cents=0 AND provider_refund_id IS NULL) THEN
    RAISE EXCEPTION 'evidence hold 1: a constraint probe leaked into the row it probed';
  END IF;

  -- A retired obligation is terminal for the worker: claim_source_refund_operations
  -- selects only `financial_state <> 'reconciled'`, so the sweep can never pick
  -- it up and refund a buyer who now holds a ticket.
  PERFORM * FROM public.claim_source_refund_operations('evidence-hold-retired',25,now());
  IF EXISTS(SELECT 1 FROM public.source_refunds WHERE id=v_refund_a
      AND lease_owner='evidence-hold-retired') THEN
    RAISE EXCEPTION 'evidence hold 1: a retired refund was claimed by the worker';
  END IF;
  IF public.issue_2079_verify_ticket_paid_identity(a,'stripe','pi_evidenceA',NULL,'ch_evidenceA',
       'acct_evidencehold')->>'outcome'<>'verified' THEN
    RAISE EXCEPTION 'evidence hold 1: released session did not verify';
  END IF;
  v_order:=public.biz_ticket_checkout_finalize(a,'pi_evidenceA','ch_evidenceA','card',v_pepper);
  IF v_order->>'outcome'<>'finalized' OR v_order->>'orderId' IS NULL
     OR NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions WHERE id=a
       AND status='paid_completed' AND order_id=(v_order->>'orderId')::uuid)
     OR (SELECT count(*) FROM public.tickets WHERE order_id=(v_order->>'orderId')::uuid)<>1 THEN
    RAISE EXCEPTION 'evidence hold 1: released session did not issue the ticket: %',v_order;
  END IF;
  -- Idempotent: a second confirm / webhook retry changes nothing.
  v:=pg_temp.evidence_hold_release(a,'pi_evidenceA','ch_evidenceA');
  v_replay:=public.biz_ticket_checkout_finalize(a,'pi_evidenceA','ch_evidenceA','card',v_pepper);
  IF v->>'outcome'<>'not_held' OR v_replay->>'orderId'<>v_order->>'orderId'
     OR (SELECT count(*) FROM public.tickets WHERE order_id=(v_order->>'orderId')::uuid)<>1
     OR (SELECT count(*) FROM public.orders WHERE checkout_session_id=a)<>1 THEN
    RAISE EXCEPTION 'evidence hold 1: replay was not idempotent: % / %',v,v_replay;
  END IF;
  -- The revocation worker's handoff no longer opens an operator refund for it.
  IF public.issue_2168_handoff_revocation_attention((SELECT id FROM public.checkout_sale_revocation_outbox
       WHERE subject_type='ticket_checkout_session' AND subject_id=a LIMIT 1))<>'already_owned'
     OR (SELECT count(*) FROM public.source_refunds WHERE source_id=a)<>1
     OR EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=a
       AND financial_state<>'reconciled') THEN
    RAISE EXCEPTION 'evidence hold 1: handoff opened a refund for a completed sale';
  END IF;

  -- ── 2. The refund was already queued by complete evidence, never started ──
  v:=pg_temp.evidence_hold_stripe(b,'e71d0000-0000-4000-8000-000000000012','pi_evidenceB',NULL);
  v:=public.issue_1930_mint_ticket_late_reversal(b,'stripe','pi_evidenceB',NULL,'ch_evidenceB');
  IF v->>'outcome'<>'promoted' THEN
    RAISE EXCEPTION 'evidence hold 2: fixture did not queue the refund: %',v;
  END IF;
  -- The #2168 handoff must not add a second refund while the late refund owns it.
  IF public.issue_2168_handoff_revocation_attention((SELECT id FROM public.checkout_sale_revocation_outbox
       WHERE subject_type='ticket_checkout_session' AND subject_id=b LIMIT 1))<>'already_owned'
     OR (SELECT count(*) FROM public.source_refunds WHERE source_id=b)<>1 THEN
    RAISE EXCEPTION 'evidence hold 2: handoff duplicated an owned refund';
  END IF;
  v:=pg_temp.evidence_hold_release(b,'pi_evidenceB','ch_evidenceB');
  IF v->>'outcome'<>'released'
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=b
       AND financial_state='reconciled' AND buyer_refund_processed_cents=0)
     OR NOT EXISTS(SELECT 1 FROM public.source_refund_ledger_allocations l
       JOIN public.source_refunds r ON r.id=l.refund_id
       WHERE r.source_id=b AND l.state='prepared') THEN
    RAISE EXCEPTION 'evidence hold 2: a queued, unstarted refund was not retired: %',v;
  END IF;

  -- ── 3. The refund worker got there first ──────────────────────────────────
  v:=pg_temp.evidence_hold_stripe(c,'e71d0000-0000-4000-8000-000000000012','pi_evidenceC',NULL);
  v:=public.issue_1930_mint_ticket_late_reversal(c,'stripe','pi_evidenceC',NULL,'ch_evidenceC');
  PERFORM * FROM public.claim_source_refund_operations('evidence-hold-worker',25,now());
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=c AND lease_owner='evidence-hold-worker') THEN
    RAISE EXCEPTION 'evidence hold 3: fixture refund was not leased';
  END IF;
  v:=pg_temp.evidence_hold_release(c,'pi_evidenceC','ch_evidenceC');
  IF v->>'outcome'<>'refund_kept' OR v->>'reason'<>'refund_in_progress'
     OR NOT pg_temp.evidence_hold_intact(c) THEN
    RAISE EXCEPTION 'evidence hold 3: a leased refund was cancelled: %',v;
  END IF;
  -- A stale lease is not enough once the worker has started an attempt.
  UPDATE public.source_refunds SET leased_at=now()-interval '1 hour' WHERE source_id=c;
  PERFORM public.ensure_source_refund_attempt((SELECT id FROM public.source_refunds WHERE source_id=c),
    'buyer_refund');
  v:=pg_temp.evidence_hold_release(c,'pi_evidenceC','ch_evidenceC');
  IF v->>'outcome'<>'refund_kept' OR v->>'reason'<>'refund_in_progress'
     OR NOT pg_temp.evidence_hold_intact(c) THEN
    RAISE EXCEPTION 'evidence hold 3: a started refund was cancelled: %',v;
  END IF;

  -- ── 4. Genuine conflicts keep the refund ──────────────────────────────────
  v:=pg_temp.evidence_hold_stripe(d,'e71d0000-0000-4000-8000-000000000012','pi_evidenceD',NULL);
  IF pg_temp.evidence_hold_release(d,'pi_evidenceD','ch_evidenceD','acct_someoneelse')->>'reason'<>'identity_conflict'
     OR pg_temp.evidence_hold_release(d,'pi_wrongpayment','ch_evidenceD')->>'reason'<>'identity_conflict'
     OR pg_temp.evidence_hold_release(d,'pi_evidenceD','ch_evidenceD','acct_evidencehold',999)->>'reason'<>'amount_mismatch'
     OR pg_temp.evidence_hold_release(d,'pi_evidenceD','ch_evidenceD','acct_evidencehold',1000,'eur')->>'reason'<>'amount_mismatch'
     OR pg_temp.evidence_hold_release(d,'pi_evidenceD',NULL)->>'reason'<>'identity_unverified'
     OR NOT pg_temp.evidence_hold_intact(d) THEN
    RAISE EXCEPTION 'evidence hold 4: a conflicting proof released the hold';
  END IF;

  -- ── 5. Sold out by the time the proof arrives: refund kept, buyer told ────
  v:=pg_temp.evidence_hold_stripe(e,'e71d0000-0000-4000-8000-000000000013','pi_evidenceE',NULL);
  INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,
    buyer_phone_e164,currency,subtotal_cents,total_cents,status,idempotency_key,expires_at,
    application_fee_amount_cents)
  VALUES(e2,'e71d0000-0000-4000-8000-000000000011','e71d0000-0000-4000-8000-000000000010',
    'Other buyer','other-buyer@example.com','+15555550112','USD',1000,1000,'requires_payment',
    'evidence-hold-'||e2,now()+interval '15 minutes',100);
  INSERT INTO public.ticket_checkout_session_items(checkout_session_id,ticket_type_id,
    ticket_name_at_purchase,quantity,unit_price_cents,total_cents)
  VALUES(e2,'e71d0000-0000-4000-8000-000000000013','Ticket',1,1000,1000);
  v_claim:=public.issue_1930_claim_ticket_provider_attempt(e2,
    'e71d0000-0000-4000-8000-000000000011','stripe','stripe_native','evidence-hold-fp-'||e2);
  v_attempt:=(v_claim->>'attemptId')::uuid; v_epoch:=(v_claim->>'epoch')::bigint;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(v_attempt,v_epoch,'pi_evidenceE2',NULL,NULL,
    'evidence-hold-cont-'||e2);
  UPDATE public.ticket_checkout_sessions SET stripe_account_id='acct_evidencehold',
    stripe_payment_intent_id='pi_evidenceE2' WHERE id=e2;
  IF public.biz_ticket_checkout_finalize(e2,'pi_evidenceE2','ch_evidenceE2','card',v_pepper)->>'outcome'<>'finalized' THEN
    RAISE EXCEPTION 'evidence hold 5: the other buyer could not take the last seat';
  END IF;
  v:=pg_temp.evidence_hold_release(e,'pi_evidenceE','ch_evidenceE');
  IF v->>'outcome'<>'refund_kept' OR v->>'reason'<>'sale_unavailable'
     OR NOT pg_temp.evidence_hold_intact(e)
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=e
       AND buyer_notice_code='sale_unavailable') THEN
    RAISE EXCEPTION 'evidence hold 5: a sold-out hold did not keep its refund and notice: %',v;
  END IF;
  -- The ordinary path then queues that refund; the notice reason survives it.
  PERFORM public.issue_1930_mint_ticket_late_reversal(e,'stripe','pi_evidenceE',NULL,'ch_evidenceE');
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=e AND buyer_state='queued'
       AND buyer_notice_code='sale_unavailable') THEN
    RAISE EXCEPTION 'evidence hold 5: the queued refund lost its notice reason';
  END IF;
  -- MONEY, PINNED. Seth ruled on 2026-09-21 that a ticket checkout refunded
  -- because the sale could not be completed KEEPS Mingla's platform fee: the
  -- buyer gets their payment minus our fee. The figures below are what the code
  -- ACTUALLY does today, and they are the opposite — full refund to the buyer,
  -- fee absorbed by Mingla. Both refund creators live in the already-merged
  -- 20270411002079, not in this issue, so #2079 does not change them; this
  -- assertion is the exact before-image so the correcting edit is deliberate
  -- and visible, in either direction. The session is 1000 cents with a 100-cent
  -- application fee. Under the ruling the buyer figure becomes 900 and the
  -- absorption 0; under today's code it is 1000 and 100. Change the maths
  -- without changing this line and the block fails.
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=e
       AND refund_kind='late_payment_no_value'
       AND original_charge_cents=1000
       AND original_application_fee_cents=100
       AND buyer_refund_requested_cents=1000      -- INHERITED: full refund
       AND platform_fee_absorption_cents=100      -- INHERITED: fee absorbed
       AND fee_reversal_required_cents=100
       AND organizer_refund_liability_cents=900) THEN
    RAISE EXCEPTION 'evidence hold 5: the inherited sale_unavailable fee maths changed — see the 2026-09-21 keep-the-fee ruling before editing';
  END IF;

  -- ── 6. No longer purchasable (ticket type switched off) ───────────────────
  v:=pg_temp.evidence_hold_stripe(f,'e71d0000-0000-4000-8000-000000000012','pi_evidenceF',NULL);
  UPDATE public.ticket_types SET is_disabled=true WHERE id='e71d0000-0000-4000-8000-000000000012';
  v:=pg_temp.evidence_hold_release(f,'pi_evidenceF','ch_evidenceF');
  UPDATE public.ticket_types SET is_disabled=false WHERE id='e71d0000-0000-4000-8000-000000000012';
  IF v->>'outcome'<>'refund_kept' OR v->>'reason'<>'sale_unavailable'
     OR NOT pg_temp.evidence_hold_intact(f) THEN
    RAISE EXCEPTION 'evidence hold 6: an unpurchasable hold did not keep its refund: %',v;
  END IF;

  -- ── 7. A genuine late payment (no evidence hold) is not touched ───────────
  INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,
    buyer_phone_e164,currency,subtotal_cents,total_cents,status,idempotency_key,expires_at,
    application_fee_amount_cents)
  VALUES(g,'e71d0000-0000-4000-8000-000000000011','e71d0000-0000-4000-8000-000000000010',
    'Late buyer','late-buyer@example.com','+15555550113','USD',1000,1000,'requires_payment',
    'evidence-hold-'||g,now()+interval '15 minutes',100);
  v_claim:=public.issue_1930_claim_ticket_provider_attempt(g,
    'e71d0000-0000-4000-8000-000000000011','stripe','stripe_native','evidence-hold-fp-'||g);
  v_attempt:=(v_claim->>'attemptId')::uuid; v_epoch:=(v_claim->>'epoch')::bigint;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(v_attempt,v_epoch,'pi_evidenceG',NULL,NULL,
    'evidence-hold-cont-'||g);
  UPDATE public.ticket_checkout_sessions SET stripe_account_id='acct_evidencehold',
    stripe_payment_intent_id='pi_evidenceG' WHERE id=g;
  IF public.issue_1930_mint_ticket_late_reversal(g,'stripe','pi_evidenceG',NULL,'ch_evidenceG')->>'outcome'<>'queued' THEN
    RAISE EXCEPTION 'evidence hold 7: fixture late reversal was not queued';
  END IF;
  v:=pg_temp.evidence_hold_release(g,'pi_evidenceG','ch_evidenceG');
  IF v->>'outcome'<>'not_held' OR NOT pg_temp.evidence_hold_intact(g) THEN
    RAISE EXCEPTION 'evidence hold 7: a genuine late-payment refund was released: %',v;
  END IF;

  -- ── 8. Paystack: a transaction id arrives after the hold ──────────────────
  INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,
    buyer_phone_e164,currency,subtotal_cents,total_cents,status,idempotency_key,expires_at,
    application_fee_amount_cents)
  VALUES(h,'e71d0000-0000-4000-8000-000000000021','e71d0000-0000-4000-8000-000000000020',
    'NG buyer','ng-buyer@example.com','+2348012345699','NGN',1000,1000,'requires_payment',
    'evidence-hold-'||h,now()+interval '15 minutes',100);
  INSERT INTO public.ticket_checkout_session_items(checkout_session_id,ticket_type_id,
    ticket_name_at_purchase,quantity,unit_price_cents,total_cents)
  VALUES(h,'e71d0000-0000-4000-8000-000000000022','Ticket',1,1000,1000);
  v_claim:=public.issue_1930_claim_ticket_provider_attempt(h,
    'e71d0000-0000-4000-8000-000000000021','paystack','paystack_redirect','evidence-hold-fp-'||h);
  v_attempt:=(v_claim->>'attemptId')::uuid; v_epoch:=(v_claim->>'epoch')::bigint;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(v_attempt,v_epoch,NULL,NULL,
    'evidence-hold-paystack-ref','evidence-hold-cont-'||h);
  v:=public.issue_1930_mint_ticket_late_reversal(h,'paystack','evidence-hold-paystack-ref',NULL,NULL);
  IF v->>'outcome'<>'attention' OR NOT pg_temp.evidence_hold_intact(h) THEN
    RAISE EXCEPTION 'evidence hold 8: Paystack fixture did not hold: %',v;
  END IF;
  v:=public.release_ticket_checkout_evidence_hold(h,'paystack','evidence-hold-paystack-ref','2079901',
    NULL,NULL,1000,'NGN');
  IF v->>'outcome'<>'released' THEN
    RAISE EXCEPTION 'evidence hold 8: a proven Paystack payment was not released: %',v;
  END IF;
  -- Same retirement on the Paystack side, and the transaction id the hold was
  -- missing is recorded. Without it the row would be a ticket late refund that
  -- is not in 'needs_attention' and still cannot name its Paystack transaction,
  -- which source_refunds_issue_2079_execution_ready refuses outright.
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=h
       AND buyer_state='cancelled_no_refund_due'
       AND fee_state='cancelled_no_reversal_due'
       AND financial_state='reconciled'
       AND paystack_transaction_id=2079901 AND stripe_charge_id IS NULL
       AND buyer_refund_processed_cents=0 AND fee_reversal_processed_cents=0) THEN
    RAISE EXCEPTION 'evidence hold 8: the Paystack retirement did not cancel its legs or record its identity';
  END IF;
  IF public.biz_ticket_checkout_finalize(h,'evidence-hold-paystack-ref','2079901','card',v_pepper)->>'outcome'<>'finalized' THEN
    RAISE EXCEPTION 'evidence hold 8: the released Paystack session did not issue the ticket';
  END IF;

  -- ── 10. A release that does not end in a sale still owes the buyer ───────
  --
  -- The release puts the session back in flight and retires its refund BEFORE
  -- the caller's finalize runs. Two things must hold across that window:
  --
  --   (a) the session RE-HOLDS its inventory. A held session only counts toward
  --       issue_2491_derived_held() while expires_at > now(), and a hold that
  --       reached the release expired long ago. Without the re-hold the last
  --       seat can be sold to someone else while a buyer who has already paid
  --       waits for their ticket.
  --   (b) if finalize fails anyway — for a reason a held seat cannot prevent,
  --       such as the ticket type being switched off — the retired obligation
  --       is RE-OPENED. Without that the mint's identity-match return answers
  --       'existing', changes nothing, and the buyer is left having paid, with
  --       no ticket, owed a refund that no longer exists and that no worker
  --       will ever look at again, because every claimer skips
  --       financial_state='reconciled'. Silent and permanent.
  --
  -- DELETE the expires_at re-grant from release_ticket_checkout_evidence_hold
  -- and (a) fails. DELETE the reopen branch from
  -- issue_1930_mint_ticket_late_reversal and (b) fails.
  v:=pg_temp.evidence_hold_stripe(i,'e71d0000-0000-4000-8000-000000000014','pi_evidenceI',NULL);
  IF v->>'outcome'<>'attention' OR NOT pg_temp.evidence_hold_intact(i) THEN
    RAISE EXCEPTION 'evidence hold 10: fixture did not hold: %',v;
  END IF;
  v:=pg_temp.evidence_hold_release(i,'pi_evidenceI','ch_evidenceI');
  IF v->>'outcome'<>'released' THEN
    RAISE EXCEPTION 'evidence hold 10: the hold was not released: %',v;
  END IF;
  -- (a) the released session holds its seat again.
  SELECT expires_at INTO v_expires FROM public.ticket_checkout_sessions WHERE id=i;
  v_held:=public.issue_2491_derived_held('e71d0000-0000-4000-8000-000000000014');
  IF v_expires IS NULL OR v_expires<=now() OR v_held<1 THEN
    RAISE EXCEPTION 'evidence hold 10(a): a released session holds no inventory (expires_at=%, held=%)',
      v_expires,v_held;
  END IF;
  -- (b) finalize then fails for a reason the seat could not prevent.
  UPDATE public.ticket_types SET is_disabled=true WHERE id='e71d0000-0000-4000-8000-000000000014';
  v_order:=public.biz_ticket_checkout_finalize(i,'pi_evidenceI','ch_evidenceI','card',v_pepper);
  UPDATE public.ticket_types SET is_disabled=false WHERE id='e71d0000-0000-4000-8000-000000000014';
  IF v_order->>'outcome'<>'paid_reversal_pending' OR v_order->>'orderId' IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.orders WHERE checkout_session_id=i) THEN
    RAISE EXCEPTION 'evidence hold 10: a closed sale still minted an order: %',v_order;
  END IF;
  -- BOTH legs come back, or the reopened obligation is only half real: a fee
  -- leg left on 'cancelled_no_reversal_due' would be a reversal nobody performs
  -- sitting on a refund that does pay. Delete the fee_state line from the
  -- reopen and this fails.
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=i
       AND refund_kind='late_payment_no_value'
       AND financial_state='pending' AND buyer_state='queued'
       AND fee_state='queued'
       AND last_error_code IS NULL AND buyer_refund_processed_cents=0)
     OR NOT EXISTS(SELECT 1 FROM public.source_refund_events e
       JOIN public.source_refunds r ON r.id=e.refund_id
       WHERE r.source_id=i AND e.safe_reason_code='sale_not_completed_after_release') THEN
    RAISE EXCEPTION 'evidence hold 10(b): a failed finalize after a release left the buyer owed nothing';
  END IF;
  -- The re-opened obligation is real work again: the worker can claim it.
  PERFORM * FROM public.claim_source_refund_operations('evidence-hold-reopen',25,now());
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=i
      AND lease_owner='evidence-hold-reopen') THEN
    RAISE EXCEPTION 'evidence hold 10(b): the re-opened refund is still invisible to the worker';
  END IF;
  -- Calling the mint again is idempotent: one refund, still exactly one.
  v_reopen:=public.issue_1930_mint_ticket_late_reversal(i,'stripe','pi_evidenceI',NULL,'ch_evidenceI');
  IF (SELECT count(*) FROM public.source_refunds WHERE source_id=i)<>1 THEN
    RAISE EXCEPTION 'evidence hold 10(b): the reopen duplicated the obligation: %',v_reopen;
  END IF;

  -- (c) A reopened obligation must also HARD-FAIL its session, or the buyer can
  -- keep the ticket AND the refund. The release had put the session back in
  -- flight with a live expires_at. reconcile-stuck-checkouts batches on
  -- status IN (processing_payment, awaiting_web_redirect, requires_payment,
  -- pending_free), so a session left in flight is picked up and finalized into
  -- a real ticket the moment the organiser re-enables the sale — while this
  -- refund also pays, because nothing cancels a refund on mint and
  -- issue_1930_claim_revocations only claims queued / failed_retryable /
  -- provider_unknown. DELETE the session UPDATE from the reopen branch and
  -- every assertion below fails.
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions WHERE id=i
       AND status='failed' AND reversal_state='paid_reversal_pending'
       AND failed_at IS NOT NULL AND order_id IS NULL) THEN
    RAISE EXCEPTION 'evidence hold 10(c): a reopened obligation left its session finalizable';
  END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions WHERE id=i
       AND status IN ('processing_payment','awaiting_web_redirect','requires_payment','pending_free')) THEN
    RAISE EXCEPTION 'evidence hold 10(c): the reconcile sweep can still batch this session';
  END IF;
  -- The seat goes back to the sale rather than being held by a dead session.
  v_held:=public.issue_2491_derived_held('e71d0000-0000-4000-8000-000000000014');
  IF v_held<>0 THEN
    RAISE EXCEPTION 'evidence hold 10(c): a failed session still holds its seat (held=%)',v_held;
  END IF;
  -- And the sale recovering does NOT let it mint: this is the exact sequence
  -- the sweep would drive — organiser re-enables the ticket type, then finalize
  -- runs again on the same paid session.
  IF public.issue_1930_ticket_session_authorized(i,'e71d0000-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION 'evidence hold 10(c): a reopened session is still authorized to mint';
  END IF;
  v_order:=public.biz_ticket_checkout_finalize(i,'pi_evidenceI','ch_evidenceI','card',v_pepper);
  IF v_order->>'orderId' IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.orders WHERE checkout_session_id=i)
     OR EXISTS(SELECT 1 FROM public.tickets t JOIN public.orders o ON o.id=t.order_id
       WHERE o.checkout_session_id=i) THEN
    RAISE EXCEPTION 'evidence hold 10(c): a recovered sale minted a ticket for a refunded buyer: %',v_order;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=i
       AND financial_state='pending' AND buyer_state='queued') THEN
    RAISE EXCEPTION 'evidence hold 10(c): the reopened refund did not survive the recovered sale';
  END IF;

  -- (d) Two reopens inside the same second must both leave an audit record.
  -- The key used to carry a second-granularity clock_timestamp(), so the second
  -- one hit ON CONFLICT DO NOTHING and vanished while still flipping state.
  -- Re-retire it by hand, in the exact shape the release writes. This UPDATE
  -- used to leave buyer_state='needs_attention' beside a reconciled row, which
  -- the table now refuses outright: a reconciled obligation says either that
  -- the money moved or that it was cancelled with nothing owed, never that a
  -- human is still waiting on it.
  UPDATE public.source_refunds SET financial_state='reconciled',
    buyer_state='cancelled_no_refund_due',
    fee_state=CASE WHEN fee_reversal_required_cents=0 THEN 'not_required'
      ELSE 'cancelled_no_reversal_due' END,
    last_error_code='sale_completed_no_refund_due',lease_owner=NULL,leased_at=NULL
    WHERE source_id=i;
  UPDATE public.ticket_checkout_sessions SET status='processing_payment',reversal_state='none',
    failed_at=NULL,expires_at=now()+interval '15 minutes' WHERE id=i;
  v_reopen:=public.issue_1930_mint_ticket_late_reversal(i,'stripe','pi_evidenceI',NULL,'ch_evidenceI');
  IF v_reopen->>'outcome'<>'reopened' THEN
    RAISE EXCEPTION 'evidence hold 10(d): the second retirement was not reopened: %',v_reopen;
  END IF;
  IF (SELECT count(DISTINCT e.event_key) FROM public.source_refund_events e
      JOIN public.source_refunds r ON r.id=e.refund_id
      WHERE r.source_id=i AND e.safe_reason_code='sale_not_completed_after_release')<>2 THEN
    RAISE EXCEPTION 'evidence hold 10(d): a reopen inside the same second lost its audit record';
  END IF;

  -- ── 11. A hold that owed no platform fee keeps 'not_required' ────────────
  --
  -- #1221 ties the fee leg to the money it owes:
  -- (fee_state = 'not_required') = (fee_reversal_required_cents = 0). A
  -- retirement that stamped 'cancelled_no_reversal_due' on every fee leg
  -- regardless would break that for a checkout with no platform fee, so the
  -- release derives the value from the amount owed rather than from whatever
  -- the leg happened to say. Replace the CASE in the release with a bare
  -- 'cancelled_no_reversal_due' and this fails on a CHECK.
  v:=pg_temp.evidence_hold_stripe(j,'e71d0000-0000-4000-8000-000000000012','pi_evidenceJ',NULL,0);
  IF v->>'outcome'<>'attention' OR NOT pg_temp.evidence_hold_intact(j) THEN
    RAISE EXCEPTION 'evidence hold 11: the zero-fee fixture did not hold: %',v;
  END IF;
  v:=pg_temp.evidence_hold_release(j,'pi_evidenceJ','ch_evidenceJ');
  IF v->>'outcome'<>'released'
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=j
       AND buyer_state='cancelled_no_refund_due'
       AND fee_state='not_required' AND fee_leg_kind='not_required'
       AND fee_reversal_required_cents=0 AND fee_reversal_processed_cents=0
       AND financial_state='reconciled') THEN
    RAISE EXCEPTION 'evidence hold 11: a zero-fee retirement did not keep its not_required fee leg: %',v;
  END IF;

  -- ── 12. The OTHER refund kind the release can retire ─────────────────────
  --
  -- A session whose paid evidence had no resolvable provider reference at all
  -- never gets a `late_payment_no_value` refund; #2168's handoff opens a
  -- `checkout_provider_reference_unresolved` one instead, and the release can
  -- reach that row too. It is a different shape — no provider payment
  -- reference, and #2168's own CHECK pins it to fee_state='not_required',
  -- fee_reversal_required_cents=0, platform_fee_absorption_cents=0, because
  -- that kind never absorbs the platform fee. So the retirement must cancel the
  -- buyer leg, leave the fee leg exactly where #2168 requires it, and NOT stamp
  -- a provider identity onto a row whose whole definition is not having one.
  INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,
    buyer_phone_e164,currency,subtotal_cents,total_cents,status,idempotency_key,expires_at,
    application_fee_amount_cents)
  VALUES(k,'e71d0000-0000-4000-8000-000000000011','e71d0000-0000-4000-8000-000000000010',
    'Unresolved buyer','unresolved-buyer@example.com','+15555550114','USD',1000,1000,'requires_payment',
    'evidence-hold-'||k,now()+interval '15 minutes',100);
  INSERT INTO public.ticket_checkout_session_items(checkout_session_id,ticket_type_id,
    ticket_name_at_purchase,quantity,unit_price_cents,total_cents)
  VALUES(k,'e71d0000-0000-4000-8000-000000000012','Ticket',1,1000,1000);
  v_claim:=public.issue_1930_claim_ticket_provider_attempt(k,
    'e71d0000-0000-4000-8000-000000000011','stripe','stripe_native','evidence-hold-fp-'||k);
  v_attempt:=(v_claim->>'attemptId')::uuid; v_epoch:=(v_claim->>'epoch')::bigint;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(v_attempt,v_epoch,'pi_evidenceK',NULL,NULL,
    'evidence-hold-cont-'||k);
  UPDATE public.ticket_checkout_sessions SET stripe_account_id='acct_evidencehold',
    stripe_payment_intent_id='pi_evidenceK' WHERE id=k;
  -- Paid, with no reference we can resolve: holds the session, opens NO refund.
  IF public.issue_1930_mint_ticket_late_reversal(k,'stripe',NULL,NULL,NULL)->>'outcome'
       <>'paid_reversal_pending'
     OR EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=k) THEN
    RAISE EXCEPTION 'evidence hold 12: the unresolved-reference fixture did not hold cleanly';
  END IF;
  SELECT id INTO v_outbox FROM public.checkout_sale_revocation_outbox
    WHERE subject_type='ticket_checkout_session' AND subject_id=k;
  -- The call is its OWN statement, deliberately. Inlined into the IF below it
  -- shares that statement's snapshot with the EXISTS beside it, so the refund
  -- the handoff has just inserted is invisible to the same condition that asks
  -- whether it exists, and this block fails on a row that is really there.
  v_handoff:=public.issue_2168_handoff_revocation_attention(v_outbox);
  IF v_handoff<>'attention_created'
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=k
       AND refund_kind='checkout_provider_reference_unresolved') THEN
    RAISE EXCEPTION 'evidence hold 12: the #2168 handoff did not open its operator refund: %',v_handoff;
  END IF;
  v:=pg_temp.evidence_hold_release(k,'pi_evidenceK','ch_evidenceK');
  IF v->>'outcome'<>'released'
     OR NOT EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=k
       AND refund_kind='checkout_provider_reference_unresolved'
       AND buyer_state='cancelled_no_refund_due'
       AND fee_state='not_required' AND fee_leg_kind='not_required'
       AND fee_reversal_required_cents=0 AND platform_fee_absorption_cents=0
       AND financial_state='reconciled'
       AND buyer_refund_processed_cents=0
       -- NOT stamped: this kind is defined by having no provider reference, and
       -- the loop above never proved one for it.
       AND stripe_charge_id IS NULL AND paystack_transaction_id IS NULL
       AND provider_payment_reference IS NULL) THEN
    RAISE EXCEPTION 'evidence hold 12: the unresolved-reference obligation did not retire in its own shape: %',v;
  END IF;
  -- And it is terminal for the 72-hour escalation, which only chases a row a
  -- human is still waiting on.
  PERFORM public.issue_2168_escalate_overdue_revocation_attention();
  IF EXISTS(SELECT 1 FROM public.source_refunds WHERE source_id=k AND ops_status='escalated') THEN
    RAISE EXCEPTION 'evidence hold 12: a closed obligation was escalated to an operator';
  END IF;

  -- ── 9. Service role only ──────────────────────────────────────────────────
  IF has_function_privilege('anon',
      'public.release_ticket_checkout_evidence_hold(uuid,text,text,text,text,text,bigint,text)','EXECUTE')
     OR has_function_privilege('authenticated',
      'public.release_ticket_checkout_evidence_hold(uuid,text,text,text,text,text,bigint,text)','EXECUTE')
     OR NOT has_function_privilege('service_role',
      'public.release_ticket_checkout_evidence_hold(uuid,text,text,text,text,text,bigint,text)','EXECUTE') THEN
    RAISE EXCEPTION 'evidence hold 9: release privilege mismatch';
  END IF;
END $test$;
ROLLBACK;
