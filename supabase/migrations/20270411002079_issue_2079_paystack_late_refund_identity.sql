-- Issue #2079 — provider-correct identity for late ticket refunds.
-- Additive, service-only, and default-dark. No provider I/O.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.source_refunds
    WHERE source_type='ticket_checkout_session'
      AND refund_kind='late_payment_no_value'
  ) THEN
    RAISE EXCEPTION 'issue_2079_existing_ticket_late_refunds_require_audited_reconciliation';
  END IF;
END $$;

ALTER TABLE public.source_refunds
  ADD COLUMN paystack_transaction_id numeric(16,0),
  ADD COLUMN stripe_charge_id text;

COMMENT ON COLUMN public.source_refunds.paystack_transaction_id IS
  'Provider-returned Paystack transaction ID; secondary corroboration for ticket late-payment refunds.';
COMMENT ON COLUMN public.source_refunds.stripe_charge_id IS
  'Stripe Charge ID corroborating provider_payment_reference PaymentIntent for ticket late-payment refunds.';

ALTER TABLE public.source_refunds
  ADD CONSTRAINT source_refunds_issue_2079_secondary_identity_shape CHECK (
    NOT (source_type='ticket_checkout_session' AND refund_kind='late_payment_no_value')
    OR (
      provider_payment_reference<>''
      AND (
        (provider='paystack' AND stripe_charge_id IS NULL
          AND (paystack_transaction_id IS NULL
            OR paystack_transaction_id BETWEEN 1 AND 9007199254740991))
        OR
        (provider='stripe' AND paystack_transaction_id IS NULL
          AND provider_payment_reference ~ '^pi_[A-Za-z0-9]+$'
          AND (stripe_charge_id IS NULL OR stripe_charge_id ~ '^ch_[A-Za-z0-9]+$'))
      )
    )
  ),
  ADD CONSTRAINT source_refunds_issue_2079_execution_ready CHECK (
    NOT (source_type='ticket_checkout_session' AND refund_kind='late_payment_no_value')
    OR buyer_state='needs_attention'
    OR (provider='paystack' AND paystack_transaction_id IS NOT NULL)
    OR (provider='stripe' AND stripe_charge_id IS NOT NULL)
  ),
  ADD CONSTRAINT source_refunds_issue_2079_attention_shape CHECK (
    NOT (source_type='ticket_checkout_session' AND refund_kind='late_payment_no_value'
      AND (paystack_transaction_id IS NULL AND provider='paystack'
        OR stripe_charge_id IS NULL AND provider='stripe'))
    OR (buyer_state='needs_attention' AND financial_state='needs_attention'
      AND ops_status='needs_review' AND last_error_code IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.claim_source_refund_operations(
  p_worker_id text,p_limit integer,p_now timestamptz
) RETURNS SETOF public.source_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF char_length(COALESCE(p_worker_id,''))<3 OR p_limit<1 OR p_limit>25 THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.source_refunds
    WHERE financial_state <> 'reconciled'
      AND NOT (
        source_type='ticket_checkout_session'
        AND refund_kind='late_payment_no_value'
        AND (buyer_state='needs_attention' OR financial_state='needs_attention'
          OR (provider='paystack' AND paystack_transaction_id IS NULL)
          OR (provider='stripe' AND stripe_charge_id IS NULL))
      )
      AND (lease_owner IS NULL OR leased_at < p_now-interval '10 minutes')
      AND (next_retry_at IS NULL OR next_retry_at<=p_now)
    ORDER BY requested_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit
  )
  UPDATE public.source_refunds sr SET lease_owner=p_worker_id,leased_at=p_now,updated_at=p_now
  FROM candidates c WHERE sr.id=c.id RETURNING sr.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_source_refund_operations(text,integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_source_refund_operations(text,integer,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_2079_capture_ticket_paid_identity_attention(
  p_checkout_session_id uuid,p_observed_provider text,p_payment_reference text,
  p_paystack_transaction_id text,p_stripe_charge_id text,
  p_observed_account_reference text,p_reason_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE;
  v_attempt public.ticket_checkout_provider_attempts%ROWTYPE;
  v_existing public.source_refunds%ROWTYPE; v_refund_id uuid; v_fee integer;
  v_paystack_id numeric(16,0); v_conflict boolean:=false;
  v_safe_reasons text[]:=ARRAY['paid_provider_attempt_missing','paid_provider_conflict',
    'paid_provider_reference_missing','paid_provider_reference_conflict',
    'paid_provider_transaction_id_invalid','paid_provider_charge_missing',
    'paid_provider_charge_conflict','paid_provider_checkout_conflict',
    'paid_provider_account_conflict','paid_provider_evidence_conflict'];
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_reason_code IS NULL OR NOT (p_reason_code=ANY(v_safe_reasons)) THEN
    RAISE EXCEPTION 'invalid_identity_reason';
  END IF;
  PERFORM 1 FROM public.events e JOIN public.ticket_checkout_sessions s ON s.event_id=e.id
    WHERE s.id=p_checkout_session_id FOR UPDATE OF e;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_checkout_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.order_id IS NOT NULL THEN RAISE EXCEPTION 'checkout_session_unavailable'; END IF;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE checkout_session_id=p_checkout_session_id FOR UPDATE;
  IF p_observed_provider NOT IN ('stripe','paystack') OR COALESCE(p_payment_reference,'')='' THEN
    RAISE EXCEPTION 'invalid_provider_evidence';
  END IF;
  IF p_observed_provider='stripe' THEN
    IF p_payment_reference !~ '^pi_[A-Za-z0-9]+$'
       OR (p_stripe_charge_id IS NOT NULL AND p_stripe_charge_id !~ '^ch_[A-Za-z0-9]+$')
       OR p_paystack_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'invalid_stripe_evidence'; END IF;
  ELSE
    IF p_stripe_charge_id IS NOT NULL
       OR (p_paystack_transaction_id IS NOT NULL AND p_paystack_transaction_id !~ '^[0-9]+$') THEN
      RAISE EXCEPTION 'invalid_paystack_evidence';
    END IF;
    IF p_paystack_transaction_id IS NOT NULL THEN
      v_paystack_id:=p_paystack_transaction_id::numeric;
      IF v_paystack_id<1 OR v_paystack_id>9007199254740991 THEN RAISE EXCEPTION 'invalid_paystack_evidence'; END IF;
    END IF;
  END IF;
  SELECT * INTO v_existing FROM public.source_refunds WHERE source_type='ticket_checkout_session'
    AND source_id=p_checkout_session_id AND refund_kind='late_payment_no_value' FOR UPDATE;
  IF FOUND THEN
    v_conflict:=v_existing.provider<>p_observed_provider
      OR v_existing.provider_payment_reference<>p_payment_reference
      OR v_existing.paystack_transaction_id IS DISTINCT FROM v_paystack_id
      OR v_existing.stripe_charge_id IS DISTINCT FROM p_stripe_charge_id
      OR v_existing.provider_account_reference IS DISTINCT FROM p_observed_account_reference;
    UPDATE public.source_refunds SET buyer_state='needs_attention',financial_state='needs_attention',
      ops_status='needs_review',last_error_code=CASE WHEN v_conflict THEN 'paid_provider_evidence_conflict' ELSE p_reason_code END,
      last_error_public='Paid provider identity requires review before refund.',
      ops_note='Provider-authenticated paid evidence is held for identity review.',updated_at=now()
    WHERE id=v_existing.id;
    RETURN jsonb_build_object('outcome',CASE WHEN v_conflict THEN 'conflict' ELSE 'existing' END,
      'refundId',v_existing.id);
  END IF;
  v_fee:=LEAST(v_session.total_cents,COALESCE(v_session.application_fee_amount_cents,0));
  INSERT INTO public.source_refunds(source_type,source_id,subject_id,brand_id,event_id,refund_kind,
    requested_by_type,reason,provider,currency,original_charge_cents,buyer_refund_requested_cents,
    buyer_state,original_application_fee_cents,fee_reversal_required_cents,fee_state,fee_leg_kind,
    financial_state,organizer_refund_liability_cents,platform_fee_absorption_cents,
    provider_payment_reference,provider_account_reference,paystack_transaction_id,stripe_charge_id,
    idempotency_key,last_error_code,last_error_public,ops_status,ops_note)
  VALUES('ticket_checkout_session',v_session.id,v_session.id,v_session.brand_id,v_session.event_id,
    'late_payment_no_value','system','Late payment identity requires review',p_observed_provider,
    upper(v_session.currency),v_session.total_cents,v_session.total_cents,'needs_attention',v_fee,v_fee,
    CASE WHEN v_fee=0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee=0 THEN 'not_required' WHEN p_observed_provider='stripe'
      THEN 'stripe_application_fee_refund' ELSE 'paystack_ledger_allocation' END,
    'needs_attention',v_session.total_cents-v_fee,v_fee,p_payment_reference,
    p_observed_account_reference,v_paystack_id,p_stripe_charge_id,
    'late-payment-no-value:'||v_session.id,p_reason_code,
    'Paid provider identity requires review before refund.','needs_review',
    'Provider-authenticated paid evidence is held for identity review.') RETURNING id INTO v_refund_id;
  INSERT INTO public.source_refund_ledger_allocations(refund_id,allocation_type,amount_cents,currency,
    provider,state,idempotency_key)
  SELECT v_refund_id,x.kind,x.amount,upper(v_session.currency),p_observed_provider,'prepared',
    'source-refund-allocation:'||x.key||':'||v_refund_id
  FROM (VALUES('buyer_refund',v_session.total_cents,'buyer'),
    ('organizer_refund_liability',v_session.total_cents-v_fee,'organizer'),
    ('platform_application_fee_reversal',v_fee,'platform')) x(kind,amount,key)
  WHERE x.amount>0 ON CONFLICT(idempotency_key) DO NOTHING;
  UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',status='failed',
    failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=v_session.id AND order_id IS NULL;
  IF v_attempt.id IS NOT NULL THEN UPDATE public.ticket_checkout_provider_attempts
    SET state='provider_unknown',updated_at=now() WHERE id=v_attempt.id AND state<>'paid_reversed'; END IF;
  INSERT INTO public.checkout_sale_revocation_outbox(subject_type,subject_id,event_id,provider_attempt_id,
    target_epoch,reason,state,last_error_code)
  VALUES('ticket_checkout_session',v_session.id,v_session.event_id,v_attempt.id,
    COALESCE(v_attempt.claimed_epoch,v_session.admission_epoch,1),p_reason_code,'provider_unknown',p_reason_code)
  ON CONFLICT(subject_type,subject_id,target_epoch) DO UPDATE SET state='provider_unknown',
    last_error_code=EXCLUDED.last_error_code,updated_at=now();
  RETURN jsonb_build_object('outcome','attention','refundId',v_refund_id);
END $$;
REVOKE ALL ON FUNCTION public.issue_2079_capture_ticket_paid_identity_attention(uuid,text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2079_capture_ticket_paid_identity_attention(uuid,text,text,text,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_2079_verify_ticket_paid_identity(
  p_checkout_session_id uuid,p_provider text,p_payment_reference text,
  p_paystack_transaction_id text,p_stripe_charge_id text,p_observed_account_reference text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE;
  v_attempt public.ticket_checkout_provider_attempts%ROWTYPE; v_reason text;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  PERFORM 1 FROM public.events e JOIN public.ticket_checkout_sessions s ON s.event_id=e.id
    WHERE s.id=p_checkout_session_id FOR UPDATE OF e;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_checkout_session_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE id=v_session.provider_attempt_id AND checkout_session_id=v_session.id FOR UPDATE;
  IF NOT FOUND THEN v_reason:='paid_provider_attempt_missing';
  ELSIF v_attempt.provider<>p_provider THEN v_reason:='paid_provider_conflict';
  ELSIF p_provider='stripe' AND v_session.stripe_account_id IS DISTINCT FROM p_observed_account_reference THEN
    v_reason:='paid_provider_account_conflict';
  ELSIF p_provider='stripe' AND COALESCE(p_payment_reference,'') !~ '^pi_[A-Za-z0-9]+$' THEN
    v_reason:='paid_provider_reference_conflict';
  ELSIF p_provider='stripe' AND COALESCE(p_stripe_charge_id,'') !~ '^ch_[A-Za-z0-9]+$' THEN
    v_reason:='paid_provider_charge_missing';
  ELSIF p_provider='stripe' AND v_attempt.flow='stripe_native'
      AND v_attempt.provider_object_id IS DISTINCT FROM p_payment_reference THEN
    v_reason:='paid_provider_reference_conflict';
  ELSIF p_provider='stripe' AND v_attempt.flow='stripe_checkout'
      AND (v_attempt.provider_checkout_id IS DISTINCT FROM v_session.stripe_checkout_session_id
        OR v_session.stripe_payment_intent_id IS DISTINCT FROM p_payment_reference) THEN
    v_reason:='paid_provider_checkout_conflict';
  ELSIF p_provider='stripe' AND v_attempt.flow NOT IN ('stripe_native','stripe_checkout') THEN
    v_reason:='paid_provider_conflict';
  END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('outcome','verified'); END IF;
  RETURN public.issue_2079_capture_ticket_paid_identity_attention(v_session.id,p_provider,
    p_payment_reference,p_paystack_transaction_id,p_stripe_charge_id,
    p_observed_account_reference,v_reason);
END $$;
REVOKE ALL ON FUNCTION public.issue_2079_verify_ticket_paid_identity(uuid,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2079_verify_ticket_paid_identity(uuid,text,text,text,text,text)
  TO service_role;

DROP FUNCTION IF EXISTS public.issue_1930_mint_ticket_late_reversal(uuid,text);
CREATE OR REPLACE FUNCTION public.issue_1930_mint_ticket_late_reversal(
  p_checkout_session_id uuid,p_provider text,p_payment_reference text,
  p_paystack_transaction_id text,p_stripe_charge_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_attempt public.ticket_checkout_provider_attempts%ROWTYPE;
  v_refund_id uuid; v_fee integer; v_paystack_id numeric(16,0); v_reason text;
BEGIN
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_checkout_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.order_id IS NOT NULL THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE id=v_session.provider_attempt_id AND checkout_session_id=v_session.id FOR UPDATE;
  IF NOT FOUND THEN v_reason:='paid_provider_attempt_missing';
  ELSIF v_attempt.provider<>p_provider THEN v_reason:='paid_provider_conflict';
  ELSIF COALESCE(p_payment_reference,'')='' THEN v_reason:='paid_provider_reference_missing';
  ELSIF p_provider='paystack' AND (v_attempt.flow<>'paystack_redirect'
      OR v_attempt.provider_reference IS DISTINCT FROM p_payment_reference) THEN
    v_reason:='paid_provider_reference_conflict';
  ELSIF p_provider='paystack' AND COALESCE(p_paystack_transaction_id,'') !~ '^[0-9]+$' THEN
    v_reason:='paid_provider_transaction_id_invalid';
  ELSIF p_provider='stripe' AND COALESCE(p_payment_reference,'') !~ '^pi_[A-Za-z0-9]+$' THEN
    v_reason:='paid_provider_reference_conflict';
  ELSIF p_provider='stripe' AND COALESCE(p_stripe_charge_id,'') !~ '^ch_[A-Za-z0-9]+$' THEN
    v_reason:='paid_provider_charge_missing';
  ELSIF p_provider='stripe' AND v_attempt.flow='stripe_native'
      AND v_attempt.provider_object_id IS DISTINCT FROM p_payment_reference THEN
    v_reason:='paid_provider_reference_conflict';
  ELSIF p_provider='stripe' AND v_attempt.flow='stripe_checkout'
      AND (v_attempt.provider_checkout_id IS DISTINCT FROM v_session.stripe_checkout_session_id
        OR v_session.stripe_payment_intent_id IS DISTINCT FROM p_payment_reference) THEN
    v_reason:='paid_provider_checkout_conflict';
  ELSIF p_provider='stripe' AND v_attempt.flow NOT IN ('stripe_native','stripe_checkout') THEN
    v_reason:='paid_provider_conflict';
  END IF;
  IF p_provider='paystack' AND v_reason IS NULL THEN
    v_paystack_id:=p_paystack_transaction_id::numeric;
    IF v_paystack_id<1 OR v_paystack_id>9007199254740991 THEN v_reason:='paid_provider_transaction_id_invalid'; END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    IF COALESCE(p_payment_reference,'')='' THEN
      UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',status='failed',
        failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=v_session.id;
      IF v_attempt.id IS NOT NULL THEN UPDATE public.ticket_checkout_provider_attempts
        SET state='provider_unknown',updated_at=now() WHERE id=v_attempt.id; END IF;
      INSERT INTO public.checkout_sale_revocation_outbox(subject_type,subject_id,event_id,provider_attempt_id,
        target_epoch,reason,state,last_error_code)
      VALUES('ticket_checkout_session',v_session.id,v_session.event_id,v_attempt.id,
        COALESCE(v_attempt.claimed_epoch,v_session.admission_epoch,1),v_reason,'provider_unknown',v_reason)
      ON CONFLICT(subject_type,subject_id,target_epoch) DO UPDATE SET state='provider_unknown',
        last_error_code=EXCLUDED.last_error_code,updated_at=now();
      RETURN jsonb_build_object('outcome','paid_reversal_pending','reason',v_reason);
    END IF;
    RETURN public.issue_2079_capture_ticket_paid_identity_attention(v_session.id,p_provider,
      p_payment_reference,p_paystack_transaction_id,p_stripe_charge_id,v_session.stripe_account_id,v_reason);
  END IF;
  v_fee:=LEAST(v_session.total_cents,COALESCE(v_session.application_fee_amount_cents,0));
  INSERT INTO public.source_refunds(source_type,source_id,subject_id,brand_id,event_id,refund_kind,
    requested_by_type,reason,provider,currency,original_charge_cents,buyer_refund_requested_cents,
    original_application_fee_cents,fee_reversal_required_cents,fee_state,fee_leg_kind,financial_state,
    organizer_refund_liability_cents,platform_fee_absorption_cents,provider_payment_reference,
    provider_account_reference,paystack_transaction_id,stripe_charge_id,idempotency_key)
  VALUES('ticket_checkout_session',v_session.id,v_session.id,v_session.brand_id,v_session.event_id,
    'late_payment_no_value','system','Late payment after sale closure',p_provider,upper(v_session.currency),
    v_session.total_cents,v_session.total_cents,v_fee,v_fee,
    CASE WHEN v_fee=0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee=0 THEN 'not_required' WHEN p_provider='stripe'
      THEN 'stripe_application_fee_refund' ELSE 'paystack_ledger_allocation' END,
    'pending',v_session.total_cents-v_fee,v_fee,p_payment_reference,v_session.stripe_account_id,
    v_paystack_id,p_stripe_charge_id,'late-payment-no-value:'||v_session.id)
  ON CONFLICT(source_type,source_id,refund_kind) DO UPDATE
    SET provider_payment_reference=public.source_refunds.provider_payment_reference
  RETURNING id INTO v_refund_id;
  INSERT INTO public.source_refund_ledger_allocations(refund_id,allocation_type,amount_cents,currency,
    provider,state,idempotency_key)
  SELECT v_refund_id,x.kind,x.amount,upper(v_session.currency),p_provider,'prepared',
    'source-refund-allocation:'||x.key||':'||v_refund_id
  FROM (VALUES('buyer_refund',v_session.total_cents,'buyer'),
    ('organizer_refund_liability',v_session.total_cents-v_fee,'organizer'),
    ('platform_application_fee_reversal',v_fee,'platform')) x(kind,amount,key)
  WHERE x.amount>0 ON CONFLICT(idempotency_key) DO NOTHING;
  UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',status='failed',
    failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=v_session.id AND order_id IS NULL;
  UPDATE public.ticket_checkout_provider_attempts SET state='paid_reversal_pending',updated_at=now()
    WHERE id=v_session.provider_attempt_id AND state<>'paid_reversed';
  RETURN jsonb_build_object('outcome','queued','refundId',v_refund_id);
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_mint_ticket_late_reversal(uuid,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_mint_ticket_late_reversal(uuid,text,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(
  p_checkout_session_id uuid,p_stripe_payment_intent_id text,
  p_stripe_charge_id text,p_stripe_payment_method_type text,p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,p_installment_plan_root boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_event public.events%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE;
  v_attempt public.ticket_checkout_provider_attempts%ROWTYPE; v_result jsonb; v_reversal jsonb;
BEGIN
  SELECT e.* INTO v_event FROM public.ticket_checkout_sessions s
    JOIN public.events e ON e.id=s.event_id WHERE s.id=p_checkout_session_id FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_checkout_session_id FOR UPDATE;
  IF v_session.order_id IS NOT NULL THEN RETURN jsonb_build_object('outcome','finalized','orderId',v_session.order_id); END IF;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE id=v_session.provider_attempt_id FOR UPDATE;
  SELECT * INTO v_admission FROM public.event_checkout_admission_state WHERE event_id=v_event.id FOR UPDATE;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' OR v_session.revoked_at IS NOT NULL
     OR v_session.admission_epoch IS NULL OR v_admission.epoch<>v_session.admission_epoch
     OR NOT public.issue_1930_ticket_session_authorized(v_session.id,v_event.id) THEN
    v_reversal:=public.issue_1930_mint_ticket_late_reversal(v_session.id,
      COALESCE(v_attempt.provider,'stripe'),p_stripe_payment_intent_id,
      CASE WHEN v_attempt.provider='paystack' THEN p_stripe_charge_id ELSE NULL END,
      CASE WHEN v_attempt.provider='stripe' THEN p_stripe_charge_id ELSE NULL END);
    RETURN jsonb_build_object('outcome','paid_reversal_pending',
      'reversalReason',COALESCE(v_reversal->>'reason',v_reversal->>'outcome'));
  END IF;
  v_result:=public.issue_1930_ticket_checkout_finalize_base(p_checkout_session_id,
    p_stripe_payment_intent_id,p_stripe_charge_id,p_stripe_payment_method_type,
    p_qr_token_pepper,p_stripe_customer_id_on_connected_account,
    p_saved_payment_method_id,p_installment_plan_root);
  RETURN jsonb_build_object('outcome','finalized')||COALESCE(v_result,'{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean)
  TO service_role;
