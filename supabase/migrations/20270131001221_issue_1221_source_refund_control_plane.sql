-- Issue #1221 — venue / RSVP typed refund control plane.
-- Ordered after the shipped #1384/#1397 shared currency migrations.
-- This migration deliberately does not alter order, ticket, trip, or Stay refund paths.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.reservation_checkout_sessions
  ADD COLUMN IF NOT EXISTS application_fee_amount_cents integer
    CHECK (application_fee_amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS pricing_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS guest_cancel_token_hash text;

INSERT INTO public.notification_categories(
  key,section,is_transactional,urgency,default_channels,reach_mode
) VALUES
  ('source_refund_buyer_state','Purchases',true,'high',
   ARRAY['inapp','push','email','sms'],'reach_once'),
  ('source_refund_brand_state','Purchases',true,'high',
   ARRAY['inapp','push','email','sms'],'reach_once')
ON CONFLICT(key) DO UPDATE SET
  is_transactional=excluded.is_transactional,
  urgency=excluded.urgency,
  default_channels=excluded.default_channels,
  reach_mode=excluded.reach_mode;

-- v1 is the only live guest-token authority. Abort on conflicting legacy copies.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reservation_checkout_sessions s
    JOIN public.reservations r ON r.id = s.reservation_id
    WHERE s.guest_cancel_token IS NOT NULL
      AND r.guest_cancel_token IS NOT NULL
      AND s.guest_cancel_token <> r.guest_cancel_token
  ) THEN
    RAISE EXCEPTION 'issue_1221_guest_token_conflict';
  END IF;
END $$;

UPDATE public.reservation_checkout_sessions s
SET guest_cancel_token_hash = 'v1:' || encode(
  digest(COALESCE(s.guest_cancel_token, r.guest_cancel_token), 'sha256'), 'hex'
)
FROM public.reservations r
WHERE r.id = s.reservation_id
  AND s.guest_cancel_token_hash IS NULL
  AND COALESCE(s.guest_cancel_token, r.guest_cancel_token) IS NOT NULL;

CREATE TABLE public.source_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('venue_reservation','rsvp_contribution')),
  source_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  venue_id uuid REFERENCES public.venue_listings(id) ON DELETE RESTRICT,
  event_id uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  refund_kind text NOT NULL CHECK (refund_kind IN ('venue_eligible_cancel','rsvp_discretionary','event_cancel')),
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('consumer','guest','brand_staff','admin','system')),
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  provider text NOT NULL CHECK (provider IN ('stripe','paystack')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  original_charge_cents integer NOT NULL CHECK (original_charge_cents > 0),
  buyer_refund_requested_cents integer NOT NULL CHECK (buyer_refund_requested_cents > 0),
  buyer_refund_processed_cents integer NOT NULL DEFAULT 0 CHECK (buyer_refund_processed_cents >= 0),
  buyer_state text NOT NULL DEFAULT 'queued'
    CHECK (buyer_state IN ('queued','provider_pending','needs_attention','processed','failed_retryable','failed_terminal')),
  original_application_fee_cents integer CHECK (original_application_fee_cents >= 0),
  application_fee_already_reversed_cents integer NOT NULL DEFAULT 0
    CHECK (application_fee_already_reversed_cents >= 0),
  fee_reversal_required_cents integer NOT NULL DEFAULT 0 CHECK (fee_reversal_required_cents >= 0),
  fee_reversal_processed_cents integer NOT NULL DEFAULT 0 CHECK (fee_reversal_processed_cents >= 0),
  fee_state text NOT NULL DEFAULT 'not_required'
    CHECK (fee_state IN ('not_required','queued','provider_pending','needs_attention','processed','failed_retryable','failed_terminal')),
  fee_leg_kind text NOT NULL DEFAULT 'not_required'
    CHECK (fee_leg_kind IN ('not_required','stripe_application_fee_refund','paystack_ledger_allocation')),
  financial_state text NOT NULL DEFAULT 'pending'
    CHECK (financial_state IN ('pending','needs_attention','reconciled','failed_terminal')),
  organizer_refund_liability_cents integer NOT NULL CHECK (organizer_refund_liability_cents >= 0),
  platform_fee_absorption_cents integer NOT NULL CHECK (platform_fee_absorption_cents >= 0),
  provider_payment_reference text NOT NULL,
  provider_account_reference text,
  stripe_application_fee_id text,
  stripe_application_fee_refund_id text,
  connected_account_fingerprint text,
  integration_fingerprint text,
  idempotency_key text NOT NULL UNIQUE,
  active_buyer_attempt_no integer NOT NULL DEFAULT 0 CHECK (active_buyer_attempt_no >= 0),
  active_fee_attempt_no integer NOT NULL DEFAULT 0 CHECK (active_fee_attempt_no >= 0),
  lease_owner text,
  leased_at timestamptz,
  next_retry_at timestamptz,
  provider_refund_id text,
  provider_status text,
  provider_state_at timestamptz,
  last_error_code text,
  last_error_public text,
  ops_status text NOT NULL DEFAULT 'none' CHECK (ops_status IN ('none','needs_review','escalated','resolved')),
  ops_note text,
  attention_generation integer NOT NULL DEFAULT 0,
  attention_action_type text,
  attention_expires_at timestamptz,
  attention_message_code text,
  attention_completed_at timestamptz,
  attention_actor_type text,
  attention_token_hash text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, refund_kind),
  CHECK (buyer_refund_requested_cents <= original_charge_cents),
  CHECK (buyer_refund_processed_cents <= buyer_refund_requested_cents),
  CHECK (fee_reversal_processed_cents <= fee_reversal_required_cents),
  CHECK (organizer_refund_liability_cents + platform_fee_absorption_cents = buyer_refund_requested_cents),
  CHECK (platform_fee_absorption_cents = fee_reversal_required_cents),
  CHECK ((buyer_state = 'processed') = (buyer_refund_processed_cents = buyer_refund_requested_cents)),
  CHECK ((fee_state = 'not_required') = (fee_reversal_required_cents = 0)),
  CHECK (fee_state <> 'processed' OR fee_reversal_processed_cents = fee_reversal_required_cents),
  CHECK (financial_state <> 'reconciled' OR
    (buyer_state = 'processed' AND fee_state IN ('processed','not_required'))),
  CHECK (financial_state <> 'reconciled' OR
    (fee_leg_kind <> 'stripe_application_fee_refund' OR stripe_application_fee_id IS NOT NULL)),
  CHECK (financial_state <> 'reconciled' OR buyer_state <> 'failed_terminal'),
  CHECK (financial_state <> 'reconciled' OR fee_state <> 'failed_terminal'),
  CHECK (
    (source_type = 'venue_reservation' AND venue_id IS NOT NULL AND event_id IS NULL)
    OR (source_type = 'rsvp_contribution' AND event_id IS NOT NULL AND venue_id IS NULL AND source_id = subject_id)
  )
);

CREATE INDEX source_refunds_work_idx ON public.source_refunds (buyer_state,next_retry_at,requested_at);
CREATE INDEX source_refunds_brand_idx ON public.source_refunds (brand_id,updated_at DESC,id DESC);
CREATE INDEX source_refunds_subject_idx ON public.source_refunds (source_type,subject_id);
CREATE INDEX source_refunds_event_idx ON public.source_refunds (event_id,refund_kind);
CREATE UNIQUE INDEX source_refunds_stripe_refund_idx ON public.source_refunds (provider_refund_id)
  WHERE provider='stripe' AND provider_refund_id IS NOT NULL;
CREATE UNIQUE INDEX source_refunds_paystack_refund_idx ON public.source_refunds (provider_refund_id)
  WHERE provider='paystack' AND provider_refund_id IS NOT NULL;

CREATE TABLE public.source_refund_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.source_refunds(id) ON DELETE RESTRICT,
  leg_type text NOT NULL CHECK (leg_type IN ('buyer_refund','application_fee_reversal')),
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  provider text NOT NULL CHECK (provider IN ('stripe','paystack')),
  provider_idempotency_key text NOT NULL UNIQUE,
  merchant_note text UNIQUE,
  requested_amount_cents integer NOT NULL CHECK (requested_amount_cents >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider_operation_id text,
  provider_status text,
  request_fingerprint text,
  safe_response_fingerprint text,
  first_submitted_at timestamptz,
  last_submitted_at timestamptz,
  reconcile_count integer NOT NULL DEFAULT 0 CHECK (reconcile_count >= 0),
  terminal_observed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (refund_id,leg_type,attempt_no)
);

CREATE TABLE public.source_refund_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  refund_id uuid NOT NULL REFERENCES public.source_refunds(id) ON DELETE RESTRICT,
  attempt_id uuid REFERENCES public.source_refund_attempts(id) ON DELETE RESTRICT,
  leg_type text CHECK (leg_type IN ('buyer_refund','application_fee_reversal')),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type IN (
    'requested','claimed','provider_request','provider_pending','needs_attention',
    'processed','failed','retry_scheduled','ops_escalated','ops_resolved',
    'notification_enqueued','payout_held','payout_adjusted'
  )),
  from_state text,
  to_state text,
  amount_observed_cents integer CHECK (amount_observed_cents >= 0),
  provider_event_type text,
  provider_event_id text,
  safe_reason_code text,
  actor_type text,
  safe_payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (safe_payload ?| ARRAY[
    'guest_token','email','phone','authorization','provider_secret','raw_body',
    'accountNumber','bankId','attention_token','status_token'
  ]))
);

CREATE TABLE public.source_refund_legacy_adoption_exceptions (
  legacy_attempt_id uuid PRIMARY KEY
    REFERENCES public.paystack_refund_attempts(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z0-9_]{3,80}$'),
  safe_evidence jsonb NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (NOT (safe_evidence ?| ARRAY[
    'email','phone','authorization','provider_secret','raw_body',
    'accountNumber','bankId','guest_token','attention_token'
  ]))
);

CREATE TABLE public.source_refund_ledger_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.source_refunds(id) ON DELETE RESTRICT,
  allocation_type text NOT NULL CHECK (allocation_type IN (
    'buyer_refund','organizer_refund_liability','platform_application_fee_reversal'
  )),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider text NOT NULL CHECK (provider IN ('stripe','paystack')),
  state text NOT NULL CHECK (state IN ('prepared','posted')),
  payout_release_id uuid,
  payout_ledger_adjustment_id uuid REFERENCES public.payout_ledger_adjustments(id),
  provider_effect_reference text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (refund_id,allocation_type)
);

ALTER TABLE public.payment_webhook_events
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_event_type text,
  ADD COLUMN IF NOT EXISTS provider_event_id text,
  ADD COLUMN IF NOT EXISTS provider_refund_id text,
  ADD COLUMN IF NOT EXISTS match_status text DEFAULT 'not_applicable'
    CHECK (match_status IN ('not_applicable','matched','unmatched','mismatched','resolved')),
  ADD COLUMN IF NOT EXISTS matched_source_refund_id uuid REFERENCES public.source_refunds(id),
  ADD COLUMN IF NOT EXISTS match_reason_code text,
  ADD COLUMN IF NOT EXISTS first_response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
CREATE UNIQUE INDEX payment_webhook_refund_event_identity_idx
  ON public.payment_webhook_events(provider,provider_event_type,provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_1221_reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'append_only';
END $$;
CREATE OR REPLACE FUNCTION public.issue_1221_reject_snapshot_item_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE'
     AND current_setting('app.issue_1221_snapshot_cleanup',true)='allowed'
     AND OLD.snapshot_id IN (
       SELECT id FROM public.admin_source_refund_query_snapshots
       WHERE expires_at<=statement_timestamp()
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'immutable_snapshot';
END $$;
CREATE OR REPLACE FUNCTION public.issue_1221_reject_snapshot_parent_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF current_setting('app.issue_1221_snapshot_cleanup',true)='allowed'
     AND OLD.expires_at<=statement_timestamp() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'immutable_snapshot';
END $$;
CREATE OR REPLACE FUNCTION public.issue_1221_enforce_allocation_monotonic()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'append_only'; END IF;
  IF OLD.state<>'prepared' OR NEW.state<>'posted'
     OR NEW.id<>OLD.id OR NEW.refund_id<>OLD.refund_id
     OR NEW.allocation_type<>OLD.allocation_type
     OR NEW.amount_cents<>OLD.amount_cents OR NEW.currency<>OLD.currency
     OR NEW.provider<>OLD.provider OR NEW.idempotency_key<>OLD.idempotency_key
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'immutable_allocation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_refund_events_append_only
  BEFORE UPDATE OR DELETE ON public.source_refund_events
  FOR EACH ROW EXECUTE FUNCTION public.issue_1221_reject_mutation();
CREATE TRIGGER source_refund_allocations_append_only
  BEFORE UPDATE OR DELETE ON public.source_refund_ledger_allocations
  FOR EACH ROW EXECUTE FUNCTION public.issue_1221_enforce_allocation_monotonic();

CREATE TABLE public.admin_source_refund_query_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  cursor_version smallint NOT NULL DEFAULT 1 CHECK (cursor_version=1),
  normalized_filters jsonb NOT NULL,
  normalized_filter_hash text NOT NULL CHECK (normalized_filter_hash ~ '^[0-9a-f]{64}$'),
  page_size integer NOT NULL CHECK (page_size BETWEEN 1 AND 100),
  item_count integer NOT NULL CHECK (item_count BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at = created_at + interval '15 minutes')
);
CREATE INDEX admin_source_refund_snapshot_expiry_idx
  ON public.admin_source_refund_query_snapshots(expires_at,id);
CREATE INDEX admin_source_refund_snapshot_actor_idx
  ON public.admin_source_refund_query_snapshots(admin_user_id,created_at DESC,id);

CREATE TABLE public.admin_source_refund_query_snapshot_items (
  snapshot_id uuid NOT NULL REFERENCES public.admin_source_refund_query_snapshots(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  item_kind text NOT NULL CHECK (item_kind IN ('refund_operation','provider_event_exception')),
  item_id uuid NOT NULL,
  safe_summary jsonb NOT NULL,
  PRIMARY KEY(snapshot_id,ordinal),
  UNIQUE(snapshot_id,item_kind,item_id)
);
CREATE TRIGGER admin_source_refund_snapshots_immutable
  BEFORE UPDATE ON public.admin_source_refund_query_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.issue_1221_reject_mutation();
CREATE TRIGGER admin_source_refund_snapshots_delete_protected
  BEFORE DELETE ON public.admin_source_refund_query_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.issue_1221_reject_snapshot_parent_delete();
CREATE TRIGGER admin_source_refund_snapshot_items_immutable
  BEFORE UPDATE OR DELETE ON public.admin_source_refund_query_snapshot_items
  FOR EACH ROW EXECUTE FUNCTION public.issue_1221_reject_snapshot_item_mutation();

ALTER TABLE public.source_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_legacy_adoption_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_legacy_adoption_exceptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_ledger_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_ledger_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_source_refund_query_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_source_refund_query_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_source_refund_query_snapshot_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_source_refund_query_snapshot_items FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.source_refunds, public.source_refund_attempts,
  public.source_refund_events, public.source_refund_legacy_adoption_exceptions,
  public.source_refund_ledger_allocations,
  public.admin_source_refund_query_snapshots,
  public.admin_source_refund_query_snapshot_items
FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.source_refunds, public.source_refund_attempts
  TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.source_refund_legacy_adoption_exceptions
  TO service_role;
GRANT SELECT,INSERT ON public.source_refund_events, public.source_refund_ledger_allocations
  TO service_role;
GRANT SELECT,INSERT,DELETE ON public.admin_source_refund_query_snapshots,
  public.admin_source_refund_query_snapshot_items TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.source_refund_events_id_seq TO service_role;

-- Safe public projection. The service layer still chooses the correct actor-bound RPC.
CREATE OR REPLACE FUNCTION public.issue_1221_source_refund_summary(r public.source_refunds)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object(
    'refund_id',r.id,'source_type',r.source_type,'subject_id',r.subject_id,
    'refund_kind',r.refund_kind,'buyer_state',r.buyer_state,'fee_state',r.fee_state,
    'financial_state',r.financial_state,'amount_cents',r.buyer_refund_requested_cents,
    'currency',r.currency,'requested_at',r.requested_at,'updated_at',r.updated_at,
    'processed_at',r.processed_at,'ops_status',r.ops_status,
    'attention_generation',r.attention_generation,
    'can_retry',r.buyer_state='failed_retryable',
    'public_message_code',CASE
      WHEN r.buyer_state='processed' THEN 'refund_processed'
      WHEN r.buyer_state='needs_attention' THEN 'refund_needs_attention'
      WHEN r.buyer_state IN ('failed_retryable','failed_terminal') THEN 'refund_delayed'
      ELSE 'refund_processing' END
  )
$$;

CREATE OR REPLACE FUNCTION public.pg_my_source_refund_summaries(
  p_source_type text,p_subject_ids uuid[]
) RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_source_type NOT IN ('venue_reservation','rsvp_contribution') THEN
    RAISE EXCEPTION 'invalid_source_type';
  END IF;
  RETURN QUERY
  SELECT public.issue_1221_source_refund_summary(sr)
  FROM public.source_refunds sr
  WHERE sr.source_type=p_source_type AND sr.subject_id=ANY(p_subject_ids)
    AND (
      (p_source_type='venue_reservation' AND EXISTS (
        SELECT 1 FROM public.reservations r
        WHERE r.id=sr.subject_id AND r.consumer_user_id=auth.uid()))
      OR (p_source_type='rsvp_contribution' AND EXISTS (
        SELECT 1 FROM public.event_rsvp_contributions c
        WHERE c.id=sr.subject_id AND c.user_id=auth.uid()))
    );
END $$;

CREATE OR REPLACE FUNCTION public.pg_guest_venue_refund_summary(
  p_reservation_id uuid,p_guest_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_summary jsonb;
BEGIN
  SELECT public.issue_1221_source_refund_summary(sr) INTO v_summary
  FROM public.reservation_checkout_sessions s
  JOIN public.source_refunds sr ON sr.source_id=s.id AND sr.source_type='venue_reservation'
  WHERE s.reservation_id=p_reservation_id
    AND s.guest_cancel_token_hash =
      'v1:' || encode(digest(COALESCE(p_guest_token,''),'sha256'),'hex');
  IF v_summary IS NULL THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  RETURN v_summary;
END $$;

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
      AND (lease_owner IS NULL OR leased_at < p_now-interval '10 minutes')
      AND (next_retry_at IS NULL OR next_retry_at<=p_now)
    ORDER BY requested_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit
  )
  UPDATE public.source_refunds sr SET lease_owner=p_worker_id,leased_at=p_now,updated_at=p_now
  FROM candidates c WHERE sr.id=c.id RETURNING sr.*;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_source_refund_attempt(
  p_refund_id uuid,p_leg_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_attempt_no integer; v_amount integer;
DECLARE v_key text; v_note text; v_state text;
DECLARE v_attempt public.source_refund_attempts%ROWTYPE;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_leg_type NOT IN ('buyer_refund','application_fee_reversal') THEN
    RAISE EXCEPTION 'invalid_leg';
  END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  v_state:=CASE WHEN p_leg_type='buyer_refund' THEN v.buyer_state ELSE v.fee_state END;
  IF v_state IN ('processed','not_required','failed_terminal') THEN
    RAISE EXCEPTION 'attempt_not_allowed';
  END IF;
  v_attempt_no:=CASE WHEN p_leg_type='buyer_refund'
    THEN greatest(1,v.active_buyer_attempt_no)
    ELSE greatest(1,v.active_fee_attempt_no) END;
  v_amount:=CASE WHEN p_leg_type='buyer_refund'
    THEN v.buyer_refund_requested_cents ELSE v.fee_reversal_required_cents END;
  v_key:=CASE WHEN p_leg_type='buyer_refund'
    THEN 'source_refund_buyer:'||v.id||':'||v_attempt_no
    ELSE 'source_refund_fee:'||v.id||':'||v_attempt_no END;
  v_note:=CASE WHEN v.provider='paystack' AND p_leg_type='buyer_refund'
    THEN 'mingla_source_refund:'||v.id||':'||v_attempt_no ELSE NULL END;
  INSERT INTO public.source_refund_attempts(
    refund_id,leg_type,attempt_no,provider,provider_idempotency_key,
    merchant_note,requested_amount_cents,currency
  ) VALUES(v.id,p_leg_type,v_attempt_no,v.provider,v_key,v_note,v_amount,v.currency)
  ON CONFLICT(refund_id,leg_type,attempt_no) DO NOTHING;
  SELECT * INTO STRICT v_attempt FROM public.source_refund_attempts
  WHERE refund_id=v.id AND leg_type=p_leg_type AND attempt_no=v_attempt_no
  FOR UPDATE;
  UPDATE public.source_refunds SET
    active_buyer_attempt_no=CASE WHEN p_leg_type='buyer_refund'
      THEN greatest(active_buyer_attempt_no,v_attempt.attempt_no) ELSE active_buyer_attempt_no END,
    active_fee_attempt_no=CASE WHEN p_leg_type='application_fee_reversal'
      THEN greatest(active_fee_attempt_no,v_attempt.attempt_no) ELSE active_fee_attempt_no END,
    updated_at=now()
  WHERE id=v.id;
  RETURN jsonb_build_object(
    'attempt_no',v_attempt.attempt_no,
    'idempotency_key',v_attempt.provider_idempotency_key,
    'merchant_note',v_attempt.merchant_note,
    'provider_operation_id',v_attempt.provider_operation_id,
    'reconcile_only',v_attempt.request_fingerprint LIKE 'legacy_paystack_attempt:%'
  );
END $$;

CREATE OR REPLACE FUNCTION public.set_source_refund_stripe_fee_identity(
  p_refund_id uuid,p_application_fee_id text,p_connected_account text,
  p_fee_amount_cents integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v.provider<>'stripe' THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF p_application_fee_id !~ '^fee_[A-Za-z0-9]+$'
     OR p_connected_account IS DISTINCT FROM v.provider_account_reference
     OR p_fee_amount_cents IS DISTINCT FROM v.original_application_fee_cents
     OR p_fee_amount_cents<v.fee_reversal_required_cents THEN
    RAISE EXCEPTION 'application_fee_evidence_mismatch';
  END IF;
  IF v.stripe_application_fee_id IS NOT NULL
     AND v.stripe_application_fee_id<>p_application_fee_id THEN
    RAISE EXCEPTION 'application_fee_identity_conflict';
  END IF;
  UPDATE public.source_refunds SET
    stripe_application_fee_id=p_application_fee_id,
    fee_state=CASE WHEN fee_state='needs_attention' THEN 'queued' ELSE fee_state END,
    financial_state=CASE WHEN financial_state='needs_attention' THEN 'pending' ELSE financial_state END,
    updated_at=now()
  WHERE id=v.id RETURNING * INTO v;
  RETURN public.issue_1221_source_refund_summary(v);
END $$;

CREATE OR REPLACE FUNCTION public.issue_1221_post_organizer_refund_liability(
  p_refund_id uuid,p_now timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_release public.brand_payout_releases%ROWTYPE;
DECLARE v_allocation public.source_refund_ledger_allocations%ROWTYPE;
DECLARE v_adjustment_id uuid; v_debt public.organiser_payout_debts%ROWTYPE;
DECLARE v_debt_id uuid; v_liability integer; v_target integer;
BEGIN
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  SELECT * INTO v_allocation FROM public.source_refund_ledger_allocations
  WHERE refund_id=v.id AND allocation_type='organizer_refund_liability'
  FOR UPDATE;
  IF NOT FOUND OR v_allocation.state='posted' THEN
    RETURN v_allocation.payout_ledger_adjustment_id;
  END IF;
  SELECT r.* INTO v_release
  FROM public.payout_release_items i
  JOIN public.brand_payout_releases r ON r.id=i.release_id
  WHERE i.source_type=v.source_type AND i.source_id=v.source_id
  LIMIT 1 FOR UPDATE OF r;
  IF NOT FOUND OR v_release.status<>'released' THEN
    UPDATE public.source_refund_ledger_allocations SET
      state='posted',posted_at=COALESCE(posted_at,p_now)
    WHERE id=v_allocation.id;
    RETURN NULL;
  END IF;
  v_liability:=least(
    v.organizer_refund_liability_cents,v_release.organiser_cash_delivered_cents
  );
  IF v_liability<=0 THEN
    UPDATE public.source_refund_ledger_allocations SET
      state='posted',posted_at=COALESCE(posted_at,p_now),payout_release_id=v_release.id
    WHERE id=v_allocation.id;
    RETURN NULL;
  END IF;
  INSERT INTO public.payout_ledger_adjustments(
    release_id,brand_id,currency,kind,amount_cents,provider_ref,idempotency_key,created_at
  ) VALUES(
    v_release.id,v_release.brand_id,v_release.currency,'post_release_refund',
    v_liability,v.provider_refund_id,'source-refund-liability:'||v.id,p_now
  ) ON CONFLICT(idempotency_key) DO NOTHING
  RETURNING id INTO v_adjustment_id;
  IF v_adjustment_id IS NULL THEN
    SELECT id INTO v_adjustment_id FROM public.payout_ledger_adjustments
    WHERE idempotency_key='source-refund-liability:'||v.id;
  END IF;
  SELECT least(
    coalesce(sum(amount_cents),0)::integer,v_release.organiser_cash_delivered_cents
  ) INTO v_target
  FROM public.payout_ledger_adjustments
  WHERE release_id=v_release.id AND kind='post_release_refund';
  SELECT * INTO v_debt FROM public.organiser_payout_debts
  WHERE origin_release_id=v_release.id AND kind='post_release_refund'
  FOR UPDATE;
  IF NOT FOUND THEN
    v_debt_id:=public.convert_postponement_debt_to_permanent(
      v_release.id,'post_release_refund',v_target,p_now
    );
  ELSE
    v_debt_id:=v_debt.id;
    IF v_target>v_debt.principal_cents THEN
      UPDATE public.organiser_payout_debts SET
        principal_cents=v_target,
        status=CASE WHEN recovered_cents=v_target THEN 'closed' ELSE 'open' END,
        closed_at=CASE WHEN recovered_cents=v_target THEN p_now ELSE NULL END,
        updated_at=p_now
      WHERE id=v_debt.id;
    END IF;
  END IF;
  UPDATE public.source_refund_ledger_allocations SET
    state='posted',posted_at=COALESCE(posted_at,p_now),
    provider_effect_reference=COALESCE(provider_effect_reference,v.provider_refund_id),
    payout_release_id=v_release.id,payout_ledger_adjustment_id=v_adjustment_id
  WHERE id=v_allocation.id;
  INSERT INTO public.source_refund_events(
    refund_id,event_key,event_type,to_state,actor_type,safe_reason_code
  ) VALUES(
    v.id,'payout-adjusted:'||v.id,'payout_adjusted','processed','system',
    'post_release_organizer_liability'
  ) ON CONFLICT(event_key) DO NOTHING;
  RETURN v_adjustment_id;
END $$;

CREATE OR REPLACE FUNCTION public.schedule_source_refund_retry(
  p_refund_id uuid,p_safe_reason_code text,p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_attempts integer;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_safe_reason_code IS NULL OR p_safe_reason_code !~ '^[a-z0-9_]{3,80}$' THEN
    RAISE EXCEPTION 'invalid_reason_code';
  END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  SELECT count(*)::integer INTO v_attempts
  FROM public.source_refund_attempts WHERE refund_id=v.id;
  UPDATE public.source_refunds SET
    buyer_state=CASE WHEN buyer_state IN ('queued','provider_pending')
      THEN 'failed_retryable' ELSE buyer_state END,
    fee_state=CASE WHEN fee_state IN ('queued','provider_pending')
      THEN 'failed_retryable' ELSE fee_state END,
    financial_state=CASE
      WHEN buyer_state='processed' AND fee_state IN ('processed','not_required') THEN 'reconciled'
      ELSE 'pending' END,
    last_error_code=p_safe_reason_code,
    next_retry_at=p_now+make_interval(secs=>least(3600,30*(2^least(v_attempts,7))::integer)),
    lease_owner=NULL,leased_at=NULL,updated_at=p_now
  WHERE id=v.id RETURNING * INTO v;
  INSERT INTO public.source_refund_events(
    refund_id,event_key,event_type,to_state,actor_type,safe_reason_code
  ) VALUES(
    v.id,'retry-scheduled:'||v.id||':'||extract(epoch from p_now)::bigint,
    'retry_scheduled','failed_retryable','system',p_safe_reason_code
  ) ON CONFLICT(event_key) DO NOTHING;
  RETURN public.issue_1221_source_refund_summary(v);
END $$;

CREATE OR REPLACE FUNCTION public.record_source_refund_provider_event(
  p_refund_id uuid,p_leg_type text,p_attempt_no integer,p_event_key text,
  p_provider_event_type text,p_provider_event_id text,p_next_state text,
  p_amount_observed_cents integer,p_provider_operation_id text DEFAULT NULL,
  p_safe_reason_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_old text; v_attempt uuid; v_expected integer;
DECLARE v_event_id bigint;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_leg_type NOT IN ('buyer_refund','application_fee_reversal')
     OR p_next_state NOT IN (
       'queued','provider_pending','needs_attention','processed',
       'failed_retryable','failed_terminal'
     ) OR p_attempt_no<1 OR p_amount_observed_cents<0 THEN
    RAISE EXCEPTION 'invalid_provider_event';
  END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  SELECT id INTO v_attempt FROM public.source_refund_attempts
   WHERE refund_id=p_refund_id AND leg_type=p_leg_type AND attempt_no=p_attempt_no;
  IF v_attempt IS NULL THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF (p_leg_type='buyer_refund' AND p_attempt_no<>v.active_buyer_attempt_no)
     OR (p_leg_type='application_fee_reversal' AND p_attempt_no<>v.active_fee_attempt_no) THEN
    RAISE EXCEPTION 'stale_attempt';
  END IF;
  v_expected:=CASE WHEN p_leg_type='buyer_refund'
    THEN v.buyer_refund_requested_cents ELSE v.fee_reversal_required_cents END;
  IF p_next_state='processed' AND p_amount_observed_cents<>v_expected THEN
    RAISE EXCEPTION 'provider_amount_mismatch';
  END IF;
  v_old := CASE WHEN p_leg_type='buyer_refund' THEN v.buyer_state ELSE v.fee_state END;
  IF v_old='processed' AND p_next_state<>'processed' THEN
    RETURN public.issue_1221_source_refund_summary(v);
  END IF;
  INSERT INTO public.source_refund_events(
    refund_id,attempt_id,leg_type,event_key,event_type,from_state,to_state,
    amount_observed_cents,provider_event_type,provider_event_id,safe_reason_code,actor_type
  ) VALUES (
    p_refund_id,v_attempt,p_leg_type,p_event_key,
    CASE WHEN p_next_state='processed' THEN 'processed'
         WHEN p_next_state='needs_attention' THEN 'needs_attention'
         WHEN p_next_state LIKE 'failed%' THEN 'failed' ELSE 'provider_pending' END,
    v_old,p_next_state,p_amount_observed_cents,p_provider_event_type,p_provider_event_id,
    p_safe_reason_code,'provider'
  ) ON CONFLICT(event_key) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id FROM public.source_refund_events
      WHERE event_key=p_event_key;
    RETURN public.issue_1221_source_refund_summary(v)
      ||jsonb_build_object('source_refund_event_id',v_event_id);
  END IF;
  UPDATE public.source_refund_attempts SET
    provider_operation_id=COALESCE(provider_operation_id,p_provider_operation_id),
    provider_status=p_next_state,
    first_submitted_at=COALESCE(first_submitted_at,now()),
    last_submitted_at=now(),
    reconcile_count=reconcile_count+1,
    terminal_observed_at=CASE WHEN p_next_state IN ('processed','failed_terminal')
      THEN COALESCE(terminal_observed_at,now()) ELSE terminal_observed_at END,
    last_error_code=CASE WHEN p_next_state LIKE 'failed%' OR p_next_state='needs_attention'
      THEN p_safe_reason_code ELSE NULL END,
    updated_at=now()
  WHERE id=v_attempt;
  IF p_leg_type='buyer_refund' THEN
    UPDATE public.source_refunds SET
      buyer_state=p_next_state,
      buyer_refund_processed_cents=CASE WHEN p_next_state='processed' THEN buyer_refund_requested_cents ELSE buyer_refund_processed_cents END,
      provider_refund_id=COALESCE(provider_refund_id,p_provider_operation_id),
      provider_status=p_next_state,provider_state_at=now(),
      last_error_code=CASE WHEN p_next_state LIKE 'failed%' OR p_next_state='needs_attention'
        THEN p_safe_reason_code ELSE NULL END,
      attention_generation=CASE
        WHEN p_next_state='needs_attention'
          THEN attention_generation+1 ELSE attention_generation END,
      attention_action_type=CASE
        WHEN p_next_state='needs_attention' AND provider='paystack'
          THEN 'paystack_customer_details' ELSE attention_action_type END,
      attention_expires_at=CASE
        WHEN p_next_state='needs_attention' THEN now()+interval '72 hours'
        ELSE attention_expires_at END,
      attention_message_code=CASE
        WHEN p_next_state='needs_attention' THEN 'refund_bank_details_required'
        ELSE attention_message_code END,
      attention_completed_at=CASE
        WHEN p_next_state='processed' THEN COALESCE(attention_completed_at,now())
        WHEN p_next_state='needs_attention' THEN NULL
        ELSE attention_completed_at END,
      attention_token_hash=NULL,
      attention_token_key_id=NULL,
      attention_submission_claim_id=NULL,
      attention_submission_claimed_at=NULL,
      attention_submission_claim_expires_at=NULL,
      attention_submission_claim_renewed_at=NULL,
      processed_at=CASE WHEN p_next_state='processed' THEN COALESCE(processed_at,now()) ELSE processed_at END,
      updated_at=now() WHERE id=p_refund_id RETURNING * INTO v;
  ELSE
    UPDATE public.source_refunds SET
      fee_state=p_next_state,
      fee_reversal_processed_cents=CASE WHEN p_next_state='processed' THEN fee_reversal_required_cents ELSE fee_reversal_processed_cents END,
      stripe_application_fee_refund_id=COALESCE(stripe_application_fee_refund_id,p_provider_operation_id),
      last_error_code=CASE WHEN p_next_state LIKE 'failed%' OR p_next_state='needs_attention'
        THEN p_safe_reason_code ELSE NULL END,
      updated_at=now() WHERE id=p_refund_id RETURNING * INTO v;
  END IF;
  IF p_leg_type='buyer_refund' AND p_next_state='processed' THEN
    UPDATE public.source_refund_ledger_allocations
      SET state='posted',posted_at=COALESCE(posted_at,now()),
        provider_effect_reference=COALESCE(provider_effect_reference,p_provider_operation_id)
    WHERE refund_id=v.id AND allocation_type='buyer_refund' AND state='prepared';
    PERFORM public.issue_1221_post_organizer_refund_liability(v.id,now());
    IF v.source_type='venue_reservation' THEN
      UPDATE public.reservations SET payment_status='refunded',updated_at=now()
      WHERE id=v.subject_id AND payment_status<>'refunded';
    ELSE
      UPDATE public.event_rsvp_contributions
      SET refunded_amount_cents=LEAST(
            buyer_total_cents,refunded_amount_cents+v.buyer_refund_requested_cents
          ),
          status=CASE
            WHEN refunded_amount_cents+v.buyer_refund_requested_cents>=buyer_total_cents
              THEN 'refunded' ELSE 'partially_refunded' END,
          refund_reason=v.reason,updated_at=now()
      WHERE id=v.subject_id;
    END IF;
  END IF;
  IF p_leg_type='application_fee_reversal' AND p_next_state='processed' THEN
    UPDATE public.source_refund_ledger_allocations
      SET state='posted',posted_at=COALESCE(posted_at,now()),
        provider_effect_reference=COALESCE(provider_effect_reference,p_provider_operation_id)
    WHERE refund_id=v.id
      AND allocation_type='platform_application_fee_reversal' AND state='prepared';
  END IF;
  UPDATE public.source_refunds SET financial_state=CASE
    WHEN buyer_state='processed' AND fee_state IN ('processed','not_required') THEN 'reconciled'
    WHEN buyer_state='failed_terminal' OR fee_state='failed_terminal' THEN 'failed_terminal'
    WHEN buyer_state='needs_attention' OR fee_state='needs_attention' THEN 'needs_attention'
    ELSE 'pending' END, lease_owner=NULL,leased_at=NULL
  WHERE id=p_refund_id RETURNING * INTO v;
  RETURN public.issue_1221_source_refund_summary(v)
    ||jsonb_build_object(
      'source_refund_event_id',v_event_id,
      'attention_generation',v.attention_generation
    );
END $$;

CREATE OR REPLACE FUNCTION public.adopt_legacy_venue_paystack_refund_attempts()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_legacy public.paystack_refund_attempts%ROWTYPE;
  v_session public.reservation_checkout_sessions%ROWTYPE;
  v_reservation public.reservations%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
  v_attempt public.source_refund_attempts%ROWTYPE;
  v_expected_reference text;
  v_reason text;
  v_fee integer;
  v_state text;
  v_adopted integer:=0;
  v_exceptions integer:=0;
  v_result jsonb;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  FOR v_legacy IN
    SELECT * FROM public.paystack_refund_attempts
    WHERE source_type='venue_reservation'
    ORDER BY created_at,id
    FOR UPDATE
  LOOP
    v_reason:=NULL;
    v_session:=NULL;
    v_reservation:=NULL;
    v_refund:=NULL;
    v_attempt:=NULL;

    SELECT * INTO v_session FROM public.reservation_checkout_sessions
    WHERE id=v_legacy.source_id;
    IF NOT FOUND THEN
      v_reason:='missing_checkout_session';
    ELSIF v_session.status<>'completed'
       OR v_session.reservation_id IS NULL
       OR v_session.venue_id IS NULL THEN
      v_reason:='incomplete_source_identity';
    ELSE
      SELECT * INTO v_reservation FROM public.reservations
      WHERE id=v_session.reservation_id;
      IF NOT FOUND
         OR v_reservation.brand_id IS DISTINCT FROM v_session.brand_id
         OR v_reservation.venue_id IS DISTINCT FROM v_session.venue_id THEN
        v_reason:='conflicting_source_identity';
      END IF;
    END IF;

    IF v_reason IS NULL AND NOT EXISTS(
      SELECT 1 FROM public.brands b
      WHERE b.id=v_session.brand_id AND b.payment_provider='paystack'
    ) THEN
      v_reason:='conflicting_provider_identity';
    END IF;
    IF v_reason IS NULL THEN
      v_expected_reference:=COALESCE(
        NULLIF(v_session.paystack_reference,''),
        NULLIF(v_reservation.payment_intent_id,'')
      );
      IF v_expected_reference IS NULL
         OR NULLIF(btrim(v_legacy.transaction_reference),'') IS NULL
         OR v_legacy.transaction_reference<>v_expected_reference THEN
        v_reason:='conflicting_transaction_reference';
      ELSIF v_legacy.amount_cents<=0
         OR v_legacy.amount_cents<>v_session.amount_cents THEN
        v_reason:='conflicting_refund_amount';
      ELSIF v_legacy.currency !~ '^[a-z]{3}$'
         OR upper(v_legacy.currency)<>upper(v_session.currency::text) THEN
        v_reason:='conflicting_refund_currency';
      ELSIF v_legacy.status NOT IN ('pending','accepted','processed','failed') THEN
        v_reason:='unknown_legacy_status';
      ELSIF NULLIF(btrim(v_legacy.idempotency_key),'') IS NULL
         OR NULLIF(btrim(v_legacy.merchant_note),'') IS NULL THEN
        v_reason:='missing_attempt_identity';
      ELSIF v_session.application_fee_amount_cents>v_legacy.amount_cents THEN
        v_reason:='conflicting_application_fee_amount';
      END IF;
    END IF;

    IF v_reason IS NULL THEN
      SELECT * INTO v_refund FROM public.source_refunds
      WHERE source_type='venue_reservation'
        AND source_id=v_session.id
        AND refund_kind='venue_eligible_cancel'
      FOR UPDATE;
      IF FOUND AND (
        v_refund.subject_id IS DISTINCT FROM v_reservation.id
        OR v_refund.brand_id IS DISTINCT FROM v_session.brand_id
        OR v_refund.venue_id IS DISTINCT FROM v_session.venue_id
        OR v_refund.provider<>'paystack'
        OR v_refund.currency<>upper(v_legacy.currency)
        OR v_refund.original_charge_cents<>v_session.amount_cents
        OR v_refund.buyer_refund_requested_cents<>v_legacy.amount_cents
        OR v_refund.provider_payment_reference<>v_legacy.transaction_reference
      ) THEN
        v_reason:='conflicting_typed_refund';
      END IF;
    END IF;

    IF v_reason IS NULL AND EXISTS(
      SELECT 1 FROM public.source_refund_attempts a
      WHERE (
          a.id=v_legacy.id
          OR a.provider_idempotency_key=v_legacy.idempotency_key
          OR a.merchant_note=v_legacy.merchant_note
          OR (
            v_refund.id IS NOT NULL
            AND a.refund_id=v_refund.id
            AND a.leg_type='buyer_refund'
            AND a.attempt_no=1
          )
        )
        AND NOT (
          v_refund.id IS NOT NULL
          AND a.id=v_legacy.id
          AND a.refund_id=v_refund.id
          AND a.leg_type='buyer_refund'
          AND a.attempt_no=1
          AND a.provider='paystack'
          AND a.provider_idempotency_key=v_legacy.idempotency_key
          AND a.merchant_note=v_legacy.merchant_note
          AND a.requested_amount_cents=v_legacy.amount_cents
          AND a.currency=upper(v_legacy.currency)
        )
    ) THEN
      v_reason:='conflicting_attempt_identity';
    END IF;

    IF v_reason IS NOT NULL THEN
      INSERT INTO public.source_refund_legacy_adoption_exceptions(
        legacy_attempt_id,reason_code,safe_evidence,last_seen_at,resolved_at
      ) VALUES(
        v_legacy.id,v_reason,
        jsonb_build_object(
          'sourceId',v_legacy.source_id,
          'status',v_legacy.status,
          'currency',v_legacy.currency,
          'amountCents',v_legacy.amount_cents,
          'transactionReferencePresent',
            NULLIF(btrim(v_legacy.transaction_reference),'') IS NOT NULL,
          'providerRefundIdPresent',v_legacy.provider_refund_id IS NOT NULL
        ),
        now(),NULL
      ) ON CONFLICT(legacy_attempt_id) DO UPDATE SET
        reason_code=excluded.reason_code,
        safe_evidence=excluded.safe_evidence,
        last_seen_at=excluded.last_seen_at,
        resolved_at=NULL;
      v_exceptions:=v_exceptions+1;
      CONTINUE;
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended('venue_reservation:'||v_session.id::text,0)
    );
    v_fee:=LEAST(
      COALESCE(v_session.application_fee_amount_cents,0),
      v_legacy.amount_cents
    );
    IF v_refund.id IS NULL THEN
      INSERT INTO public.source_refunds(
        source_type,source_id,subject_id,brand_id,venue_id,refund_kind,
        requested_by_type,reason,provider,currency,original_charge_cents,
        buyer_refund_requested_cents,original_application_fee_cents,
        fee_reversal_required_cents,fee_state,fee_leg_kind,financial_state,
        organizer_refund_liability_cents,platform_fee_absorption_cents,
        provider_payment_reference,idempotency_key,active_buyer_attempt_no,
        requested_at,updated_at
      ) VALUES(
        'venue_reservation',v_session.id,v_reservation.id,v_session.brand_id,
        v_session.venue_id,'venue_eligible_cancel','system',
        'Legacy venue Paystack refund adoption','paystack',
        upper(v_legacy.currency),v_session.amount_cents,v_legacy.amount_cents,
        v_session.application_fee_amount_cents,v_fee,
        CASE
          WHEN v_session.application_fee_amount_cents IS NULL THEN 'needs_attention'
          WHEN v_fee=0 THEN 'not_required'
          ELSE 'queued'
        END,
        CASE WHEN v_fee=0 THEN 'not_required' ELSE 'paystack_ledger_allocation' END,
        CASE
          WHEN v_session.application_fee_amount_cents IS NULL THEN 'needs_attention'
          ELSE 'pending'
        END,
        v_legacy.amount_cents-v_fee,v_fee,v_legacy.transaction_reference,
        'legacy_venue_paystack_refund:'||v_legacy.id,1,
        v_legacy.created_at,v_legacy.updated_at
      ) RETURNING * INTO v_refund;
      INSERT INTO public.source_refund_ledger_allocations(
        refund_id,allocation_type,amount_cents,currency,provider,state,
        idempotency_key,created_at
      ) VALUES(
        v_refund.id,'buyer_refund',v_refund.buyer_refund_requested_cents,
        v_refund.currency,'paystack','prepared',
        'source-refund-allocation:buyer:'||v_refund.id,v_legacy.created_at
      );
      IF v_refund.organizer_refund_liability_cents>0 THEN
        INSERT INTO public.source_refund_ledger_allocations(
          refund_id,allocation_type,amount_cents,currency,provider,state,
          idempotency_key,created_at
        ) VALUES(
          v_refund.id,'organizer_refund_liability',
          v_refund.organizer_refund_liability_cents,v_refund.currency,
          'paystack','prepared',
          'source-refund-allocation:organizer:'||v_refund.id,v_legacy.created_at
        );
      END IF;
      IF v_refund.platform_fee_absorption_cents>0 THEN
        INSERT INTO public.source_refund_ledger_allocations(
          refund_id,allocation_type,amount_cents,currency,provider,state,
          idempotency_key,created_at
        ) VALUES(
          v_refund.id,'platform_application_fee_reversal',
          v_refund.platform_fee_absorption_cents,v_refund.currency,
          'paystack','prepared',
          'source-refund-allocation:platform:'||v_refund.id,v_legacy.created_at
        );
      END IF;
    END IF;

    INSERT INTO public.source_refund_attempts(
      id,refund_id,leg_type,attempt_no,provider,provider_idempotency_key,
      merchant_note,requested_amount_cents,currency,provider_operation_id,
      provider_status,request_fingerprint,first_submitted_at,last_submitted_at,
      terminal_observed_at,last_error_code,created_at,updated_at
    ) VALUES(
      v_legacy.id,v_refund.id,'buyer_refund',1,'paystack',
      v_legacy.idempotency_key,v_legacy.merchant_note,v_legacy.amount_cents,
      upper(v_legacy.currency),v_legacy.provider_refund_id,v_legacy.status,
      'legacy_paystack_attempt:'||v_legacy.id,
      v_legacy.created_at,v_legacy.updated_at,
      CASE WHEN v_legacy.status IN ('processed','failed')
        THEN v_legacy.updated_at ELSE NULL END,
      CASE WHEN v_legacy.status='failed'
        THEN 'legacy_paystack_failed' ELSE NULL END,
      v_legacy.created_at,v_legacy.updated_at
    ) ON CONFLICT(refund_id,leg_type,attempt_no) DO NOTHING;
    SELECT * INTO STRICT v_attempt FROM public.source_refund_attempts
    WHERE refund_id=v_refund.id AND leg_type='buyer_refund' AND attempt_no=1
    FOR UPDATE;
    IF v_attempt.id<>v_legacy.id
       OR v_attempt.provider_idempotency_key<>v_legacy.idempotency_key
       OR v_attempt.merchant_note<>v_legacy.merchant_note THEN
      RAISE EXCEPTION 'legacy_attempt_conflict_after_lock';
    END IF;
    UPDATE public.source_refunds SET active_buyer_attempt_no=1
    WHERE id=v_refund.id AND active_buyer_attempt_no<1;
    INSERT INTO public.source_refund_events(
      refund_id,attempt_id,leg_type,event_key,event_type,to_state,
      provider_event_type,provider_event_id,safe_reason_code,actor_type,
      safe_payload,created_at
    ) VALUES(
      v_refund.id,v_attempt.id,'buyer_refund',
      'legacy-adopted:'||v_legacy.id,'claimed',
      CASE
        WHEN v_legacy.status IN ('pending','accepted') THEN 'needs_attention'
        WHEN v_legacy.status='processed' THEN 'processed'
        ELSE 'failed_terminal'
      END,
      'legacy_paystack_attempt',v_legacy.id::text,
      'legacy_paystack_attempt_adopted','system',
      jsonb_build_object(
        'legacyAttemptId',v_legacy.id,
        'legacyStatus',v_legacy.status,
        'transactionReference',v_legacy.transaction_reference,
        'merchantNote',v_legacy.merchant_note,
        'idempotencyKey',v_legacy.idempotency_key
      ),
      v_legacy.created_at
    ) ON CONFLICT(event_key) DO NOTHING;

    v_state:=CASE
      WHEN v_legacy.status IN ('pending','accepted') THEN 'needs_attention'
      WHEN v_legacy.status='processed' THEN 'processed'
      ELSE 'failed_terminal'
    END;
    v_result:=public.record_source_refund_provider_event(
      v_refund.id,'buyer_refund',1,
      'legacy-outcome:'||v_legacy.id||':'||v_legacy.status,
      'legacy_paystack_attempt',v_legacy.id::text,v_state,
      CASE WHEN v_state='processed' THEN v_legacy.amount_cents ELSE 0 END,
      v_legacy.provider_refund_id,
      CASE
        WHEN v_state='needs_attention' THEN 'legacy_paystack_reconciliation_required'
        WHEN v_state='failed_terminal' THEN 'legacy_paystack_failed'
        ELSE 'legacy_paystack_processed'
      END
    );
    IF v_state='processed' AND v_fee>0 AND v_refund.fee_state<>'processed' THEN
      v_result:=public.ensure_source_refund_attempt(
        v_refund.id,'application_fee_reversal'
      );
      v_result:=public.record_source_refund_provider_event(
        v_refund.id,'application_fee_reversal',
        (v_result->>'attempt_no')::integer,
        'legacy-fee-allocation:'||v_legacy.id,
        'legacy_paystack_ledger',v_legacy.id::text,'processed',v_fee,
        'paystack-ledger:'||v_refund.id,
        'legacy_paystack_exact_ledger_allocation'
      );
    END IF;
    UPDATE public.source_refund_legacy_adoption_exceptions
    SET resolved_at=COALESCE(resolved_at,now()),last_seen_at=now()
    WHERE legacy_attempt_id=v_legacy.id;
    v_adopted:=v_adopted+1;
  END LOOP;
  RETURN jsonb_build_object(
    'adopted',v_adopted,'exceptions',v_exceptions,'provider_calls',0
  );
END $$;

CREATE OR REPLACE FUNCTION public.assert_legacy_venue_paystack_adoption_ready()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.source_refund_legacy_adoption_exceptions
    WHERE resolved_at IS NULL
  ) OR EXISTS(
    SELECT 1
    FROM public.paystack_refund_attempts legacy
    LEFT JOIN public.source_refund_attempts adopted
      ON adopted.id=legacy.id
     AND adopted.request_fingerprint='legacy_paystack_attempt:'||legacy.id
     AND adopted.provider_idempotency_key=legacy.idempotency_key
     AND adopted.merchant_note=legacy.merchant_note
    WHERE legacy.source_type='venue_reservation'
      AND adopted.id IS NULL
  ) THEN
    RAISE EXCEPTION 'issue_1221_legacy_venue_paystack_adoption_blocked';
  END IF;
END $$;

SELECT public.adopt_legacy_venue_paystack_refund_attempts();
SELECT public.assert_legacy_venue_paystack_adoption_ready();

CREATE OR REPLACE FUNCTION public.pg_prepare_my_venue_cancellation_refund(
  p_reservation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid; v_cancel record; v_session public.reservation_checkout_sessions%ROWTYPE;
DECLARE v_provider text; v_refund public.source_refunds%ROWTYPE; v_fee integer;
BEGIN
  v_uid:=auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_session FROM public.reservation_checkout_sessions
  WHERE reservation_id=p_reservation_id AND status='completed'
  ORDER BY created_at DESC,id DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'completed_checkout_session_not_found'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('venue_reservation:'||v_session.id::text,0)
  );
  -- Replay is resolved before the legacy legal-transition function.
  SELECT sr.* INTO v_refund FROM public.source_refunds sr
  WHERE sr.source_type='venue_reservation' AND sr.subject_id=p_reservation_id
    AND sr.refund_kind='venue_eligible_cancel';
  IF FOUND THEN
    RETURN jsonb_build_object('cancelled',true,'refund',public.issue_1221_source_refund_summary(v_refund));
  END IF;
  SELECT * INTO v_cancel FROM public.pg_cancel_my_reservation(p_reservation_id);
  IF NOT v_cancel.refund_eligible THEN
    RETURN jsonb_build_object('cancelled',true,'refund',NULL);
  END IF;
  SELECT * INTO v_session FROM public.reservation_checkout_sessions
  WHERE reservation_id=p_reservation_id AND status='completed'
  ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'completed_checkout_session_not_found'; END IF;
  SELECT CASE WHEN b.payment_provider='paystack' THEN 'paystack' ELSE 'stripe' END
    INTO v_provider FROM public.brands b WHERE b.id=v_session.brand_id;
  v_fee:=v_session.application_fee_amount_cents;
  INSERT INTO public.source_refunds(
    source_type,source_id,subject_id,brand_id,venue_id,refund_kind,
    requested_by_type,requested_by_user_id,reason,provider,currency,
    original_charge_cents,buyer_refund_requested_cents,original_application_fee_cents,
    fee_reversal_required_cents,fee_state,fee_leg_kind,financial_state,
    organizer_refund_liability_cents,platform_fee_absorption_cents,
    provider_payment_reference,provider_account_reference,idempotency_key
  ) VALUES (
    'venue_reservation',v_session.id,p_reservation_id,v_session.brand_id,v_session.venue_id,
    'venue_eligible_cancel','consumer',v_uid,'Eligible venue reservation cancellation',
    v_provider,upper(v_session.currency),v_session.amount_cents,v_session.amount_cents,v_fee,
    COALESCE(v_fee,0),
    CASE WHEN v_fee IS NULL THEN 'needs_attention'
         WHEN v_fee=0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee IS NULL THEN 'stripe_application_fee_refund'
         WHEN v_fee=0 THEN 'not_required'
         WHEN v_provider='stripe' THEN 'stripe_application_fee_refund'
         ELSE 'paystack_ledger_allocation' END,
    CASE WHEN v_fee IS NULL THEN 'needs_attention' ELSE 'pending' END,
    v_session.amount_cents-COALESCE(v_fee,0),COALESCE(v_fee,0),
    COALESCE(v_session.stripe_payment_intent_id,v_session.paystack_reference),
    v_session.stripe_account_id,'venue_eligible_cancel:'||v_session.id
  ) RETURNING * INTO v_refund;
  INSERT INTO public.source_refund_ledger_allocations(
    refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
  ) VALUES (
    v_refund.id,'buyer_refund',v_refund.buyer_refund_requested_cents,
    v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:buyer:'||v_refund.id
  );
  IF v_refund.organizer_refund_liability_cents>0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
    ) VALUES (
      v_refund.id,'organizer_refund_liability',v_refund.organizer_refund_liability_cents,
      v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:organizer:'||v_refund.id
    );
  END IF;
  IF v_refund.platform_fee_absorption_cents>0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
    ) VALUES (
      v_refund.id,'platform_application_fee_reversal',v_refund.platform_fee_absorption_cents,
      v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:platform:'||v_refund.id
    );
  END IF;
  INSERT INTO public.source_refund_events(refund_id,event_key,event_type,to_state,actor_type,safe_reason_code)
  VALUES(v_refund.id,'requested:'||v_refund.id,'requested','queued','consumer','eligible_venue_cancel');
  RETURN jsonb_build_object('cancelled',true,'refund',public.issue_1221_source_refund_summary(v_refund));
END $$;

CREATE OR REPLACE FUNCTION public.biz_prepare_rsvp_contribution_refund(
  p_contribution_id uuid,p_mode text,p_reason text,p_client_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid; v_c public.event_rsvp_contributions%ROWTYPE; v_event public.events%ROWTYPE;
DECLARE v_refund public.source_refunds%ROWTYPE; v_requested integer; v_fee integer;
DECLARE v_provider_ref text; v_account text;
BEGIN
  v_uid:=auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_c FROM public.event_rsvp_contributions
  WHERE id=p_contribution_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contribution_not_found'; END IF;
  IF public.biz_brand_effective_rank(v_c.brand_id,v_uid)
       < public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_mode NOT IN ('discretionary','cancellation') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('rsvp_contribution:'||v_c.id::text,0)
  );
  SELECT * INTO v_c FROM public.event_rsvp_contributions
  WHERE id=p_contribution_id FOR UPDATE;
  SELECT * INTO v_event FROM public.events WHERE id=v_c.event_id;
  IF p_mode='cancellation' AND COALESCE(v_event.status,'')<>'cancelled' THEN
    RAISE EXCEPTION 'event_not_cancelled';
  END IF;
  SELECT sr.* INTO v_refund FROM public.source_refunds sr
  WHERE sr.source_type='rsvp_contribution' AND sr.source_id=v_c.id
    AND sr.refund_kind=CASE WHEN p_mode='cancellation' THEN 'event_cancel' ELSE 'rsvp_discretionary' END;
  IF FOUND THEN RETURN public.issue_1221_source_refund_summary(v_refund); END IF;
  v_requested:=CASE WHEN p_mode='cancellation'
    THEN v_c.buyer_total_cents-v_c.refunded_amount_cents
    ELSE GREATEST(0,v_c.amount_cents-v_c.application_fee_amount_cents-v_c.refunded_amount_cents) END;
  v_fee:=CASE WHEN p_mode='cancellation'
    THEN LEAST(v_requested,v_c.application_fee_amount_cents) ELSE 0 END;
  IF v_requested<=0 THEN RAISE EXCEPTION 'nothing_to_refund'; END IF;
  v_provider_ref:=COALESCE(v_c.stripe_charge_id,v_c.stripe_payment_intent_id);
  SELECT b.stripe_connect_id INTO v_account FROM public.brands b WHERE b.id=v_c.brand_id;
  INSERT INTO public.source_refunds(
    source_type,source_id,subject_id,brand_id,event_id,refund_kind,
    requested_by_type,requested_by_user_id,reason,provider,currency,
    original_charge_cents,buyer_refund_requested_cents,original_application_fee_cents,
    fee_reversal_required_cents,fee_state,fee_leg_kind,financial_state,
    organizer_refund_liability_cents,platform_fee_absorption_cents,
    provider_payment_reference,provider_account_reference,idempotency_key
  ) VALUES (
    'rsvp_contribution',v_c.id,v_c.id,v_c.brand_id,v_c.event_id,
    CASE WHEN p_mode='cancellation' THEN 'event_cancel' ELSE 'rsvp_discretionary' END,
    'brand_staff',v_uid,p_reason,v_c.provider,upper(v_c.currency),
    v_c.buyer_total_cents,v_requested,v_c.application_fee_amount_cents,v_fee,
    CASE WHEN v_fee=0 THEN 'not_required'
         WHEN v_c.provider='stripe' THEN 'needs_attention' ELSE 'queued' END,
    CASE WHEN v_fee=0 THEN 'not_required'
         WHEN v_c.provider='stripe' THEN 'stripe_application_fee_refund'
         ELSE 'paystack_ledger_allocation' END,
    CASE WHEN v_fee>0 AND v_c.provider='stripe' THEN 'needs_attention' ELSE 'pending' END,
    v_requested-v_fee,v_fee,v_provider_ref,v_account,
    'rsvp:'||v_c.id||':'||p_mode||':'||p_client_idempotency_key
  ) RETURNING * INTO v_refund;
  INSERT INTO public.source_refund_ledger_allocations(
    refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
  ) VALUES(v_refund.id,'buyer_refund',v_requested,v_refund.currency,v_refund.provider,
    'prepared','source-refund-allocation:buyer:'||v_refund.id);
  IF v_requested-v_fee>0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
    ) VALUES(v_refund.id,'organizer_refund_liability',v_requested-v_fee,v_refund.currency,
      v_refund.provider,'prepared','source-refund-allocation:organizer:'||v_refund.id);
  END IF;
  IF v_fee>0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
    ) VALUES(v_refund.id,'platform_application_fee_reversal',v_fee,v_refund.currency,
      v_refund.provider,'prepared','source-refund-allocation:platform:'||v_refund.id);
  END IF;
  INSERT INTO public.source_refund_events(refund_id,event_key,event_type,to_state,actor_type,safe_reason_code)
  VALUES(v_refund.id,'requested:'||v_refund.id,'requested','queued','brand_staff','rsvp_refund_requested');
  RETURN public.issue_1221_source_refund_summary(v_refund);
END $$;

CREATE OR REPLACE FUNCTION public.pg_prepare_guest_venue_cancellation_refund(
  p_reservation_id uuid,p_guest_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_r public.reservations%ROWTYPE; v_s public.reservation_checkout_sessions%ROWTYPE;
DECLARE v_refund public.source_refunds%ROWTYPE; v_provider text; v_fee integer;
DECLARE v_cutoff integer; v_refundable boolean; v_eligible boolean;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT s.* INTO v_s FROM public.reservation_checkout_sessions s
  WHERE s.reservation_id=p_reservation_id
    AND s.guest_cancel_token_hash =
      'v1:'||encode(digest(COALESCE(p_guest_token,''),'sha256'),'hex')
  ORDER BY s.created_at DESC,s.id DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('venue_reservation:'||v_s.id::text,0)
  );
  SELECT s.* INTO v_s FROM public.reservation_checkout_sessions s
  WHERE s.id=v_s.id
    AND s.guest_cancel_token_hash =
      'v1:'||encode(digest(COALESCE(p_guest_token,''),'sha256'),'hex')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  SELECT * INTO v_r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  SELECT sr.* INTO v_refund FROM public.source_refunds sr
  WHERE sr.source_type='venue_reservation' AND sr.source_id=v_s.id
    AND sr.refund_kind='venue_eligible_cancel';
  IF FOUND THEN
    RETURN jsonb_build_object('cancelled',true,'refund',public.issue_1221_source_refund_summary(v_refund));
  END IF;
  IF NOT public.pg_reservation_transition_is_legal(v_r.status,'cancelled_by_guest') THEN
    RAISE EXCEPTION 'cancel_not_allowed';
  END IF;
  SELECT cancel_cutoff_hours,fee_refundable INTO v_cutoff,v_refundable
  FROM public.venue_reservation_settings WHERE venue_id=v_r.venue_id;
  v_eligible:=v_r.payment_status='paid' AND COALESCE(v_refundable,false)
    AND public.pg_reservation_before_cancel_cutoff(v_r.reserved_for,COALESCE(v_cutoff,0));
  UPDATE public.reservations SET status='cancelled_by_guest',updated_at=now()
  WHERE id=v_r.id;
  IF NOT v_eligible THEN
    RETURN jsonb_build_object('cancelled',true,'refund',NULL);
  END IF;
  SELECT CASE WHEN b.payment_provider='paystack' THEN 'paystack' ELSE 'stripe' END
  INTO v_provider FROM public.brands b WHERE b.id=v_s.brand_id;
  v_fee:=v_s.application_fee_amount_cents;
  INSERT INTO public.source_refunds(
    source_type,source_id,subject_id,brand_id,venue_id,refund_kind,
    requested_by_type,reason,provider,currency,original_charge_cents,
    buyer_refund_requested_cents,original_application_fee_cents,
    fee_reversal_required_cents,fee_state,fee_leg_kind,financial_state,
    organizer_refund_liability_cents,platform_fee_absorption_cents,
    provider_payment_reference,provider_account_reference,idempotency_key
  ) VALUES(
    'venue_reservation',v_s.id,v_r.id,v_s.brand_id,v_s.venue_id,
    'venue_eligible_cancel','guest','Eligible guest venue reservation cancellation',
    v_provider,upper(v_s.currency),v_s.amount_cents,v_s.amount_cents,v_fee,
    COALESCE(v_fee,0),
    CASE WHEN v_fee IS NULL THEN 'needs_attention' WHEN v_fee=0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee=0 THEN 'not_required' WHEN v_provider='stripe'
      THEN 'stripe_application_fee_refund' ELSE 'paystack_ledger_allocation' END,
    CASE WHEN v_fee IS NULL THEN 'needs_attention' ELSE 'pending' END,
    v_s.amount_cents-COALESCE(v_fee,0),COALESCE(v_fee,0),
    COALESCE(v_s.stripe_payment_intent_id,v_s.paystack_reference),
    v_s.stripe_account_id,'venue_eligible_cancel:'||v_s.id
  ) RETURNING * INTO v_refund;
  INSERT INTO public.source_refund_ledger_allocations(
    refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
  ) VALUES(v_refund.id,'buyer_refund',v_refund.buyer_refund_requested_cents,
    v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:buyer:'||v_refund.id);
  IF v_refund.organizer_refund_liability_cents>0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
    ) VALUES(v_refund.id,'organizer_refund_liability',v_refund.organizer_refund_liability_cents,
      v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:organizer:'||v_refund.id);
  END IF;
  IF v_refund.platform_fee_absorption_cents>0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
    ) VALUES(v_refund.id,'platform_application_fee_reversal',v_refund.platform_fee_absorption_cents,
      v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:platform:'||v_refund.id);
  END IF;
  INSERT INTO public.source_refund_events(refund_id,event_key,event_type,to_state,actor_type,safe_reason_code)
  VALUES(v_refund.id,'requested:'||v_refund.id,'requested','queued','guest','eligible_venue_cancel');
  RETURN jsonb_build_object('cancelled',true,'refund',public.issue_1221_source_refund_summary(v_refund));
END $$;

CREATE OR REPLACE FUNCTION public.prepare_event_cancel_rsvp_source_refunds(
  p_event_id uuid
) RETURNS SETOF public.source_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_event public.events%ROWTYPE; v_c public.event_rsvp_contributions%ROWTYPE;
DECLARE v_refund public.source_refunds%ROWTYPE; v_requested integer; v_fee integer;
DECLARE v_provider_ref text; v_account text;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF COALESCE(v_event.status,'')<>'cancelled' THEN RAISE EXCEPTION 'event_not_cancelled'; END IF;
  FOR v_c IN
    SELECT * FROM public.event_rsvp_contributions
    WHERE event_id=p_event_id AND status IN ('paid','partially_refunded')
      AND buyer_total_cents>refunded_amount_cents
    ORDER BY id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('rsvp_contribution:'||v_c.id::text,0)
    );
    SELECT c.* INTO v_c FROM public.event_rsvp_contributions c
    WHERE c.id=v_c.id FOR UPDATE;
    SELECT * INTO v_refund FROM public.source_refunds
    WHERE source_type='rsvp_contribution' AND source_id=v_c.id
      AND refund_kind='event_cancel';
    IF FOUND THEN RETURN NEXT v_refund; CONTINUE; END IF;
    v_requested:=v_c.buyer_total_cents-v_c.refunded_amount_cents;
    v_fee:=least(v_requested,v_c.application_fee_amount_cents);
    v_provider_ref:=COALESCE(v_c.stripe_charge_id,v_c.stripe_payment_intent_id);
    SELECT b.stripe_connect_id INTO v_account FROM public.brands b
    WHERE b.id=v_c.brand_id;
    INSERT INTO public.source_refunds(
      source_type,source_id,subject_id,brand_id,event_id,refund_kind,
      requested_by_type,reason,provider,currency,original_charge_cents,
      buyer_refund_requested_cents,original_application_fee_cents,
      fee_reversal_required_cents,fee_state,fee_leg_kind,financial_state,
      organizer_refund_liability_cents,platform_fee_absorption_cents,
      provider_payment_reference,provider_account_reference,idempotency_key
    ) VALUES(
      'rsvp_contribution',v_c.id,v_c.id,v_c.brand_id,v_c.event_id,'event_cancel',
      'system','Event cancellation RSVP contribution refund',v_c.provider,
      upper(v_c.currency),v_c.buyer_total_cents,v_requested,
      v_c.application_fee_amount_cents,v_fee,
      CASE WHEN v_fee=0 THEN 'not_required'
           WHEN v_c.provider='stripe' THEN 'needs_attention' ELSE 'queued' END,
      CASE WHEN v_fee=0 THEN 'not_required'
           WHEN v_c.provider='stripe' THEN 'stripe_application_fee_refund'
           ELSE 'paystack_ledger_allocation' END,
      CASE WHEN v_fee>0 AND v_c.provider='stripe' THEN 'needs_attention' ELSE 'pending' END,
      v_requested-v_fee,v_fee,v_provider_ref,v_account,'event-cancel-rsvp:'||v_c.id
    ) RETURNING * INTO v_refund;
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
    ) VALUES(
      v_refund.id,'buyer_refund',v_requested,v_refund.currency,v_refund.provider,
      'prepared','source-refund-allocation:buyer:'||v_refund.id
    );
    IF v_requested-v_fee>0 THEN
      INSERT INTO public.source_refund_ledger_allocations(
        refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
      ) VALUES(
        v_refund.id,'organizer_refund_liability',v_requested-v_fee,
        v_refund.currency,v_refund.provider,'prepared',
        'source-refund-allocation:organizer:'||v_refund.id
      );
    END IF;
    IF v_fee>0 THEN
      INSERT INTO public.source_refund_ledger_allocations(
        refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
      ) VALUES(
        v_refund.id,'platform_application_fee_reversal',v_fee,
        v_refund.currency,v_refund.provider,'prepared',
        'source-refund-allocation:platform:'||v_refund.id
      );
    END IF;
    INSERT INTO public.source_refund_events(
      refund_id,event_key,event_type,to_state,actor_type,safe_reason_code
    ) VALUES(
      v_refund.id,'requested:'||v_refund.id,'requested','queued','system',
      'event_cancel_rsvp_refund'
    );
    RETURN NEXT v_refund;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.biz_list_source_refund_summaries(
  p_brand_id uuid,p_source_type text,p_subject_ids uuid[],p_limit integer,p_cursor timestamptz
) RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.biz_brand_effective_rank(p_brand_id,auth.uid())
       < public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
  RETURN QUERY SELECT public.issue_1221_source_refund_summary(sr)
  FROM public.source_refunds sr
  WHERE sr.brand_id=p_brand_id AND sr.source_type=p_source_type
    AND sr.subject_id=ANY(p_subject_ids)
    AND (p_cursor IS NULL OR sr.updated_at<p_cursor)
  ORDER BY sr.updated_at DESC,sr.id DESC LIMIT p_limit;
END $$;

CREATE OR REPLACE FUNCTION public.biz_request_source_refund_action(
  p_refund_id uuid,p_action text,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_rank integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  v_rank := public.biz_brand_effective_rank(v.brand_id,auth.uid());
  IF p_action='retry' AND v_rank < public.biz_role_rank('finance_manager') THEN
    RAISE EXCEPTION 'not_authorized';
  ELSIF p_action='escalate' AND v_rank < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized';
  ELSIF p_action NOT IN ('retry','escalate') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF p_action='retry' THEN
    IF v.buyer_state<>'failed_retryable' AND v.fee_state<>'failed_retryable' THEN
      RAISE EXCEPTION 'retry_not_allowed';
    END IF;
    UPDATE public.source_refunds SET
      buyer_state=CASE WHEN buyer_state='failed_retryable' THEN 'queued' ELSE buyer_state END,
      fee_state=CASE WHEN fee_state='failed_retryable' THEN 'queued' ELSE fee_state END,
      active_buyer_attempt_no=active_buyer_attempt_no+
        CASE WHEN buyer_state='failed_retryable' THEN 1 ELSE 0 END,
      active_fee_attempt_no=active_fee_attempt_no+
        CASE WHEN fee_state='failed_retryable' THEN 1 ELSE 0 END,
      financial_state='pending',next_retry_at=now(),ops_note=p_reason,
      updated_at=now() WHERE id=v.id RETURNING * INTO v;
  ELSE
    UPDATE public.source_refunds SET ops_status='escalated',ops_note=p_reason,
      updated_at=now() WHERE id=v.id RETURNING * INTO v;
    INSERT INTO public.source_refund_events(refund_id,event_key,event_type,actor_type,safe_reason_code)
    VALUES(v.id,'biz-escalate:'||v.id||':'||extract(epoch from now())::text,
      'ops_escalated','brand_staff','brand_escalation');
  END IF;
  RETURN public.issue_1221_source_refund_summary(v);
END $$;

CREATE OR REPLACE FUNCTION public.admin_request_source_refund_action(
  p_refund_id uuid,p_action text,p_reason text,p_actor_user_id uuid,p_actor_email text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_before jsonb; v_after jsonb;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_action NOT IN ('reconcile_provider','retry_terminal','escalate','resolve_ops') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  v_before := public.issue_1221_source_refund_summary(v);
  IF p_action='retry_terminal' THEN
    IF v.buyer_state<>'failed_terminal' AND v.fee_state<>'failed_terminal' THEN
      RAISE EXCEPTION 'retry_not_allowed';
    END IF;
    UPDATE public.source_refunds SET
      active_buyer_attempt_no=active_buyer_attempt_no+
        CASE WHEN buyer_state='failed_terminal' THEN 1 ELSE 0 END,
      active_fee_attempt_no=active_fee_attempt_no+
        CASE WHEN fee_state='failed_terminal' THEN 1 ELSE 0 END,
      buyer_state=CASE WHEN buyer_state='failed_terminal' THEN 'queued' ELSE buyer_state END,
      fee_state=CASE WHEN fee_state='failed_terminal' THEN 'queued' ELSE fee_state END,
      financial_state='pending',next_retry_at=now(),ops_note=p_reason,updated_at=now()
    WHERE id=v.id RETURNING * INTO v;
  ELSIF p_action='reconcile_provider' THEN
    UPDATE public.source_refunds SET next_retry_at=now(),ops_note=p_reason,updated_at=now()
    WHERE id=v.id RETURNING * INTO v;
  ELSIF p_action='escalate' THEN
    UPDATE public.source_refunds SET ops_status='escalated',ops_note=p_reason,updated_at=now()
    WHERE id=v.id RETURNING * INTO v;
  ELSE
    UPDATE public.source_refunds SET ops_status='resolved',ops_note=p_reason,updated_at=now()
    WHERE id=v.id RETURNING * INTO v;
  END IF;
  v_after := public.issue_1221_source_refund_summary(v);
  PERFORM public.admin_write_audit(
    'source_refund.'||p_action,'source_refund',v.id::text,p_reason,
    jsonb_build_object('before',v_before,'after',v_after),true,p_actor_email,p_actor_user_id
  );
  RETURN v_after;
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_source_refund_operation(p_refund_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT jsonb_build_object(
    'summary',public.issue_1221_source_refund_summary(sr),
    'timeline',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'eventType',e.event_type,'legType',e.leg_type,'fromState',e.from_state,
        'toState',e.to_state,'amountCents',e.amount_observed_cents,
        'providerEventType',e.provider_event_type,'safeReasonCode',e.safe_reason_code,
        'actorType',e.actor_type,'createdAt',e.created_at
      ) ORDER BY e.created_at,e.id)
      FROM public.source_refund_events e WHERE e.refund_id=sr.id
    ),'[]'::jsonb),
    'allocations',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'allocationType',a.allocation_type,'amountCents',a.amount_cents,
        'currency',a.currency,'state',a.state,'payoutReleaseId',a.payout_release_id,
        'payoutLedgerAdjustmentId',a.payout_ledger_adjustment_id
      ) ORDER BY a.allocation_type)
      FROM public.source_refund_ledger_allocations a WHERE a.refund_id=sr.id
    ),'[]'::jsonb)
  ) INTO v_result FROM public.source_refunds sr WHERE sr.id=p_refund_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  RETURN v_result;
END $$;

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
          'createdAt',pwe.created_at,'firstResponseDueAt',pwe.first_response_due_at
        ),0
      FROM public.payment_webhook_events pwe
      WHERE pwe.match_status IN ('unmatched','mismatched')
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

CREATE OR REPLACE FUNCTION public.issue_1221_raise_query_too_broad()
RETURNS integer LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'query_too_broad'; END $$;

-- Preserve the order candidate byte-for-behavior while making Venue and RSVP
-- attachment consume typed refund truth and the same source advisory lock.
CREATE OR REPLACE FUNCTION public.run_payout_release_dark_sweep(
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row record; v_release_id uuid; v_created integer:=0; v_matured integer;
  v_opened integer; v_refreshed jsonb;
BEGIN
  v_refreshed:=public.refresh_pending_payout_release_truth(p_now);
  v_opened:=public.sync_post_release_postponement_debts(p_now);
  v_matured:=public.mature_postponement_debts(p_now);
  FOR v_row IN
    WITH candidates AS (
      SELECT 'order'::text source_type,o.id source_id,e.brand_id,o.event_id,
        occ.event_date_id,b.payment_provider provider,lower(o.currency::text) currency,
        o.created_at finalized_at,occ.end_at anchor_end_at,o.total_cents gross_cents,
        o.refunded_amount_cents refunded_cents,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.order_id=o.id AND d.status NOT IN ('won','warning_closed')),0) disputed_cents,
        o.stripe_application_fee_amount_cents mingla_fee_cents,
        coalesce((SELECT sum(ps.partner_share_cents)::int FROM public.partner_splits ps
          WHERE ps.order_id=o.id),0) partner_share_cents,
        fs.provider_fee_cents,occ.event_date_id::text occurrence_key
      FROM public.orders o JOIN public.events e ON e.id=o.event_id
      JOIN public.brands b ON b.id=e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,o.created_at
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='order' AND fs.source_id=o.id
      WHERE o.payment_status IN ('paid','partial_refund')
        AND o.total_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND o.created_at>b.payout_hold_cutover_at AND e.status<>'cancelled'
      UNION ALL
      SELECT 'rsvp_contribution',c.id,e.brand_id,c.event_id,occ.event_date_id,c.provider,
        lower(c.currency),coalesce(c.paid_at,c.created_at),occ.end_at,
        c.buyer_total_cents,
        greatest(c.refunded_amount_cents,coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.buyer_state='processed'
        ),0)),0,c.application_fee_amount_cents,0,fs.provider_fee_cents,
        occ.event_date_id::text
      FROM public.event_rsvp_contributions c JOIN public.events e ON e.id=c.event_id
      JOIN public.brands b ON b.id=c.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        c.event_id,NULL,coalesce(c.paid_at,c.created_at)
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='rsvp_contribution' AND fs.source_id=c.id
      WHERE c.status IN ('paid','partially_refunded') AND b.payout_hold_cutover_at IS NOT NULL
        AND coalesce(c.paid_at,c.created_at)>b.payout_hold_cutover_at AND e.status<>'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_reservation',s.id,s.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(s.currency::text),r.created_at,s.reserved_for,s.amount_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.buyer_state='processed'
        ),0),0,0,0,fs.provider_fee_cents,'reservation:'||s.id::text
      FROM public.reservation_checkout_sessions s
      JOIN public.reservations r ON r.id=s.reservation_id
      JOIN public.brands b ON b.id=s.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_reservation' AND fs.source_id=s.id
      WHERE s.status='completed' AND s.amount_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND r.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.financial_state<>'reconciled'
        )
    )
    SELECT * FROM candidates c
    WHERE c.anchor_end_at IS NOT NULL AND c.anchor_end_at+interval '3 days'<=p_now
      AND c.gross_cents-c.refunded_cents-c.disputed_cents>0
      AND NOT EXISTS (SELECT 1 FROM public.payout_release_items i
        WHERE i.source_type=c.source_type AND i.source_id=c.source_id)
    ORDER BY c.anchor_end_at,c.source_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.source_type||':'||v_row.source_id::text,0)
    );
    IF v_row.source_type IN ('venue_reservation','rsvp_contribution') AND EXISTS (
      SELECT 1 FROM public.source_refunds sr
      WHERE sr.source_type=v_row.source_type AND sr.source_id=v_row.source_id
        AND sr.financial_state<>'reconciled'
    ) THEN CONTINUE; END IF;
    v_release_id:=public.attach_payout_release(
      v_row.source_type,v_row.source_id,v_row.brand_id,v_row.event_id,v_row.event_date_id,
      v_row.occurrence_key,v_row.provider,v_row.currency,v_row.finalized_at,v_row.anchor_end_at,
      v_row.gross_cents,v_row.refunded_cents,v_row.disputed_cents,v_row.mingla_fee_cents,
      v_row.partner_share_cents,v_row.provider_fee_cents
    );
    PERFORM public.apply_open_payout_debts(v_release_id,p_now);
    v_created:=v_created+1;
  END LOOP;
  RETURN jsonb_build_object(
    'dark',true,'attached',v_created,'opened_postponement_debts',v_opened,
    'matured_debts',v_matured,'refreshed',v_refreshed,'executed',0
  );
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_admin_source_refund_query_snapshots(
  p_limit integer DEFAULT 500
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_snapshots integer; v_items integer;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_limit<1 OR p_limit>2000 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
  PERFORM set_config('app.issue_1221_snapshot_cleanup','allowed',true);
  WITH doomed AS (
    SELECT id FROM public.admin_source_refund_query_snapshots
    WHERE expires_at<=statement_timestamp() ORDER BY expires_at,id
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), item_count AS (
    SELECT count(*)::integer n FROM public.admin_source_refund_query_snapshot_items
    WHERE snapshot_id IN (SELECT id FROM doomed)
  ), deleted AS (
    DELETE FROM public.admin_source_refund_query_snapshots
    WHERE id IN (SELECT id FROM doomed) RETURNING id
  )
  SELECT count(*)::integer,(SELECT n FROM item_count) INTO v_snapshots,v_items FROM deleted;
  RETURN jsonb_build_object('deleted_snapshots',v_snapshots,'deleted_items',v_items);
END $$;

-- A8-A12: purpose-separated, short-lived customer-attention authority.
ALTER TABLE public.source_refund_events
  DROP CONSTRAINT source_refund_events_event_type_check;
ALTER TABLE public.source_refund_events
  ADD CONSTRAINT source_refund_events_event_type_check CHECK (event_type IN (
    'requested','claimed','provider_request','provider_pending','needs_attention',
    'processed','failed','retry_scheduled','ops_escalated','ops_resolved',
    'notification_enqueued','payout_held','payout_adjusted',
    'attention_contact_corrected','attention_delivery_reclaimed',
    'attention_generation_invalidated'
  ));

ALTER TABLE public.source_refunds
  ADD COLUMN attention_token_key_id text,
  ADD COLUMN attention_submitted_at timestamptz,
  ADD COLUMN attention_submission_claim_id uuid,
  ADD COLUMN attention_submission_claimed_at timestamptz,
  ADD COLUMN attention_submission_claim_expires_at timestamptz,
  ADD COLUMN attention_submission_claim_renewed_at timestamptz,
  ADD COLUMN attention_recipient_email_override text,
  ADD COLUMN attention_recipient_phone_e164_override text,
  ADD COLUMN attention_recipient_revision integer NOT NULL DEFAULT 0
    CHECK (attention_recipient_revision >= 0),
  ADD COLUMN attention_recipient_updated_at timestamptz;

ALTER TABLE public.source_refunds ADD CONSTRAINT source_refunds_attention_token_pair
  CHECK (
    (attention_token_hash IS NULL AND attention_token_key_id IS NULL)
    OR (
      attention_token_hash ~ '^v1:[a-z0-9_-]{1,16}:[0-9a-f]{64}$'
      AND attention_token_key_id ~ '^[a-z0-9_-]{1,16}$'
      AND split_part(attention_token_hash,':',2)=attention_token_key_id
    )
  );
ALTER TABLE public.source_refunds ADD CONSTRAINT source_refunds_attention_claim_shape
  CHECK (
    (attention_submission_claim_id IS NULL
      AND attention_submission_claimed_at IS NULL
      AND attention_submission_claim_expires_at IS NULL
      AND attention_submission_claim_renewed_at IS NULL)
    OR (
      attention_submission_claim_id IS NOT NULL
      AND attention_submission_claimed_at IS NOT NULL
      AND attention_submission_claim_expires_at IS NOT NULL
      AND attention_submission_claim_expires_at>attention_submission_claimed_at
    )
  );

CREATE TABLE public.source_refund_attention_contract (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  contract_version integer NOT NULL DEFAULT 0 CHECK (contract_version IN (0,9)),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.source_refund_attention_contract(singleton,contract_version,enabled)
VALUES(true,0,false);

CREATE TABLE public.source_refund_attention_rate_limits (
  scope text NOT NULL CHECK (scope IN ('ip','actor_refund_generation')),
  mode text NOT NULL CHECK (mode IN ('banks','submit_paystack_details')),
  fingerprint text NOT NULL CHECK (
    fingerprint ~ '^v1:[a-z0-9_-]{1,16}:[A-Za-z0-9_-]{43}$'
    OR fingerprint='signed_in_unattributed'
  ),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 30),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(scope,mode,fingerprint,window_started_at)
);
CREATE INDEX source_refund_attention_rate_expiry_idx
  ON public.source_refund_attention_rate_limits(expires_at);

ALTER TABLE public.notification_outbox
  ADD COLUMN channel text CHECK (channel IN ('inapp','push','email','sms')),
  ADD COLUMN notification_group_key text,
  ADD COLUMN contract_version integer NOT NULL DEFAULT 0 CHECK (contract_version IN (0,9)),
  ADD COLUMN attention_generation integer,
  ADD COLUMN source_refund_event_id bigint REFERENCES public.source_refund_events(id) ON DELETE RESTRICT,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN parked_at timestamptz,
  ADD COLUMN brand_name_snapshot text;
ALTER TABLE public.notification_outbox DROP CONSTRAINT notification_outbox_status_check;
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_status_check
  CHECK (status IN ('pending','processing','done','failed','retry_wait','parked'));
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_source_shape
  CHECK (
    category_key NOT LIKE 'source_refund_%'
    OR (
      contract_version=9
      AND channel IS NOT NULL
      AND attention_generation>0
      AND source_refund_event_id IS NOT NULL
      AND contact IS NULL
    )
  );

CREATE TABLE public.source_refund_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.source_refunds(id) ON DELETE RESTRICT,
  source_refund_event_id bigint NOT NULL REFERENCES public.source_refund_events(id) ON DELETE RESTRICT,
  outbox_id uuid NOT NULL REFERENCES public.notification_outbox(id) ON DELETE RESTRICT,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  attention_generation integer NOT NULL CHECK (attention_generation > 0),
  audience text NOT NULL CHECK (audience IN ('buyer','brand','ops')),
  channel text NOT NULL CHECK (channel IN ('inapp','push','email','sms')),
  recipient_revision integer NOT NULL CHECK (recipient_revision >= 0),
  recipient_key_id text,
  recipient_fingerprint text,
  payload_fingerprint text NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  serializer_version integer NOT NULL DEFAULT 9 CHECK (serializer_version=9),
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'queued','dispatching','retry_wait','sent','delivered','undelivered',
    'failed_terminal','ambiguous','suppressed','skipped','superseded'
  )),
  provider text,
  provider_message_id text,
  dispatch_claim_id uuid,
  dispatch_claimed_at timestamptz,
  claim_expires_at timestamptz,
  provider_io_started_at timestamptz,
  provider_idempotency_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4),
  manual_reclaim_count integer NOT NULL DEFAULT 0
    CHECK (manual_reclaim_count >= 0 AND manual_reclaim_count <= attempts),
  next_attempt_at timestamptz,
  last_safe_code text CHECK (
    last_safe_code IS NULL OR last_safe_code ~ '^[a-z0-9_]{1,48}$'
  ),
  ambiguous_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(outbox_id),
  UNIQUE(idempotency_key,channel),
  CHECK (
    (channel IN ('email','sms') AND recipient_key_id IS NOT NULL
      AND recipient_fingerprint IS NOT NULL)
    OR (channel IN ('inapp','push') AND recipient_key_id IS NULL
      AND recipient_fingerprint IS NULL)
  ),
  CHECK (
    status<>'dispatching'
    OR (dispatch_claim_id IS NOT NULL AND dispatch_claimed_at IS NOT NULL
      AND claim_expires_at IS NOT NULL)
  ),
  CHECK (
    status<>'ambiguous' OR provider_io_started_at IS NOT NULL
  ),
  CHECK (
    channel IN ('inapp','push') OR status NOT IN ('sent','delivered')
    OR provider_message_id IS NOT NULL
  )
);
CREATE INDEX source_refund_notification_source_idx
  ON public.source_refund_notification_deliveries(
    refund_id,attention_generation,created_at,id
  );
CREATE INDEX source_refund_notification_due_idx
  ON public.source_refund_notification_deliveries(status,next_attempt_at,created_at,id)
  WHERE status IN ('queued','retry_wait');
CREATE UNIQUE INDEX source_refund_notification_provider_message_idx
  ON public.source_refund_notification_deliveries(provider,provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX source_refund_notification_claim_idx
  ON public.source_refund_notification_deliveries(claim_expires_at)
  WHERE status='dispatching';
CREATE INDEX source_refund_notification_recipient_kid_idx
  ON public.source_refund_notification_deliveries(recipient_key_id,status)
  WHERE recipient_key_id IS NOT NULL;

CREATE TABLE public.source_refund_attention_cleanup_metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  expired_hashes_cleared integer NOT NULL,
  expired_claims_cleared integer NOT NULL,
  cleanup_backlog integer NOT NULL,
  oldest_expired_age_seconds integer NOT NULL,
  active_current_kid integer NOT NULL,
  active_previous_kid integer NOT NULL,
  rate_rows_deleted integer NOT NULL,
  warning_code text
);

ALTER TABLE public.source_refund_attention_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_attention_contract FORCE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_attention_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_attention_rate_limits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_notification_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_attention_cleanup_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_refund_attention_cleanup_metrics FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.source_refund_attention_contract,
  public.source_refund_attention_rate_limits,
  public.source_refund_notification_deliveries,
  public.source_refund_attention_cleanup_metrics
FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.source_refund_attention_contract TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.source_refund_attention_rate_limits TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.source_refund_notification_deliveries TO service_role;
GRANT SELECT,INSERT,DELETE ON public.source_refund_attention_cleanup_metrics TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.source_refund_attention_cleanup_metrics_id_seq
  TO service_role;

-- Replace the early summary after the dedicated ledger exists so already
-- authorized status surfaces can show a finite parked-delivery state without
-- exposing any delivery internals.
CREATE OR REPLACE FUNCTION public.issue_1221_source_refund_summary(
  r public.source_refunds
) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object(
    'refund_id',r.id,'source_type',r.source_type,'subject_id',r.subject_id,
    'refund_kind',r.refund_kind,'buyer_state',r.buyer_state,'fee_state',r.fee_state,
    'financial_state',r.financial_state,'amount_cents',r.buyer_refund_requested_cents,
    'currency',r.currency,'requested_at',r.requested_at,'updated_at',r.updated_at,
    'processed_at',r.processed_at,'ops_status',r.ops_status,
    'attention_generation',r.attention_generation,
    'attentionDeliveryState',CASE
      WHEN EXISTS(
        SELECT 1 FROM public.source_refund_notification_deliveries delivery
        WHERE delivery.refund_id=r.id
          AND delivery.attention_generation=r.attention_generation
          AND delivery.status='ambiguous'
      ) THEN 'parked'
      WHEN EXISTS(
        SELECT 1 FROM public.source_refund_notification_deliveries delivery
        WHERE delivery.refund_id=r.id
          AND delivery.attention_generation=r.attention_generation
          AND delivery.status IN (
            'undelivered','failed_terminal','suppressed','superseded'
          )
      ) THEN 'recovery_required'
      ELSE NULL END,
    'attentionRecoveryCode',CASE
      WHEN EXISTS(
        SELECT 1 FROM public.source_refund_notification_deliveries delivery
        WHERE delivery.refund_id=r.id
          AND delivery.attention_generation=r.attention_generation
          AND delivery.status='ambiguous'
      ) THEN 'delivery_acceptance_unknown'
      WHEN EXISTS(
        SELECT 1 FROM public.source_refund_notification_deliveries delivery
        WHERE delivery.refund_id=r.id
          AND delivery.attention_generation=r.attention_generation
          AND delivery.status='undelivered'
      ) THEN 'delivery_undelivered'
      ELSE NULL END,
    'can_retry',r.buyer_state='failed_retryable',
    'public_message_code',CASE
      WHEN r.buyer_state='processed' THEN 'refund_processed'
      WHEN r.buyer_state='needs_attention' THEN 'refund_needs_attention'
      WHEN r.buyer_state IN ('failed_retryable','failed_terminal') THEN 'refund_delayed'
      ELSE 'refund_processing' END
  )
$$;

CREATE OR REPLACE FUNCTION public.admin_get_source_refund_operation(p_refund_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT jsonb_build_object(
    'summary',public.issue_1221_source_refund_summary(sr),
    'timeline',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'eventType',e.event_type,'legType',e.leg_type,'fromState',e.from_state,
        'toState',e.to_state,'amountCents',e.amount_observed_cents,
        'providerEventType',e.provider_event_type,'safeReasonCode',e.safe_reason_code,
        'actorType',e.actor_type,'createdAt',e.created_at
      ) ORDER BY e.created_at,e.id)
      FROM public.source_refund_events e WHERE e.refund_id=sr.id
    ),'[]'::jsonb),
    'allocations',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'allocationType',a.allocation_type,'amountCents',a.amount_cents,
        'currency',a.currency,'state',a.state,'payoutReleaseId',a.payout_release_id,
        'payoutLedgerAdjustmentId',a.payout_ledger_adjustment_id
      ) ORDER BY a.allocation_type)
      FROM public.source_refund_ledger_allocations a WHERE a.refund_id=sr.id
    ),'[]'::jsonb),
    'attentionDeliveries',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'generation',delivery.attention_generation,
        'deliveryId',delivery.id,
        'channel',delivery.channel,
        'status',delivery.status,
        'attempts',delivery.attempts,
        'nextAttemptAt',delivery.next_attempt_at,
        'lastSafeCode',delivery.last_safe_code,
        'contactRevision',delivery.recipient_revision,
        'emailConfigured',EXISTS(
          SELECT 1 FROM public.source_refund_notification_deliveries email_delivery
          WHERE email_delivery.refund_id=sr.id
            AND email_delivery.attention_generation=sr.attention_generation
            AND email_delivery.channel='email'
        ),
        'smsConfigured',EXISTS(
          SELECT 1 FROM public.source_refund_notification_deliveries sms_delivery
          WHERE sms_delivery.refund_id=sr.id
            AND sms_delivery.attention_generation=sr.attention_generation
            AND sms_delivery.channel='sms'
        ),
        'createdAt',delivery.created_at,
        'updatedAt',delivery.updated_at
      ) ORDER BY delivery.created_at,delivery.id)
      FROM public.source_refund_notification_deliveries delivery
      WHERE delivery.refund_id=sr.id
    ),'[]'::jsonb)
  ) INTO v_result FROM public.source_refunds sr WHERE sr.id=p_refund_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_source_refund_attention_delivery(
  p_refund_id uuid,p_attention_generation integer,p_attention_token_hash text,
  p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_kid text;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_attention_token_hash !~ '^v1:[a-z0-9_-]{1,16}:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_attention_hash';
  END IF;
  v_kid:=split_part(p_attention_token_hash,':',2);
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v.provider<>'paystack' OR v.currency<>'NGN'
     OR v.buyer_state<>'needs_attention'
     OR v.attention_action_type<>'paystack_customer_details'
     OR v.attention_generation<>p_attention_generation
     OR v.attention_completed_at IS NOT NULL
     OR v.attention_expires_at IS NULL OR v.attention_expires_at<=p_now THEN
    IF FOUND AND v.attention_expires_at<=p_now THEN
      UPDATE public.source_refunds SET attention_token_hash=NULL,
        attention_token_key_id=NULL,attention_submission_claim_id=NULL,
        attention_submission_claimed_at=NULL,
        attention_submission_claim_expires_at=NULL,
        attention_submission_claim_renewed_at=NULL,ops_status='needs_review',
        last_error_code='attention_expired',updated_at=p_now WHERE id=v.id;
    END IF;
    RETURN jsonb_build_object('deliverable',false);
  END IF;
  IF v.attention_token_hash IS NOT NULL
     AND v.attention_token_hash<>p_attention_token_hash THEN
    RAISE EXCEPTION 'attention_hash_conflict';
  END IF;
  UPDATE public.source_refunds SET
    attention_token_hash=COALESCE(attention_token_hash,p_attention_token_hash),
    attention_token_key_id=COALESCE(attention_token_key_id,v_kid),updated_at=p_now
  WHERE id=v.id RETURNING * INTO v;
  RETURN jsonb_build_object(
    'deliverable',true,'refundId',v.id,'generation',v.attention_generation,
    'keyId',v.attention_token_key_id,'expiresAt',v.attention_expires_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.authorize_source_refund_attention(
  p_refund_id uuid,p_user_id uuid,p_attention_token_hash text,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_owned boolean:=false;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v.attention_expires_at IS NULL OR v.attention_expires_at<=p_now THEN
    UPDATE public.source_refunds SET attention_token_hash=NULL,
      attention_token_key_id=NULL,attention_submission_claim_id=NULL,
      attention_submission_claimed_at=NULL,
      attention_submission_claim_expires_at=NULL,
      attention_submission_claim_renewed_at=NULL,ops_status='needs_review',
      last_error_code='attention_expired',updated_at=p_now WHERE id=v.id;
    RETURN NULL;
  END IF;
  IF p_user_id IS NOT NULL THEN
    IF v.source_type='venue_reservation' THEN
      SELECT EXISTS(SELECT 1 FROM public.reservations r
        WHERE r.id=v.subject_id AND r.consumer_user_id=p_user_id) INTO v_owned;
    ELSIF v.source_type='rsvp_contribution' THEN
      SELECT EXISTS(SELECT 1 FROM public.event_rsvp_contributions c
        WHERE c.id=v.subject_id AND c.user_id=p_user_id) INTO v_owned;
    END IF;
  ELSE
    v_owned:=p_attention_token_hash IS NOT NULL
      AND v.attention_token_hash IS NOT NULL
      AND p_attention_token_hash=v.attention_token_hash
      AND split_part(p_attention_token_hash,':',2)=v.attention_token_key_id;
  END IF;
  IF NOT v_owned OR v.provider<>'paystack' OR v.currency<>'NGN'
     OR v.buyer_state<>'needs_attention'
     OR v.attention_action_type<>'paystack_customer_details'
     OR v.attention_completed_at IS NOT NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'refundId',v.id,'sourceType',v.source_type,'sourceId',v.source_id,
    'subjectId',v.subject_id,'brandId',v.brand_id,'provider',v.provider,
    'currency',v.currency,'providerRefundId',v.provider_refund_id,
    'providerReference',v.provider_payment_reference,
    'providerAccountReference',v.provider_account_reference,
    'integrationFingerprint',v.integration_fingerprint,
    'amountCents',v.buyer_refund_requested_cents,
    'attemptNo',v.active_buyer_attempt_no,
    'generation',v.attention_generation,'expiresAt',v.attention_expires_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.consume_source_refund_attention_rate_limit(
  p_scope text,p_mode text,p_fingerprints text[],p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_window interval; v_limit integer; v_start timestamptz; v_next integer:=0;
DECLARE v_fp text;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_scope NOT IN ('ip','actor_refund_generation')
     OR p_mode NOT IN ('banks','submit_paystack_details')
     OR cardinality(p_fingerprints) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'invalid_rate_limit';
  END IF;
  IF p_scope='ip' THEN
    v_window:=CASE WHEN p_mode='banks' THEN interval '10 minutes' ELSE interval '15 minutes' END;
    v_limit:=CASE WHEN p_mode='banks' THEN 30 ELSE 10 END;
  ELSE
    v_window:=CASE WHEN p_mode='banks' THEN interval '10 minutes' ELSE interval '15 minutes' END;
    v_limit:=CASE WHEN p_mode='banks' THEN 10 ELSE 5 END;
  END IF;
  v_start:=to_timestamp(floor(extract(epoch from p_now)/extract(epoch from v_window))
    *extract(epoch from v_window));
  SELECT COALESCE(max(request_count),0)+1 INTO v_next
  FROM public.source_refund_attention_rate_limits
  WHERE scope=p_scope AND mode=p_mode
    AND fingerprint=ANY(p_fingerprints) AND window_started_at=v_start;
  FOREACH v_fp IN ARRAY p_fingerprints LOOP
    INSERT INTO public.source_refund_attention_rate_limits(
      scope,mode,fingerprint,window_started_at,request_count,expires_at
    ) VALUES(p_scope,p_mode,v_fp,v_start,v_next,v_start+interval '24 hours')
    ON CONFLICT(scope,mode,fingerprint,window_started_at) DO UPDATE SET
      request_count=v_next,expires_at=excluded.expires_at;
  END LOOP;
  RETURN jsonb_build_object(
    'allowed',v_next<=v_limit,'count',v_next,'limit',v_limit,
    'retryAfter',GREATEST(1,ceil(extract(epoch from v_start+v_window-p_now))::integer)
  );
END $$;

CREATE OR REPLACE FUNCTION public.claim_source_refund_attention_submission(
  p_refund_id uuid,p_generation integer,p_actor_type text,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_claim uuid:=gen_random_uuid();
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_actor_type NOT IN ('authenticated_buyer','attention_token_guest') THEN
    RAISE EXCEPTION 'invalid_actor';
  END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v.buyer_state<>'needs_attention'
     OR v.attention_generation<>p_generation
     OR v.attention_expires_at<=p_now THEN RETURN jsonb_build_object('claimed',false,'code','action_unavailable'); END IF;
  IF v.attention_submission_claim_id IS NOT NULL
     AND v.attention_submission_claim_expires_at>p_now THEN
    RETURN jsonb_build_object('claimed',false,'code','in_progress');
  END IF;
  UPDATE public.source_refunds SET attention_submission_claim_id=v_claim,
    attention_submission_claimed_at=p_now,
    attention_submission_claim_expires_at=p_now+interval '120 seconds',
    attention_submission_claim_renewed_at=NULL,attention_actor_type=p_actor_type,
    updated_at=p_now WHERE id=v.id;
  RETURN jsonb_build_object(
    'claimed',true,'claimId',v_claim,'claimExpiresAt',p_now+interval '120 seconds'
  );
END $$;

CREATE OR REPLACE FUNCTION public.renew_source_refund_attention_submission(
  p_refund_id uuid,p_generation integer,p_claim_id uuid,p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v.attention_generation<>p_generation
     OR v.buyer_state<>'needs_attention'
     OR v.attention_submission_claim_id<>p_claim_id
     OR v.attention_submission_claim_expires_at<=p_now
     OR v.attention_submission_claim_renewed_at IS NOT NULL
     OR p_now<v.attention_submission_claimed_at+interval '60 seconds' THEN RETURN false; END IF;
  UPDATE public.source_refunds SET attention_submission_claim_expires_at=LEAST(
      attention_submission_claimed_at+interval '240 seconds',p_now+interval '120 seconds'
    ),attention_submission_claim_renewed_at=p_now,updated_at=p_now WHERE id=v.id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.release_source_refund_attention_submission(
  p_refund_id uuid,p_generation integer,p_claim_id uuid,p_disposition text,p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_disposition NOT IN ('definitive_unsent','accepted','terminal') THEN
    RAISE EXCEPTION 'invalid_disposition';
  END IF;
  UPDATE public.source_refunds SET
    attention_submission_claim_id=NULL,attention_submission_claimed_at=NULL,
    attention_submission_claim_expires_at=NULL,
    attention_submission_claim_renewed_at=NULL,
    attention_submitted_at=CASE WHEN p_disposition='accepted' THEN p_now ELSE attention_submitted_at END,
    attention_token_hash=CASE WHEN p_disposition IN ('accepted','terminal') THEN NULL ELSE attention_token_hash END,
    attention_token_key_id=CASE WHEN p_disposition IN ('accepted','terminal') THEN NULL ELSE attention_token_key_id END,
    attention_completed_at=CASE WHEN p_disposition='accepted' THEN p_now ELSE attention_completed_at END,
    updated_at=p_now
  WHERE id=p_refund_id AND attention_generation=p_generation
    AND attention_submission_claim_id=p_claim_id;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_source_refund_attention(
  p_now timestamptz DEFAULT now(),p_limit integer DEFAULT 500
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_hashes integer:=0; v_claims integer:=0; v_rates integer:=0;
DECLARE v_backlog integer:=0; v_oldest integer:=0; v_current integer:=0; v_previous integer:=0;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
  WITH expired AS (
    SELECT id FROM public.source_refunds
    WHERE attention_expires_at<=p_now
      AND (attention_token_hash IS NOT NULL OR attention_submission_claim_id IS NOT NULL)
    ORDER BY attention_expires_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), cleared AS (
    UPDATE public.source_refunds sr SET attention_token_hash=NULL,
      attention_token_key_id=NULL,attention_submission_claim_id=NULL,
      attention_submission_claimed_at=NULL,
      attention_submission_claim_expires_at=NULL,
      attention_submission_claim_renewed_at=NULL,ops_status='needs_review',
      last_error_code='attention_expired',updated_at=p_now
    WHERE sr.id IN (SELECT id FROM expired)
    RETURNING 1
  ) SELECT count(*) INTO v_hashes FROM cleared;
  WITH expired_claims AS (
    SELECT id FROM public.source_refunds
    WHERE attention_submission_claim_expires_at<=p_now
    ORDER BY attention_submission_claim_expires_at,id
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), cleared AS (
    UPDATE public.source_refunds sr SET attention_submission_claim_id=NULL,
      attention_submission_claimed_at=NULL,
      attention_submission_claim_expires_at=NULL,
      attention_submission_claim_renewed_at=NULL,updated_at=p_now
    WHERE sr.id IN (SELECT id FROM expired_claims) RETURNING 1
  ) SELECT count(*) INTO v_claims FROM cleared;
  WITH doomed AS (
    SELECT ctid FROM public.source_refund_attention_rate_limits
    WHERE expires_at<=p_now ORDER BY expires_at LIMIT 1000
  ), deleted AS (
    DELETE FROM public.source_refund_attention_rate_limits
    WHERE ctid IN (SELECT ctid FROM doomed) RETURNING 1
  ) SELECT count(*) INTO v_rates FROM deleted;
  SELECT count(*),COALESCE(max(extract(epoch from p_now-attention_expires_at))::integer,0)
    INTO v_backlog,v_oldest FROM public.source_refunds
    WHERE attention_expires_at<=p_now AND attention_token_hash IS NOT NULL;
  SELECT count(*) FILTER(WHERE attention_token_key_id IS NOT NULL),
    0 INTO v_current,v_previous FROM public.source_refunds
    WHERE attention_token_hash IS NOT NULL;
  INSERT INTO public.source_refund_attention_cleanup_metrics(
    expired_hashes_cleared,expired_claims_cleared,cleanup_backlog,
    oldest_expired_age_seconds,active_current_kid,active_previous_kid,
    rate_rows_deleted,warning_code
  ) VALUES(
    v_hashes,v_claims,v_backlog,v_oldest,v_current,v_previous,v_rates,
    CASE WHEN v_backlog>0 OR v_oldest>600
      THEN 'source_refund_attention_cleanup_lagging' END
  );
  DELETE FROM public.source_refund_attention_cleanup_metrics
  WHERE run_at<p_now-interval '30 days';
  RETURN jsonb_build_object(
    'source_refund_attention_expired_hashes_cleared',v_hashes,
    'source_refund_attention_expired_claims_cleared',v_claims,
    'source_refund_attention_cleanup_backlog',v_backlog,
    'source_refund_attention_oldest_expired_age_seconds',v_oldest,
    'source_refund_attention_active_current_kid',v_current,
    'source_refund_attention_active_previous_kid',v_previous,
    'source_refund_attention_rate_rows_deleted',v_rates
  );
END $$;

CREATE OR REPLACE FUNCTION public.claim_notification_outbox(p_limit int DEFAULT 25)
RETURNS SETOF public.notification_outbox LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN QUERY UPDATE public.notification_outbox o SET status='processing'
  WHERE o.id IN (
    SELECT c.id FROM public.notification_outbox c
    WHERE c.status='pending' AND c.category_key NOT LIKE 'source_refund_%'
    ORDER BY c.created_at,c.id FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(LEAST(p_limit,25),0)
  ) RETURNING o.*;
END $$;

CREATE OR REPLACE FUNCTION public.claim_source_refund_notification_outbox(
  p_limit integer,p_contract_version integer,p_worker_id uuid,p_now timestamptz
) RETURNS SETOF public.notification_outbox LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_contract_version<>9 OR NOT EXISTS(
    SELECT 1 FROM public.source_refund_attention_contract
    WHERE singleton AND contract_version=9 AND enabled
  ) THEN RETURN; END IF;
  RETURN QUERY UPDATE public.notification_outbox o SET status='processing'
  WHERE o.id IN (
    SELECT c.id FROM public.notification_outbox c
    WHERE c.category_key LIKE 'source_refund_%' AND c.contract_version=9
      AND (c.status='pending' OR (c.status='retry_wait' AND c.next_attempt_at<=p_now))
    ORDER BY COALESCE(c.next_attempt_at,c.created_at),c.created_at,c.id
    FOR UPDATE SKIP LOCKED LIMIT GREATEST(LEAST(p_limit,25),0)
  ) RETURNING o.*;
END $$;

CREATE OR REPLACE FUNCTION public.claim_source_refund_notification_delivery(
  p_outbox_id uuid,p_claim_id uuid,p_contract_version integer,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refund_notification_deliveries%ROWTYPE;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_contract_version<>9 THEN RETURN jsonb_build_object('outcome','attention_dark'); END IF;
  SELECT * INTO v FROM public.source_refund_notification_deliveries
  WHERE outbox_id=p_outbox_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  IF v.status IN ('sent','delivered') THEN RETURN jsonb_build_object('outcome','already_accepted','deliveryId',v.id); END IF;
  IF v.status='dispatching' AND v.claim_expires_at>p_now THEN
    RETURN jsonb_build_object('outcome','in_progress','deliveryId',v.id);
  END IF;
  IF v.status='dispatching' AND v.claim_expires_at<=p_now
     AND v.provider_io_started_at IS NOT NULL
     AND NOT (v.channel='email' AND v.provider_idempotency_expires_at>p_now) THEN
    UPDATE public.source_refund_notification_deliveries SET status='ambiguous',
      ambiguous_at=p_now,last_safe_code='delivery_ambiguous',updated_at=p_now WHERE id=v.id;
    UPDATE public.notification_outbox SET status='parked',parked_at=p_now,
      last_error='delivery_ambiguous' WHERE id=v.outbox_id;
    RETURN jsonb_build_object('outcome','ambiguous_parked','deliveryId',v.id);
  END IF;
  IF v.attempts>=4 THEN
    UPDATE public.source_refund_notification_deliveries SET
      status='failed_terminal',last_safe_code='attempts_exhausted',
      dispatch_claim_id=NULL,dispatch_claimed_at=NULL,claim_expires_at=NULL,
      next_attempt_at=NULL,updated_at=p_now
    WHERE id=v.id;
    UPDATE public.notification_outbox SET status='failed',
      next_attempt_at=NULL,last_error='attempts_exhausted'
    WHERE id=v.outbox_id;
    UPDATE public.source_refunds SET ops_status='needs_review',
      last_error_code='attention_delivery_unavailable',updated_at=p_now
    WHERE id=v.refund_id;
    RETURN jsonb_build_object(
      'outcome','attempts_exhausted','deliveryId',v.id
    );
  END IF;
  IF v.status='retry_wait' AND v.next_attempt_at>p_now THEN
    RETURN jsonb_build_object('outcome','retry_wait','deliveryId',v.id,'nextAttemptAt',v.next_attempt_at);
  END IF;
  UPDATE public.source_refund_notification_deliveries SET status='dispatching',
    dispatch_claim_id=p_claim_id,dispatch_claimed_at=p_now,
    claim_expires_at=p_now+interval '120 seconds',attempts=attempts+1,
    updated_at=p_now WHERE id=v.id RETURNING * INTO v;
  RETURN jsonb_build_object(
    'outcome','claimed','deliveryId',v.id,'refundId',v.refund_id,
    'eventId',v.source_refund_event_id,'generation',v.attention_generation,
    'audience',v.audience,'channel',v.channel,'attempts',v.attempts,
    'recipientRevision',v.recipient_revision,'recipientKeyId',v.recipient_key_id,
    'recipientFingerprint',v.recipient_fingerprint,
    'payloadFingerprint',v.payload_fingerprint,'serializerVersion',v.serializer_version
  );
END $$;

CREATE OR REPLACE FUNCTION public.resolve_source_refund_notification_recipient(
  p_delivery_id uuid,p_claim_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refund_notification_deliveries%ROWTYPE;
DECLARE r public.source_refunds%ROWTYPE; v_email text; v_phone text;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v FROM public.source_refund_notification_deliveries
    WHERE id=p_delivery_id AND dispatch_claim_id=p_claim_id
      AND status='dispatching' AND claim_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.source_refunds WHERE id=v.refund_id;
  IF r.buyer_state<>'needs_attention'
     OR r.attention_generation<>v.attention_generation
     OR r.attention_recipient_revision<>v.recipient_revision
     OR r.attention_completed_at IS NOT NULL
     OR r.attention_expires_at IS NULL
     OR r.attention_expires_at<=now() THEN RETURN NULL; END IF;
  IF v.audience='brand' THEN
    SELECT b.contact_email,b.contact_phone
      INTO v_email,v_phone FROM public.brands b WHERE b.id=r.brand_id;
  ELSIF r.source_type='venue_reservation' THEN
    SELECT COALESCE(r.attention_recipient_email_override,s.buyer_email),
      COALESCE(r.attention_recipient_phone_e164_override,s.buyer_phone_e164)
      INTO v_email,v_phone FROM public.reservation_checkout_sessions s
      WHERE s.id=r.source_id;
  ELSE
    SELECT COALESCE(r.attention_recipient_email_override,c.guest_email),
      COALESCE(r.attention_recipient_phone_e164_override,e.guest_phone)
      INTO v_email,v_phone FROM public.event_rsvp_contributions c
      LEFT JOIN public.event_rsvps e ON e.id=c.rsvp_id WHERE c.id=r.source_id;
  END IF;
  RETURN jsonb_build_object(
    'recipient',CASE WHEN v.channel='email' THEN v_email ELSE v_phone END,
    'channel',v.channel,'refundId',r.id,'generation',r.attention_generation,
    'keyId',r.attention_token_key_id,'expiresAt',r.attention_expires_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.mark_source_refund_notification_provider_io(
  p_delivery_id uuid,p_claim_id uuid,p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.source_refund_notification_deliveries SET
    provider_io_started_at=COALESCE(provider_io_started_at,p_now),
    provider_idempotency_expires_at=CASE WHEN channel='email'
      THEN COALESCE(provider_idempotency_expires_at,p_now+interval '24 hours')
      ELSE NULL END,updated_at=p_now
  WHERE id=p_delivery_id AND dispatch_claim_id=p_claim_id
    AND status='dispatching' AND claim_expires_at>p_now;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.complete_source_refund_notification_delivery(
  p_delivery_id uuid,p_claim_id uuid,p_outcome text,p_provider_message_id text,
  p_safe_code text,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refund_notification_deliveries%ROWTYPE;
DECLARE v_status text; v_outbox text; v_backoff interval;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v FROM public.source_refund_notification_deliveries
    WHERE id=p_delivery_id AND dispatch_claim_id=p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','in_progress'); END IF;
  IF p_outcome='accepted' THEN v_status:=CASE WHEN v.channel='inapp' THEN 'delivered' ELSE 'sent' END; v_outbox:='done';
  ELSIF p_outcome='payload_changed' THEN
    v_status:='failed_terminal'; v_outbox:='parked';
  ELSIF p_outcome IN ('suppressed','skipped','terminal_unsent') THEN
    v_status:=CASE WHEN p_outcome='suppressed' THEN 'suppressed'
      WHEN p_outcome='skipped' THEN 'skipped' ELSE 'failed_terminal' END; v_outbox:='failed';
  ELSIF p_outcome='acceptance_unknown' THEN v_status:='ambiguous'; v_outbox:='parked';
  ELSIF p_outcome='definitive_unsent_retryable' AND v.attempts<4 THEN
    v_status:='retry_wait';v_outbox:='retry_wait';
    v_backoff:=CASE v.attempts WHEN 1 THEN interval '60 seconds'
      WHEN 2 THEN interval '5 minutes' ELSE interval '30 minutes' END;
  ELSE v_status:='failed_terminal';v_outbox:='failed'; END IF;
  UPDATE public.source_refund_notification_deliveries SET status=v_status,
    provider_message_id=CASE WHEN v_status IN ('sent','delivered') THEN p_provider_message_id END,
    last_safe_code=p_safe_code,next_attempt_at=CASE WHEN v_status='retry_wait' THEN p_now+v_backoff END,
    ambiguous_at=CASE WHEN v_status='ambiguous' THEN p_now END,
    delivered_at=CASE WHEN v_status='delivered' THEN p_now END,
    dispatch_claim_id=NULL,dispatch_claimed_at=NULL,claim_expires_at=NULL,updated_at=p_now
  WHERE id=v.id;
  UPDATE public.notification_outbox SET status=v_outbox,
    next_attempt_at=CASE WHEN v_outbox='retry_wait' THEN p_now+v_backoff END,
    parked_at=CASE WHEN v_outbox='parked' THEN p_now END,
    last_error=CASE WHEN v_outbox='done' THEN NULL ELSE p_safe_code END
  WHERE id=v.outbox_id;
  IF v_status IN ('ambiguous','failed_terminal') THEN
    UPDATE public.source_refunds SET ops_status='needs_review',
      last_error_code=CASE WHEN v_status='ambiguous'
        THEN 'attention_delivery_ambiguous' ELSE 'attention_delivery_unavailable' END,
      updated_at=p_now WHERE id=v.refund_id;
  END IF;
  RETURN jsonb_build_object('outcome',v_status);
END $$;

CREATE OR REPLACE FUNCTION public.classify_source_refund_notification_failure(
  p_delivery_id uuid,p_claim_id uuid,p_safe_code text,p_certainty text,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refund_notification_deliveries%ROWTYPE;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_certainty='derive' THEN
    SELECT * INTO v FROM public.source_refund_notification_deliveries
    WHERE id=p_delivery_id AND dispatch_claim_id=p_claim_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('outcome','in_progress');
    END IF;
    p_certainty:=CASE
      WHEN v.provider_io_started_at IS NULL
        THEN 'definitive_unsent_retryable'
      WHEN v.channel='email' AND v.provider_idempotency_expires_at>p_now
        THEN 'definitive_unsent_retryable'
      ELSE 'acceptance_unknown'
    END;
  ELSIF p_certainty NOT IN (
    'definitive_unsent_retryable','definitive_unsent_terminal',
    'acceptance_unknown'
  ) THEN
    p_certainty:='acceptance_unknown';
  END IF;
  RETURN public.complete_source_refund_notification_delivery(
    p_delivery_id,p_claim_id,p_certainty,NULL,p_safe_code,p_now
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_request_source_refund_attention_recovery(
  p_refund_id uuid,p_action text,p_expected_generation integer,p_delivery_id uuid,
  p_channel text,p_new_contact text,p_reason_code text,p_actor_user_id uuid,p_actor_email text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; d public.source_refund_notification_deliveries%ROWTYPE;
DECLARE s public.reservation_checkout_sessions%ROWTYPE; r public.reservations%ROWTYPE;
DECLARE c public.event_rsvp_contributions%ROWTYPE; v_before jsonb; v_after jsonb;
DECLARE v_new_generation integer; v_event_id bigint; v_norm text; v_current text;
DECLARE v_before_recipient_hmac text; v_after_recipient_hmac text;
DECLARE v_old_terminal_count integer; v_new_channel_count integer;
DECLARE v_current_email_hmac text; v_current_sms_hmac text;
DECLARE v_recipient_kid text; v_recipient_key_b64 text; v_recipient_key bytea;
DECLARE v_current_email text; v_current_phone text;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.admin_users a WHERE a.id=p_actor_user_id
      AND lower(a.email)=lower(p_actor_email) AND a.status='active') THEN
    RAISE EXCEPTION 'attention_recovery_conflict';
  END IF;
  IF p_action NOT IN ('correct_attention_contact','reclaim_confirmed_unsent','invalidate_and_resend_attention') THEN
    RAISE EXCEPTION 'attention_recovery_conflict';
  END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v.provider<>'paystack' OR v.currency<>'NGN'
     OR v.buyer_state<>'needs_attention' OR v.attention_generation<>p_expected_generation
     OR v.attention_expires_at<=now() THEN RAISE EXCEPTION 'attention_recovery_conflict'; END IF;
  IF EXISTS(SELECT 1 FROM public.source_refund_notification_deliveries
    WHERE refund_id=v.id AND attention_generation=v.attention_generation
      AND status='dispatching' AND claim_expires_at>now()) THEN
    RAISE EXCEPTION 'attention_recovery_conflict';
  END IF;
  PERFORM o.id FROM public.notification_outbox o
  WHERE o.id IN (
    SELECT locked_delivery.outbox_id
    FROM public.source_refund_notification_deliveries locked_delivery
    WHERE locked_delivery.refund_id=v.id
      AND locked_delivery.attention_generation=v.attention_generation
  )
  ORDER BY o.id FOR UPDATE;
  PERFORM locked_delivery.id
  FROM public.source_refund_notification_deliveries locked_delivery
  WHERE locked_delivery.refund_id=v.id
    AND locked_delivery.attention_generation=v.attention_generation
  ORDER BY locked_delivery.id FOR UPDATE;
  v_before:=public.issue_1221_source_refund_summary(v);
  IF p_action='correct_attention_contact' THEN
    IF p_channel NOT IN ('email','sms')
       OR p_reason_code NOT IN ('invalid_recipient','recipient_updated_contact')
       OR p_new_contact IS NULL THEN RAISE EXCEPTION 'attention_recovery_conflict'; END IF;
    IF v.source_type='venue_reservation' THEN
      SELECT * INTO s FROM public.reservation_checkout_sessions WHERE id=v.source_id;
      SELECT * INTO r FROM public.reservations
        WHERE id=s.reservation_id AND id=v.subject_id;
      IF NOT FOUND OR s.consumer_user_id IS NOT NULL OR r.consumer_user_id IS NOT NULL THEN
        RAISE EXCEPTION 'attention_recovery_conflict';
      END IF;
      v_current:=CASE WHEN p_channel='email'
        THEN COALESCE(v.attention_recipient_email_override,s.buyer_email)
        ELSE COALESCE(v.attention_recipient_phone_e164_override,s.buyer_phone_e164)
      END;
    ELSE
      SELECT * INTO c FROM public.event_rsvp_contributions WHERE id=v.source_id;
      IF NOT FOUND OR c.user_id IS NOT NULL THEN RAISE EXCEPTION 'attention_recovery_conflict'; END IF;
      IF p_channel='email' THEN
        v_current:=COALESCE(v.attention_recipient_email_override,c.guest_email);
      ELSE
        SELECT COALESCE(v.attention_recipient_phone_e164_override,e.guest_phone)
        INTO v_current FROM public.event_rsvps e WHERE e.id=c.rsvp_id;
      END IF;
    END IF;
    v_norm:=CASE WHEN p_channel='email'
      THEN lower(regexp_replace(p_new_contact,'^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$','','g'))
      ELSE regexp_replace(p_new_contact,'^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$','','g')
    END;
    IF v_norm=COALESCE(CASE WHEN p_channel='email' THEN lower(v_current) ELSE v_current END,'')
       OR (p_channel='email' AND (v_norm !~ '^[\x21-\x7e]+$'
        OR v_norm !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
        OR octet_length(v_norm)>254))
       OR (p_channel='sms' AND v_norm !~ '^\+[1-9][0-9]{1,14}$') THEN
      RAISE EXCEPTION 'attention_recovery_conflict';
    END IF;
    SELECT latest_delivery.recipient_fingerprint
    INTO v_before_recipient_hmac
    FROM public.source_refund_notification_deliveries latest_delivery
    WHERE latest_delivery.refund_id=v.id
      AND latest_delivery.attention_generation=v.attention_generation
      AND latest_delivery.channel=p_channel
    ORDER BY latest_delivery.created_at DESC,latest_delivery.id DESC LIMIT 1;
    BEGIN
      v_after_recipient_hmac:=current_setting('request.headers',true)::jsonb
        ->>'x-source-refund-recipient-hmac';
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'attention_recovery_conflict';
    END;
    IF v_after_recipient_hmac IS NULL
       OR v_after_recipient_hmac !~ '^v1:[a-z0-9_-]{1,16}:[A-Za-z0-9_-]{43}$'
       OR v_after_recipient_hmac=v_before_recipient_hmac THEN
      RAISE EXCEPTION 'attention_recovery_conflict';
    END IF;
    UPDATE public.notification_outbox SET status='failed',
      next_attempt_at=NULL,last_error='recipient_changed_requires_regeneration'
    WHERE id IN (
      SELECT pending_delivery.outbox_id
      FROM public.source_refund_notification_deliveries pending_delivery
      WHERE pending_delivery.refund_id=v.id
        AND pending_delivery.attention_generation=v.attention_generation
        AND pending_delivery.status IN ('queued','retry_wait')
    );
    UPDATE public.source_refunds SET
      attention_recipient_email_override=CASE WHEN p_channel='email' THEN v_norm ELSE attention_recipient_email_override END,
      attention_recipient_phone_e164_override=CASE WHEN p_channel='sms' THEN v_norm ELSE attention_recipient_phone_e164_override END,
      attention_recipient_revision=attention_recipient_revision+1,
      attention_recipient_updated_at=now(),attention_token_hash=NULL,
      attention_token_key_id=NULL,updated_at=now() WHERE id=v.id RETURNING * INTO v;
    UPDATE public.source_refund_notification_deliveries SET
      status='superseded',
      last_safe_code='recipient_changed_requires_regeneration',updated_at=now()
    WHERE refund_id=v.id AND attention_generation=v.attention_generation
      AND status IN ('queued','retry_wait');
    INSERT INTO public.source_refund_events(
      refund_id,event_key,event_type,actor_type,safe_reason_code,safe_payload
    ) VALUES(v.id,'attention-contact:'||v.id||':'||v.attention_recipient_revision,
      'attention_contact_corrected','admin',p_reason_code,jsonb_build_object(
        'channel',p_channel,
        'revision',v.attention_recipient_revision,
        'reasonCode',p_reason_code,
        'beforeRecipientHmac',v_before_recipient_hmac,
        'afterRecipientHmac',v_after_recipient_hmac
      ))
    RETURNING id INTO v_event_id;
  ELSIF p_action='reclaim_confirmed_unsent' THEN
    IF p_reason_code<>'provider_confirmed_unsent' OR p_delivery_id IS NULL
       OR p_channel NOT IN ('email','sms') THEN RAISE EXCEPTION 'attention_recovery_conflict'; END IF;
    SELECT * INTO d FROM public.source_refund_notification_deliveries
      WHERE id=p_delivery_id AND refund_id=v.id
        AND attention_generation=v.attention_generation AND channel=p_channel FOR UPDATE;
    IF NOT FOUND OR d.status<>'ambiguous' OR d.provider_io_started_at IS NULL
       OR d.provider_message_id IS NOT NULL OR d.attempts>=4
       OR d.recipient_revision<>v.attention_recipient_revision THEN
      RAISE EXCEPTION 'attention_recovery_conflict';
    END IF;
    UPDATE public.source_refund_notification_deliveries SET status='retry_wait',
      next_attempt_at=now(),manual_reclaim_count=manual_reclaim_count+1,
      ambiguous_at=NULL,last_safe_code='provider_confirmed_unsent',updated_at=now()
    WHERE id=d.id;
    UPDATE public.notification_outbox SET status='retry_wait',next_attempt_at=now(),
      parked_at=NULL,last_error='provider_confirmed_unsent' WHERE id=d.outbox_id;
    INSERT INTO public.source_refund_events(refund_id,event_key,event_type,actor_type,safe_reason_code)
    VALUES(v.id,'attention-reclaim:'||d.id||':'||(d.manual_reclaim_count+1),
      'attention_delivery_reclaimed','admin',p_reason_code);
  ELSE
    IF p_reason_code NOT IN ('delivery_acceptance_unknown','delivery_undelivered',
      'recipient_contact_corrected','recipient_requested_resend')
       OR p_new_contact IS NOT NULL OR NOT EXISTS(
         SELECT 1 FROM public.source_refund_notification_deliveries
         WHERE refund_id=v.id AND attention_generation=v.attention_generation
           AND status IN ('ambiguous','undelivered','failed_terminal','suppressed','superseded')
       ) THEN RAISE EXCEPTION 'attention_recovery_conflict'; END IF;
    BEGIN
      v_recipient_kid:=current_setting('request.headers',true)::jsonb
        ->>'x-source-refund-recipient-kid';
      v_recipient_key_b64:=current_setting('request.headers',true)::jsonb
        ->>'x-source-refund-recipient-key-b64';
      IF v_recipient_kid IS NULL
         OR v_recipient_kid !~ '^[a-z0-9_-]{1,16}$'
         OR v_recipient_key_b64 IS NULL
         OR v_recipient_key_b64 !~ '^[A-Za-z0-9+/]{43}=$' THEN
        RAISE EXCEPTION 'attention_recovery_conflict';
      END IF;
      v_recipient_key:=decode(v_recipient_key_b64,'base64');
      IF octet_length(v_recipient_key)<>32
         OR encode(v_recipient_key,'base64')<>v_recipient_key_b64 THEN
        RAISE EXCEPTION 'attention_recovery_conflict';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'attention_recovery_conflict';
    END;
    IF v.source_type='venue_reservation' THEN
      SELECT COALESCE(
          v.attention_recipient_email_override,current_session.buyer_email
        ),
        COALESCE(
          v.attention_recipient_phone_e164_override,
          current_session.buyer_phone_e164
        )
      INTO v_current_email,v_current_phone
      FROM public.reservation_checkout_sessions current_session
      WHERE current_session.id=v.source_id;
    ELSE
      SELECT COALESCE(
          v.attention_recipient_email_override,current_contribution.guest_email
        ),
        COALESCE(
          v.attention_recipient_phone_e164_override,current_rsvp.guest_phone
        )
      INTO v_current_email,v_current_phone
      FROM public.event_rsvp_contributions current_contribution
      LEFT JOIN public.event_rsvps current_rsvp
        ON current_rsvp.id=current_contribution.rsvp_id
      WHERE current_contribution.id=v.source_id;
    END IF;
    v_current_email:=lower(regexp_replace(
      v_current_email,'^[ \t]+|[ \t]+$','','g'
    ));
    v_current_phone:=regexp_replace(
      v_current_phone,'^[ \t]+|[ \t]+$','','g'
    );
    IF v_current_email IS NOT NULL THEN
      v_current_email_hmac:='v1:'||v_recipient_kid||':'||
        rtrim(translate(encode(extensions.hmac(
          convert_to('source_refund_notification_recipient:v1','UTF8')||
          decode('00','hex')||convert_to(v_recipient_kid,'UTF8')||
          decode('00','hex')||convert_to('email','UTF8')||
          decode('00','hex')||convert_to(v_current_email,'UTF8'),
          v_recipient_key,'sha256'
        ),'base64'),'+/','-_'),'=');
    END IF;
    IF v_current_phone IS NOT NULL THEN
      v_current_sms_hmac:='v1:'||v_recipient_kid||':'||
        rtrim(translate(encode(extensions.hmac(
          convert_to('source_refund_notification_recipient:v1','UTF8')||
          decode('00','hex')||convert_to(v_recipient_kid,'UTF8')||
          decode('00','hex')||convert_to('sms','UTF8')||
          decode('00','hex')||convert_to(v_current_phone,'UTF8'),
          v_recipient_key,'sha256'
        ),'base64'),'+/','-_'),'=');
    END IF;
    IF p_reason_code='recipient_contact_corrected' AND NOT (
      v.attention_recipient_revision > ALL(
        SELECT prior_delivery.recipient_revision
        FROM public.source_refund_notification_deliveries prior_delivery
        WHERE prior_delivery.refund_id=v.id
          AND prior_delivery.attention_generation=v.attention_generation
      )
    ) THEN RAISE EXCEPTION 'attention_recovery_conflict'; END IF;
    IF EXISTS(
      SELECT 1
      FROM public.source_refund_notification_deliveries external_delivery
      WHERE external_delivery.refund_id=v.id
        AND external_delivery.attention_generation=v.attention_generation
        AND external_delivery.audience='buyer'
        AND (
          (external_delivery.channel='email'
            AND v_current_email_hmac IS NULL)
          OR
          (external_delivery.channel='sms'
            AND v_current_sms_hmac IS NULL)
        )
    ) THEN RAISE EXCEPTION 'attention_recovery_conflict'; END IF;
    SELECT count(*) INTO v_old_terminal_count
    FROM public.source_refund_notification_deliveries
    WHERE refund_id=v.id AND attention_generation=v.attention_generation
      AND status NOT IN ('sent','delivered','superseded');
    UPDATE public.source_refund_notification_deliveries SET status='superseded',
      last_safe_code='attention_generation_superseded',updated_at=now()
    WHERE refund_id=v.id AND attention_generation=v.attention_generation
      AND status NOT IN ('sent','delivered','superseded');
    UPDATE public.notification_outbox SET status='failed',
      last_error='attention_generation_superseded'
    WHERE id IN (SELECT outbox_id FROM public.source_refund_notification_deliveries
      WHERE refund_id=v.id AND attention_generation=v.attention_generation);
    v_new_generation:=v.attention_generation+1;
    INSERT INTO public.source_refund_events(
      refund_id,event_key,event_type,actor_type,safe_reason_code
    ) VALUES(v.id,'attention-generation:'||v.id||':'||v_new_generation,
      'attention_generation_invalidated','admin',p_reason_code) RETURNING id INTO v_event_id;
    UPDATE public.source_refunds SET attention_generation=v_new_generation,
      attention_token_hash=NULL,attention_token_key_id=NULL,
      attention_submission_claim_id=NULL,attention_submission_claimed_at=NULL,
      attention_submission_claim_expires_at=NULL,
      attention_submission_claim_renewed_at=NULL,attention_completed_at=NULL,
      attention_expires_at=now()+interval '72 hours',ops_status='needs_review',
      updated_at=now() WHERE id=v.id RETURNING * INTO v;
    WITH source_rows AS (
      SELECT DISTINCT ON (old_delivery.channel)
        old_outbox.category_key,old_outbox.user_id,old_outbox.brand_id,
        old_outbox.payload,old_outbox.brand_name_snapshot,
        old_delivery.channel,old_delivery.audience,
        old_delivery.payload_fingerprint,old_delivery.serializer_version,
        CASE
          WHEN old_delivery.channel='email' AND v_current_email_hmac IS NOT NULL
            THEN v_current_email_hmac
          WHEN old_delivery.channel='sms' AND v_current_sms_hmac IS NOT NULL
            THEN v_current_sms_hmac
          ELSE NULL
        END AS recipient_fingerprint
      FROM public.source_refund_notification_deliveries old_delivery
      JOIN public.notification_outbox old_outbox
        ON old_outbox.id=old_delivery.outbox_id
      WHERE old_delivery.refund_id=v.id
        AND old_delivery.attention_generation=p_expected_generation
        AND old_delivery.audience='buyer'
      ORDER BY old_delivery.channel,old_delivery.created_at DESC,old_delivery.id DESC
    ), prepared AS (
      SELECT source_rows.*,
        'source_refund:'||v.id||':'||v_event_id||':'||v.attention_generation||
          ':buyer:'||source_rows.channel AS new_idempotency_key
      FROM source_rows
      WHERE source_rows.channel IN ('inapp','push')
        OR source_rows.recipient_fingerprint IS NOT NULL
    ), inserted_outbox AS (
      INSERT INTO public.notification_outbox(
        category_key,user_id,contact,brand_id,payload,idempotency_key,status,
        channel,notification_group_key,contract_version,attention_generation,
        source_refund_event_id,next_attempt_at,brand_name_snapshot
      )
      SELECT category_key,user_id,NULL,brand_id,payload,new_idempotency_key,
        'pending',channel,'source_refund:'||v.id||':'||v.attention_generation,
        9,v.attention_generation,v_event_id,now(),brand_name_snapshot
      FROM prepared
      ON CONFLICT(idempotency_key) DO NOTHING
      RETURNING id,idempotency_key
    ), inserted_delivery AS (
      INSERT INTO public.source_refund_notification_deliveries(
        refund_id,source_refund_event_id,outbox_id,attention_generation,
        audience,channel,recipient_revision,recipient_key_id,
        recipient_fingerprint,payload_fingerprint,serializer_version,
        idempotency_key,status,next_attempt_at
      )
      SELECT v.id,v_event_id,new_outbox.id,v.attention_generation,
        prepared.audience,prepared.channel,v.attention_recipient_revision,
        CASE WHEN prepared.channel IN ('email','sms')
          THEN split_part(prepared.recipient_fingerprint,':',2) ELSE NULL END,
        CASE WHEN prepared.channel IN ('email','sms')
          THEN prepared.recipient_fingerprint ELSE NULL END,
        prepared.payload_fingerprint,prepared.serializer_version,
        prepared.new_idempotency_key,'queued',now()
      FROM inserted_outbox new_outbox
      JOIN prepared ON prepared.new_idempotency_key=new_outbox.idempotency_key
      RETURNING channel
    )
    SELECT count(*) INTO v_new_channel_count FROM inserted_delivery;
    INSERT INTO public.source_refund_events(
      refund_id,event_key,event_type,actor_type,safe_reason_code,safe_payload
    )
    SELECT v.id,
      'attention-notification:'||v.id||':'||v.attention_generation||':'||delivery.channel,
      'notification_enqueued','system',p_reason_code,
      jsonb_build_object(
        'channel',delivery.channel,'generation',v.attention_generation
      )
    FROM public.source_refund_notification_deliveries delivery
    WHERE delivery.refund_id=v.id
      AND delivery.attention_generation=v.attention_generation
    ON CONFLICT(event_key) DO NOTHING;
  END IF;
  v_after:=public.issue_1221_source_refund_summary(v);
  IF p_delivery_id IS NOT NULL THEN
    SELECT * INTO d FROM public.source_refund_notification_deliveries
    WHERE id=p_delivery_id;
  ELSE
    SELECT * INTO d FROM public.source_refund_notification_deliveries
    WHERE refund_id=v.id AND attention_generation=v.attention_generation
    ORDER BY created_at DESC,id DESC LIMIT 1;
  END IF;
  PERFORM public.admin_write_audit(
    'source_refund.'||p_action,'source_refund',v.id::text,p_reason_code,
    jsonb_build_object('before',v_before,'after',v_after,
      'generation',v.attention_generation,'channel',p_channel,
      'contactRevision',v.attention_recipient_revision,
      'beforeRecipientHmac',v_before_recipient_hmac,
      'afterRecipientHmac',v_after_recipient_hmac,
      'oldTerminalCount',v_old_terminal_count,
      'newChannelCount',v_new_channel_count),
    true,p_actor_email,p_actor_user_id
  );
  RETURN v_after||jsonb_build_object(
    'recovery',jsonb_build_object(
      'generation',v.attention_generation,'deliveryId',p_delivery_id,
      'channel',p_channel,'status',d.status,'attempts',d.attempts,
      'nextAttemptAt',d.next_attempt_at,'lastSafeCode',d.last_safe_code,
      'contactRevision',v.attention_recipient_revision,
      'emailConfigured',EXISTS(
        SELECT 1 FROM public.source_refund_notification_deliveries configured
        WHERE configured.refund_id=v.id
          AND configured.attention_generation=v.attention_generation
          AND configured.channel='email'
      ),
      'smsConfigured',EXISTS(
        SELECT 1 FROM public.source_refund_notification_deliveries configured
        WHERE configured.refund_id=v.id
          AND configured.attention_generation=v.attention_generation
          AND configured.channel='sms'
      )
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.prepare_source_refund_attention_delivery(uuid,integer,text,timestamptz),
  public.authorize_source_refund_attention(uuid,uuid,text,timestamptz),
  public.consume_source_refund_attention_rate_limit(text,text,text[],timestamptz),
  public.claim_source_refund_attention_submission(uuid,integer,text,timestamptz),
  public.renew_source_refund_attention_submission(uuid,integer,uuid,timestamptz),
  public.release_source_refund_attention_submission(uuid,integer,uuid,text,timestamptz),
  public.cleanup_expired_source_refund_attention(timestamptz,integer),
  public.claim_source_refund_notification_outbox(integer,integer,uuid,timestamptz),
  public.claim_source_refund_notification_delivery(uuid,uuid,integer,timestamptz),
  public.resolve_source_refund_notification_recipient(uuid,uuid),
  public.mark_source_refund_notification_provider_io(uuid,uuid,timestamptz),
  public.complete_source_refund_notification_delivery(uuid,uuid,text,text,text,timestamptz),
  public.classify_source_refund_notification_failure(uuid,uuid,text,text,timestamptz),
  public.admin_request_source_refund_attention_recovery(uuid,text,integer,uuid,text,text,text,uuid,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_source_refund_attention_delivery(uuid,integer,text,timestamptz),
  public.authorize_source_refund_attention(uuid,uuid,text,timestamptz),
  public.consume_source_refund_attention_rate_limit(text,text,text[],timestamptz),
  public.claim_source_refund_attention_submission(uuid,integer,text,timestamptz),
  public.renew_source_refund_attention_submission(uuid,integer,uuid,timestamptz),
  public.release_source_refund_attention_submission(uuid,integer,uuid,text,timestamptz),
  public.cleanup_expired_source_refund_attention(timestamptz,integer),
  public.claim_source_refund_notification_outbox(integer,integer,uuid,timestamptz),
  public.claim_source_refund_notification_delivery(uuid,uuid,integer,timestamptz),
  public.resolve_source_refund_notification_recipient(uuid,uuid),
  public.mark_source_refund_notification_provider_io(uuid,uuid,timestamptz),
  public.complete_source_refund_notification_delivery(uuid,uuid,text,text,text,timestamptz),
  public.classify_source_refund_notification_failure(uuid,uuid,text,text,timestamptz),
  public.admin_request_source_refund_attention_recovery(uuid,text,integer,uuid,text,text,text,uuid,text)
TO service_role;

REVOKE EXECUTE ON FUNCTION public.pg_my_source_refund_summaries(text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pg_my_source_refund_summaries(text,uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pg_prepare_my_venue_cancellation_refund(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pg_prepare_my_venue_cancellation_refund(uuid)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pg_prepare_guest_venue_cancellation_refund(uuid,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pg_prepare_guest_venue_cancellation_refund(uuid,text)
TO service_role;
REVOKE EXECUTE ON FUNCTION public.biz_prepare_rsvp_contribution_refund(uuid,text,text,text),
  public.biz_list_source_refund_summaries(uuid,text,uuid[],integer,timestamptz)
FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_prepare_rsvp_contribution_refund(uuid,text,text,text),
  public.biz_list_source_refund_summaries(uuid,text,uuid[],integer,timestamptz)
TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pg_guest_venue_refund_summary(uuid,text),
  public.claim_source_refund_operations(text,integer,timestamptz),
  public.adopt_legacy_venue_paystack_refund_attempts(),
  public.assert_legacy_venue_paystack_adoption_ready(),
  public.ensure_source_refund_attempt(uuid,text),
  public.set_source_refund_stripe_fee_identity(uuid,text,text,integer),
  public.schedule_source_refund_retry(uuid,text,timestamptz),
  public.issue_1221_post_organizer_refund_liability(uuid,timestamptz),
  public.prepare_event_cancel_rsvp_source_refunds(uuid),
  public.record_source_refund_provider_event(uuid,text,integer,text,text,text,text,integer,text,text),
  public.cleanup_admin_source_refund_query_snapshots(integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pg_guest_venue_refund_summary(uuid,text),
  public.claim_source_refund_operations(text,integer,timestamptz),
  public.adopt_legacy_venue_paystack_refund_attempts(),
  public.assert_legacy_venue_paystack_adoption_ready(),
  public.ensure_source_refund_attempt(uuid,text),
  public.set_source_refund_stripe_fee_identity(uuid,text,text,integer),
  public.schedule_source_refund_retry(uuid,text,timestamptz),
  public.prepare_event_cancel_rsvp_source_refunds(uuid),
  public.record_source_refund_provider_event(uuid,text,integer,text,text,text,text,integer,text,text),
  public.cleanup_admin_source_refund_query_snapshots(integer)
TO service_role;
REVOKE EXECUTE ON FUNCTION public.biz_request_source_refund_action(uuid,text,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_request_source_refund_action(uuid,text,text)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_request_source_refund_action(uuid,text,text,uuid,text),
  public.admin_get_source_refund_operation(uuid),
  public.admin_list_source_refund_operations(uuid,jsonb,text,uuid,integer,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_request_source_refund_action(uuid,text,text,uuid,text),
  public.admin_get_source_refund_operation(uuid),
  public.admin_list_source_refund_operations(uuid,jsonb,text,uuid,integer,integer)
TO service_role;

-- Raw copies are scrubbed only after the canonical hashes exist.
UPDATE public.reservation_checkout_sessions SET guest_cancel_token=NULL
WHERE guest_cancel_token_hash IS NOT NULL;
UPDATE public.reservations r SET guest_cancel_token=NULL
WHERE EXISTS (
  SELECT 1 FROM public.reservation_checkout_sessions s
  WHERE s.reservation_id=r.id AND s.guest_cancel_token_hash IS NOT NULL
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='issue_1221_source_refund_backstop') THEN
    PERFORM cron.unschedule('issue_1221_source_refund_backstop');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='issue_1221_admin_refund_snapshot_cleanup') THEN
    PERFORM cron.unschedule('issue_1221_admin_refund_snapshot_cleanup');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='issue_1221_guest_token_scrub') THEN
    PERFORM cron.unschedule('issue_1221_guest_token_scrub');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='issue_1221_attention_cleanup') THEN
    PERFORM cron.unschedule('issue_1221_attention_cleanup');
  END IF;
END $$;
SELECT cron.schedule(
  'issue_1221_source_refund_backstop','*/5 * * * *',
  $cron$SELECT net.http_post(
    url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)
      ||'/functions/v1/source-refund-sweep',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name='service_role_key' LIMIT 1)
    ),
    body:='{}'::jsonb,timeout_milliseconds:=30000
  );$cron$
);
SELECT cron.schedule(
  'issue_1221_admin_refund_snapshot_cleanup','*/5 * * * *',
  $cron$SELECT public.cleanup_admin_source_refund_query_snapshots(500);$cron$
);
SELECT cron.schedule(
  'issue_1221_guest_token_scrub','*/5 * * * *',
  $cron$
    UPDATE public.reservation_checkout_sessions SET guest_cancel_token=NULL
    WHERE guest_cancel_token_hash IS NOT NULL AND guest_cancel_token IS NOT NULL;
    UPDATE public.reservations r SET guest_cancel_token=NULL
    WHERE guest_cancel_token IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.reservation_checkout_sessions s
      WHERE s.reservation_id=r.id AND s.guest_cancel_token_hash IS NOT NULL
    );
  $cron$
);
SELECT cron.schedule(
  'issue_1221_attention_cleanup','*/5 * * * *',
  $cron$SELECT public.cleanup_expired_source_refund_attention(now(),500);$cron$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reservation_checkout_sessions WHERE guest_cancel_token IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.reservations WHERE guest_cancel_token IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_1221_raw_guest_token_exit_check_failed';
  END IF;
  IF has_table_privilege('anon','public.source_refunds','SELECT')
     OR has_table_privilege('authenticated','public.source_refunds','SELECT') THEN
    RAISE EXCEPTION 'issue_1221_refund_rls_grant_failed';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class WHERE oid='public.source_refund_notification_deliveries'::regclass) THEN
    RAISE EXCEPTION 'issue_1221_source_delivery_force_rls_failed';
  END IF;
END $$;

COMMIT;
