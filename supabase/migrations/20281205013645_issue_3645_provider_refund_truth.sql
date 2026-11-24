BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE target record;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('public.biz_refund_order_commit_from_webhook(uuid,text,integer,character,integer,text)', 'b648667b858beae398b7cb0d3014c923'),
    ('public.issue_4522_order_charge_refunded_cents(uuid)', '8de1546a204e8dbaa5cb0c948b053e0e'),
    ('public.issue_4522_payout_item_now(text,uuid,integer,integer,integer,integer,integer)', '204d0bdfc70120ab48af201f58e3a085'),
    ('public.issue_4522_row_refund_unrecorded(uuid)', 'aa695376f8df1d38c809a962d8cef745'),
    ('public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text)', '0728ba2e6bcd947538e3968d4fd13f74'),
    ('public.admin_list_source_refund_operations(uuid,jsonb,text,uuid,integer,integer)', 'bc8c84767400c5952de7bb9796bf5d29')
  ) AS expected(signature, digest) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(target.signature))) IS DISTINCT FROM target.digest THEN
      RAISE EXCEPTION '#3645 function drift: %', target.signature;
    END IF;
  END LOOP;
END;
$drift$;

ALTER TABLE public.paystack_refund_attempts
  ADD COLUMN provider_merchant_note text,
  ADD COLUMN provider_event_at timestamptz;

ALTER TABLE public.ticket_refund_attempts
  ADD COLUMN buyer_refund_failed_at timestamptz;

INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode)
VALUES ('buyer_refund_failed','Purchases',true,'normal',ARRAY['inapp','push','sms'],'reach_once')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION public.issue_3645_apply_provider_refund_failure(
  p_refund_id uuid, p_provider text, p_provider_refund_id text,
  p_order_installment_id uuid, p_amount_cents integer, p_event_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_refund public.refunds;
  v_order public.orders;
  v_removed bigint;
  v_total integer;
  v_failure jsonb;
BEGIN
  -- Fee observation takes the attempt before the refund. Keep that order.
  PERFORM 1 FROM public.ticket_refund_attempts
  WHERE buyer_refund_id = p_provider_refund_id AND refund_id = p_refund_id
    AND p_provider = 'stripe' FOR UPDATE;
  SELECT * INTO STRICT v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF coalesce(v_refund.metadata->'provider_refund_failures', '{}'::jsonb) ? p_provider_refund_id THEN
    RETURN false;
  END IF;
  IF v_refund.status NOT IN ('succeeded','pending') THEN
    RETURN false;
  END IF;

  IF p_order_installment_id IS NOT NULL THEN
    PERFORM public.issue_3645_lock_installment_graph(p_order_installment_id);
  END IF;
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_refund.order_id FOR NO KEY UPDATE;

  IF p_order_installment_id IS NOT NULL THEN
    DELETE FROM public.order_installment_refund_applications
    WHERE refund_id = v_refund.id AND installment_id = p_order_installment_id
    RETURNING amount_cents INTO v_removed;
    IF FOUND THEN
      UPDATE public.order_installments
      SET refunded_amount_cents = refunded_amount_cents - v_removed,
          status = CASE WHEN status = 'refunded' THEN 'collected' ELSE status END,
          updated_at = now()
      WHERE id = p_order_installment_id;
    END IF;
  END IF;

  v_failure := jsonb_build_object('amount_cents', p_amount_cents, 'installment_id',
    p_order_installment_id, 'occurred_at', p_event_at, 'observed_at', now(), 'provider', p_provider,
    'correct_buyer', v_refund.status='succeeded' OR v_refund.buyer_refund_status='succeeded',
    'cancelled', v_order.cancelled_at IS NOT NULL);
  UPDATE public.refunds
  SET status = CASE WHEN NOT metadata ? 'trip_cancel' OR amount_cents <= p_amount_cents + coalesce((
                    SELECT sum((prior.value->>'amount_cents')::integer)
                    FROM jsonb_each(coalesce(v_refund.metadata->'provider_refund_failures','{}'::jsonb)) prior
                  ),0)
                    THEN 'failed' ELSE status END,
      buyer_refund_status = 'failed',
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'provider_refund_failures', coalesce(metadata->'provider_refund_failures','{}'::jsonb)
          || jsonb_build_object(p_provider_refund_id, v_failure)
      )
  WHERE id = v_refund.id;

  IF p_provider = 'stripe' THEN
    UPDATE public.ticket_refund_attempts
    SET next_observation_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
        status = CASE WHEN status IN ('succeeded_positive','not_applicable')
                      THEN status ELSE 'evidence_conflict' END,
        buyer_refund_failed_at = coalesce(p_event_at, now()), updated_at = now()
    WHERE refund_id = v_refund.id AND buyer_refund_id = p_provider_refund_id;
  END IF;

  v_total := public.issue_4522_order_charge_refunded_cents(v_order.id);
  UPDATE public.orders
  SET refunded_amount_cents = v_total,
      payment_status = CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled'
                            WHEN v_total = 0 AND EXISTS (
                              SELECT 1 FROM public.order_installments i WHERE i.order_id=v_order.id
                                AND i.refunded_amount_cents > 0
                            ) THEN 'partial_refund'
                            WHEN v_total = 0 THEN 'paid'
                            WHEN v_total < total_cents THEN 'partial_refund'
                            ELSE public.issue_3281_settled_payment_status(id) END,
      updated_at = now()
  WHERE id = v_order.id;

  -- Existing buyer outbox is the durable correction rail. An untouched
  -- dashboard pending/failed attempt has no preceding success to correct.
  IF v_order.buyer_email IS NOT NULL AND
     (v_refund.status = 'succeeded' OR v_refund.buyer_refund_status = 'succeeded') THEN
    UPDATE public.ticket_order_notifications
    SET status='skipped', last_error='provider_refund_failed',updated_at=now()
    WHERE order_id=v_order.id AND status IN ('pending','deferred','failed_retryable')
      AND payload->>'template_key'='buyer_refund_issued'
      AND (payload->>'refund_record_id'=v_refund.id::text
           OR payload->>'stripe_refund_id'=p_provider_refund_id);
    INSERT INTO public.ticket_order_notifications (
      order_id, event_id, channel, recipient, status, idempotency_key, payload
    ) VALUES (
      v_order.id, v_order.event_id, 'email', v_order.buyer_email, 'pending',
      'refund-failed:' || p_provider || ':' || p_provider_refund_id,
      jsonb_build_object('template_key','buyer_refund_failed','amount_cents',p_amount_cents,
        'currency',v_order.currency,'refund_record_id',v_refund.id,'cancelled',v_order.cancelled_at IS NOT NULL)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  IF p_order_installment_id IS NOT NULL THEN
    PERFORM public.issue_4522_sync_row_payout_hold(p_order_installment_id);
  END IF;
  PERFORM public.issue_4522_sync_order_payouts(v_order.id);
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_apply_provider_refund_failure(uuid,text,text,uuid,integer,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_3645_record_stripe_refund_lifecycle(
  p_provider_refund_id text, p_payment_reference text, p_account text,
  p_currency text, p_amount_cents integer, p_status text, p_event_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_attempt public.ticket_refund_attempts;
  v_refund public.refunds;
  v_installment_id uuid;
  v_order_reference text;
  v_order_account text;
  v_changed boolean;
  v_order public.orders;
  v_failure jsonb;
BEGIN
  IF nullif(p_provider_refund_id,'') IS NULL OR nullif(p_payment_reference,'') IS NULL
     OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN jsonb_build_object('status','unmatched','reason','refund_identity_missing');
  END IF;
  IF p_status NOT IN ('pending','failed') OR p_status IS NULL THEN
    RAISE EXCEPTION 'invalid_stripe_refund_lifecycle' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order-refund:' || p_provider_refund_id,0));
  SELECT * INTO v_attempt FROM public.ticket_refund_attempts
  WHERE buyer_refund_id = p_provider_refund_id FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO STRICT v_refund FROM public.refunds WHERE id = v_attempt.refund_id;
    IF v_attempt.payment_intent_id IS DISTINCT FROM p_payment_reference
       OR v_attempt.connected_account_id IS DISTINCT FROM p_account
       OR lower(v_attempt.currency) IS DISTINCT FROM lower(p_currency)
       OR v_attempt.buyer_refund_amount_text IS DISTINCT FROM p_amount_cents::text THEN
      RETURN jsonb_build_object('status','mismatched','reason','refund_charge_evidence_mismatch');
    END IF;
    SELECT id INTO v_installment_id FROM public.order_installments
    WHERE order_id = v_attempt.order_id AND stripe_payment_intent_id = p_payment_reference;
    IF v_installment_id IS NULL THEN
      SELECT stripe_payment_intent_id INTO v_order_reference FROM public.orders WHERE id = v_attempt.order_id;
      IF v_order_reference IS DISTINCT FROM p_payment_reference THEN
        RETURN jsonb_build_object('status','mismatched','reason','refund_charge_evidence_mismatch');
      END IF;
    END IF;
  ELSE
    SELECT * INTO v_refund FROM public.refunds WHERE stripe_refund_id = p_provider_refund_id;
    IF NOT FOUND THEN
      SELECT o.* INTO v_order FROM public.orders o
      JOIN public.events e ON e.id=o.event_id
      LEFT JOIN public.ticket_checkout_sessions s ON s.id=o.checkout_session_id
      JOIN public.stripe_connect_accounts a ON a.brand_id=e.brand_id AND a.detached_at IS NULL
      WHERE o.stripe_payment_intent_id=p_payment_reference
        AND coalesce(s.stripe_account_id,a.stripe_account_id)=p_account
        AND o.payment_status IN ('paid','partial_refund','refunded','cancelled');
      IF NOT FOUND THEN
        RETURN jsonb_build_object('status','unmatched','reason','refund_identity_missing');
      END IF;
      IF lower(v_order.currency) IS DISTINCT FROM lower(p_currency)
         OR p_amount_cents > v_order.total_cents THEN
        RETURN jsonb_build_object('status','mismatched','reason','refund_charge_evidence_mismatch');
      END IF;
      INSERT INTO public.refunds (order_id,amount_cents,currency,reason,status,
        buyer_refund_status,stripe_payment_intent_id,stripe_charge_id,stripe_refund_id,metadata)
      VALUES (v_order.id,p_amount_cents,v_order.currency,'Dashboard-initiated refund (Stripe)',
        'pending','provider_pending',p_payment_reference,v_order.stripe_charge_id,p_provider_refund_id,
        jsonb_build_object('source','webhook_reconciliation','provider_pending_dashboard',true))
      RETURNING * INTO v_refund;
    END IF;
    SELECT coalesce(v_refund.stripe_payment_intent_id, o.stripe_payment_intent_id),
           coalesce(s.stripe_account_id, a.stripe_account_id)
    INTO v_order_reference, v_order_account
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    LEFT JOIN public.ticket_checkout_sessions s ON s.id = o.checkout_session_id
    LEFT JOIN public.stripe_connect_accounts a ON a.brand_id = e.brand_id AND a.detached_at IS NULL
    WHERE o.id = v_refund.order_id;
    IF v_order_reference IS DISTINCT FROM p_payment_reference
       OR (p_account IS NOT NULL AND v_order_account IS DISTINCT FROM p_account)
       OR lower(v_refund.currency) IS DISTINCT FROM lower(p_currency)
       OR v_refund.amount_cents IS DISTINCT FROM p_amount_cents THEN
      RETURN jsonb_build_object('status','mismatched','reason','refund_charge_evidence_mismatch');
    END IF;
    v_installment_id := v_refund.order_installment_id;
  END IF;

  IF p_status = 'pending' THEN
    UPDATE public.refunds SET buyer_refund_status='provider_pending'
    WHERE id=v_refund.id AND status='pending'
      AND buyer_refund_status IN ('unknown_legacy','not_started')
      AND NOT metadata ? 'provider_refund_failures';
    RETURN jsonb_build_object('status','matched','order_id',v_refund.order_id);
  END IF;

  v_changed := public.issue_3645_apply_provider_refund_failure(v_refund.id, 'stripe',
    p_provider_refund_id, v_installment_id, p_amount_cents, p_event_at);
  SELECT metadata #> ARRAY['provider_refund_failures',p_provider_refund_id] INTO v_failure
  FROM public.refunds WHERE id=v_refund.id;
  RETURN jsonb_build_object('status','matched','reason','provider_refund_failed',
    'order_id',v_refund.order_id,'changed',v_changed,
    'buyer_correction',CASE WHEN v_failure->>'correct_buyer'='true' THEN jsonb_build_object(
      'refund_record_id',v_refund.id,'amount_cents',p_amount_cents,
      'currency',v_refund.currency,'cancelled',v_failure->'cancelled') END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_record_stripe_refund_lifecycle(text,text,text,text,integer,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_record_stripe_refund_lifecycle(text,text,text,text,integer,text,timestamptz)
  TO service_role;

CREATE FUNCTION public.issue_3645_reconcile_paystack_dashboard_refund(
  p_provider_refund_id text, p_transaction_reference text, p_merchant_note text,
  p_currency text, p_amount_cents integer, p_status text, p_event_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_order public.orders;
  v_inst public.order_installments;
  v_attempt public.paystack_refund_attempts;
  v_matches integer;
  v_order_id uuid;
  v_installment_id uuid;
  v_source_id uuid;
  v_source_type text;
  v_paid bigint;
  v_refunded bigint;
  v_refund_id uuid;
  v_commit jsonb;
  v_key text := 'paystack-dashboard:' || p_provider_refund_id;
BEGIN
  IF nullif(p_provider_refund_id, '') IS NULL OR nullif(p_transaction_reference,'') IS NULL THEN
    RETURN jsonb_build_object('status','unmatched','reason','refund_identity_missing');
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_status IS NULL OR p_status NOT IN ('accepted','processed','failed') THEN
    RETURN jsonb_build_object('status','mismatched','reason','refund_charge_evidence_mismatch');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key,0));
  SELECT count(*), min(order_id::text)::uuid, min(installment_id::text)::uuid
  INTO v_matches, v_order_id, v_installment_id
  FROM (
    SELECT o.id AS order_id, NULL::uuid AS installment_id
    FROM public.orders o
    WHERE o.stripe_payment_intent_id = p_transaction_reference
      AND o.stripe_charge_id ~ '^[0-9]+$'
      AND o.payment_status IN ('paid','partial_refund','refunded','cancelled')
    UNION ALL
    SELECT i.order_id, i.id
    FROM public.order_installments i
    WHERE i.stripe_payment_intent_id = p_transaction_reference
      AND i.provider = 'paystack' AND i.collected_at IS NOT NULL
  ) candidates;
  IF v_matches = 0 THEN
    RETURN jsonb_build_object('status','unmatched','reason','refund_charge_missing');
  ELSIF v_matches <> 1 THEN
    RETURN jsonb_build_object('status','mismatched','reason','refund_charge_ambiguous');
  END IF;

  -- Use the same order/referral lock ordering as checkout refund settlement.
  PERFORM 1 FROM public.payee_shares
  WHERE order_kind = 'ticket' AND order_id = v_order_id AND payee_kind = 'referral' FOR UPDATE;
  IF v_installment_id IS NOT NULL THEN
    PERFORM public.issue_3645_lock_installment_graph(v_installment_id);
    SELECT * INTO STRICT v_inst FROM public.order_installments WHERE id = v_installment_id;
  END IF;
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_order_id FOR NO KEY UPDATE;
  v_source_id := coalesce(v_installment_id, v_order_id);
  v_source_type := CASE WHEN v_installment_id IS NULL THEN 'order' ELSE 'order_installment' END;
  v_paid := CASE WHEN v_installment_id IS NULL THEN v_order.total_cents
                ELSE coalesce(v_inst.buyer_total_cents, v_inst.amount_cents) END;
  v_refunded := CASE WHEN v_installment_id IS NULL THEN v_order.refunded_amount_cents
                     ELSE v_inst.refunded_amount_cents END;
  IF (p_currency IS NOT NULL AND lower(p_currency) <> 'ngn')
     OR lower(coalesce(v_inst.currency, v_order.currency)) IS DISTINCT FROM 'ngn'
     OR p_amount_cents > v_paid THEN
    RETURN jsonb_build_object('status','mismatched','reason','refund_charge_evidence_mismatch');
  END IF;

  SELECT * INTO v_attempt FROM public.paystack_refund_attempts
  WHERE provider_refund_id = p_provider_refund_id FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.source_type <> v_source_type OR v_attempt.source_id <> v_source_id
       OR v_attempt.transaction_reference <> p_transaction_reference
       OR v_attempt.amount_cents <> p_amount_cents THEN
      RETURN jsonb_build_object('status','mismatched','reason','refund_charge_evidence_mismatch');
    END IF;
    IF v_attempt.idempotency_key <> v_key
       OR v_attempt.status = 'failed'
       OR (v_attempt.status = 'processed' AND p_status <> 'failed')
       OR p_event_at < v_attempt.provider_event_at THEN
      RETURN jsonb_build_object('status','matched','reason',
        CASE WHEN v_attempt.status = 'failed' THEN 'provider_refund_failed' ELSE NULL END);
    END IF;
  END IF;

  -- The trip-cancel readback or completed operator reconciliation may have
  -- already booked this dashboard refund before its webhook arrived.
  IF EXISTS (SELECT 1 FROM public.refunds r WHERE r.order_id = v_order_id
    AND (r.metadata #> '{trip_cancel,outside_refunds}') ? lower(p_provider_refund_id)) THEN
    RETURN jsonb_build_object('status','matched','reason',CASE WHEN p_status='failed'
      THEN 'provider_refund_failed' END);
  END IF;

  IF p_status = 'processed' AND v_refunded + p_amount_cents > v_paid THEN
    RETURN jsonb_build_object('status','mismatched','reason','refund_exceeds_charge_balance');
  END IF;

  INSERT INTO public.paystack_refund_attempts (
    source_type,source_id,transaction_reference,merchant_note,provider_merchant_note,
    provider_refund_id,amount_cents,currency,status,idempotency_key,provider_event_at
  ) VALUES (
    v_source_type,v_source_id,p_transaction_reference,v_key,nullif(left(p_merchant_note,1000),''),
    p_provider_refund_id,p_amount_cents,'ngn',p_status,v_key,p_event_at
  ) ON CONFLICT (idempotency_key) DO UPDATE
  SET status = excluded.status, provider_event_at = coalesce(excluded.provider_event_at,
      public.paystack_refund_attempts.provider_event_at), updated_at=now();

  IF p_status = 'processed' THEN
    IF v_installment_id IS NOT NULL THEN
      INSERT INTO public.refunds (order_id,order_installment_id,amount_cents,currency,reason,
        status,buyer_refund_status,application_fee_refund_status,application_fee_refunded_cents,
        stripe_payment_intent_id,stripe_refund_id,processed_at,buyer_refunded_at,metadata)
      VALUES (v_order_id,v_installment_id,p_amount_cents,'ngn','Paystack dashboard refund',
        'succeeded','succeeded','not_applicable',0,p_transaction_reference,p_provider_refund_id,
        now(),now(),jsonb_build_object('source','paystack_dashboard'))
      RETURNING id INTO v_refund_id;
      PERFORM public.issue_3645_mark_installment_refunded(v_installment_id,v_refund_id,p_amount_cents);
    ELSE
      v_commit := public.biz_refund_order_commit_from_webhook(
        v_order_id,p_provider_refund_id,p_amount_cents,'ngn',NULL,NULL);
      v_refund_id := (v_commit->>'refund_id')::uuid;
      UPDATE public.refunds
      SET reason='Paystack dashboard refund', buyer_refund_status='succeeded',buyer_refunded_at=now(),
          application_fee_refund_status='not_applicable',application_fee_refunded_cents=0,
          metadata=metadata || jsonb_build_object('source','paystack_dashboard')
      WHERE id=v_refund_id;
    END IF;
    UPDATE public.paystack_refund_attempts SET local_refund_id=v_refund_id
    WHERE idempotency_key=v_key;
    PERFORM public.issue_4522_sync_order_payouts(v_order_id);
  ELSIF p_status='failed' AND v_attempt.local_refund_id IS NOT NULL THEN
    PERFORM public.issue_3645_apply_provider_refund_failure(v_attempt.local_refund_id,'paystack',
      p_provider_refund_id,v_installment_id,p_amount_cents,p_event_at);
  END IF;

  RETURN jsonb_build_object('status','matched','reason',
    CASE WHEN p_status='failed' THEN 'provider_refund_failed' ELSE NULL END,
    'order_id',v_order_id,'changed',true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_reconcile_paystack_dashboard_refund(text,text,text,text,integer,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_reconcile_paystack_dashboard_refund(text,text,text,text,integer,text,timestamptz)
  TO service_role;

-- Outstanding refunds on the exact charge are still a liability after the
-- provider reverses them. Count confirmed replacement refunds only after the
-- original failure was observed, and only on that charge.
CREATE FUNCTION public.issue_3645_unresolved_provider_refund_cents(p_order_id uuid, p_installment_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  WITH failures AS (
    SELECT (f.value->>'amount_cents')::bigint AS amount_cents,
           (f.value->>'observed_at')::timestamptz AS observed_at
    FROM public.refunds r
    CROSS JOIN LATERAL jsonb_each(coalesce(r.metadata->'provider_refund_failures', '{}'::jsonb)) f
    WHERE r.order_id=p_order_id
      AND (f.value->>'installment_id')::uuid IS NOT DISTINCT FROM p_installment_id
  )
  SELECT greatest(0,
    coalesce((SELECT sum(amount_cents) FROM failures),0)
    - coalesce((SELECT sum(r.amount_cents) FROM public.refunds r
      WHERE r.order_id=p_order_id AND r.status='succeeded'
        AND r.order_installment_id IS NOT DISTINCT FROM p_installment_id
        AND r.created_at > (SELECT max(observed_at) FROM failures)
        AND NOT r.metadata ? 'provider_refund_failures'
        AND NOT r.metadata ? 'trip_cancel'),0))::bigint;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_unresolved_provider_refund_cents(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Re-emit the guarded functions from their latest definitions.

CREATE OR REPLACE FUNCTION public.biz_refund_order_commit_from_webhook(
  p_order_id uuid,
  p_stripe_refund_id text,
  p_amount_cents integer,
  p_currency character,
  p_application_fee_refunded_cents integer,
  p_idempotency_key_hint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing_refund_id uuid;
  v_refund_id uuid;
  v_line record;
  v_remaining_to_allocate int;
  v_alloc_qty int;
  v_alloc_amount int;
  v_new_payment_status text;
  v_total_refunded_cents int;
  v_settled boolean := false;
  v_allocate boolean := false;
  v_open_lines int;
  v_idx int := 0;
  v_extras_due int := 0;
  v_extras_cap int := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order-refund:' || p_stripe_refund_id,0));
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Match path 1: refunds.stripe_refund_id = p_stripe_refund_id (idempotent webhook replay).
  SELECT id INTO v_existing_refund_id
  FROM public.refunds
  WHERE stripe_refund_id = p_stripe_refund_id;

  -- Match path 2: in-app refund pre-recorded with idempotency_key hint, still pending.
  IF v_existing_refund_id IS NULL AND p_idempotency_key_hint IS NOT NULL THEN
    SELECT id INTO v_existing_refund_id
    FROM public.refunds
    WHERE order_id = p_order_id
      AND status = 'pending'
      AND metadata->>'idempotency_key' = p_idempotency_key_hint
    LIMIT 1;
  END IF;

  IF v_existing_refund_id IS NOT NULL THEN
    -- Advance the existing row to succeeded (if pending) — no-op if already terminal.
    UPDATE public.refunds
    SET status = 'succeeded',
        buyer_refund_status = 'succeeded', buyer_refunded_at = coalesce(buyer_refunded_at,now()),
        stripe_refund_id = COALESCE(stripe_refund_id, p_stripe_refund_id),
        -- issue #3281 — no fee amount keeps the fee fields as they are (#2097).
        application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, application_fee_refunded_cents),
        processed_at = COALESCE(processed_at, now())
    WHERE id = v_existing_refund_id
      AND status = 'pending';
    -- issue #3281 — only the call that settles the refund voids its tickets.
    v_settled := FOUND;
    v_refund_id := v_existing_refund_id;
    SELECT v_settled AND metadata ? 'provider_pending_dashboard' INTO v_allocate
    FROM public.refunds WHERE id=v_refund_id;
    IF v_allocate THEN
      -- Keep the lock order used by new dashboard refunds and share reversals.
      PERFORM 1 FROM public.payee_shares
      WHERE order_kind = 'ticket' AND order_id = p_order_id AND payee_kind = 'referral'
      FOR UPDATE;
      PERFORM 1 FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
    END IF;
  ELSE
    -- issue #3281 — lock the order before allocating, so two dashboard refunds
    -- never take the same line, and a redelivery that waited here finds the row.
    -- The referral share goes first: a settling refund's share trigger
    -- (issue_3872_refund_share_trigger) takes it before the order everywhere else.
    PERFORM 1 FROM public.payee_shares
    WHERE order_kind = 'ticket' AND order_id = p_order_id AND payee_kind = 'referral'
    FOR UPDATE;
    PERFORM 1 FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
    SELECT id INTO v_refund_id
    FROM public.refunds
    WHERE stripe_refund_id = p_stripe_refund_id;
    v_existing_refund_id := v_refund_id;
    IF v_refund_id IS NULL THEN
      v_settled := true;
      -- Dashboard-initiated refund with no in-app pre-record.
      -- Create a new refund row + proportional refund_line_items (oldest-first allocation per Q-3).
      INSERT INTO public.refunds (
        order_id, amount_cents, currency, reason, initiated_by, status,
        stripe_payment_intent_id, stripe_charge_id, stripe_refund_id,
        application_fee_refunded_cents, processed_at, metadata
      ) VALUES (
        p_order_id,
        p_amount_cents,
        p_currency,
        'Dashboard-initiated refund (Stripe)',
        NULL,
        'succeeded',
        v_order.stripe_payment_intent_id,
        v_order.stripe_charge_id,
        p_stripe_refund_id,
        -- issue #3281 — unknown until fee evidence arrives (#2097 unknown_legacy).
        p_application_fee_refunded_cents,
        now(),
        jsonb_build_object('source', 'webhook_reconciliation')
      ) RETURNING id INTO v_refund_id;
      v_allocate := true;
    END IF;
  END IF;

  IF v_allocate THEN
      -- Proportional allocation: walk order_line_items oldest-first, take as much qty as needed
      -- to cover p_amount_cents at unit_price_cents per ticket.
      v_remaining_to_allocate := p_amount_cents;
      FOR v_line IN
        SELECT id, ticket_type_id, quantity, unit_price_cents, total_cents,
               (
                 SELECT COALESCE(SUM(rli.quantity), 0)
                 FROM public.refund_line_items rli
                 JOIN public.refunds r ON r.id = rli.refund_id
                 WHERE rli.order_line_item_id = order_line_items.id
                   -- issue #3281 — a pending in-app refund already holds its lines.
                   AND r.status IN ('pending', 'succeeded')
                   AND r.id <> v_refund_id
               ) AS already_refunded_qty
        FROM public.order_line_items
        WHERE order_id = p_order_id
        ORDER BY id ASC
      LOOP
        EXIT WHEN v_remaining_to_allocate <= 0;
        -- How many units can we refund from this line?
        v_alloc_qty := LEAST(
          v_line.quantity - v_line.already_refunded_qty,
          CASE WHEN v_line.unit_price_cents > 0
            THEN v_remaining_to_allocate / v_line.unit_price_cents
            ELSE 0
          END
        );
        IF v_alloc_qty <= 0 THEN
          CONTINUE;
        END IF;
        v_alloc_amount := v_alloc_qty * v_line.unit_price_cents;
        INSERT INTO public.refund_line_items (
          refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
        ) VALUES (
          v_refund_id, v_line.id, v_line.ticket_type_id, v_alloc_qty, v_alloc_amount
        );
        v_remaining_to_allocate := v_remaining_to_allocate - v_alloc_amount;
      END LOOP;
      -- If we couldn't fully allocate (e.g., partial-cent refund), the leftover stays at the
      -- order level only (orders.refunded_amount_cents reflects the Stripe truth via re-aggregation below).

      -- issue #3281 — once the order's refunds return the whole charge, this
      -- refund's unallocated cents take the paid tickets still held, so refunds
      -- smaller than a ticket never leave a fully refunded order with valid tickets.
      IF v_remaining_to_allocate > 0
         AND (SELECT COALESCE(SUM(amount_cents), 0) FROM public.refunds
              WHERE order_id = p_order_id AND status = 'succeeded') >= v_order.total_cents THEN
        SELECT count(*) INTO v_open_lines
        FROM public.order_line_items oli
        WHERE oli.order_id = p_order_id AND oli.unit_price_cents > 0
          AND oli.quantity > (
            SELECT COALESCE(SUM(rli.quantity), 0)
            FROM public.refund_line_items rli
            JOIN public.refunds r ON r.id = rli.refund_id
            WHERE rli.order_line_item_id = oli.id AND r.status IN ('pending', 'succeeded'));
        -- issue #3281 — keep the extras' share for the extras, leaving each
        -- ticket line still held at least a cent.
        SELECT COALESCE(SUM(item.total_cents), 0) INTO v_extras_due
          FROM public.order_add_on_line_items item
         WHERE item.order_id = p_order_id
           AND NOT EXISTS (
             SELECT 1 FROM public.refund_add_on_line_items ra
               JOIN public.refunds r ON r.id = ra.refund_id
              WHERE ra.order_add_on_line_item_id = item.id
                AND r.status IN ('pending', 'succeeded'));
        v_extras_cap := LEAST(v_extras_due, GREATEST(v_remaining_to_allocate - v_open_lines, 0));
        v_remaining_to_allocate := v_remaining_to_allocate - v_extras_cap;
        FOR v_line IN
          SELECT oli.id, oli.ticket_type_id,
                 oli.quantity - (
                   SELECT COALESCE(SUM(rli.quantity), 0)
                   FROM public.refund_line_items rli
                   JOIN public.refunds r ON r.id = rli.refund_id
                   WHERE rli.order_line_item_id = oli.id AND r.status IN ('pending', 'succeeded')
                 ) AS open_qty
          FROM public.order_line_items oli
          WHERE oli.order_id = p_order_id AND oli.unit_price_cents > 0
          ORDER BY oli.id ASC
        LOOP
          CONTINUE WHEN v_line.open_qty <= 0;
          EXIT WHEN v_remaining_to_allocate <= 0;
          v_idx := v_idx + 1;
          -- Split only this refund's own cents, so no line claims more than was returned.
          v_alloc_amount := CASE WHEN v_idx >= v_open_lines THEN v_remaining_to_allocate
            ELSE GREATEST(v_remaining_to_allocate / (v_open_lines - v_idx + 1), 1) END;
          -- The first pass may already hold part of this line for this refund.
          INSERT INTO public.refund_line_items (
            refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
          ) VALUES (
            v_refund_id, v_line.id, v_line.ticket_type_id, v_line.open_qty, v_alloc_amount
          )
          ON CONFLICT ON CONSTRAINT refund_line_items_refund_line_installment_unique DO UPDATE
          SET quantity = public.refund_line_items.quantity + EXCLUDED.quantity,
              amount_cents = public.refund_line_items.amount_cents + EXCLUDED.amount_cents;
          v_remaining_to_allocate := v_remaining_to_allocate - v_alloc_amount;
        END LOOP;
        -- The order is fully refunded, so its extras are too.
        INSERT INTO public.refund_add_on_line_items (
          refund_id, order_add_on_line_item_id, quantity, amount_cents
        )
        SELECT v_refund_id, due.id, due.quantity,
               LEAST(due.total_cents, GREATEST(v_extras_cap - due.before, 0))::integer
          FROM (
            SELECT item.id, item.quantity, item.total_cents,
                   COALESCE(SUM(item.total_cents) OVER (
                     ORDER BY item.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                   ), 0) AS before
              FROM public.order_add_on_line_items item
             WHERE item.order_id = p_order_id
               AND NOT EXISTS (
                 SELECT 1 FROM public.refund_add_on_line_items ra
                   JOIN public.refunds r ON r.id = ra.refund_id
                  WHERE ra.order_add_on_line_item_id = item.id
                    AND r.status IN ('pending', 'succeeded'))
          ) due;
      END IF;
  END IF;

  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
  -- Recompute cumulative refunded cents and new payment_status.
  v_total_refunded_cents := public.issue_4522_order_charge_refunded_cents(p_order_id);

  -- issue #3281 — a replay must not undo a settled full cancellation.
  v_new_payment_status := CASE
    WHEN v_order.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN v_total_refunded_cents = 0 THEN v_order.payment_status
    ELSE public.issue_3281_settled_payment_status(p_order_id) END;

  UPDATE public.orders
  SET payment_status = v_new_payment_status,
      refunded_amount_cents = v_total_refunded_cents,
      updated_at = now()
  WHERE id = p_order_id;

  -- Defense-in-depth ticket void (idempotent — only flips tickets still 'valid').
  -- issue #3281 — a replayed event must not void more tickets than the refund holds.
  IF v_settled THEN
    FOR v_line IN
      SELECT rli.ticket_type_id, rli.quantity
      FROM public.refund_line_items rli
      WHERE rli.refund_id = v_refund_id
    LOOP
      UPDATE public.tickets t
      SET status = 'refunded'
      WHERE t.id IN (
        SELECT t2.id
        FROM public.tickets t2
        WHERE t2.order_id = p_order_id
          AND t2.ticket_type_id = v_line.ticket_type_id
          AND t2.status = 'valid'
        ORDER BY t2.created_at ASC
        LIMIT v_line.quantity
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents,
    'source', CASE WHEN v_existing_refund_id IS NULL THEN 'webhook_new' ELSE 'webhook_match' END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4522_order_charge_refunded_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT (COALESCE((
    SELECT sum(r.amount_cents - LEAST(r.amount_cents, COALESCE((
             SELECT sum(x.amount_cents) FROM public.order_installment_refund_applications x
              WHERE x.refund_id = r.id), 0))
      - coalesce((SELECT sum((x.value->>'amount_cents')::integer)
        FROM jsonb_each(coalesce(r.metadata->'provider_refund_failures','{}'::jsonb)) x), 0))
      FROM public.refunds r
     WHERE r.order_id = p_order_id AND r.status = 'succeeded' AND r.order_installment_id IS NULL), 0)
    -- Seventh pass (H-2): a trip cancel still in progress is one refunds row
    -- that settles only when every refund it intends is done. The part of it
    -- the provider has already confirmed on the order's own charge (the
    -- deposit) is refunded money now and is counted now: second provider,
    -- its attempt processed; card, its attempt settled with a buyer refund.
    + COALESCE((
    SELECT sum(pa.amount_cents)
      FROM public.refunds r
      JOIN public.paystack_refund_attempts pa ON pa.local_refund_id = r.id
     WHERE r.order_id = p_order_id AND r.status = 'pending' AND r.order_installment_id IS NULL
       AND r.metadata ? 'trip_cancel' AND pa.status = 'processed'
       AND pa.merchant_note = 'mingla_trip_refund:' || r.id::text || ':deposit'), 0)
    + COALESCE((
    SELECT sum(a.buyer_refund_amount_text::bigint)
      FROM public.refunds r
      JOIN public.orders o ON o.id = r.order_id
      JOIN public.ticket_refund_attempts a ON a.refund_id = r.id
     WHERE r.order_id = p_order_id AND r.status = 'pending' AND r.order_installment_id IS NULL
       AND r.metadata ? 'trip_cancel' AND a.payment_intent_id = o.stripe_payment_intent_id
       AND a.status IN ('succeeded_positive', 'not_applicable') AND a.buyer_refund_id IS NOT NULL
       AND a.buyer_refund_amount_text ~ '^[1-9][0-9]{0,15}$'), 0)
    -- Pass 11 (P11-1): refunded on this charge outside Mingla's calls.
    + public.issue_4522_order_outside_refunded_cents(p_order_id))::integer
$fn$;

CREATE OR REPLACE FUNCTION public.issue_4522_payout_item_now(
  p_source_type text, p_source_id uuid, p_gross integer, p_refunded integer,
  p_disputed integer, p_fee integer, p_net integer)
RETURNS TABLE (refunded_cents bigint, net_cents bigint, settled_net_cents bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order uuid;
  v_refunded bigint;
  v_fee bigint := p_fee;
  v_held boolean := false;
  v_settled bigint;
BEGIN
  IF p_source_type = 'order' THEN
    -- The same figures the payout sweep attaches an order with.
    SELECT o.id, o.refunded_amount_cents,
           greatest(0, coalesce(o.stripe_application_fee_amount_cents, 0) - coalesce((
             SELECT sum(rf.application_fee_refunded_cents) FROM public.refunds rf
              WHERE rf.order_id = o.id AND rf.status = 'succeeded'
                AND rf.application_fee_refund_status = 'succeeded_positive'), 0))
      INTO v_order, v_refunded, v_fee
      FROM public.orders o WHERE o.id = p_source_id;
    v_held := EXISTS (SELECT 1 FROM public.refunds r
                       WHERE r.order_id = p_source_id AND r.status = 'pending'
                         AND r.order_installment_id IS NULL)
      OR EXISTS (SELECT 1 FROM public.ticket_refund_attempts a
                   JOIN public.refunds r ON r.id = a.refund_id
                  WHERE a.order_id = p_source_id AND a.buyer_refund_id IS NOT NULL
                    AND a.buyer_refund_failed_at IS NULL
                    AND r.status <> 'succeeded' AND r.order_installment_id IS NULL)
      OR EXISTS (SELECT 1 FROM public.paystack_refund_attempts pa
                   LEFT JOIN public.refunds r ON r.id = pa.local_refund_id
                  WHERE pa.source_type = 'order' AND pa.source_id = p_source_id
                    AND pa.status <> 'failed'
                    AND (pa.status IN ('accepted', 'processed') OR pa.provider_refund_id IS NOT NULL)
                    AND r.status IS DISTINCT FROM 'succeeded')
      OR public.issue_4522_cancel_refund_unsettled(p_source_id);
  ELSIF p_source_type = 'order_installment' THEN
    SELECT oi.order_id, oi.refunded_amount_cents INTO v_order, v_refunded
      FROM public.order_installments oi WHERE oi.id = p_source_id;
    v_held := EXISTS (SELECT 1 FROM public.refunds r
                       WHERE r.order_id = v_order AND r.status = 'pending'
                         AND (r.order_installment_id IS NULL OR r.order_installment_id = p_source_id))
      OR public.issue_4522_row_refund_unrecorded(p_source_id)
      OR public.issue_4522_cancel_refund_unsettled(v_order);
  END IF;
  IF v_order IS NULL THEN
    RETURN QUERY SELECT p_refunded::bigint, p_net::bigint, p_net::bigint;
    RETURN;
  END IF;
  v_settled := least(p_net::bigint,
    greatest(0, p_gross::bigint - v_refunded - p_disputed - v_fee));
  RETURN QUERY SELECT greatest(p_refunded::bigint, least(p_gross::bigint, v_refunded)),
    CASE WHEN v_held THEN 0::bigint ELSE greatest(0, v_settled -
      public.issue_3645_unresolved_provider_refund_cents(v_order,
        CASE WHEN p_source_type = 'order_installment' THEN p_source_id END))
    END, v_settled;
END
$fn$;

CREATE OR REPLACE FUNCTION public.issue_2097_finalize_refund_attempt(
  p_attempt_id uuid,p_lease_owner uuid,p_lease_epoch bigint,p_status text,
  p_fee_refund_id text,p_fee_refund_amount_text text,p_after_amount_refunded_text text,
  p_stripe_event_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v public.ticket_refund_attempts%ROWTYPE; v_refund public.refunds%ROWTYPE;
  v_total integer; v_order_status text; v_amount integer;
  v_attempt_count integer; v_expected_count integer; v_nonterminal_count integer;
  v_positive_total bigint; v_aggregate_status text;
BEGIN
  SELECT * INTO v FROM public.ticket_refund_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF v.buyer_refund_failed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','evidence_conflict','idempotent_replay',true);
  END IF;
  IF v.status IN ('succeeded_positive','not_applicable','fee_evidence_unavailable','evidence_conflict') THEN
    RETURN jsonb_build_object('status',v.status,'application_fee_refunded_cents',v.fee_refund_amount_text,'idempotent_replay',true);
  END IF;
  IF v.lease_owner IS DISTINCT FROM p_lease_owner OR v.lease_epoch<>p_lease_epoch OR v.lease_expires_at<=now() THEN
    RAISE EXCEPTION 'stale_refund_lease';
  END IF;
  IF p_status NOT IN ('succeeded_positive','not_applicable','fee_evidence_unavailable','evidence_conflict') THEN RAISE EXCEPTION 'invalid_fee_status'; END IF;
  IF p_status='succeeded_positive' THEN
    IF p_fee_refund_id IS NULL OR p_fee_refund_amount_text !~ '^[1-9][0-9]{0,15}$'
      OR p_after_amount_refunded_text !~ '^[1-9][0-9]{0,15}$'
      OR p_after_amount_refunded_text::numeric-v.baseline_amount_refunded_text::numeric<>p_fee_refund_amount_text::numeric
      OR p_after_amount_refunded_text::numeric>v.application_fee_amount_text::numeric THEN
      RAISE EXCEPTION 'fee_evidence_conflict';
    END IF;
    v_amount:=p_fee_refund_amount_text::integer;
  ELSIF p_status='not_applicable' THEN
    IF v.application_fee_id IS NOT NULL OR v.application_fee_amount_text<>'0'
       OR p_fee_refund_id IS NOT NULL OR p_fee_refund_amount_text<>'0'
       OR p_after_amount_refunded_text<>'0' OR v.buyer_refund_id IS NULL THEN
      RAISE EXCEPTION 'no_fee_evidence_conflict';
    END IF;
    v_amount:=0;
  ELSIF p_status='evidence_conflict' AND p_fee_refund_amount_text IS NOT NULL THEN
    IF p_fee_refund_id IS NULL OR p_fee_refund_amount_text !~ '^(0|[1-9][0-9]{0,15})$' THEN
      RAISE EXCEPTION 'invalid_conflict_evidence';
    END IF;
  ELSIF p_fee_refund_amount_text IS NOT NULL THEN RAISE EXCEPTION 'unknown_fee_amount_must_be_null'; END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=v.refund_id FOR UPDATE;
  INSERT INTO public.ticket_refund_fee_evidence(attempt_id,stripe_event_id,application_fee_id,
    fee_refund_id,amount_text,currency,connected_account_id,charge_id,provider_mode,evidence_kind)
  VALUES(v.id,p_stripe_event_id,v.application_fee_id,p_fee_refund_id,p_fee_refund_amount_text,
    v.currency,v.connected_account_id,v.charge_id,v.provider_mode,
    CASE WHEN p_status='succeeded_positive' THEN 'fee_refund' WHEN p_status='not_applicable' THEN 'no_fee'
      WHEN p_status='fee_evidence_unavailable' THEN 'visibility_exhausted' ELSE 'conflict' END);
  UPDATE public.ticket_refund_attempts SET status=p_status,fee_refund_id=p_fee_refund_id,
    fee_refund_amount_text=CASE WHEN p_status IN ('succeeded_positive','not_applicable') THEN p_fee_refund_amount_text END,
    observed_fee_refund_amount_text=p_fee_refund_amount_text,last_observed_at=now(),next_observation_at=NULL,
    updated_at=now() WHERE id=v.id;
  SELECT COUNT(*),MAX(expected_attempt_count),
    COUNT(*) FILTER (WHERE status NOT IN ('succeeded_positive','not_applicable')),
    COALESCE(SUM(fee_refund_amount_text::bigint) FILTER (WHERE status='succeeded_positive'),0)
    INTO v_attempt_count,v_expected_count,v_nonterminal_count,v_positive_total
  FROM public.ticket_refund_attempts WHERE refund_id=v.refund_id;
  v_aggregate_status:=CASE
    WHEN EXISTS(SELECT 1 FROM public.ticket_refund_attempts a WHERE a.refund_id=v.refund_id AND a.status='evidence_conflict') THEN 'evidence_conflict'
    WHEN EXISTS(SELECT 1 FROM public.ticket_refund_attempts a WHERE a.refund_id=v.refund_id AND a.status='fee_evidence_unavailable') THEN 'fee_evidence_unavailable'
    WHEN v_attempt_count=v_expected_count AND v_nonterminal_count=0 AND v_positive_total>0 THEN 'succeeded_positive'
    WHEN v_attempt_count=v_expected_count AND v_nonterminal_count=0 THEN 'not_applicable'
    ELSE 'pending_visibility' END;
  UPDATE public.refunds SET application_fee_refund_status=v_aggregate_status,
    application_fee_refunded_cents=CASE WHEN v_aggregate_status='succeeded_positive' THEN v_positive_total::integer
      WHEN v_aggregate_status='not_applicable' THEN 0 ELSE NULL END,
    status=CASE WHEN v_aggregate_status IN ('succeeded_positive','not_applicable') THEN 'succeeded' ELSE status END,
    processed_at=CASE WHEN v_aggregate_status IN ('succeeded_positive','not_applicable')
      THEN COALESCE(processed_at,now()) ELSE processed_at END
  WHERE id=v.refund_id;
  IF v_aggregate_status IN ('succeeded_positive','not_applicable') THEN
  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  -- It comes before the ticket update: that update's counter trigger locks the
  -- ticket type, which a dashboard refund takes only after the order.
  -- issue #4522 pass 6 (S9-1) — each refunded instalment or flexible-payment
  -- charge of this refund is recorded on its own row, in this transaction,
  -- by the one owner (a replay is a no-op; the edge's own call replays too).
  -- Before the order lock: the instalment graph locks the event, then the order.
  PERFORM public.issue_3645_mark_installment_refunded(oi.id, v.refund_id, a.buyer_refund_amount_text::bigint)
     FROM public.ticket_refund_attempts a
     JOIN public.order_installments oi
       ON oi.order_id = a.order_id AND oi.stripe_payment_intent_id = a.payment_intent_id
    WHERE a.refund_id = v.refund_id AND a.buyer_refund_id IS NOT NULL
      AND a.buyer_refund_failed_at IS NULL
      AND a.buyer_refund_amount_text ~ '^[1-9][0-9]{0,15}$'
    ORDER BY oi.ordinal, oi.id;
  PERFORM 1 FROM public.orders WHERE id = v.order_id FOR NO KEY UPDATE;
    UPDATE public.tickets t SET status='refunded' FROM public.ticket_refund_quarantine x
      JOIN public.ticket_refund_attempts a ON a.id=x.attempt_id
      WHERE a.refund_id=v.refund_id AND x.ticket_id=t.id AND t.status='refund_pending';
    -- issue #4522 pass 6 (S9-1) — the order holds what was refunded of its own
    -- (deposit) charge; instalment charges are counted on their rows.
    v_total := public.issue_4522_order_charge_refunded_cents(v.order_id);
    v_order_status:=public.issue_3281_settled_payment_status(v.order_id);
    UPDATE public.orders SET payment_status=v_order_status,refunded_amount_cents=v_total,updated_at=now() WHERE id=v.order_id;
    IF p_status='succeeded_positive' THEN
      UPDATE public.mingla_revenue_log SET refunded_amount_cents=LEAST(amount_cents,
        p_after_amount_refunded_text::integer),refunded=(p_after_amount_refunded_text::integer>=amount_cents),updated_at=now()
        WHERE stripe_application_fee_id=v.application_fee_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('status',p_status,'aggregate_status',v_aggregate_status,
    'application_fee_refunded_cents',CASE WHEN v_aggregate_status='succeeded_positive' THEN v_positive_total::integer
      WHEN v_aggregate_status='not_applicable' THEN 0 END,
    'new_payment_status',v_order_status,'idempotent_replay',false);
END;$function$;

CREATE OR REPLACE FUNCTION public.issue_4522_row_refund_unrecorded(p_installment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.order_installments oi
                   JOIN public.ticket_refund_attempts a
                     ON a.order_id = oi.order_id AND a.payment_intent_id = oi.stripe_payment_intent_id
                  WHERE oi.id = p_installment_id AND a.buyer_refund_id IS NOT NULL
                    AND a.buyer_refund_failed_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM public.order_installment_refund_applications x
                                     WHERE x.refund_id = a.refund_id AND x.installment_id = oi.id))
      OR EXISTS (SELECT 1 FROM public.paystack_refund_attempts pa
                  WHERE pa.source_type = 'order_installment' AND pa.source_id = p_installment_id
                    AND (pa.local_refund_id IS NOT NULL OR pa.idempotency_key LIKE 'paystack-dashboard:%')
                    AND pa.status <> 'failed'
                    AND (pa.status IN ('accepted', 'processed') OR pa.provider_refund_id IS NOT NULL)
                    AND NOT EXISTS (SELECT 1 FROM public.order_installment_refund_applications x
                                     WHERE x.refund_id = pa.local_refund_id AND x.installment_id = p_installment_id))
$fn$;

CREATE OR REPLACE FUNCTION public.admin_list_source_refund_operations(
  p_admin_user_id uuid,p_normalized_filters jsonb,p_normalized_filter_hash text,
  p_snapshot_id uuid DEFAULT NULL,p_next_ordinal integer DEFAULT 0,
  p_page_size integer DEFAULT NULL
) RETURNS TABLE(
  snapshot_id uuid,snapshot_created_at timestamptz,snapshot_expires_at timestamptz,
  item_count integer,page_size integer,items jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_snapshot public.admin_source_refund_query_snapshots%ROWTYPE; v_id uuid;
DECLARE v_count integer; v_items jsonb;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_normalized_filters IS NULL OR jsonb_typeof(p_normalized_filters)<>'object'
     OR p_normalized_filter_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_filters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_normalized_filters) k
    WHERE k NOT IN ('sourceType','provider','buyerState','feeState','financialState',
      'webhookMatchStatus','opsStatus','brandId','createdFrom','createdTo','updatedFrom','updatedTo')
  ) THEN RAISE EXCEPTION 'invalid_filters'; END IF;
  IF (p_normalized_filters ? 'createdFrom')<>(p_normalized_filters ? 'createdTo')
     OR (p_normalized_filters ? 'updatedFrom')<>(p_normalized_filters ? 'updatedTo')
     OR (
       p_normalized_filters ? 'createdFrom' AND (
         (p_normalized_filters->>'createdFrom')::timestamptz>
           (p_normalized_filters->>'createdTo')::timestamptz
         OR (p_normalized_filters->>'createdTo')::timestamptz-
           (p_normalized_filters->>'createdFrom')::timestamptz>interval '366 days'
       )
     ) OR (
       p_normalized_filters ? 'updatedFrom' AND (
         (p_normalized_filters->>'updatedFrom')::timestamptz>
           (p_normalized_filters->>'updatedTo')::timestamptz
         OR (p_normalized_filters->>'updatedTo')::timestamptz-
           (p_normalized_filters->>'updatedFrom')::timestamptz>interval '366 days'
       )
     ) THEN RAISE EXCEPTION 'invalid_date_range'; END IF;
  IF p_snapshot_id IS NULL THEN
    IF p_next_ordinal<>0 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'invalid_page';
    END IF;
    v_id:=gen_random_uuid();
    WITH candidates AS MATERIALIZED (
      SELECT 'refund_operation'::text item_kind,sr.id item_id,sr.updated_at captured_at,
        jsonb_build_object(
          'operationId',sr.id,'brandId',sr.brand_id,'sourceType',sr.source_type,
          'sourceLabel',sr.subject_id,'amountCents',sr.buyer_refund_requested_cents,
          'currency',sr.currency,'provider',sr.provider,'buyerState',sr.buyer_state,
          'feeState',sr.fee_state,'financialState',sr.financial_state,
          'requestedAt',sr.requested_at,'updatedAt',sr.updated_at,'opsStatus',sr.ops_status
        ) safe_summary,
        CASE WHEN sr.financial_state='needs_attention' THEN 0
             WHEN sr.ops_status='escalated' THEN 1 ELSE 2 END priority
      FROM public.source_refunds sr
      WHERE NOT p_normalized_filters ? 'webhookMatchStatus'
        AND (NOT p_normalized_filters ? 'sourceType' OR sr.source_type IN (
          SELECT jsonb_array_elements_text(p_normalized_filters->'sourceType')
        ))
        AND (NOT p_normalized_filters ? 'provider' OR sr.provider IN (
          SELECT jsonb_array_elements_text(p_normalized_filters->'provider')
        ))
        AND (NOT p_normalized_filters ? 'buyerState' OR sr.buyer_state IN (
          SELECT jsonb_array_elements_text(p_normalized_filters->'buyerState')
        ))
        AND (NOT p_normalized_filters ? 'feeState' OR sr.fee_state IN (
          SELECT jsonb_array_elements_text(p_normalized_filters->'feeState')
        ))
        AND (NOT p_normalized_filters ? 'financialState' OR sr.financial_state IN (
          SELECT jsonb_array_elements_text(p_normalized_filters->'financialState')
        ))
        AND (NOT p_normalized_filters ? 'opsStatus' OR sr.ops_status IN (
          SELECT jsonb_array_elements_text(p_normalized_filters->'opsStatus')
        ))
        AND (NOT p_normalized_filters ? 'brandId' OR sr.brand_id=(p_normalized_filters->>'brandId')::uuid)
        AND (NOT p_normalized_filters ? 'createdFrom' OR sr.requested_at>=
          (p_normalized_filters->>'createdFrom')::timestamptz)
        AND (NOT p_normalized_filters ? 'createdTo' OR sr.requested_at<=
          (p_normalized_filters->>'createdTo')::timestamptz)
        AND (NOT p_normalized_filters ? 'updatedFrom' OR sr.updated_at>=
          (p_normalized_filters->>'updatedFrom')::timestamptz)
        AND (NOT p_normalized_filters ? 'updatedTo' OR sr.updated_at<=
          (p_normalized_filters->>'updatedTo')::timestamptz)
      UNION ALL
      SELECT 'provider_event_exception',pwe.id,pwe.created_at,
        jsonb_build_object(
          'exceptionId',pwe.id,'provider',pwe.provider,'providerEventType',pwe.provider_event_type,
          'matchStatus',pwe.match_status,'safeReasonCode',pwe.match_reason_code,
          'providerRefundId',pwe.provider_refund_id,
          'createdAt',pwe.created_at,'firstResponseDueAt',pwe.first_response_due_at
        ),0
      FROM public.payment_webhook_events pwe
      WHERE (pwe.match_status IN ('unmatched','mismatched')
        OR (pwe.match_status='matched' AND pwe.match_reason_code='provider_refund_failed'))
        AND NOT (
          p_normalized_filters ? 'sourceType'
          OR p_normalized_filters ? 'buyerState'
          OR p_normalized_filters ? 'feeState'
          OR p_normalized_filters ? 'financialState'
          OR p_normalized_filters ? 'opsStatus'
        )
        AND (NOT p_normalized_filters ? 'provider' OR pwe.provider IN (
          SELECT jsonb_array_elements_text(p_normalized_filters->'provider')
        ))
        AND (NOT p_normalized_filters ? 'webhookMatchStatus' OR pwe.match_status IN (
          SELECT jsonb_array_elements_text(p_normalized_filters->'webhookMatchStatus')
        ))
        AND (NOT p_normalized_filters ? 'createdFrom' OR pwe.created_at>=
          (p_normalized_filters->>'createdFrom')::timestamptz)
        AND (NOT p_normalized_filters ? 'createdTo' OR pwe.created_at<=
          (p_normalized_filters->>'createdTo')::timestamptz)
      LIMIT 10001
    ), numbered AS MATERIALIZED (
      SELECT item_kind,item_id,safe_summary,
        (row_number() OVER(ORDER BY priority,captured_at DESC,item_kind,item_id)-1)::integer ordinal,
        count(*) OVER()::integer total
      FROM candidates
    ), assert_bound AS (
      SELECT CASE WHEN COALESCE(max(total),0)>10000
        THEN public.issue_1221_raise_query_too_broad() ELSE COALESCE(max(total),0) END n
      FROM numbered
    ), inserted_snapshot AS (
      INSERT INTO public.admin_source_refund_query_snapshots(
        id,admin_user_id,normalized_filters,normalized_filter_hash,page_size,item_count,
        created_at,expires_at
      )
      SELECT v_id,p_admin_user_id,p_normalized_filters,p_normalized_filter_hash,
        p_page_size,n,statement_timestamp(),statement_timestamp()+interval '15 minutes'
      FROM assert_bound RETURNING *
    ), inserted_items AS (
      INSERT INTO public.admin_source_refund_query_snapshot_items(
        snapshot_id,ordinal,item_kind,item_id,safe_summary
      ) SELECT v_id,ordinal,item_kind,item_id,safe_summary FROM numbered RETURNING 1
    )
    SELECT * INTO v_snapshot FROM inserted_snapshot;
  ELSE
    IF p_page_size IS NOT NULL THEN RAISE EXCEPTION 'invalid_page'; END IF;
    SELECT * INTO v_snapshot FROM public.admin_source_refund_query_snapshots
    WHERE id=p_snapshot_id FOR SHARE;
    IF NOT FOUND OR v_snapshot.expires_at<=statement_timestamp() THEN
      RAISE EXCEPTION 'snapshot_expired';
    END IF;
    IF v_snapshot.admin_user_id<>p_admin_user_id
       OR v_snapshot.normalized_filters<>p_normalized_filters
       OR v_snapshot.normalized_filter_hash<>p_normalized_filter_hash THEN
      RAISE EXCEPTION 'snapshot_binding_mismatch';
    END IF;
    IF p_next_ordinal<0 OR p_next_ordinal>v_snapshot.item_count
       OR p_next_ordinal%v_snapshot.page_size<>0 THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ordinal',i.ordinal,'itemKind',i.item_kind,'itemId',i.item_id,'safeSummary',i.safe_summary
  ) ORDER BY i.ordinal),'[]'::jsonb) INTO v_items
  FROM public.admin_source_refund_query_snapshot_items i
  WHERE i.snapshot_id=v_snapshot.id AND i.ordinal>=p_next_ordinal
    AND i.ordinal<p_next_ordinal+v_snapshot.page_size;
  RETURN QUERY SELECT v_snapshot.id,v_snapshot.created_at,v_snapshot.expires_at,
    v_snapshot.item_count,v_snapshot.page_size,v_items;
END $$;

COMMIT;
