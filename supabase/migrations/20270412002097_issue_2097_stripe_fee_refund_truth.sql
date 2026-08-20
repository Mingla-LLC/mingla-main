-- Issue #2097 — provider-authentic Stripe Application Fee Refund truth.
-- Additive only. No provider call is performed by this migration.

BEGIN;

ALTER TABLE public.refunds
  ALTER COLUMN application_fee_refunded_cents DROP NOT NULL,
  ALTER COLUMN application_fee_refunded_cents DROP DEFAULT;

UPDATE public.refunds
SET application_fee_refunded_cents = NULL
WHERE application_fee_refunded_cents = 0;

ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS application_fee_refund_status text NOT NULL DEFAULT 'unknown_legacy',
  ADD COLUMN IF NOT EXISTS application_fee_refund_terminal_reason text,
  ADD COLUMN IF NOT EXISTS buyer_refund_status text NOT NULL DEFAULT 'unknown_legacy',
  ADD COLUMN IF NOT EXISTS buyer_refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_application_fee_id text;

ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_application_fee_nonnegative;
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_application_fee_refund_status_check;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_application_fee_refund_status_check CHECK (
  application_fee_refund_status IN (
    'awaiting_application_fee','application_fee_timeout','application_fee_conflict',
    'rejected_preflight','pending_visibility','succeeded_positive',
    'fee_evidence_unavailable','evidence_conflict','not_applicable','unknown_legacy'
  )
);
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_application_fee_terminal_reason_check;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_application_fee_terminal_reason_check CHECK (
  (application_fee_refund_status = 'rejected_preflight'
    AND application_fee_refund_terminal_reason IS NOT NULL
    AND application_fee_refund_terminal_reason IN (
      'invalid_provider_amount','partial_fee_below_provider_cent','fee_preflight_conflict'
    ))
  OR
  (application_fee_refund_status <> 'rejected_preflight'
    AND application_fee_refund_terminal_reason IS NULL)
);
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_application_fee_amount_truth_check;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_application_fee_amount_truth_check CHECK (
  (application_fee_refund_status = 'succeeded_positive' AND application_fee_refunded_cents > 0)
  OR (application_fee_refund_status = 'not_applicable' AND application_fee_refunded_cents = 0)
  OR (application_fee_refund_status NOT IN ('succeeded_positive','not_applicable')
      AND application_fee_refunded_cents IS NULL)
);
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_buyer_refund_status_check;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_buyer_refund_status_check CHECK (
  buyer_refund_status IN ('not_started','provider_pending','succeeded','failed','unknown_legacy')
);

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS stripe_application_fee_id text;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_application_fee_id text;

ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check CHECK (
  status IN ('valid','used','void','transferred','refund_pending','refunded')
);

CREATE TABLE IF NOT EXISTS public.ticket_refund_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL,
  expected_attempt_count integer NOT NULL DEFAULT 1 CHECK (expected_attempt_count BETWEEN 1 AND 32),
  provider text NOT NULL CHECK (provider IN ('stripe','paystack')),
  provider_mode text NOT NULL CHECK (provider_mode IN ('test','live','not_applicable')),
  connected_account_id text,
  currency character(3) NOT NULL,
  charge_id text,
  payment_intent_id text,
  checkout_session_id text,
  application_fee_id text,
  application_fee_amount_text text,
  captured_charge_amount_text text,
  requested_refund_amount_text text NOT NULL,
  baseline_fee_refund_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  baseline_amount_refunded_text text,
  buyer_refund_id text,
  buyer_refund_amount_text text,
  buyer_refunded_at timestamptz,
  fee_refund_id text,
  fee_refund_amount_text text,
  observed_fee_refund_amount_text text,
  status text NOT NULL,
  terminal_reason text,
  observation_count integer NOT NULL DEFAULT 0 CHECK (observation_count BETWEEN 0 AND 8),
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  next_observation_at timestamptz,
  lease_owner uuid,
  lease_epoch bigint NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  provider_call_permitted_at timestamptz,
  safe_error_class text,
  alert_emitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (refund_id, request_fingerprint),
  UNIQUE (buyer_refund_id),
  UNIQUE (fee_refund_id),
  CONSTRAINT ticket_refund_attempt_status_check CHECK (status IN (
    'awaiting_application_fee','application_fee_timeout','application_fee_conflict',
    'rejected_preflight','pending_visibility','succeeded_positive',
    'fee_evidence_unavailable','evidence_conflict','not_applicable','unknown_legacy'
  )),
  CONSTRAINT ticket_refund_attempt_reason_check CHECK (
    (status='rejected_preflight' AND terminal_reason IS NOT NULL AND terminal_reason IN (
      'invalid_provider_amount','partial_fee_below_provider_cent','fee_preflight_conflict'
    )) OR (status<>'rejected_preflight' AND terminal_reason IS NULL)
  ),
  CONSTRAINT ticket_refund_attempt_amount_check CHECK (
    (status='succeeded_positive' AND fee_refund_amount_text ~ '^[1-9][0-9]*$')
    OR (status='not_applicable' AND fee_refund_amount_text='0')
    OR (status NOT IN ('succeeded_positive','not_applicable') AND fee_refund_amount_text IS NULL)
  ),
  CONSTRAINT ticket_refund_attempt_provider_identity_check CHECK (
    (status IN ('awaiting_application_fee','application_fee_timeout','application_fee_conflict',
      'rejected_preflight','unknown_legacy') AND buyer_refund_id IS NULL AND fee_refund_id IS NULL)
    OR (status IN ('pending_visibility','fee_evidence_unavailable','evidence_conflict')
      AND buyer_refund_id IS NOT NULL)
    OR (status='succeeded_positive' AND buyer_refund_id IS NOT NULL AND application_fee_id IS NOT NULL
      AND fee_refund_id IS NOT NULL)
    OR (status='not_applicable' AND buyer_refund_id IS NOT NULL AND application_fee_id IS NULL
      AND fee_refund_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.ticket_refund_fee_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.ticket_refund_attempts(id) ON DELETE RESTRICT,
  stripe_event_id text,
  application_fee_id text,
  fee_refund_id text,
  amount_text text,
  currency character(3) NOT NULL,
  connected_account_id text NOT NULL,
  charge_id text NOT NULL,
  provider_mode text NOT NULL CHECK (provider_mode IN ('test','live')),
  evidence_kind text NOT NULL CHECK (evidence_kind IN (
    'application_fee','fee_refund','no_fee','visibility_exhausted','conflict'
  )),
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fee_refund_id),
  UNIQUE (stripe_event_id),
  CONSTRAINT ticket_refund_fee_evidence_shape_check CHECK (
    (evidence_kind='no_fee' AND application_fee_id IS NULL AND fee_refund_id IS NULL AND amount_text='0')
    OR (evidence_kind<>'no_fee' AND application_fee_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.ticket_refund_quarantine (
  attempt_id uuid NOT NULL REFERENCES public.ticket_refund_attempts(id) ON DELETE RESTRICT,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE RESTRICT,
  prior_status text NOT NULL CHECK (prior_status IN ('valid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, ticket_id),
  UNIQUE (ticket_id)
);

CREATE INDEX IF NOT EXISTS ticket_refund_attempts_status_due_idx
  ON public.ticket_refund_attempts(status,next_observation_at)
  WHERE status IN ('awaiting_application_fee','pending_visibility');
CREATE INDEX IF NOT EXISTS ticket_refund_attempts_application_fee_idx
  ON public.ticket_refund_attempts(application_fee_id)
  WHERE application_fee_id IS NOT NULL;

ALTER TABLE public.ticket_refund_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_refund_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_refund_fee_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_refund_fee_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_refund_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_refund_quarantine FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_refund_attempts FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ticket_refund_fee_evidence FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ticket_refund_quarantine FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ticket_refund_attempts TO service_role;
GRANT SELECT ON public.ticket_refund_fee_evidence TO service_role;
GRANT SELECT ON public.ticket_refund_quarantine TO service_role;

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

CREATE OR REPLACE FUNCTION public.issue_2097_record_pending_observation(
  p_attempt_id uuid,p_lease_owner uuid,p_lease_epoch bigint,
  p_after_amount_refunded_text text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v public.ticket_refund_attempts%ROWTYPE; v_new_count integer;
BEGIN
  SELECT * INTO v FROM public.ticket_refund_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF v.status<>'pending_visibility' THEN
    RETURN jsonb_build_object('status',v.status,'idempotent_replay',true,
      'observation_count',v.observation_count,'next_observation_at',v.next_observation_at);
  END IF;
  IF v.lease_owner IS DISTINCT FROM p_lease_owner OR v.lease_epoch<>p_lease_epoch
     OR v.lease_expires_at<=now() THEN RAISE EXCEPTION 'stale_refund_lease'; END IF;
  IF v.next_observation_at IS NOT NULL AND v.next_observation_at>now() THEN
    RETURN jsonb_build_object('status','retry_not_due','attempt_status',v.status,
      'observation_count',v.observation_count,'next_observation_at',v.next_observation_at);
  END IF;
  IF p_after_amount_refunded_text !~ '^(0|[1-9][0-9]{0,15})$'
     OR p_after_amount_refunded_text::numeric<>v.baseline_amount_refunded_text::numeric THEN
    RAISE EXCEPTION 'pending_observation_evidence_conflict';
  END IF;
  v_new_count:=LEAST(v.observation_count+1,8);
  UPDATE public.ticket_refund_attempts SET observation_count=v_new_count,last_observed_at=now(),
    next_observation_at=CASE WHEN v_new_count>=8 THEN NULL ELSE COALESCE(buyer_refunded_at,created_at)+CASE v_new_count
      WHEN 1 THEN interval '5 seconds' WHEN 2 THEN interval '30 seconds' WHEN 3 THEN interval '2 minutes'
      WHEN 4 THEN interval '10 minutes' WHEN 5 THEN interval '30 minutes' WHEN 6 THEN interval '2 hours'
      ELSE interval '24 hours' END END,updated_at=now()
  WHERE id=v.id;
  RETURN jsonb_build_object('status',CASE WHEN v_new_count>=8 THEN 'fee_evidence_unavailable' ELSE 'pending_visibility' END,
    'observation_count',v_new_count,'next_observation_at',CASE WHEN v_new_count>=8 THEN NULL ELSE
      COALESCE(v.buyer_refunded_at,v.created_at)+CASE v_new_count WHEN 1 THEN interval '5 seconds'
      WHEN 2 THEN interval '30 seconds' WHEN 3 THEN interval '2 minutes' WHEN 4 THEN interval '10 minutes'
      WHEN 5 THEN interval '30 minutes' WHEN 6 THEN interval '2 hours' ELSE interval '24 hours' END END);
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
    UPDATE public.tickets t SET status='refunded' FROM public.ticket_refund_quarantine x
      JOIN public.ticket_refund_attempts a ON a.id=x.attempt_id
      WHERE a.refund_id=v.refund_id AND x.ticket_id=t.id AND t.status='refund_pending';
    SELECT COALESCE(SUM(amount_cents),0) INTO v_total FROM public.refunds
      WHERE order_id=v.order_id AND status='succeeded';
    v_order_status:=CASE WHEN NOT EXISTS(
      SELECT 1 FROM public.order_line_items oli WHERE oli.order_id=v.order_id AND oli.quantity>(
        SELECT COALESCE(SUM(rli.quantity),0) FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id=rli.refund_id WHERE rli.order_line_item_id=oli.id AND r.status='succeeded'
      )) THEN 'refunded' ELSE 'partial_refund' END;
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

CREATE OR REPLACE FUNCTION public.issue_2097_finalize_not_applicable(
  p_refund_id uuid,p_provider text,p_provider_refund_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v public.refunds%ROWTYPE;
BEGIN
  IF p_provider NOT IN ('paystack','stripe_proven_no_fee') THEN RAISE EXCEPTION 'provider_not_proven_not_applicable'; END IF;
  SELECT * INTO v FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  UPDATE public.refunds SET stripe_refund_id=p_provider_refund_id,buyer_refund_status='succeeded',
    buyer_refunded_at=COALESCE(buyer_refunded_at,now()),application_fee_refund_status='not_applicable',
    application_fee_refunded_cents=0 WHERE id=p_refund_id;
  RETURN jsonb_build_object('status','not_applicable','application_fee_refunded_cents',0);
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

CREATE OR REPLACE FUNCTION public.admin_list_refunds(
  p_search text DEFAULT NULL,p_status_filter text DEFAULT NULL,
  p_limit int DEFAULT 25,p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT r.id,r.order_id,public.biz_order_brand_id(r.order_id) brand_id,
      r.amount_cents,r.currency,r.reason,r.status,r.stripe_refund_id,r.stripe_charge_id,
      r.application_fee_refunded_cents,r.application_fee_refund_status,
      r.application_fee_refund_terminal_reason,r.buyer_refund_status,
      r.initiated_by,r.created_at,r.processed_at
    FROM public.refunds r
  ), enriched AS (
    SELECT base.*,b.name brand_name FROM base LEFT JOIN public.brands b ON b.id=base.brand_id
  ), filtered AS (
    SELECT * FROM enriched WHERE (p_search IS NULL OR stripe_refund_id ILIKE '%'||p_search||'%'
      OR stripe_charge_id ILIKE '%'||p_search||'%' OR order_id::text=p_search)
      AND (p_status_filter IS NULL OR status=p_status_filter OR application_fee_refund_status=p_status_filter)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC),'[]'::jsonb),
    (SELECT count(*) FROM filtered) INTO v_rows,v_total
  FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) f;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total);
END;$function$;

REVOKE ALL ON FUNCTION public.issue_2097_prepare_refund_attempt(uuid,text,text,text,text,text,text,text,text,text,text,jsonb,text,boolean,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2097_record_pre_refund_state(uuid,text,text,text,text,text,text,text,text,text,text,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2097_record_buyer_refund(uuid,uuid,bigint,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2097_record_pending_observation(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2097_finalize_not_applicable(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_2097_claim_refund_attempt(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2097_prepare_refund_attempt(uuid,text,text,text,text,text,text,text,text,text,text,jsonb,text,boolean,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2097_record_pre_refund_state(uuid,text,text,text,text,text,text,text,text,text,text,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2097_record_buyer_refund(uuid,uuid,bigint,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2097_record_pending_observation(uuid,uuid,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2097_finalize_not_applicable(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2097_claim_refund_attempt(uuid,uuid) TO service_role;

COMMENT ON TABLE public.ticket_refund_attempts IS '#2097 service-only exact provider refund attempt and lease owner; never a source-refund rail.';
COMMENT ON TABLE public.ticket_refund_fee_evidence IS '#2097 immutable Stripe Application Fee/Fee Refund evidence; source_refunds excluded.';

COMMIT;
