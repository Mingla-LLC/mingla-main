-- Issue #1930 — current-sale admission, deterministic provider attempts, and
-- closure-won no-value convergence. Additive and default-off; no provider I/O.

CREATE TABLE public.event_checkout_admission_state (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  epoch bigint NOT NULL DEFAULT 1 CHECK (epoch > 0),
  sellable boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT 'not_evaluated'
    CHECK (reason IN ('sellable','not_evaluated','event_missing','event_deleted',
      'event_status','event_visibility','trip_closed','trip_deadline','inventory_changed')),
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_checkout_admission_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_checkout_admission_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_checkout_admission_state TO service_role;

CREATE TABLE public.ticket_checkout_provider_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id uuid NOT NULL UNIQUE
    REFERENCES public.ticket_checkout_sessions(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('stripe','paystack')),
  flow text NOT NULL CHECK (flow IN ('stripe_native','stripe_checkout','paystack_redirect')),
  claimed_epoch bigint NOT NULL CHECK (claimed_epoch > 0),
  state text NOT NULL DEFAULT 'claimed' CHECK (state IN (
    'claimed','provider_unknown','ready','neutralization_pending','neutralized',
    'paid_reversal_pending','paid_reversed','terminal_failed'
  )),
  provider_idempotency_key text NOT NULL UNIQUE,
  provider_object_id text UNIQUE,
  provider_checkout_id text UNIQUE,
  provider_reference text UNIQUE,
  request_fingerprint text NOT NULL,
  continuation_fingerprint text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  neutralized_at timestamptz,
  reversed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_checkout_provider_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_checkout_provider_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_checkout_provider_attempts TO service_role;
CREATE INDEX ticket_checkout_attempt_event_state_idx
  ON public.ticket_checkout_provider_attempts(event_id,state,updated_at);

CREATE TABLE public.checkout_sale_revocation_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('ticket_checkout_session','rsvp_contribution')),
  subject_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  provider_attempt_id uuid REFERENCES public.ticket_checkout_provider_attempts(id) ON DELETE RESTRICT,
  target_epoch bigint NOT NULL CHECK (target_epoch > 0),
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN (
    'queued','leased','provider_unknown','neutralized','paid_reversal_pending',
    'paid_reversed','failed_retryable','failed_terminal'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  leased_at timestamptz,
  next_retry_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_type,subject_id,target_epoch)
);

ALTER TABLE public.checkout_sale_revocation_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkout_sale_revocation_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkout_sale_revocation_outbox TO service_role;
CREATE INDEX checkout_sale_revocation_work_idx
  ON public.checkout_sale_revocation_outbox(state,next_retry_at,created_at);

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN admission_epoch bigint,
  ADD COLUMN provider_attempt_id uuid REFERENCES public.ticket_checkout_provider_attempts(id) ON DELETE RESTRICT,
  ADD COLUMN provider_flow text CHECK (provider_flow IS NULL OR provider_flow IN (
    'stripe_native','stripe_checkout','paystack_redirect'
  )),
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_reason text,
  ADD COLUMN reversal_state text NOT NULL DEFAULT 'none' CHECK (reversal_state IN (
    'none','neutralization_pending','neutralized','paid_reversal_pending',
    'paid_reversed','failed_terminal'
  )),
  ADD COLUMN reversed_at timestamptz;

ALTER TABLE public.event_rsvp_contributions
  ADD COLUMN caller_idempotency_key text,
  ADD COLUMN admission_epoch bigint,
  ADD COLUMN provider_attempt_key text,
  ADD COLUMN provider_attempt_state text NOT NULL DEFAULT 'unclaimed' CHECK (
    provider_attempt_state IN ('unclaimed','claimed','provider_unknown','ready',
      'neutralization_pending','neutralized','paid_reversal_pending','paid_reversed','terminal_failed')
  ),
  ADD COLUMN provider_flow text CHECK (provider_flow IS NULL OR provider_flow IN (
    'stripe_native','stripe_checkout','paystack_redirect'
  )),
  ADD COLUMN provider_object_id text,
  ADD COLUMN provider_checkout_id text,
  ADD COLUMN provider_reference text,
  ADD COLUMN provider_request_fingerprint text,
  ADD COLUMN provider_continuation_fingerprint text,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_reason text,
  ADD COLUMN reversal_state text NOT NULL DEFAULT 'none' CHECK (reversal_state IN (
    'none','neutralization_pending','neutralized','paid_reversal_pending',
    'paid_reversed','failed_terminal'
  ));
CREATE UNIQUE INDEX event_rsvp_contributions_caller_idempotency_idx
  ON public.event_rsvp_contributions(event_id,caller_idempotency_key)
  WHERE caller_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX event_rsvp_contributions_provider_attempt_key_idx
  ON public.event_rsvp_contributions(provider_attempt_key)
  WHERE provider_attempt_key IS NOT NULL;
CREATE UNIQUE INDEX event_rsvp_contributions_provider_object_idx
  ON public.event_rsvp_contributions(provider_object_id)
  WHERE provider_object_id IS NOT NULL;
CREATE UNIQUE INDEX event_rsvp_contributions_provider_checkout_idx
  ON public.event_rsvp_contributions(provider_checkout_id)
  WHERE provider_checkout_id IS NOT NULL;

CREATE TABLE public.issue_1930_runtime_capability (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  enabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  evidence text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.issue_1930_runtime_capability(singleton,enabled)
VALUES (true,false);
ALTER TABLE public.issue_1930_runtime_capability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.issue_1930_runtime_capability FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.issue_1930_runtime_capability TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_checkout_transition_guard_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE((SELECT enabled FROM public.issue_1930_runtime_capability WHERE singleton),false)
$$;
REVOKE ALL ON FUNCTION public.issue_1930_checkout_transition_guard_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_checkout_transition_guard_ready() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_set_runtime_capability(
  p_enabled boolean, p_evidence text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
  IF p_enabled AND (p_evidence IS NULL OR char_length(trim(p_evidence)) < 20) THEN
    RAISE EXCEPTION 'runtime_evidence_required';
  END IF;
  UPDATE public.issue_1930_runtime_capability SET enabled=p_enabled,
    enabled_at=CASE WHEN p_enabled THEN now() ELSE NULL END,
    enabled_by=auth.uid(), evidence=left(p_evidence,500), updated_at=now()
  WHERE singleton;
  RETURN p_enabled;
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_set_runtime_capability(boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_set_runtime_capability(boolean,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_event_sale_reason(p_event public.events)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=public AS $$
BEGIN
  IF p_event.id IS NULL THEN RETURN 'event_missing'; END IF;
  IF p_event.deleted_at IS NOT NULL THEN RETURN 'event_deleted'; END IF;
  IF p_event.status NOT IN ('scheduled','live') THEN RETURN 'event_status'; END IF;
  IF p_event.visibility NOT IN ('public','hidden') THEN RETURN 'event_visibility'; END IF;
  IF p_event.event_type='trip' AND COALESCE(p_event.bookings_closed,false) THEN RETURN 'trip_closed'; END IF;
  IF p_event.event_type='trip' AND p_event.booking_deadline IS NOT NULL
     AND p_event.booking_deadline < now() THEN RETURN 'trip_deadline'; END IF;
  RETURN 'sellable';
END $$;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(
  p_session_id uuid, p_event_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event public.events%ROWTYPE; v_bad boolean;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF public.issue_1930_event_sale_reason(v_event) <> 'sellable' THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND s.event_id=p_event_id AND s.revoked_at IS NULL
      AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
  THEN RETURN false; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.ticket_checkout_session_items i
    LEFT JOIN public.ticket_types tt ON tt.id=i.ticket_type_id AND tt.event_id=p_event_id
    WHERE i.checkout_session_id=p_session_id AND (
      tt.id IS NULL OR tt.deleted_at IS NOT NULL OR tt.is_hidden OR tt.is_disabled
      OR NOT tt.available_online
      OR (tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now())
      OR (tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now())
      OR (NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL AND
        (SELECT count(*) FROM public.tickets sold
          WHERE sold.ticket_type_id=tt.id
            AND sold.status IN ('valid','used','transferred'))
        + (SELECT COALESCE(sum(reserved.quantity),0) FROM public.ticket_checkout_session_items reserved
            JOIN public.ticket_checkout_sessions active
              ON active.id=reserved.checkout_session_id
          WHERE reserved.ticket_type_id=tt.id
            AND active.id<>p_session_id
            AND active.expires_at>now()
            AND active.order_id IS NULL
            AND active.revoked_at IS NULL
            AND active.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
        + i.quantity > tt.quantity_total)
    )
  ) INTO v_bad;
  IF v_bad THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND (s.metadata->>'event_date_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.event_dates d
        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id
          AND d.end_at > now())) THEN RETURN false; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_claim_ticket_provider_attempt(
  p_checkout_session_id uuid,
  p_event_id uuid,
  p_provider text,
  p_flow text,
  p_request_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event public.events%ROWTYPE; v_session public.ticket_checkout_sessions%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE;
  v_attempt public.ticket_checkout_provider_attempts%ROWTYPE; v_reason text;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','revoked'); END IF;
  v_reason:=public.issue_1930_event_sale_reason(v_event);
  INSERT INTO public.event_checkout_admission_state(event_id,epoch,sellable,reason)
  VALUES(p_event_id,1,v_reason='sellable',v_reason)
  ON CONFLICT(event_id) DO UPDATE SET sellable=EXCLUDED.sellable,reason=EXCLUDED.reason
  RETURNING * INTO v_admission;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_checkout_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.event_id<>p_event_id
     OR NOT public.issue_1930_ticket_session_authorized(p_checkout_session_id,p_event_id) THEN
    IF FOUND AND v_session.revoked_at IS NULL THEN
      UPDATE public.ticket_checkout_sessions SET revoked_at=now(),revoked_reason=v_reason,
        reversal_state='neutralization_pending',status='failed',failed_at=now(),updated_at=now(),
        idempotency_key=idempotency_key||':revoked:'||id::text
      WHERE id=p_checkout_session_id;
    END IF;
    RETURN jsonb_build_object('outcome','revoked');
  END IF;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE checkout_session_id=p_checkout_session_id FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.provider<>p_provider OR v_attempt.flow<>p_flow
       OR v_attempt.request_fingerprint<>p_request_fingerprint THEN
      RETURN jsonb_build_object('outcome','flow_conflict');
    END IF;
    RETURN jsonb_build_object('outcome',CASE WHEN v_attempt.state='ready' THEN 'existing_ready'
      WHEN v_attempt.state='provider_unknown' THEN 'provider_unknown' ELSE 'in_progress' END,
      'attemptId',v_attempt.id,'epoch',v_attempt.claimed_epoch,
      'providerObjectId',v_attempt.provider_object_id,
      'providerCheckoutId',v_attempt.provider_checkout_id,
      'providerReference',v_attempt.provider_reference);
  END IF;
  INSERT INTO public.ticket_checkout_provider_attempts(
    checkout_session_id,event_id,brand_id,provider,flow,claimed_epoch,
    provider_idempotency_key,request_fingerprint)
  VALUES(p_checkout_session_id,p_event_id,v_session.brand_id,p_provider,p_flow,v_admission.epoch,
    'ticket_checkout:'||p_checkout_session_id::text||':'||p_flow,p_request_fingerprint)
  RETURNING * INTO v_attempt;
  UPDATE public.ticket_checkout_sessions SET admission_epoch=v_admission.epoch,
    provider_attempt_id=v_attempt.id,provider_flow=p_flow,updated_at=now()
  WHERE id=p_checkout_session_id;
  RETURN jsonb_build_object('outcome','fresh_claim','attemptId',v_attempt.id,
    'epoch',v_attempt.claimed_epoch,'idempotencyKey',v_attempt.provider_idempotency_key);
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_claim_ticket_provider_attempt(uuid,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_claim_ticket_provider_attempt(uuid,uuid,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_commit_ticket_provider_attempt(
  p_attempt_id uuid,p_claimed_epoch bigint,p_provider_object_id text,
  p_provider_checkout_id text,p_provider_reference text,p_continuation_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_attempt public.ticket_checkout_provider_attempts%ROWTYPE; v_event public.events%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE;
BEGIN
  SELECT e.* INTO v_event FROM public.ticket_checkout_provider_attempts a
    JOIN public.events e ON e.id=a.event_id WHERE a.id=p_attempt_id FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','missing'); END IF;
  SELECT * INTO v_admission FROM public.event_checkout_admission_state
    WHERE event_id=v_event.id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE id=p_attempt_id FOR UPDATE;
  IF v_attempt.claimed_epoch<>p_claimed_epoch OR v_admission.epoch<>p_claimed_epoch
     OR public.issue_1930_event_sale_reason(v_event)<>'sellable'
     OR NOT public.issue_1930_ticket_session_authorized(v_attempt.checkout_session_id,v_event.id) THEN
    UPDATE public.ticket_checkout_provider_attempts SET state='neutralization_pending',
      provider_object_id=COALESCE(provider_object_id,p_provider_object_id),
      provider_checkout_id=COALESCE(provider_checkout_id,p_provider_checkout_id),
      provider_reference=COALESCE(provider_reference,p_provider_reference),
      continuation_fingerprint=COALESCE(continuation_fingerprint,p_continuation_fingerprint),
      updated_at=now()
      WHERE id=p_attempt_id AND state NOT IN ('neutralized','paid_reversed');
    INSERT INTO public.checkout_sale_revocation_outbox(
      subject_type,subject_id,event_id,provider_attempt_id,target_epoch,reason)
    VALUES('ticket_checkout_session',v_attempt.checkout_session_id,v_event.id,v_attempt.id,
      GREATEST(v_admission.epoch,p_claimed_epoch),'commit_epoch_lost') ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('outcome','revoked');
  END IF;
  UPDATE public.ticket_checkout_provider_attempts SET state='ready',
    provider_object_id=COALESCE(provider_object_id,p_provider_object_id),
    provider_checkout_id=COALESCE(provider_checkout_id,p_provider_checkout_id),
    provider_reference=COALESCE(provider_reference,p_provider_reference),
    continuation_fingerprint=p_continuation_fingerprint,ready_at=COALESCE(ready_at,now()),updated_at=now()
  WHERE id=p_attempt_id AND state IN ('claimed','provider_unknown','ready');
  RETURN jsonb_build_object('outcome','ready');
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_commit_ticket_provider_attempt(uuid,bigint,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_commit_ticket_provider_attempt(uuid,bigint,text,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_mark_ticket_provider_unknown(
  p_attempt_id uuid,p_claimed_epoch bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.ticket_checkout_provider_attempts SET state='provider_unknown',updated_at=now()
    WHERE id=p_attempt_id AND claimed_epoch=p_claimed_epoch AND state='claimed';
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_mark_ticket_provider_unknown(uuid,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_mark_ticket_provider_unknown(uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_preflight(
  p_checkout_session_id uuid,p_buyer_status_token_hash text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_event public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_checkout_session_id;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=v_session.event_id FOR UPDATE;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_checkout_session_id FOR UPDATE;
  IF v_session.buyer_status_token_hash IS DISTINCT FROM p_buyer_status_token_hash THEN
    RETURN 'forbidden';
  END IF;
  IF NOT public.issue_1930_ticket_session_authorized(v_session.id,v_session.event_id) THEN
    RETURN 'unavailable';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_provider_attempts a
    WHERE a.id=v_session.provider_attempt_id AND a.state='ready'
      AND a.claimed_epoch=v_session.admission_epoch) THEN RETURN 'in_progress'; END IF;
  RETURN 'present_allowed';
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_preflight(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_preflight(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_rsvp_contribution_authorized(
  p_contribution_id uuid,p_event_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event public.events%ROWTYPE; v_contribution public.event_rsvp_contributions%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR public.issue_1930_event_sale_reason(v_event)<>'sellable'
     OR v_event.event_type<>'rsvp' OR NOT COALESCE(v_event.rsvp_contribution_enabled,false)
  THEN RETURN false; END IF;
  SELECT * INTO v_contribution FROM public.event_rsvp_contributions
    WHERE id=p_contribution_id FOR UPDATE;
  RETURN FOUND AND v_contribution.event_id=p_event_id
    AND (v_contribution.status='pending' OR
      (v_contribution.status='failed' AND
       v_contribution.provider_attempt_state='provider_unknown'))
    AND v_contribution.revoked_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_rsvp_contribution_authorized(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_rsvp_contribution_authorized(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_claim_rsvp_provider_attempt(
  p_contribution_id uuid,p_event_id uuid,p_flow text,p_request_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event public.events%ROWTYPE; v_c public.event_rsvp_contributions%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE; v_key text;
BEGIN
  IF p_flow NOT IN ('stripe_native','stripe_checkout','paystack_redirect')
     OR p_request_fingerprint IS NULL OR char_length(p_request_fingerprint)<16 THEN
    RETURN jsonb_build_object('outcome','flow_conflict');
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','revoked'); END IF;
  INSERT INTO public.event_checkout_admission_state(event_id,epoch,sellable,reason)
  VALUES(p_event_id,1,public.issue_1930_event_sale_reason(v_event)='sellable',
    public.issue_1930_event_sale_reason(v_event))
  ON CONFLICT(event_id) DO UPDATE SET sellable=EXCLUDED.sellable,reason=EXCLUDED.reason
  RETURNING * INTO v_admission;
  SELECT * INTO v_c FROM public.event_rsvp_contributions
    WHERE id=p_contribution_id FOR UPDATE;
  IF NOT FOUND OR v_c.event_id<>p_event_id
     OR NOT public.issue_1930_rsvp_contribution_authorized(p_contribution_id,p_event_id) THEN
    RETURN jsonb_build_object('outcome','revoked');
  END IF;
  IF v_c.provider_attempt_key IS NOT NULL THEN
    IF v_c.provider_flow<>p_flow OR v_c.provider_request_fingerprint<>p_request_fingerprint THEN
      RETURN jsonb_build_object('outcome','flow_conflict');
    END IF;
    RETURN jsonb_build_object('outcome',CASE
      WHEN v_c.provider_attempt_state='ready' THEN 'existing_ready'
      WHEN v_c.provider_attempt_state='provider_unknown' THEN 'provider_unknown'
      ELSE 'in_progress' END,'epoch',v_c.admission_epoch,
      'idempotencyKey',v_c.provider_attempt_key,
      'providerObjectId',v_c.provider_object_id,
      'providerCheckoutId',v_c.provider_checkout_id,
      'providerReference',v_c.provider_reference);
  END IF;
  v_key:='rsvp_contribution:'||p_contribution_id::text||':'||p_flow;
  UPDATE public.event_rsvp_contributions SET admission_epoch=v_admission.epoch,
    provider_attempt_key=v_key,provider_attempt_state='claimed',provider_flow=p_flow,
    provider_request_fingerprint=p_request_fingerprint,updated_at=now()
    WHERE id=p_contribution_id;
  RETURN jsonb_build_object('outcome','fresh_claim','epoch',v_admission.epoch,
    'idempotencyKey',v_key);
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_claim_rsvp_provider_attempt(uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_claim_rsvp_provider_attempt(uuid,uuid,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_commit_rsvp_provider_attempt(
  p_contribution_id uuid,p_claimed_epoch bigint,p_provider_object_id text,
  p_provider_checkout_id text,p_provider_reference text,p_continuation_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event public.events%ROWTYPE; v_c public.event_rsvp_contributions%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE;
BEGIN
  SELECT e.* INTO v_event FROM public.event_rsvp_contributions c
    JOIN public.events e ON e.id=c.event_id WHERE c.id=p_contribution_id FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','missing'); END IF;
  SELECT * INTO v_admission FROM public.event_checkout_admission_state
    WHERE event_id=v_event.id FOR UPDATE;
  SELECT * INTO v_c FROM public.event_rsvp_contributions
    WHERE id=p_contribution_id FOR UPDATE;
  IF v_c.admission_epoch IS DISTINCT FROM p_claimed_epoch
     OR v_admission.epoch IS DISTINCT FROM p_claimed_epoch
     OR NOT public.issue_1930_rsvp_contribution_authorized(v_c.id,v_event.id) THEN
    UPDATE public.event_rsvp_contributions SET
      provider_attempt_state='neutralization_pending',
      provider_object_id=COALESCE(provider_object_id,p_provider_object_id),
      provider_checkout_id=COALESCE(provider_checkout_id,p_provider_checkout_id),
      provider_reference=COALESCE(provider_reference,p_provider_reference),
      provider_continuation_fingerprint=COALESCE(
        provider_continuation_fingerprint,p_continuation_fingerprint),
      revoked_at=COALESCE(revoked_at,now()),revoked_reason=COALESCE(revoked_reason,'commit_epoch_lost'),
      reversal_state=CASE WHEN reversal_state='none' THEN 'neutralization_pending' ELSE reversal_state END,
      status='failed',updated_at=now() WHERE id=v_c.id;
    INSERT INTO public.checkout_sale_revocation_outbox(
      subject_type,subject_id,event_id,target_epoch,reason)
    VALUES('rsvp_contribution',v_c.id,v_event.id,GREATEST(v_admission.epoch,p_claimed_epoch),
      'commit_epoch_lost') ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('outcome','revoked');
  END IF;
  UPDATE public.event_rsvp_contributions SET provider_attempt_state='ready',
    provider_object_id=COALESCE(provider_object_id,p_provider_object_id),
    provider_checkout_id=COALESCE(provider_checkout_id,p_provider_checkout_id),
    provider_reference=COALESCE(provider_reference,p_provider_reference),
    provider_continuation_fingerprint=p_continuation_fingerprint,
    status=CASE WHEN status='failed' THEN 'pending' ELSE status END,updated_at=now()
    WHERE id=v_c.id AND provider_attempt_state IN ('claimed','provider_unknown','ready');
  RETURN jsonb_build_object('outcome','ready');
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_commit_rsvp_provider_attempt(uuid,bigint,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_commit_rsvp_provider_attempt(uuid,bigint,text,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_mark_rsvp_provider_unknown(
  p_contribution_id uuid,p_claimed_epoch bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.event_rsvp_contributions SET provider_attempt_state='provider_unknown',
    status='pending',updated_at=now()
    WHERE id=p_contribution_id AND admission_epoch=p_claimed_epoch
      AND provider_attempt_state='claimed';
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_mark_rsvp_provider_unknown(uuid,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_mark_rsvp_provider_unknown(uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_revoke_event_checkout_admissions(
  p_event_id uuid,p_reason text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_epoch bigint; v_count integer;
BEGIN
  INSERT INTO public.event_checkout_admission_state(event_id,epoch,sellable,reason,changed_at)
  VALUES(p_event_id,1,false,left(p_reason,40),now())
  ON CONFLICT(event_id) DO UPDATE SET epoch=event_checkout_admission_state.epoch+1,
    sellable=false,reason=EXCLUDED.reason,changed_at=now()
  RETURNING epoch INTO v_epoch;
  WITH changed AS (
    UPDATE public.ticket_checkout_sessions s SET revoked_at=COALESCE(revoked_at,now()),
      revoked_reason=COALESCE(revoked_reason,left(p_reason,80)),
      reversal_state=CASE WHEN reversal_state='none' THEN 'neutralization_pending' ELSE reversal_state END,
      status='failed',failed_at=COALESCE(failed_at,now()),updated_at=now(),
      idempotency_key=CASE WHEN revoked_at IS NULL THEN idempotency_key||':revoked:'||id::text ELSE idempotency_key END
    WHERE s.event_id=p_event_id AND s.order_id IS NULL AND s.revoked_at IS NULL
      AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
    RETURNING s.id,s.provider_attempt_id
  ), queued AS (
    INSERT INTO public.checkout_sale_revocation_outbox(
      subject_type,subject_id,event_id,provider_attempt_id,target_epoch,reason)
    SELECT 'ticket_checkout_session',id,p_event_id,provider_attempt_id,v_epoch,left(p_reason,80)
    FROM changed ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_count FROM changed;
  UPDATE public.ticket_checkout_provider_attempts SET state='neutralization_pending',updated_at=now()
    WHERE event_id=p_event_id AND state IN ('claimed','provider_unknown','ready');
  WITH changed AS (
    UPDATE public.event_rsvp_contributions c SET revoked_at=COALESCE(revoked_at,now()),
      revoked_reason=COALESCE(revoked_reason,left(p_reason,80)),
      reversal_state=CASE WHEN reversal_state='none' THEN 'neutralization_pending' ELSE reversal_state END,
      provider_attempt_state=CASE
        WHEN provider_attempt_state IN ('claimed','provider_unknown','ready') THEN 'neutralization_pending'
        ELSE provider_attempt_state END,
      status='failed',updated_at=now()
    WHERE c.event_id=p_event_id AND c.revoked_at IS NULL AND c.status='pending'
    RETURNING c.id
  ) INSERT INTO public.checkout_sale_revocation_outbox(
    subject_type,subject_id,event_id,target_epoch,reason)
    SELECT 'rsvp_contribution',id,p_event_id,v_epoch,left(p_reason,80) FROM changed
    ON CONFLICT DO NOTHING;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_revoke_event_checkout_admissions(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_revoke_event_checkout_admissions(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_claim_revocations(
  p_worker_id text,p_limit integer DEFAULT 25
) RETURNS SETOF public.checkout_sale_revocation_outbox LANGUAGE plpgsql
SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN QUERY WITH candidates AS (
    SELECT id FROM public.checkout_sale_revocation_outbox
    WHERE state IN ('queued','failed_retryable','provider_unknown')
      AND (next_retry_at IS NULL OR next_retry_at<=now())
      AND (leased_at IS NULL OR leased_at<now()-interval '5 minutes')
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),50)
  ), claimed AS (
    UPDATE public.checkout_sale_revocation_outbox o SET state='leased',
      lease_owner=left(p_worker_id,120),leased_at=now(),attempt_count=attempt_count+1,updated_at=now()
    FROM candidates c WHERE o.id=c.id RETURNING o.*
  ) SELECT * FROM claimed;
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_claim_revocations(text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_claim_revocations(text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_record_revocation_result(
  p_outbox_id uuid,p_worker_id text,p_state text,p_error_code text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_outbox public.checkout_sale_revocation_outbox%ROWTYPE;
BEGIN
  IF p_state NOT IN ('neutralized','provider_unknown','paid_reversal_pending','paid_reversed','failed_retryable','failed_terminal')
    THEN RAISE EXCEPTION 'invalid_revocation_state'; END IF;
  UPDATE public.checkout_sale_revocation_outbox SET state=p_state,lease_owner=NULL,leased_at=NULL,
    next_retry_at=CASE WHEN p_state IN ('provider_unknown','failed_retryable')
      THEN now()+LEAST(interval '1 hour',interval '30 seconds'*(2^LEAST(attempt_count,7))) ELSE NULL END,
    last_error_code=CASE WHEN p_error_code ~ '^[a-z0-9_]{3,80}$' THEN p_error_code ELSE NULL END,
    updated_at=now() WHERE id=p_outbox_id AND lease_owner=p_worker_id
    RETURNING * INTO v_outbox;
  IF FOUND AND v_outbox.subject_type='rsvp_contribution' THEN
    UPDATE public.event_rsvp_contributions SET
      provider_attempt_state=CASE p_state
        WHEN 'neutralized' THEN 'neutralized'
        WHEN 'paid_reversal_pending' THEN 'paid_reversal_pending'
        WHEN 'paid_reversed' THEN 'paid_reversed'
        WHEN 'failed_terminal' THEN 'terminal_failed'
        ELSE 'provider_unknown' END,
      updated_at=now() WHERE id=v_outbox.subject_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_record_revocation_result(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_record_revocation_result(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_events_revoke_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF (OLD.status,OLD.visibility,OLD.deleted_at,OLD.booking_deadline,OLD.bookings_closed,
        OLD.rsvp_contribution_enabled)
     IS DISTINCT FROM
     (NEW.status,NEW.visibility,NEW.deleted_at,NEW.booking_deadline,NEW.bookings_closed,
        NEW.rsvp_contribution_enabled) THEN
    PERFORM public.issue_1930_revoke_event_checkout_admissions(NEW.id,
      public.issue_1930_event_sale_reason(NEW));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS issue_1930_events_revoke ON public.events;
CREATE TRIGGER issue_1930_events_revoke AFTER UPDATE OF status,visibility,deleted_at,
  booking_deadline,bookings_closed,rsvp_contribution_enabled ON public.events FOR EACH ROW
  EXECUTE FUNCTION public.issue_1930_events_revoke_trigger();

CREATE OR REPLACE FUNCTION public.issue_1930_child_sale_revoke_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    v_event_id:=OLD.event_id;
    PERFORM 1 FROM public.events WHERE id=OLD.event_id FOR UPDATE;
    PERFORM public.issue_1930_revoke_event_checkout_admissions(OLD.event_id,'inventory_changed');
    RETURN OLD;
  END IF;
  v_event_id:=NEW.event_id;
  IF OLD.event_id IS DISTINCT FROM NEW.event_id THEN
    -- Claims/finalizers lock event authority first. Reassignments must lock and
    -- revoke both authorities in the same UUID order so simultaneous A->B and
    -- B->A moves cannot invert the checkout lock graph.
    PERFORM 1 FROM public.events
      WHERE id IN (OLD.event_id,NEW.event_id) ORDER BY id FOR UPDATE;
    IF OLD.event_id<NEW.event_id THEN
      PERFORM public.issue_1930_revoke_event_checkout_admissions(OLD.event_id,'inventory_changed');
      PERFORM public.issue_1930_revoke_event_checkout_admissions(NEW.event_id,'inventory_changed');
    ELSE
      PERFORM public.issue_1930_revoke_event_checkout_admissions(NEW.event_id,'inventory_changed');
      PERFORM public.issue_1930_revoke_event_checkout_admissions(OLD.event_id,'inventory_changed');
    END IF;
    RETURN NEW;
  END IF;
  -- Branch on the relation before touching table-specific OLD/NEW fields.
  -- PostgreSQL resolves record attributes before boolean short-circuiting, so
  -- combining the relation predicate with OLD.deleted_at is not table-safe.
  IF TG_TABLE_NAME='ticket_types' THEN
    IF (OLD.event_id,OLD.deleted_at,OLD.is_hidden,OLD.is_disabled,OLD.available_online,
        OLD.sale_start_at,OLD.sale_end_at,OLD.quantity_total,OLD.is_unlimited)
      IS DISTINCT FROM
      (NEW.event_id,NEW.deleted_at,NEW.is_hidden,NEW.is_disabled,NEW.available_online,
        NEW.sale_start_at,NEW.sale_end_at,NEW.quantity_total,NEW.is_unlimited) THEN
      PERFORM 1 FROM public.events WHERE id=v_event_id FOR UPDATE;
      PERFORM public.issue_1930_revoke_event_checkout_admissions(v_event_id,'inventory_changed');
    END IF;
  ELSIF TG_TABLE_NAME='event_dates' THEN
    IF (OLD.event_id,OLD.start_at,OLD.end_at)
      IS DISTINCT FROM (NEW.event_id,NEW.start_at,NEW.end_at) THEN
      PERFORM 1 FROM public.events WHERE id=v_event_id FOR UPDATE;
      PERFORM public.issue_1930_revoke_event_checkout_admissions(v_event_id,'inventory_changed');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS issue_1930_ticket_types_revoke ON public.ticket_types;
CREATE TRIGGER issue_1930_ticket_types_revoke AFTER UPDATE OF event_id,deleted_at,is_hidden,
  is_disabled,available_online,sale_start_at,sale_end_at,quantity_total,is_unlimited OR DELETE
  ON public.ticket_types
  FOR EACH ROW EXECUTE FUNCTION public.issue_1930_child_sale_revoke_trigger();
DROP TRIGGER IF EXISTS issue_1930_event_dates_revoke ON public.event_dates;
CREATE TRIGGER issue_1930_event_dates_revoke AFTER UPDATE OF event_id,start_at,end_at OR DELETE
  ON public.event_dates FOR EACH ROW EXECUTE FUNCTION public.issue_1930_child_sale_revoke_trigger();

-- Extend the canonical source-refund vocabulary for provider-verified late
-- ticket charges. Exact subject write-back is re-emitted below by this issue.
ALTER TABLE public.source_refunds DROP CONSTRAINT source_refunds_source_type_check;
ALTER TABLE public.source_refunds DROP CONSTRAINT source_refunds_refund_kind_check;
ALTER TABLE public.source_refunds DROP CONSTRAINT source_refunds_source_shape;
ALTER TABLE public.source_refunds ADD CONSTRAINT source_refunds_source_type_check CHECK (
  source_type IN ('venue_reservation','rsvp_contribution','stay_reservation',
    'venue_menu_order','ticket_checkout_session'));
ALTER TABLE public.source_refunds ADD CONSTRAINT source_refunds_refund_kind_check CHECK (
  refund_kind IN ('venue_eligible_cancel','rsvp_discretionary','event_cancel','stay_cancellation',
    'venue_order_guest_cancel','venue_order_venue_approved','late_payment_no_value'));
ALTER TABLE public.source_refunds ADD CONSTRAINT source_refunds_source_shape CHECK (
  (source_type='venue_reservation' AND venue_id IS NOT NULL AND event_id IS NULL)
  OR (source_type='rsvp_contribution' AND event_id IS NOT NULL AND venue_id IS NULL AND source_id=subject_id)
  OR (source_type='stay_reservation' AND venue_id IS NOT NULL AND event_id IS NULL)
  OR (source_type='venue_menu_order' AND venue_id IS NOT NULL AND event_id IS NULL)
  OR (source_type='ticket_checkout_session' AND event_id IS NOT NULL AND venue_id IS NULL AND source_id=subject_id));

-- Provider success can arrive after the event lock revoked the sale. Mint the
-- one canonical full reversal while the event and session are still locked;
-- never manufacture an order merely because a provider reported success.
CREATE OR REPLACE FUNCTION public.issue_1930_mint_ticket_late_reversal(
  p_checkout_session_id uuid,p_provider_payment_reference text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_provider text;
  v_refund_id uuid; v_fee integer;
BEGIN
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_checkout_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.order_id IS NOT NULL THEN RETURN NULL; END IF;
  SELECT CASE WHEN payment_provider='paystack' THEN 'paystack' ELSE 'stripe' END
    INTO v_provider FROM public.brands WHERE id=v_session.brand_id;
  v_fee:=LEAST(v_session.total_cents,COALESCE(v_session.application_fee_amount_cents,0));
  INSERT INTO public.source_refunds(
    source_type,source_id,subject_id,brand_id,event_id,refund_kind,
    requested_by_type,reason,provider,currency,original_charge_cents,
    buyer_refund_requested_cents,original_application_fee_cents,
    fee_reversal_required_cents,fee_state,fee_leg_kind,financial_state,
    organizer_refund_liability_cents,platform_fee_absorption_cents,
    provider_payment_reference,provider_account_reference,idempotency_key)
  VALUES('ticket_checkout_session',v_session.id,v_session.id,v_session.brand_id,
    v_session.event_id,'late_payment_no_value','system','Late payment after sale closure',
    v_provider,upper(v_session.currency),v_session.total_cents,v_session.total_cents,
    v_fee,v_fee,CASE WHEN v_fee=0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee=0 THEN 'not_required' WHEN v_provider='stripe'
      THEN 'stripe_application_fee_refund' ELSE 'paystack_ledger_allocation' END,
    'pending',v_session.total_cents-v_fee,v_fee,p_provider_payment_reference,
    v_session.stripe_account_id,'late-payment-no-value:'||v_session.id)
  ON CONFLICT(source_type,source_id,refund_kind) DO UPDATE
    SET provider_payment_reference=public.source_refunds.provider_payment_reference
  RETURNING id INTO v_refund_id;
  INSERT INTO public.source_refund_ledger_allocations(
    refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key)
  SELECT v_refund_id,x.kind,x.amount,upper(v_session.currency),v_provider,'prepared',
    'source-refund-allocation:'||x.key||':'||v_refund_id
  FROM (VALUES
    ('buyer_refund',v_session.total_cents,'buyer'),
    ('organizer_refund_liability',v_session.total_cents-v_fee,'organizer'),
    ('platform_application_fee_reversal',v_fee,'platform')) x(kind,amount,key)
  WHERE x.amount>0 ON CONFLICT(idempotency_key) DO NOTHING;
  UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',
    status='failed',failed_at=COALESCE(failed_at,now()),updated_at=now()
    WHERE id=v_session.id AND order_id IS NULL;
  UPDATE public.ticket_checkout_provider_attempts SET state='paid_reversal_pending',updated_at=now()
    WHERE id=v_session.provider_attempt_id AND state<>'paid_reversed';
  RETURN v_refund_id;
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_mint_ticket_late_reversal(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_mint_ticket_late_reversal(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_mint_rsvp_late_reversal(
  p_contribution_id uuid,p_provider_payment_reference text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_c public.event_rsvp_contributions%ROWTYPE; v_refund_id uuid; v_fee integer;
  v_account text;
BEGIN
  SELECT * INTO v_c FROM public.event_rsvp_contributions
    WHERE id=p_contribution_id FOR UPDATE;
  IF NOT FOUND OR v_c.status='paid' THEN RETURN NULL; END IF;
  v_fee:=LEAST(v_c.buyer_total_cents,COALESCE(v_c.application_fee_amount_cents,0));
  SELECT stripe_connect_id INTO v_account FROM public.brands WHERE id=v_c.brand_id;
  INSERT INTO public.source_refunds(
    source_type,source_id,subject_id,brand_id,event_id,refund_kind,requested_by_type,
    reason,provider,currency,original_charge_cents,buyer_refund_requested_cents,
    original_application_fee_cents,fee_reversal_required_cents,fee_state,fee_leg_kind,
    financial_state,organizer_refund_liability_cents,platform_fee_absorption_cents,
    provider_payment_reference,provider_account_reference,idempotency_key)
  VALUES('rsvp_contribution',v_c.id,v_c.id,v_c.brand_id,v_c.event_id,'event_cancel',
    'system','Late RSVP contribution after sale closure',v_c.provider,upper(v_c.currency),
    v_c.buyer_total_cents,v_c.buyer_total_cents,v_fee,v_fee,
    CASE WHEN v_fee=0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee=0 THEN 'not_required' WHEN v_c.provider='stripe'
      THEN 'stripe_application_fee_refund' ELSE 'paystack_ledger_allocation' END,
    'pending',v_c.buyer_total_cents-v_fee,v_fee,p_provider_payment_reference,v_account,
    'rsvp-late-payment-no-value:'||v_c.id)
  ON CONFLICT(source_type,source_id,refund_kind) DO UPDATE
    SET provider_payment_reference=public.source_refunds.provider_payment_reference
  RETURNING id INTO v_refund_id;
  INSERT INTO public.source_refund_ledger_allocations(
    refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key)
  SELECT v_refund_id,x.kind,x.amount,upper(v_c.currency),v_c.provider,'prepared',
    'source-refund-allocation:'||x.key||':'||v_refund_id
  FROM (VALUES('buyer_refund',v_c.buyer_total_cents,'buyer'),
    ('organizer_refund_liability',v_c.buyer_total_cents-v_fee,'organizer'),
    ('platform_application_fee_reversal',v_fee,'platform')) x(kind,amount,key)
  WHERE x.amount>0 ON CONFLICT(idempotency_key) DO NOTHING;
  UPDATE public.event_rsvp_contributions SET status='failed',
    reversal_state='paid_reversal_pending',provider_attempt_state='paid_reversal_pending',
    updated_at=now() WHERE id=v_c.id;
  RETURN v_refund_id;
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_mint_rsvp_late_reversal(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_mint_rsvp_late_reversal(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_finalize_rsvp_contribution(
  p_contribution_id uuid,p_provider_ref text,p_charge_id text,p_payment_method_type text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_c public.event_rsvp_contributions%ROWTYPE; v_event public.events%ROWTYPE;
BEGIN
  SELECT e.* INTO v_event FROM public.event_rsvp_contributions c
    JOIN public.events e ON e.id=c.event_id WHERE c.id=p_contribution_id FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  SELECT * INTO v_c FROM public.event_rsvp_contributions WHERE id=p_contribution_id FOR UPDATE;
  IF v_c.status='paid' THEN RETURN jsonb_build_object('outcome','finalized'); END IF;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable'
     OR v_event.event_type<>'rsvp' OR NOT COALESCE(v_event.rsvp_contribution_enabled,false)
     OR v_c.revoked_at IS NOT NULL THEN
    PERFORM public.issue_1930_mint_rsvp_late_reversal(v_c.id,p_provider_ref);
    RETURN jsonb_build_object('outcome','paid_reversal_pending');
  END IF;
  PERFORM public.finalize_rsvp_contribution(
    p_contribution_id,p_provider_ref,p_charge_id,p_payment_method_type);
  RETURN jsonb_build_object('outcome','finalized');
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_finalize_rsvp_contribution(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_finalize_rsvp_contribution(uuid,text,text,text)
  TO service_role;

-- The current finalize implementation remains byte-for-behavior for valid
-- sales. This event-first wrapper adds the missing epoch/current-truth CAS and
-- is the only finalize entrypoint available to edge functions after #1930.
ALTER FUNCTION public.biz_ticket_checkout_finalize(
  uuid,text,text,text,text,text,text,boolean)
  RENAME TO issue_1930_ticket_checkout_finalize_base;
CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(
  p_checkout_session_id uuid,p_stripe_payment_intent_id text,
  p_stripe_charge_id text,p_stripe_payment_method_type text,p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,p_installment_plan_root boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_event public.events%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE; v_result jsonb;
BEGIN
  SELECT e.* INTO v_event FROM public.ticket_checkout_sessions s
    JOIN public.events e ON e.id=s.event_id WHERE s.id=p_checkout_session_id FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_checkout_session_id FOR UPDATE;
  IF v_session.order_id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome','finalized','orderId',v_session.order_id);
  END IF;
  SELECT * INTO v_admission FROM public.event_checkout_admission_state
    WHERE event_id=v_event.id FOR UPDATE;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable'
     OR v_session.revoked_at IS NOT NULL
     OR v_session.admission_epoch IS NULL
     OR v_admission.epoch<>v_session.admission_epoch
     OR NOT public.issue_1930_ticket_session_authorized(v_session.id,v_event.id) THEN
    PERFORM public.issue_1930_mint_ticket_late_reversal(v_session.id,
      COALESCE(p_stripe_charge_id,p_stripe_payment_intent_id,'provider-success'));
    RETURN jsonb_build_object('outcome','paid_reversal_pending');
  END IF;
  v_result:=public.issue_1930_ticket_checkout_finalize_base(p_checkout_session_id,
    p_stripe_payment_intent_id,p_stripe_charge_id,p_stripe_payment_method_type,
    p_qr_token_pepper,p_stripe_customer_id_on_connected_account,
    p_saved_payment_method_id,p_installment_plan_root);
  RETURN jsonb_build_object('outcome','finalized')||COALESCE(v_result,'{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  uuid,text,text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  uuid,text,text,text,text,text,text,boolean) TO service_role;

-- Extend the canonical recorder without copying its large, already-proven
-- provider-event state machine. The renamed base remains byte-identical; this
-- public wrapper adds the explicit ticket-session write-back in the same DB
-- transaction and never routes through RSVP.
ALTER FUNCTION public.record_source_refund_provider_event(
  uuid,text,integer,text,text,text,text,integer,text,text)
  RENAME TO issue_1930_record_source_refund_provider_event_base;
CREATE OR REPLACE FUNCTION public.record_source_refund_provider_event(
  p_refund_id uuid,p_leg_type text,p_attempt_no integer,p_event_key text,
  p_provider_event_type text,p_provider_event_id text,p_next_state text,
  p_amount_observed_cents integer,p_provider_operation_id text DEFAULT NULL,
  p_safe_reason_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_refund public.source_refunds%ROWTYPE; v_result jsonb;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_refund FROM public.source_refunds WHERE id=p_refund_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  v_result:=public.issue_1930_record_source_refund_provider_event_base(
    p_refund_id,p_leg_type,p_attempt_no,p_event_key,p_provider_event_type,
    p_provider_event_id,p_next_state,p_amount_observed_cents,
    p_provider_operation_id,p_safe_reason_code);
  IF v_refund.source_type='ticket_checkout_session'
     AND p_leg_type='buyer_refund' AND p_next_state='processed' THEN
    UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversed',
      reversed_at=COALESCE(reversed_at,now()),updated_at=now()
    WHERE id=v_refund.subject_id AND reversal_state='paid_reversal_pending' AND order_id IS NULL;
    UPDATE public.ticket_checkout_provider_attempts SET state='paid_reversed',
      reversed_at=COALESCE(reversed_at,now()),updated_at=now()
    WHERE checkout_session_id=v_refund.subject_id AND state='paid_reversal_pending';
  ELSIF v_refund.source_type='ticket_checkout_session'
     AND p_leg_type='buyer_refund' AND p_next_state='failed_terminal' THEN
    UPDATE public.ticket_checkout_sessions SET reversal_state='failed_terminal',updated_at=now()
    WHERE id=v_refund.subject_id AND order_id IS NULL;
    UPDATE public.ticket_checkout_provider_attempts SET state='terminal_failed',updated_at=now()
    WHERE checkout_session_id=v_refund.subject_id AND state='paid_reversal_pending';
  ELSIF v_refund.source_type='rsvp_contribution'
     AND p_leg_type='buyer_refund' AND p_next_state='processed' THEN
    UPDATE public.event_rsvp_contributions SET reversal_state='paid_reversed',
      provider_attempt_state='paid_reversed',updated_at=now()
    WHERE id=v_refund.subject_id AND reversal_state='paid_reversal_pending';
  ELSIF v_refund.source_type='rsvp_contribution'
     AND p_leg_type='buyer_refund' AND p_next_state='failed_terminal' THEN
    UPDATE public.event_rsvp_contributions SET reversal_state='failed_terminal',
      provider_attempt_state='terminal_failed',updated_at=now()
    WHERE id=v_refund.subject_id;
  END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.record_source_refund_provider_event(
  uuid,text,integer,text,text,text,text,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_source_refund_provider_event(
  uuid,text,integer,text,text,text,text,integer,text,text) TO service_role;

-- Initial truth/backfill. Invalid nonterminal sessions are revoked without any
-- provider call; the outbox is processed only after the compatibility deploy.
INSERT INTO public.event_checkout_admission_state(event_id,epoch,sellable,reason)
SELECT e.id,1,public.issue_1930_event_sale_reason(e)='sellable',public.issue_1930_event_sale_reason(e)
FROM public.events e ON CONFLICT(event_id) DO NOTHING;
SELECT public.issue_1930_revoke_event_checkout_admissions(e.id,public.issue_1930_event_sale_reason(e))
FROM public.events e WHERE public.issue_1930_event_sale_reason(e)<>'sellable';

-- Put current event truth ahead of the legacy create function's idempotency
-- replay. The renamed implementation remains the single pricing/capacity owner.
ALTER FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text)
  RENAME TO issue_1930_ticket_checkout_create_session_base;
CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,p_buyer_user_id uuid,p_buyer_name text,p_buyer_email text,
  p_buyer_phone_e164 text,p_marketing_opt_in boolean,p_lines jsonb,
  p_idempotency_key text,p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,p_payment_plan_choice text DEFAULT 'auto'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  -- Preserve the canonical fresh-checkout error vocabulary consumed by the
  -- #1929 direct-checkout clients. Current truth still runs before the legacy
  -- idempotency owner; only the public token remains backward-compatible.
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;
  RETURN public.issue_1930_ticket_checkout_create_session_base(
    p_event_id,p_buyer_user_id,p_buyer_name,p_buyer_email,p_buyer_phone_e164,
    p_marketing_opt_in,p_lines,p_idempotency_key,p_expires_at,
    p_application_fee_amount_cents,p_payment_plan_choice);
END $$;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(
  uuid,text,text,text,text,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(
  uuid,text,text,text,text,text,text,boolean) TO service_role;

COMMENT ON TABLE public.ticket_checkout_provider_attempts IS
  '#1930: one stable provider attempt per checkout; no client secret or raw continuation is stored.';
COMMENT ON TABLE public.checkout_sale_revocation_outbox IS
  '#1930: durable provider-neutralization/reversal work; transition commits never call providers.';
