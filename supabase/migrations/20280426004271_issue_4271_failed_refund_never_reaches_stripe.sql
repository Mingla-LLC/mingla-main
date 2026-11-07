-- Issue #4271 follow-up: a ticket refund Stripe never received is committed
-- 'failed', and a refund that is no longer pending can never reach Stripe again.
--
-- Live case: Stripe refused a refund before anything happened (a permission
-- error reading the payment), refund-order returned 502 and the refunds row
-- stayed 'pending' forever. refund_preview and biz_refund_order count pending
-- rows as refunded, so the host could never refund those tickets again.
--
-- 1. issue_4271_commit_refund_failed commits 'failed' in ONE transaction, under
--    the same refunds row lock issue_2097_prepare_refund_attempt takes, and only
--    when Stripe provably never saw the refund: the caller did not reach
--    refunds.create, Stripe recorded no refund, and no #2097 attempt for the
--    refund was ever permitted to call Stripe (provider_call_permitted_at).
--    The same transaction closes the refund's open attempts. Otherwise the row
--    stays pending (outcome 'unknown') for the existing reconcile machinery.
-- 2. issue_4271_bind_refund_provider_key records the Stripe idempotency key a
--    refund is first driven under (ticket_refund:<id> or admin_refund:<id>), so
--    admin-reconcile-ticket-refund replays the refund under its ORIGINAL key and
--    no path can drive one row under two keys.
-- 3. The #2097 prepare, pre-refund state, claim, record and finalize functions
--    refuse a refund whose status is not 'pending' (PT409; claim answers
--    "not claimed"), so a 'failed' row never reaches Stripe or settles later.
--    Their bodies are otherwise exactly the 20270412002097 ones (finalize: the
--    20280305003281 one).
--
-- Static SQL, CREATE OR REPLACE only, no data change; safe to run twice.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_4271_commit_refund_failed(
  p_refund_id uuid,
  p_provider_call_reached boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_closed integer;
BEGIN
  -- The lock issue_2097_prepare_refund_attempt takes before it permits a call.
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE='P0010';
  END IF;
  IF v_refund.status='failed' THEN
    RETURN jsonb_build_object('refund_id',p_refund_id,'outcome','failed','idempotent_replay',true);
  END IF;
  IF v_refund.status<>'pending' THEN
    RETURN jsonb_build_object('refund_id',p_refund_id,'outcome','unknown','reason','refund_not_pending',
      'refund_status',v_refund.status);
  END IF;
  IF p_provider_call_reached IS DISTINCT FROM false THEN
    RETURN jsonb_build_object('refund_id',p_refund_id,'outcome','unknown','reason','provider_call_reached');
  END IF;
  IF v_refund.stripe_refund_id IS NOT NULL THEN
    RETURN jsonb_build_object('refund_id',p_refund_id,'outcome','unknown','reason','provider_refund_recorded');
  END IF;
  -- Attempts are locked after the refund row, in prepare's order.
  PERFORM 1 FROM public.ticket_refund_attempts WHERE refund_id=p_refund_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.ticket_refund_attempts a
    WHERE a.refund_id=p_refund_id
      AND (a.provider_call_permitted_at IS NOT NULL OR a.buyer_refund_id IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('refund_id',p_refund_id,'outcome','unknown','reason','provider_call_permitted');
  END IF;
  -- Nothing ever reached Stripe: close every open attempt so none is claimable.
  UPDATE public.ticket_refund_attempts
  SET status='application_fee_timeout',next_observation_at=NULL,
      lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
  WHERE refund_id=p_refund_id AND status IN ('awaiting_application_fee','pending_visibility');
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  UPDATE public.refunds
  SET status='failed',
      processed_at=now(),
      application_fee_refund_status=CASE
        WHEN application_fee_refund_status IN ('awaiting_application_fee','pending_visibility')
          THEN 'application_fee_timeout' ELSE application_fee_refund_status END
  WHERE id=p_refund_id;
  RETURN jsonb_build_object('refund_id',p_refund_id,'outcome','failed','closed_attempts',v_closed,
    'idempotent_replay',false);
END;$function$;

CREATE OR REPLACE FUNCTION public.issue_4271_bind_refund_provider_key(
  p_refund_id uuid,
  p_provider_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_bound text;
BEGIN
  IF p_provider_key IS NULL
     OR p_provider_key NOT IN ('ticket_refund:'||p_refund_id::text,'admin_refund:'||p_refund_id::text) THEN
    RAISE EXCEPTION 'invalid_provider_key' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE='P0010';
  END IF;
  v_bound := v_refund.metadata->>'provider_idempotency_key';
  IF v_bound IS NOT NULL THEN
    IF v_bound<>p_provider_key THEN
      RAISE EXCEPTION 'provider_key_conflict: refund=% bound=%',p_refund_id,v_bound USING ERRCODE='PT409';
    END IF;
    RETURN jsonb_build_object('refund_id',p_refund_id,'provider_key',v_bound,'bound',false);
  END IF;
  IF v_refund.status<>'pending' THEN
    RAISE EXCEPTION 'refund_not_pending: refund=% status=%',p_refund_id,v_refund.status USING ERRCODE='PT409';
  END IF;
  UPDATE public.refunds
  SET metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('provider_idempotency_key',p_provider_key)
  WHERE id=p_refund_id;
  RETURN jsonb_build_object('refund_id',p_refund_id,'provider_key',p_provider_key,'bound',true);
END;$function$;

CREATE OR REPLACE FUNCTION public.issue_2097_prepare_refund_attempt(
  p_refund_id uuid,
  p_request_fingerprint text,
  p_provider_mode text,
  p_connected_account_id text,
  p_currency text,
  p_charge_id text,
  p_payment_intent_id text,
  p_application_fee_id text,
  p_application_fee_amount_text text,
  p_captured_charge_amount_text text,
  p_requested_refund_amount_text text,
  p_baseline_fee_refund_ids jsonb,
  p_baseline_amount_refunded_text text,
  p_typescript_preflight boolean,
  p_expected_attempt_count integer,
  p_lease_owner uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_existing public.ticket_refund_attempts%ROWTYPE;
  v_attempt public.ticket_refund_attempts%ROWTYPE;
  v_reason text;
  v_db_preflight boolean;
BEGIN
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  SELECT * INTO v_existing FROM public.ticket_refund_attempts
    WHERE refund_id=p_refund_id AND request_fingerprint=p_request_fingerprint FOR UPDATE;
  IF FOUND THEN
    -- issue #4271 — a refund that is no longer pending never reaches Stripe again.
    IF v_refund.status<>'pending' THEN
      RETURN jsonb_build_object('attempt_id',v_existing.id,'status',v_existing.status,
        'terminal_reason',v_existing.terminal_reason,'provider_call_permitted',false,
        'lease_epoch',v_existing.lease_epoch,'idempotent_replay',true,'refund_status',v_refund.status);
    END IF;
    IF v_existing.status='awaiting_application_fee' AND v_existing.application_fee_id IS NULL THEN
      IF v_existing.next_observation_at IS NOT NULL AND v_existing.next_observation_at>now() THEN
        RETURN jsonb_build_object('attempt_id',v_existing.id,'status',v_existing.status,
          'observation_result','retry_not_due','provider_call_permitted',false,
          'lease_epoch',v_existing.lease_epoch,'idempotent_replay',true,
          'next_observation_at',v_existing.next_observation_at);
      END IF;
      IF p_application_fee_amount_text !~ '^[1-9][0-9]{0,15}$'
         OR p_captured_charge_amount_text !~ '^[1-9][0-9]{0,15}$'
         OR p_requested_refund_amount_text !~ '^[1-9][0-9]{0,15}$'
         OR p_baseline_amount_refunded_text !~ '^(0|[1-9][0-9]{0,15})$'
         OR jsonb_typeof(p_baseline_fee_refund_ids)<>'array' THEN
        UPDATE public.ticket_refund_attempts SET status='rejected_preflight',
          terminal_reason='invalid_provider_amount',next_observation_at=NULL,updated_at=now()
        WHERE id=v_existing.id RETURNING * INTO v_existing;
        UPDATE public.refunds SET application_fee_refund_status='rejected_preflight',
          application_fee_refund_terminal_reason='invalid_provider_amount',
          application_fee_refunded_cents=NULL WHERE id=p_refund_id;
        RETURN jsonb_build_object('attempt_id',v_existing.id,'status',v_existing.status,
          'terminal_reason','invalid_provider_amount','provider_call_permitted',false,
          'lease_epoch',v_existing.lease_epoch,'idempotent_replay',true);
      END IF;
      IF p_application_fee_id IS NULL
         OR p_connected_account_id IS DISTINCT FROM v_existing.connected_account_id
         OR p_charge_id IS DISTINCT FROM v_existing.charge_id
         OR p_payment_intent_id IS DISTINCT FROM v_existing.payment_intent_id
         OR upper(p_currency)::character(3) IS DISTINCT FROM v_existing.currency
         OR (v_existing.application_fee_amount_text IS NOT NULL
           AND p_application_fee_amount_text IS DISTINCT FROM v_existing.application_fee_amount_text)
         OR p_captured_charge_amount_text IS DISTINCT FROM v_existing.captured_charge_amount_text
         OR p_requested_refund_amount_text IS DISTINCT FROM v_existing.requested_refund_amount_text THEN
        UPDATE public.ticket_refund_attempts SET status='application_fee_conflict',next_observation_at=NULL,
          updated_at=now() WHERE id=v_existing.id RETURNING * INTO v_existing;
        UPDATE public.refunds SET application_fee_refund_status='application_fee_conflict',
          application_fee_refunded_cents=NULL WHERE id=p_refund_id;
        RETURN jsonb_build_object('attempt_id',v_existing.id,'status',v_existing.status,
          'provider_call_permitted',false,'lease_epoch',v_existing.lease_epoch,'idempotent_replay',true);
      END IF;
      v_db_preflight:=p_application_fee_amount_text::numeric>0
        AND p_captured_charge_amount_text::numeric>0
        AND p_requested_refund_amount_text::numeric>0
        AND p_requested_refund_amount_text::numeric<=p_captured_charge_amount_text::numeric
        AND (p_requested_refund_amount_text::numeric=p_captured_charge_amount_text::numeric
          OR p_application_fee_amount_text::numeric*p_requested_refund_amount_text::numeric
             >=p_captured_charge_amount_text::numeric);
      IF NOT v_db_preflight OR p_typescript_preflight IS DISTINCT FROM v_db_preflight THEN
        v_reason:=CASE WHEN p_typescript_preflight IS DISTINCT FROM v_db_preflight THEN 'fee_preflight_conflict'
          WHEN p_requested_refund_amount_text::numeric<=0 OR p_requested_refund_amount_text::numeric>p_captured_charge_amount_text::numeric
            OR p_captured_charge_amount_text::numeric<=0 OR p_application_fee_amount_text::numeric<=0 THEN 'invalid_provider_amount'
          ELSE 'partial_fee_below_provider_cent' END;
        UPDATE public.ticket_refund_attempts SET status='rejected_preflight',terminal_reason=v_reason,
          next_observation_at=NULL,updated_at=now() WHERE id=v_existing.id RETURNING * INTO v_existing;
        UPDATE public.refunds SET application_fee_refund_status='rejected_preflight',
          application_fee_refund_terminal_reason=v_reason,application_fee_refunded_cents=NULL WHERE id=p_refund_id;
        RETURN jsonb_build_object('attempt_id',v_existing.id,'status',v_existing.status,
          'terminal_reason',v_reason,'provider_call_permitted',false,
          'lease_epoch',v_existing.lease_epoch,'idempotent_replay',true);
      END IF;
      UPDATE public.ticket_refund_attempts SET application_fee_id=p_application_fee_id,
        application_fee_amount_text=p_application_fee_amount_text,
        baseline_fee_refund_ids=p_baseline_fee_refund_ids,
        baseline_amount_refunded_text=p_baseline_amount_refunded_text,
        lease_owner=p_lease_owner,lease_epoch=lease_epoch+1,lease_expires_at=now()+interval '120 seconds',
        provider_call_permitted_at=now(),next_observation_at=NULL,updated_at=now()
      WHERE id=v_existing.id RETURNING * INTO v_existing;
      UPDATE public.refunds SET stripe_application_fee_id=p_application_fee_id WHERE id=p_refund_id;
      RETURN jsonb_build_object('attempt_id',v_existing.id,'status',v_existing.status,
        'provider_call_permitted',true,'lease_epoch',v_existing.lease_epoch,'idempotent_replay',true);
    END IF;
    RETURN jsonb_build_object('attempt_id',v_existing.id,'status',v_existing.status,
      'terminal_reason',v_existing.terminal_reason,'provider_call_permitted',false,
      'lease_epoch',v_existing.lease_epoch,'idempotent_replay',true);
  END IF;
  -- issue #4271 — a refund that is no longer pending never reaches Stripe again.
  IF v_refund.status<>'pending' THEN
    RAISE EXCEPTION 'refund_not_pending: refund=% status=%',p_refund_id,v_refund.status USING ERRCODE='PT409';
  END IF;
  IF p_provider_mode NOT IN ('test','live') OR p_connected_account_id IS NULL
     OR p_currency !~ '^[A-Za-z]{3}$' OR p_charge_id IS NULL OR p_payment_intent_id IS NULL
     OR p_application_fee_id IS NULL OR p_application_fee_amount_text !~ '^(0|[1-9][0-9]{0,15})$'
     OR p_captured_charge_amount_text !~ '^(0|[1-9][0-9]{0,15})$'
     OR p_requested_refund_amount_text !~ '^(0|[1-9][0-9]{0,15})$' THEN
    v_reason := 'invalid_provider_amount';
  ELSE
    v_db_preflight := p_application_fee_amount_text::numeric > 0
      AND p_captured_charge_amount_text::numeric > 0
      AND p_requested_refund_amount_text::numeric > 0
      AND p_requested_refund_amount_text::numeric <= p_captured_charge_amount_text::numeric
      AND (p_requested_refund_amount_text::numeric = p_captured_charge_amount_text::numeric
        OR p_application_fee_amount_text::numeric * p_requested_refund_amount_text::numeric
           >= p_captured_charge_amount_text::numeric);
    IF NOT v_db_preflight THEN
      v_reason := CASE
        WHEN p_requested_refund_amount_text::numeric <= 0
          OR p_requested_refund_amount_text::numeric > p_captured_charge_amount_text::numeric
          OR p_captured_charge_amount_text::numeric <= 0
          OR p_application_fee_amount_text::numeric <= 0 THEN 'invalid_provider_amount'
        ELSE 'partial_fee_below_provider_cent' END;
    ELSIF p_typescript_preflight IS DISTINCT FROM v_db_preflight THEN
      v_reason := 'fee_preflight_conflict';
    END IF;
  END IF;
  IF jsonb_typeof(COALESCE(p_baseline_fee_refund_ids,'null'::jsonb)) <> 'array'
     OR p_baseline_amount_refunded_text !~ '^(0|[1-9][0-9]{0,15})$'
     OR p_expected_attempt_count NOT BETWEEN 1 AND 32 THEN
    v_reason := 'invalid_provider_amount';
  END IF;
  INSERT INTO public.ticket_refund_attempts(
    refund_id,order_id,request_fingerprint,expected_attempt_count,provider,provider_mode,connected_account_id,
    currency,charge_id,payment_intent_id,application_fee_id,application_fee_amount_text,
    captured_charge_amount_text,requested_refund_amount_text,baseline_fee_refund_ids,
    baseline_amount_refunded_text,status,terminal_reason,lease_owner,lease_epoch,
    lease_expires_at,provider_call_permitted_at,first_observed_at
  ) VALUES (
    p_refund_id,v_refund.order_id,p_request_fingerprint,p_expected_attempt_count,'stripe',p_provider_mode,
    p_connected_account_id,upper(p_currency)::character(3),p_charge_id,p_payment_intent_id,
    p_application_fee_id,p_application_fee_amount_text,p_captured_charge_amount_text,
    p_requested_refund_amount_text,COALESCE(p_baseline_fee_refund_ids,'[]'::jsonb),
    p_baseline_amount_refunded_text,CASE WHEN v_reason IS NULL THEN 'awaiting_application_fee' ELSE 'rejected_preflight' END,
    v_reason,p_lease_owner,1,now()+interval '120 seconds',CASE WHEN v_reason IS NULL THEN now() END,now()
  ) RETURNING * INTO v_attempt;
  UPDATE public.refunds SET application_fee_refund_status=v_attempt.status,
    application_fee_refund_terminal_reason=v_attempt.terminal_reason,
    stripe_application_fee_id=p_application_fee_id,
    application_fee_refunded_cents=NULL
  WHERE id=p_refund_id;
  RETURN jsonb_build_object('attempt_id',v_attempt.id,'status',v_attempt.status,
    'terminal_reason',v_attempt.terminal_reason,'provider_call_permitted',v_reason IS NULL,
    'lease_epoch',v_attempt.lease_epoch,'idempotent_replay',false);
END;$function$;

CREATE OR REPLACE FUNCTION public.issue_2097_record_pre_refund_state(
  p_refund_id uuid,p_request_fingerprint text,p_provider_mode text,
  p_connected_account_id text,p_currency text,p_charge_id text,p_payment_intent_id text,
  p_application_fee_amount_text text,p_captured_charge_amount_text text,
  p_requested_refund_amount_text text,p_status text,p_expected_attempt_count integer,
  p_lease_owner uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_refund public.refunds%ROWTYPE; v public.ticket_refund_attempts%ROWTYPE;
  v_new_count integer; v_no_fee_proven boolean; v_input_invalid boolean;
BEGIN
  IF p_status NOT IN ('awaiting_application_fee','application_fee_conflict') THEN RAISE EXCEPTION 'invalid_pre_refund_state'; END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF (p_captured_charge_amount_text ~ '^[1-9][0-9]{0,15}$') IS DISTINCT FROM true
     OR (p_requested_refund_amount_text ~ '^[1-9][0-9]{0,15}$') IS DISTINCT FROM true
     OR (p_application_fee_amount_text IS NOT NULL
       AND (p_application_fee_amount_text ~ '^(0|[1-9][0-9]{0,15})$') IS DISTINCT FROM true) THEN
    v_input_invalid:=true;
  ELSE
    v_input_invalid:=p_requested_refund_amount_text::numeric>p_captured_charge_amount_text::numeric;
  END IF;
  SELECT * INTO v FROM public.ticket_refund_attempts WHERE refund_id=p_refund_id AND request_fingerprint=p_request_fingerprint FOR UPDATE;
  IF FOUND THEN
    IF v.status<>'awaiting_application_fee' THEN
      RETURN jsonb_build_object('attempt_id',v.id,'status',v.status,'idempotent_replay',true,
        'provider_call_permitted',false,'lease_epoch',v.lease_epoch);
    END IF;
    -- issue #4271 — a refund that is no longer pending never reaches Stripe again.
    IF v_refund.status<>'pending' THEN
      RAISE EXCEPTION 'refund_not_pending: refund=% status=%',p_refund_id,v_refund.status USING ERRCODE='PT409';
    END IF;
    IF p_status = 'application_fee_conflict' THEN
      UPDATE public.ticket_refund_attempts SET status = 'application_fee_conflict',
        next_observation_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE id=v.id RETURNING * INTO v;
      UPDATE public.refunds SET application_fee_refund_status='application_fee_conflict',
        application_fee_refund_terminal_reason=NULL,application_fee_refunded_cents=NULL
      WHERE id=p_refund_id;
      RETURN jsonb_build_object('attempt_id',v.id,'status',v.status,'idempotent_replay',true,
        'provider_call_permitted',false,'lease_epoch',v.lease_epoch);
    END IF;
    IF v.next_observation_at IS NOT NULL AND v.next_observation_at > now() THEN
      RETURN jsonb_build_object('attempt_id',v.id,'status','awaiting_application_fee',
        'observation_result','retry_not_due','idempotent_replay',true,
        'provider_call_permitted',false,'lease_epoch',v.lease_epoch,
        'next_observation_at',v.next_observation_at);
    END IF;
    v_new_count:=LEAST(v.observation_count+1,8);
    v_no_fee_proven:=v_new_count>=8 AND v.application_fee_amount_text='0';
    UPDATE public.ticket_refund_attempts SET observation_count=v_new_count,last_observed_at=now(),
      status=CASE WHEN v_new_count>=8 AND NOT v_no_fee_proven THEN 'application_fee_timeout' ELSE status END,
      next_observation_at=CASE WHEN v_new_count>=8 THEN NULL ELSE first_observed_at+CASE v_new_count
        WHEN 1 THEN interval '5 seconds' WHEN 2 THEN interval '30 seconds' WHEN 3 THEN interval '2 minutes'
        WHEN 4 THEN interval '10 minutes' WHEN 5 THEN interval '30 minutes' WHEN 6 THEN interval '2 hours'
        ELSE interval '24 hours' END END,
      lease_owner=CASE WHEN v_no_fee_proven THEN p_lease_owner ELSE lease_owner END,
      lease_epoch=CASE WHEN v_no_fee_proven THEN lease_epoch+1 ELSE lease_epoch END,
      lease_expires_at=CASE WHEN v_no_fee_proven THEN now()+interval '120 seconds' ELSE lease_expires_at END,
      provider_call_permitted_at=CASE WHEN v_no_fee_proven THEN now() ELSE provider_call_permitted_at END,
      updated_at=now() WHERE id=v.id RETURNING * INTO v;
    UPDATE public.refunds SET application_fee_refund_status=v.status,
      application_fee_refunded_cents=NULL WHERE id=p_refund_id;
    RETURN jsonb_build_object('attempt_id',v.id,'status',v.status,'idempotent_replay',true,
      'provider_call_permitted',v_no_fee_proven,'lease_epoch',v.lease_epoch,
      'next_observation_at',v.next_observation_at);
  END IF;
  -- issue #4271 — a refund that is no longer pending never reaches Stripe again.
  IF v_refund.status<>'pending' THEN
    RAISE EXCEPTION 'refund_not_pending: refund=% status=%',p_refund_id,v_refund.status USING ERRCODE='PT409';
  END IF;
  INSERT INTO public.ticket_refund_attempts(refund_id,order_id,request_fingerprint,expected_attempt_count,
    provider,provider_mode,connected_account_id,currency,charge_id,payment_intent_id,
    application_fee_amount_text,captured_charge_amount_text,requested_refund_amount_text,
    status,terminal_reason,observation_count,first_observed_at,last_observed_at,next_observation_at)
  VALUES(p_refund_id,v_refund.order_id,p_request_fingerprint,p_expected_attempt_count,'stripe',p_provider_mode,
    p_connected_account_id,upper(p_currency)::character(3),p_charge_id,p_payment_intent_id,
    CASE WHEN p_application_fee_amount_text ~ '^(0|[1-9][0-9]{0,15})$' THEN p_application_fee_amount_text END,
    CASE WHEN p_captured_charge_amount_text ~ '^(0|[1-9][0-9]{0,15})$' THEN p_captured_charge_amount_text END,
    CASE WHEN p_requested_refund_amount_text ~ '^(0|[1-9][0-9]{0,15})$' THEN p_requested_refund_amount_text ELSE '0' END,
    CASE WHEN v_input_invalid THEN 'rejected_preflight' ELSE p_status END,
    CASE WHEN v_input_invalid THEN 'invalid_provider_amount' END,1,now(),now(),
    CASE WHEN NOT v_input_invalid AND p_status='awaiting_application_fee' THEN now()+interval '5 seconds' END)
  RETURNING * INTO v;
  UPDATE public.refunds SET application_fee_refund_status=v.status,
    application_fee_refund_terminal_reason=v.terminal_reason,application_fee_refunded_cents=NULL WHERE id=p_refund_id;
  RETURN jsonb_build_object('attempt_id',v.id,'status',v.status,'idempotent_replay',false,'provider_call_permitted',false);
END;$function$;

CREATE OR REPLACE FUNCTION public.issue_2097_claim_refund_attempt(
  p_attempt_id uuid,p_lease_owner uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v public.ticket_refund_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.ticket_refund_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF v.status NOT IN ('awaiting_application_fee','pending_visibility') THEN
    RETURN jsonb_build_object('attempt_id',v.id,'status',v.status,'claimed',false,'lease_epoch',v.lease_epoch);
  END IF;
  -- issue #4271 — a refund that is no longer pending never reaches Stripe again.
  -- Not claimed (never a raise): every caller already treats an unclaimed attempt as owned elsewhere.
  IF EXISTS (SELECT 1 FROM public.refunds r WHERE r.id=v.refund_id AND r.status<>'pending') THEN
    RETURN jsonb_build_object('attempt_id',v.id,'status',v.status,'claimed',false,
      'lease_epoch',v.lease_epoch,'refund_not_pending',true);
  END IF;
  IF v.next_observation_at IS NOT NULL AND v.next_observation_at > now() THEN
    RETURN jsonb_build_object('attempt_id',v.id,'status','retry_not_due','attempt_status',v.status,
      'claimed',false,'lease_epoch',v.lease_epoch,'next_observation_at',v.next_observation_at);
  END IF;
  IF v.lease_expires_at>now() AND v.lease_owner IS DISTINCT FROM p_lease_owner THEN
    RETURN jsonb_build_object('attempt_id',v.id,'status',v.status,'claimed',false,'lease_epoch',v.lease_epoch);
  END IF;
  UPDATE public.ticket_refund_attempts SET lease_owner=p_lease_owner,lease_epoch=lease_epoch+1,
    lease_expires_at=now()+interval '120 seconds',updated_at=now()
    WHERE id=v.id RETURNING * INTO v;
  RETURN jsonb_build_object('attempt_id',v.id,'status',v.status,'claimed',true,'lease_epoch',v.lease_epoch);
END;$function$;

CREATE OR REPLACE FUNCTION public.issue_2097_record_buyer_refund(
  p_attempt_id uuid,p_lease_owner uuid,p_lease_epoch bigint,
  p_buyer_refund_id text,p_buyer_refund_amount_text text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v public.ticket_refund_attempts%ROWTYPE; q record;
BEGIN
  SELECT * INTO v FROM public.ticket_refund_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF v.buyer_refund_id IS NOT NULL THEN
    IF v.buyer_refund_id<>p_buyer_refund_id THEN RAISE EXCEPTION 'buyer_refund_identity_conflict'; END IF;
    RETURN jsonb_build_object('status',v.status,'idempotent_replay',true);
  END IF;
  -- issue #4271 — a refund that is no longer pending never reaches Stripe again.
  IF EXISTS (SELECT 1 FROM public.refunds r WHERE r.id=v.refund_id AND r.status<>'pending') THEN
    RAISE EXCEPTION 'refund_not_pending: refund=%',v.refund_id USING ERRCODE='PT409';
  END IF;
  IF v.lease_owner IS DISTINCT FROM p_lease_owner OR v.lease_epoch<>p_lease_epoch
     OR v.lease_expires_at<=now() OR v.provider_call_permitted_at IS NULL THEN
    RAISE EXCEPTION 'stale_refund_lease';
  END IF;
  IF p_buyer_refund_amount_text !~ '^[1-9][0-9]{0,15}$'
     OR p_buyer_refund_amount_text::numeric<>v.requested_refund_amount_text::numeric THEN
    RAISE EXCEPTION 'buyer_refund_amount_conflict';
  END IF;
  UPDATE public.ticket_refund_attempts SET buyer_refund_id=p_buyer_refund_id,
    buyer_refund_amount_text=p_buyer_refund_amount_text,buyer_refunded_at=now(),status='pending_visibility',
    observation_count=0,last_observed_at=NULL,next_observation_at=now(),
    updated_at=now() WHERE id=v.id;
  UPDATE public.refunds SET stripe_refund_id=p_buyer_refund_id,buyer_refund_status='succeeded',
    buyer_refunded_at=now(),application_fee_refund_status='pending_visibility',
    application_fee_refunded_cents=NULL WHERE id=v.refund_id;
  FOR q IN SELECT rli.ticket_type_id,rli.quantity FROM public.refund_line_items rli WHERE rli.refund_id=v.refund_id LOOP
    INSERT INTO public.ticket_refund_quarantine(attempt_id,ticket_id,prior_status)
    SELECT v.id,t.id,'valid' FROM public.tickets t WHERE t.order_id=v.order_id
      AND t.ticket_type_id=q.ticket_type_id AND t.status='valid'
      ORDER BY t.created_at,t.id LIMIT q.quantity ON CONFLICT DO NOTHING;
  END LOOP;
  IF NOT FOUND THEN
    INSERT INTO public.ticket_refund_quarantine(attempt_id,ticket_id,prior_status)
    SELECT v.id,t.id,'valid' FROM public.tickets t
    WHERE t.order_id=v.order_id AND t.status='valid'
    ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.tickets t SET status='refund_pending'
    FROM public.ticket_refund_quarantine x WHERE x.attempt_id=v.id AND x.ticket_id=t.id;
  RETURN jsonb_build_object('status','pending_visibility','idempotent_replay',false);
END;$function$;

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
  -- issue #4271 — a refund that is no longer pending never reaches Stripe again.
  IF v_refund.status<>'pending' THEN
    RAISE EXCEPTION 'refund_not_pending: refund=% status=%',v.refund_id,v_refund.status USING ERRCODE='PT409';
  END IF;
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
  PERFORM 1 FROM public.orders WHERE id = v.order_id FOR NO KEY UPDATE;
    UPDATE public.tickets t SET status='refunded' FROM public.ticket_refund_quarantine x
      JOIN public.ticket_refund_attempts a ON a.id=x.attempt_id
      WHERE a.refund_id=v.refund_id AND x.ticket_id=t.id AND t.status='refund_pending';
    SELECT COALESCE(SUM(amount_cents),0) INTO v_total FROM public.refunds
      WHERE order_id=v.order_id AND status='succeeded';
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

REVOKE ALL ON FUNCTION public.issue_4271_commit_refund_failed(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_commit_refund_failed(uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4271_bind_refund_provider_key(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_bind_refund_provider_key(uuid,text) TO service_role;
-- CREATE OR REPLACE keeps the #2097 grants; restated so the file stands alone.
REVOKE ALL ON FUNCTION public.issue_2097_prepare_refund_attempt(uuid,text,text,text,text,text,text,text,text,text,text,jsonb,text,boolean,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2097_record_pre_refund_state(uuid,text,text,text,text,text,text,text,text,text,text,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2097_claim_refund_attempt(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2097_record_buyer_refund(uuid,uuid,bigint,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2097_prepare_refund_attempt(uuid,text,text,text,text,text,text,text,text,text,text,jsonb,text,boolean,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2097_record_pre_refund_state(uuid,text,text,text,text,text,text,text,text,text,text,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2097_claim_refund_attempt(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2097_record_buyer_refund(uuid,uuid,bigint,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text) TO service_role;

COMMENT ON FUNCTION public.issue_4271_commit_refund_failed(uuid,boolean) IS
  'Issue #4271: commits a pending ticket refund failed, and closes its open #2097 attempts, only when Stripe provably never saw it (refunds.create not reached, no Stripe refund recorded, no attempt ever permitted), under the refunds row lock prepare takes. Otherwise outcome unknown and the row stays pending. Service role only.';
COMMENT ON FUNCTION public.issue_4271_bind_refund_provider_key(uuid,text) IS
  'Issue #4271: records the Stripe idempotency key (ticket_refund:<id> or admin_refund:<id>) a refund is first driven under; a different key is a PT409 conflict. admin-reconcile-ticket-refund replays under this key. Service role only.';

NOTIFY pgrst, 'reload schema';

COMMIT;
