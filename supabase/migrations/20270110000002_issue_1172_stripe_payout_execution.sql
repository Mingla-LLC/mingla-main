-- Issue #1172 — Stripe organiser payout execution and reconciliation.
-- Execution remains DARK until PAYOUT_RELEASE_EXECUTE=true is explicitly set
-- after the R2 soak gate. Stripe charge creation and partner transfers are not
-- touched by this migration.

BEGIN;

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS initiated_by text NOT NULL DEFAULT 'stripe_auto',
  ADD COLUMN IF NOT EXISTS release_id uuid
    REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT;

ALTER TABLE public.payouts
  DROP CONSTRAINT IF EXISTS payouts_initiated_by_check;
ALTER TABLE public.payouts
  ADD CONSTRAINT payouts_initiated_by_check
  CHECK (initiated_by IN ('stripe_auto','mingla_release'));

CREATE INDEX IF NOT EXISTS payouts_release_id_idx
  ON public.payouts (release_id)
  WHERE release_id IS NOT NULL;

ALTER TABLE public.brand_payout_releases
  ADD COLUMN IF NOT EXISTS stripe_execution_claim_id uuid,
  ADD COLUMN IF NOT EXISTS stripe_execution_claimed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS brand_payout_releases_stripe_payout_uniq
  ON public.brand_payout_releases (stripe_payout_id)
  WHERE stripe_payout_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payout_release_alert_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL
    REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  alert_kind text NOT NULL CHECK (alert_kind IN ('stripe_attempt_cap')),
  idempotency_key text NOT NULL UNIQUE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  error_message text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending','dispatching','provider_accepted','manual_review'
    )),
  delivery_attempt_count integer NOT NULL DEFAULT 0
    CHECK (delivery_attempt_count >= 0),
  dispatch_claim_id uuid,
  dispatch_claimed_at timestamptz,
  last_delivery_error text,
  provider_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, alert_kind)
);

ALTER TABLE public.payout_release_alert_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_release_alert_outbox FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS payout_release_alert_outbox_retry_idx
  ON public.payout_release_alert_outbox (status, created_at)
  WHERE status IN ('pending','dispatching');

ALTER TABLE public.notification_deliveries
  ADD COLUMN IF NOT EXISTS recipient_fingerprint text,
  ADD COLUMN IF NOT EXISTS payload_fingerprint text,
  ADD COLUMN IF NOT EXISTS dispatch_claim_id uuid,
  ADD COLUMN IF NOT EXISTS dispatch_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_idempotency_expires_at timestamptz;

ALTER TABLE public.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_owner_chk;
ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_owner_chk CHECK (
    notification_id IS NOT NULL
    OR contact IS NOT NULL
    OR recipient_fingerprint IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.claim_notification_email_delivery(
  p_idempotency_key text,
  p_recipient_fingerprint text,
  p_payload_fingerprint text,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_delivery public.notification_deliveries;
  v_claim_id uuid;
BEGIN
  IF nullif(btrim(p_idempotency_key),'') IS NULL
     OR nullif(btrim(p_recipient_fingerprint),'') IS NULL
     OR nullif(btrim(p_payload_fingerprint),'') IS NULL THEN
    RAISE EXCEPTION 'email_delivery_claim_fields_required'
      USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_delivery
  FROM public.notification_deliveries
  WHERE idempotency_key=p_idempotency_key AND channel='email'
  FOR UPDATE;

  IF NOT FOUND THEN
    v_claim_id:=gen_random_uuid();
    INSERT INTO public.notification_deliveries (
      notification_id,
      channel,
      status,
      provider,
      provider_message_id,
      contact,
      idempotency_key,
      recipient_fingerprint,
      payload_fingerprint,
      dispatch_claim_id,
      dispatch_claimed_at,
      first_attempt_at,
      provider_idempotency_expires_at,
      attempt_at
    ) VALUES (
      NULL,
      'email',
      'queued',
      'resend',
      NULL,
      NULL,
      p_idempotency_key,
      p_recipient_fingerprint,
      p_payload_fingerprint,
      v_claim_id,
      p_now,
      p_now,
      p_now+interval '24 hours',
      p_now
    )
    RETURNING * INTO v_delivery;
    RETURN jsonb_build_object(
      'action','send_new',
      'delivery_id',v_delivery.id,
      'claim_id',v_claim_id,
      'provider_message_id',NULL
    );
  END IF;

  IF v_delivery.recipient_fingerprint IS DISTINCT FROM p_recipient_fingerprint
     OR v_delivery.payload_fingerprint IS DISTINCT FROM p_payload_fingerprint THEN
    RETURN jsonb_build_object(
      'action','idempotency_conflict',
      'delivery_id',v_delivery.id,
      'claim_id',NULL,
      'provider_message_id',NULL
    );
  END IF;
  IF v_delivery.status='sent' AND v_delivery.provider_message_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action','already_accepted',
      'delivery_id',v_delivery.id,
      'claim_id',NULL,
      'provider_message_id',v_delivery.provider_message_id
    );
  END IF;
  IF v_delivery.status='failed' THEN
    RETURN jsonb_build_object(
      'action','acceptance_unknown',
      'delivery_id',v_delivery.id,
      'claim_id',NULL,
      'provider_message_id',NULL
    );
  END IF;
  IF v_delivery.dispatch_claim_id IS NOT NULL
     AND v_delivery.dispatch_claimed_at>=p_now-interval '10 minutes' THEN
    RETURN jsonb_build_object(
      'action','in_progress',
      'delivery_id',v_delivery.id,
      'claim_id',NULL,
      'provider_message_id',NULL
    );
  END IF;
  IF v_delivery.provider_idempotency_expires_at IS NULL
     OR v_delivery.provider_idempotency_expires_at<=p_now THEN
    UPDATE public.notification_deliveries
    SET status='failed',
        failed_reason='acceptance_unknown_after_provider_window',
        dispatch_claim_id=NULL,
        dispatch_claimed_at=NULL,
        attempt_at=p_now
    WHERE id=v_delivery.id;
    RETURN jsonb_build_object(
      'action','acceptance_unknown',
      'delivery_id',v_delivery.id,
      'claim_id',NULL,
      'provider_message_id',NULL
    );
  END IF;

  v_claim_id:=gen_random_uuid();
  UPDATE public.notification_deliveries
  SET dispatch_claim_id=v_claim_id,
      dispatch_claimed_at=p_now,
      attempt_at=p_now
  WHERE id=v_delivery.id;
  RETURN jsonb_build_object(
    'action','retry_same_provider_key',
    'delivery_id',v_delivery.id,
    'claim_id',v_claim_id,
    'provider_message_id',NULL
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'action','in_progress',
      'delivery_id',NULL,
      'claim_id',NULL,
      'provider_message_id',NULL
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.complete_notification_email_delivery(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_outcome text,
  p_provider_message_id text DEFAULT NULL,
  p_error_reason text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_delivery public.notification_deliveries;
BEGIN
  IF p_outcome NOT IN ('accepted','retryable','manual_review') THEN
    RAISE EXCEPTION 'invalid_email_delivery_outcome' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_delivery
  FROM public.notification_deliveries
  WHERE id=p_delivery_id AND channel='email'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'email_delivery_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_delivery.dispatch_claim_id IS DISTINCT FROM p_claim_id THEN
    RAISE EXCEPTION 'stale_email_delivery_claim' USING ERRCODE='P0001';
  END IF;
  IF p_outcome='accepted'
     AND nullif(btrim(coalesce(p_provider_message_id,'')),'') IS NULL THEN
    RAISE EXCEPTION 'provider_message_id_required' USING ERRCODE='22023';
  END IF;

  UPDATE public.notification_deliveries
  SET status=CASE p_outcome
        WHEN 'accepted' THEN 'sent'
        WHEN 'retryable' THEN 'queued'
        ELSE 'failed'
      END,
      provider_message_id=CASE WHEN p_outcome='accepted'
        THEN p_provider_message_id ELSE provider_message_id END,
      delivered_at=CASE WHEN p_outcome='accepted' THEN p_now ELSE delivered_at END,
      failed_reason=CASE WHEN p_outcome='accepted' THEN NULL
        ELSE left(coalesce(p_error_reason,p_outcome),500) END,
      dispatch_claim_id=NULL,
      dispatch_claimed_at=NULL,
      attempt_at=p_now
  WHERE id=p_delivery_id;
  RETURN CASE p_outcome
    WHEN 'accepted' THEN 'provider_accepted'
    WHEN 'retryable' THEN 'retry_pending'
    ELSE 'manual_review'
  END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.authorize_stripe_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_amount_cents integer,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_event_status text;
  v_live_end_at timestamptz;
  v_expected integer;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='stripe'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stripe_release_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_release.stripe_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status<>'in_flight'
     OR v_release.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'stale_stripe_execution_claim' USING ERRCODE='P0001';
  END IF;
  v_expected:=v_release.net_release_cents+v_release.maturity_recredit_cents;
  IF p_amount_cents IS DISTINCT FROM v_expected OR v_expected<=0 THEN
    RAISE EXCEPTION 'stripe_release_amount_not_ledger_exact'
      USING ERRCODE='P0001';
  END IF;

  IF v_release.event_id IS NOT NULL THEN
    SELECT e.status INTO v_event_status
    FROM public.events e
    WHERE e.id=v_release.event_id;
    IF v_event_status IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status='blocked_anchor',
          error_message='missing_live_event_truth',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
    IF v_event_status='cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status='cancelled_event',
          error_message='event_cancelled_before_stripe_payout',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;

    SELECT ed.end_at INTO v_live_end_at
    FROM public.event_dates ed
    WHERE ed.id=v_release.event_date_id
      AND ed.event_id=v_release.event_id;
    IF v_live_end_at IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status='blocked_anchor',
          error_message='missing_live_occurrence_truth',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
    IF v_live_end_at+interval '3 days'>p_now THEN
      UPDATE public.brand_payout_releases
      SET anchor_end_at=v_live_end_at,
          releasable_at=v_live_end_at+interval '3 days',
          status='pending',
          error_message='event_postponed_before_stripe_payout',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
    IF v_live_end_at IS DISTINCT FROM v_release.anchor_end_at THEN
      UPDATE public.brand_payout_releases
      SET anchor_end_at=v_live_end_at,
          releasable_at=v_live_end_at+interval '3 days',
          updated_at=p_now
      WHERE id=p_release_id;
    END IF;
  ELSIF v_release.releasable_at>p_now THEN
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message='release_no_longer_mature',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;

  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.claim_stripe_payout_releases(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  release_id uuid,
  brand_id uuid,
  stripe_account_id text,
  currency text,
  net_release_cents integer,
  maturity_recredit_cents integer,
  attempt_count integer,
  claim_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT
      r.id,
      coalesce((
        SELECT sum(a.amount_cents)::integer
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0) AS recredit
    FROM public.brand_payout_releases r
    JOIN public.stripe_connect_accounts sca
      ON sca.brand_id=r.brand_id AND sca.detached_at IS NULL
    WHERE r.provider='stripe'
      AND r.stripe_payout_id IS NULL
      AND r.attempt_count<10
      AND r.releasable_at<=p_now
      AND (
        r.status IN ('pending','blocked_kyc','blocked_balance')
        OR (
          r.status='in_flight'
          AND r.stripe_execution_claimed_at < p_now-interval '10 minutes'
        )
      )
      AND (
        r.event_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id=r.event_id AND e.status<>'cancelled'
        )
      )
      AND (
        r.event_date_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.event_dates ed
          WHERE ed.id=r.event_date_id
            AND ed.event_id=r.event_id
            AND ed.end_at+interval '3 days'<=p_now
        )
      )
      AND r.net_release_cents + coalesce((
        SELECT sum(a.amount_cents)::integer
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0) > 0
    ORDER BY r.releasable_at,r.created_at,r.id
    FOR UPDATE OF r SKIP LOCKED
    LIMIT greatest(1,least(p_limit,100))
  ),
  claimed AS (
    UPDATE public.brand_payout_releases r
    SET status='in_flight',
        maturity_recredit_cents=eligible.recredit,
        stripe_execution_claim_id=gen_random_uuid(),
        stripe_execution_claimed_at=p_now,
        error_message=NULL,
        updated_at=p_now
    FROM eligible
    WHERE r.id=eligible.id
    RETURNING r.*
  )
  SELECT
    c.id,
    c.brand_id,
    sca.stripe_account_id,
    c.currency,
    c.net_release_cents,
    c.maturity_recredit_cents,
    c.attempt_count,
    c.stripe_execution_claim_id
  FROM claimed c
  JOIN public.stripe_connect_accounts sca
    ON sca.brand_id=c.brand_id AND sca.detached_at IS NULL
  ORDER BY c.releasable_at,c.created_at,c.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_stripe_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_outcome text,
  p_payout_id text,
  p_amount_cents integer,
  p_error_message text,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_expected integer;
  v_status text;
BEGIN
  IF p_outcome NOT IN (
    'accepted','blocked_balance','blocked_kyc','retryable_error',
    'definitive_error'
  ) THEN
    RAISE EXCEPTION 'invalid_stripe_execution_outcome' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='stripe'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stripe_release_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_release.stripe_execution_claim_id IS DISTINCT FROM p_claim_id THEN
    RAISE EXCEPTION 'stale_stripe_execution_claim' USING ERRCODE='P0001';
  END IF;
  v_expected:=v_release.net_release_cents+v_release.maturity_recredit_cents;
  IF p_amount_cents IS DISTINCT FROM v_expected OR v_expected<=0 THEN
    RAISE EXCEPTION 'stripe_release_amount_not_ledger_exact'
      USING ERRCODE='P0001';
  END IF;

  IF p_outcome='accepted' THEN
    IF p_payout_id IS NULL OR btrim(p_payout_id)='' THEN
      RAISE EXCEPTION 'stripe_payout_id_required' USING ERRCODE='22023';
    END IF;
    UPDATE public.brand_payout_releases
    SET stripe_payout_id=p_payout_id,
        organiser_cash_delivered_cents=v_expected,
        status='released',
        released_at=p_now,
        error_message=NULL,
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN 'released';
  END IF;

  v_status:=CASE p_outcome
    WHEN 'blocked_balance' THEN 'blocked_balance'
    WHEN 'blocked_kyc' THEN 'blocked_kyc'
    WHEN 'definitive_error' THEN
      CASE WHEN v_release.attempt_count+1>=10 THEN 'failed' ELSE 'pending' END
    ELSE 'pending'
  END;
  UPDATE public.brand_payout_releases
  SET status=v_status,
      attempt_count=CASE WHEN p_outcome='definitive_error'
        THEN v_release.attempt_count+1 ELSE v_release.attempt_count END,
      error_message=left(coalesce(p_error_message,p_outcome),1000),
      stripe_execution_claim_id=NULL,
      stripe_execution_claimed_at=NULL,
      updated_at=p_now
  WHERE id=p_release_id;
  IF v_status='failed' THEN
    INSERT INTO public.payout_release_alert_outbox (
      release_id,
      alert_kind,
      idempotency_key,
      brand_id,
      error_message,
      created_at,
      updated_at
    ) VALUES (
      p_release_id,
      'stripe_attempt_cap',
      'ops.stripe_payout_release_attempt_cap:' || p_release_id::text,
      v_release.brand_id,
      left(coalesce(p_error_message,'stripe_attempt_cap_reached'),1000),
      p_now,
      p_now
    )
    ON CONFLICT (release_id, alert_kind) DO NOTHING;
  END IF;
  RETURN v_status;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.claim_payout_release_alerts(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  alert_id uuid,
  release_id uuid,
  brand_id uuid,
  error_message text,
  idempotency_key text,
  claim_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT o.id
    FROM public.payout_release_alert_outbox o
    WHERE o.alert_kind='stripe_attempt_cap'
      AND (
        o.status='pending'
        OR (
          o.status='dispatching'
          AND o.dispatch_claimed_at < p_now-interval '10 minutes'
        )
      )
    ORDER BY o.created_at,o.id
    FOR UPDATE OF o SKIP LOCKED
    LIMIT greatest(1,least(p_limit,100))
  ),
  claimed AS (
    UPDATE public.payout_release_alert_outbox o
    SET status='dispatching',
        dispatch_claim_id=gen_random_uuid(),
        dispatch_claimed_at=p_now,
        updated_at=p_now
    FROM eligible
    WHERE o.id=eligible.id
    RETURNING o.*
  )
  SELECT
    c.id,
    c.release_id,
    c.brand_id,
    c.error_message,
    c.idempotency_key,
    c.dispatch_claim_id
  FROM claimed c
  ORDER BY c.created_at,c.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_payout_release_alert_delivery(
  p_alert_id uuid,
  p_claim_id uuid,
  p_outcome text,
  p_error_message text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_alert public.payout_release_alert_outbox;
BEGIN
  IF p_outcome NOT IN ('provider_accepted','retryable','manual_review') THEN
    RAISE EXCEPTION 'invalid_payout_release_alert_outcome'
      USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_alert
  FROM public.payout_release_alert_outbox
  WHERE id=p_alert_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_release_alert_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_alert.status<>'dispatching'
     OR v_alert.dispatch_claim_id IS DISTINCT FROM p_claim_id THEN
    RAISE EXCEPTION 'stale_payout_release_alert_claim' USING ERRCODE='P0001';
  END IF;

  UPDATE public.payout_release_alert_outbox
  SET status=CASE p_outcome
        WHEN 'provider_accepted' THEN 'provider_accepted'
        WHEN 'manual_review' THEN 'manual_review'
        ELSE 'pending'
      END,
      delivery_attempt_count=delivery_attempt_count+1,
      dispatch_claim_id=NULL,
      dispatch_claimed_at=NULL,
      last_delivery_error=CASE
        WHEN p_outcome='provider_accepted' THEN NULL
        ELSE left(coalesce(p_error_message,'alert_delivery_failed'),1000)
      END,
      provider_accepted_at=CASE WHEN p_outcome='provider_accepted'
        THEN p_now ELSE provider_accepted_at END,
      updated_at=p_now
  WHERE id=p_alert_id;
  RETURN CASE p_outcome
    WHEN 'provider_accepted' THEN 'provider_accepted'
    WHEN 'manual_review' THEN 'manual_review'
    ELSE 'pending'
  END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_stripe_payout_webhook_failure(
  p_payout_id text,
  p_retryable_kyc boolean,
  p_error_message text,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_status text;
  v_next_attempt integer;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE provider='stripe' AND stripe_payout_id=p_payout_id
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT r.* INTO v_release
    FROM public.payouts p
    JOIN public.brand_payout_releases r ON r.id=p.release_id
    WHERE p.stripe_payout_id=p_payout_id
    FOR UPDATE OF r;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'release_id',NULL,'status','stripe_auto','attempt_cap_reached',false,
        'mutated',false
      );
    END IF;
    RETURN jsonb_build_object(
      'release_id',v_release.id,'status',v_release.status,
      'attempt_cap_reached',v_release.status='failed','mutated',false
    );
  END IF;

  IF p_retryable_kyc THEN
    v_next_attempt:=v_release.attempt_count;
    v_status:='blocked_kyc';
    UPDATE public.brand_payout_releases
    SET stripe_payout_id=NULL,
        organiser_cash_delivered_cents=0,
        attempt_count=v_next_attempt,
        status=v_status,
        error_message=left(coalesce(p_error_message,'stripe_payout_failed'),1000),
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=v_release.id;
  ELSE
    v_status:='failed';
    UPDATE public.brand_payout_releases
    SET organiser_cash_delivered_cents=0,
        status=v_status,
        error_message=left(coalesce(p_error_message,'stripe_payout_failed'),1000),
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=v_release.id;
    INSERT INTO public.payout_release_alert_outbox (
      release_id,
      alert_kind,
      idempotency_key,
      brand_id,
      error_message,
      created_at,
      updated_at
    ) VALUES (
      v_release.id,
      'stripe_attempt_cap',
      'ops.stripe_payout_release_attempt_cap:' || v_release.id::text,
      v_release.brand_id,
      left(coalesce(p_error_message,'stripe_payout_failed'),1000),
      p_now,
      p_now
    )
    ON CONFLICT (release_id, alert_kind) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'release_id',v_release.id,'status',v_status,
    'attempt_cap_reached',NOT p_retryable_kyc,'mutated',true
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.authorize_stripe_payout_execution(
  uuid,uuid,integer,timestamptz
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_stripe_payout_releases(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_stripe_payout_execution(
  uuid,uuid,text,text,integer,text,timestamptz
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_payout_release_alerts(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_payout_release_alert_delivery(
  uuid,uuid,text,text,timestamptz
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_notification_email_delivery(
  text,text,text,timestamptz
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_notification_email_delivery(
  uuid,uuid,text,text,text,timestamptz
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_stripe_payout_webhook_failure(
  text,boolean,text,timestamptz
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_stripe_payout_execution(
  uuid,uuid,integer,timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_stripe_payout_releases(integer,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_stripe_payout_execution(
  uuid,uuid,text,text,integer,text,timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_payout_release_alerts(integer,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payout_release_alert_delivery(
  uuid,uuid,text,text,timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_email_delivery(
  text,text,text,timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_email_delivery(
  uuid,uuid,text,text,text,timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_stripe_payout_webhook_failure(
  text,boolean,text,timestamptz
) TO service_role;

COMMIT;
