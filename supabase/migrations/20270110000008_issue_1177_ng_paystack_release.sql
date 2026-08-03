-- Issue #1177 (sub-issue H of #1013) — Nigerian organiser Paystack Transfer
-- execution, brand-borne fees, and reconciliation.
--
-- Execution remains DARK until PAYOUT_RELEASE_EXECUTE=true is explicitly set
-- after the R2 soak gate (and OPS-1 balance funding + OPS-2 transfer-OTP disable
-- as downstream ops gates before sub-issue I). Buyer checkout / charge creation
-- and the at-charge subaccount split are NOT touched here. Partner transfer
-- EXECUTION stays owned by partner-paystack-split-retry (E); H only accounts for
-- partner fees in the ceiling check.
--
-- Amount law — RATIFIED MODEL B (#1013 SPEC v1.2 §1 "brand absorbs the transfer
-- fee"): the transfer fee/stamp is taken OUT of the organiser pool, so the
-- organiser receives pool − fee. Partner PRINCIPAL is never reduced. Fee
-- estimate/actual variance nets forward as an append-only ledger adjustment and
-- never becomes a silent Mingla subsidy.
--
-- Mirrors the Stripe execution pattern (20270110000002): claim → authorize
-- (re-anchor) → record, plus a versioned fee reconcile and reversal. The TS
-- versioned calculator (payout-release-sweep/engine.ts) computes the chunk plan;
-- this migration persists it and drives money-safe state transitions.

BEGIN;

-- Paystack-named claim-tracking columns (sibling to C's stripe_execution_*).
ALTER TABLE public.brand_payout_releases
  ADD COLUMN IF NOT EXISTS paystack_execution_claim_id uuid,
  ADD COLUMN IF NOT EXISTS paystack_execution_claimed_at timestamptz;

-- One executed representative transfer code per release (mirrors C's Stripe
-- payout uniqueness guard).
CREATE UNIQUE INDEX IF NOT EXISTS brand_payout_releases_paystack_transfer_uniq
  ON public.brand_payout_releases (paystack_transfer_code)
  WHERE paystack_transfer_code IS NOT NULL;

-- OQ-2: the table's UNIQUE (release_id, kind, partner_split_id, chunk_index)
-- treats a NULL partner_split_id as DISTINCT, so it does NOT enforce
-- one-leg-per-chunk for organiser legs (partner_split_id IS NULL). This partial
-- unique index guarantees organiser-leg plan idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS payout_transfer_legs_organiser_chunk_uniq
  ON public.payout_transfer_legs (release_id, chunk_index)
  WHERE kind = 'organiser';

-- Widen the alert-outbox kinds for the Paystack rail (keep the existing
-- stripe_attempt_cap). The existing outbox drain remains the delivery path.
ALTER TABLE public.payout_release_alert_outbox
  DROP CONSTRAINT IF EXISTS payout_release_alert_outbox_alert_kind_check;
ALTER TABLE public.payout_release_alert_outbox
  ADD CONSTRAINT payout_release_alert_outbox_alert_kind_check
  CHECK (alert_kind IN (
    'stripe_attempt_cap',
    'paystack_otp_blocked',
    'paystack_attempt_cap',
    'paystack_fee_unreconciled',
    'paystack_over_cap'
  ));

-- ───────────────────────────────────────────────────────────────────────────
-- Claim eligible Paystack organiser releases (mirror claim_stripe_payout_
-- releases). Sets in_flight + a fresh claim id + the matured recredit, and
-- returns the release joined to its ACTIVE Paystack transfer recipient (G).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_paystack_payout_releases(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  release_id uuid,
  brand_id uuid,
  recipient_code text,
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
    JOIN public.brand_paystack_recipients rec
      ON rec.brand_id=r.brand_id AND rec.is_active
    WHERE r.provider='paystack'
      AND r.paystack_transfer_code IS NULL
      AND r.attempt_count<10
      AND r.releasable_at<=p_now
      AND (
        r.status IN (
          'pending','blocked_balance','blocked_otp','blocked_over_cap',
          'fee_unreconciled'
        )
        OR (
          r.status='in_flight'
          AND r.paystack_execution_claimed_at < p_now-interval '10 minutes'
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
        paystack_execution_claim_id=gen_random_uuid(),
        paystack_execution_claimed_at=p_now,
        error_message=NULL,
        updated_at=p_now
    FROM eligible
    WHERE r.id=eligible.id
    RETURNING r.*
  )
  SELECT
    c.id,
    c.brand_id,
    rec.recipient_code,
    c.currency,
    c.net_release_cents,
    c.maturity_recredit_cents,
    c.attempt_count,
    c.paystack_execution_claim_id
  FROM claimed c
  JOIN public.brand_paystack_recipients rec
    ON rec.brand_id=c.brand_id AND rec.is_active
  ORDER BY c.releasable_at,c.created_at,c.id;
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- Persist the TS-computed organiser chunk plan BEFORE any initiate. Idempotent
-- under retry via the organiser partial unique index. Claim-guarded.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_paystack_leg_plan(
  p_release_id uuid,
  p_claim_id uuid,
  p_legs jsonb,
  p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_leg jsonb;
  v_inserted integer:=0;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_release.paystack_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status<>'in_flight' THEN
    RAISE EXCEPTION 'stale_paystack_execution_claim' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(p_legs) <> 'array' THEN
    RAISE EXCEPTION 'paystack_leg_plan_must_be_array' USING ERRCODE='22023';
  END IF;

  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs)
  LOOP
    INSERT INTO public.payout_transfer_legs (
      release_id,
      partner_split_id,
      kind,
      chunk_index,
      principal_cents,
      estimated_fee_cents,
      stamp_duty_cents,
      fee_schedule_version
    ) VALUES (
      p_release_id,
      NULL,
      'organiser',
      (v_leg->>'chunk_index')::integer,
      (v_leg->>'principal_cents')::integer,
      (v_leg->>'estimated_fee_cents')::integer,
      (v_leg->>'stamp_duty_cents')::integer,
      coalesce(v_leg->>'fee_schedule_version','verified-2026-07-24')
    )
    ON CONFLICT (release_id, chunk_index) WHERE kind='organiser'
    DO NOTHING;
    IF FOUND THEN v_inserted:=v_inserted+1; END IF;
  END LOOP;
  RETURN v_inserted;
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- Final pre-initiate cancellation / re-anchor guard (mirror authorize_stripe_
-- payout_execution). Returns false ⇒ the sweep skips initiate for this release.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.authorize_paystack_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_event_status text;
  v_live_end_at timestamptz;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_release.paystack_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status<>'in_flight'
     OR v_release.paystack_transfer_code IS NOT NULL THEN
    RAISE EXCEPTION 'stale_paystack_execution_claim' USING ERRCODE='P0001';
  END IF;

  IF v_release.event_id IS NOT NULL THEN
    SELECT e.status INTO v_event_status
    FROM public.events e
    WHERE e.id=v_release.event_id;
    IF v_event_status IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status='blocked_anchor',
          error_message='missing_live_event_truth',
          paystack_execution_claim_id=NULL,
          paystack_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
    IF v_event_status='cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status='cancelled_event',
          error_message='event_cancelled_before_paystack_transfer',
          paystack_execution_claim_id=NULL,
          paystack_execution_claimed_at=NULL,
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
          paystack_execution_claim_id=NULL,
          paystack_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
    IF v_live_end_at+interval '3 days'>p_now THEN
      UPDATE public.brand_payout_releases
      SET anchor_end_at=v_live_end_at,
          releasable_at=v_live_end_at+interval '3 days',
          status='pending',
          error_message='event_postponed_before_paystack_transfer',
          paystack_execution_claim_id=NULL,
          paystack_execution_claimed_at=NULL,
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
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;

  RETURN true;
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- Record a single organiser chunk's initiate/reconcile result. Leg-id keyed and
-- idempotent (safe for both the sweep and the webhook — no claim id required).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_paystack_transfer_leg_outcome(
  p_leg_id uuid,
  p_release_id uuid,
  p_outcome text,
  p_transfer_code text,
  p_reference text,
  p_error text,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_leg public.payout_transfer_legs;
  v_release public.brand_payout_releases;
BEGIN
  IF p_outcome NOT IN (
    'in_flight','succeeded','otp','blocked_balance','retryable_error',
    'definitive_error'
  ) THEN
    RAISE EXCEPTION 'invalid_paystack_leg_outcome' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_leg
  FROM public.payout_transfer_legs
  WHERE id=p_leg_id AND release_id=p_release_id AND kind='organiser'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_organiser_leg_not_found' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE='P0002';
  END IF;
  -- Terminal legs never regress (idempotent replay guard).
  IF v_leg.status IN ('succeeded','failed','reversed') THEN
    RETURN v_leg.status;
  END IF;

  IF p_outcome='in_flight' THEN
    UPDATE public.payout_transfer_legs
    SET status='in_flight',
        provider_transfer_code=coalesce(p_transfer_code,provider_transfer_code),
        provider_reference=coalesce(p_reference,provider_reference)
    WHERE id=p_leg_id;
    RETURN 'in_flight';
  END IF;

  IF p_outcome='succeeded' THEN
    UPDATE public.payout_transfer_legs
    SET status='succeeded',
        provider_transfer_code=coalesce(p_transfer_code,provider_transfer_code),
        provider_reference=coalesce(p_reference,provider_reference)
    WHERE id=p_leg_id;
    RETURN 'succeeded';
  END IF;

  IF p_outcome='otp' THEN
    -- OTP blocks the whole rail (OPS-2 unmet). Release-level; no attempt burn.
    UPDATE public.brand_payout_releases
    SET status='blocked_otp',
        error_message='paystack_transfer_otp_enabled',
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    INSERT INTO public.payout_release_alert_outbox (
      release_id,alert_kind,idempotency_key,brand_id,error_message,
      created_at,updated_at
    ) VALUES (
      p_release_id,'paystack_otp_blocked',
      'paystack_otp_blocked:'||p_release_id::text,
      v_release.brand_id,
      left(coalesce(p_error,'paystack_transfer_otp_enabled'),1000),
      p_now,p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    RETURN 'blocked_otp';
  END IF;

  IF p_outcome='blocked_balance' THEN
    UPDATE public.brand_payout_releases
    SET status='blocked_balance',
        error_message=left(coalesce(p_error,'paystack_balance_below_release_ceiling'),1000),
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN 'blocked_balance';
  END IF;

  IF p_outcome='retryable_error' THEN
    -- Ambiguous/operational: keep the leg selectable with the SAME reference
    -- (no attempt bump). Release re-pending so it is re-claimable next sweep;
    -- reconcile-first resolves any transfer that actually processed.
    UPDATE public.payout_transfer_legs
    SET status='in_flight',
        provider_reference=coalesce(p_reference,provider_reference)
    WHERE id=p_leg_id;
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message=left(coalesce(p_error,'paystack_transfer_retryable'),1000),
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN 'retryable';
  END IF;

  -- definitive_error: burn the leg attempt. At cap → leg + release failed +
  -- alert. Below cap → clear the dead code/reference so reconcile-first takes
  -- the INITIATE path with the bumped a<n+1> reference; release re-pending.
  IF v_leg.attempt_count+1>=10 THEN
    UPDATE public.payout_transfer_legs
    SET status='failed',attempt_count=v_leg.attempt_count+1
    WHERE id=p_leg_id;
    UPDATE public.brand_payout_releases
    SET status='failed',
        error_message=left(coalesce(p_error,'paystack_transfer_attempt_cap'),1000),
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    INSERT INTO public.payout_release_alert_outbox (
      release_id,alert_kind,idempotency_key,brand_id,error_message,
      created_at,updated_at
    ) VALUES (
      p_release_id,'paystack_attempt_cap',
      'paystack_attempt_cap:'||p_release_id::text,
      v_release.brand_id,
      left(coalesce(p_error,'paystack_transfer_attempt_cap'),1000),
      p_now,p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    RETURN 'failed';
  END IF;
  UPDATE public.payout_transfer_legs
  SET status='planned',
      attempt_count=v_leg.attempt_count+1,
      provider_transfer_code=NULL,
      provider_reference=NULL
  WHERE id=p_leg_id;
  UPDATE public.brand_payout_releases
  SET status='pending',
      error_message=left(coalesce(p_error,'paystack_transfer_definitive'),1000),
      paystack_execution_claim_id=NULL,
      paystack_execution_claimed_at=NULL,
      updated_at=p_now
  WHERE id=p_release_id;
  RETURN 'pending';
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- Append-only actual-fee reconciliation + release finalization. Missing fee
-- truth ⇒ fee_unreconciled (never a silent Mingla charge). Once every organiser
-- leg is succeeded AND fee-reconciled, the release is finalized 'released' with
-- organiser_cash_delivered_cents = Σ succeeded chunk principals.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_paystack_transfer_leg_fee(
  p_leg_id uuid,
  p_actual_fee_cents integer,
  p_actual_stamp_cents integer,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_leg public.payout_transfer_legs;
  v_release public.brand_payout_releases;
  v_variance integer;
  v_kind text;
  v_outstanding integer;
  v_delivered integer;
  v_code text;
BEGIN
  SELECT * INTO v_leg
  FROM public.payout_transfer_legs
  WHERE id=p_leg_id AND kind='organiser'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_organiser_leg_not_found' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=v_leg.release_id AND provider='paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE='P0002';
  END IF;

  -- Missing fee truth: mark fee_unreconciled + alert. Never charge Mingla.
  IF p_actual_fee_cents IS NULL THEN
    UPDATE public.payout_transfer_legs
    SET status='fee_unreconciled'
    WHERE id=p_leg_id
      AND reconciled_at IS NULL
      AND status NOT IN ('failed','reversed');
    UPDATE public.brand_payout_releases
    SET status='fee_unreconciled',
        error_message='paystack_transfer_fee_unreconciled',
        updated_at=p_now
    WHERE id=v_leg.release_id AND status IN ('in_flight','pending','blocked_balance');
    INSERT INTO public.payout_release_alert_outbox (
      release_id,alert_kind,idempotency_key,brand_id,error_message,
      created_at,updated_at
    ) VALUES (
      v_leg.release_id,'paystack_fee_unreconciled',
      'paystack_fee_unreconciled:'||v_leg.release_id::text,
      v_release.brand_id,'paystack_transfer_fee_unreconciled',p_now,p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    RETURN 'fee_unreconciled';
  END IF;

  -- Idempotent: an already-reconciled leg does not re-post its adjustment.
  IF v_leg.reconciled_at IS NOT NULL THEN
    RETURN 'already_reconciled';
  END IF;

  v_variance := (p_actual_fee_cents + coalesce(p_actual_stamp_cents,0))
    - (v_leg.estimated_fee_cents + v_leg.stamp_duty_cents);
  UPDATE public.payout_transfer_legs
  SET status='succeeded',
      actual_fee_cents=p_actual_fee_cents,
      actual_stamp_duty_cents=coalesce(p_actual_stamp_cents,0),
      fee_variance_cents=v_variance,
      reconciled_at=p_now
  WHERE id=p_leg_id;

  IF v_variance<>0 THEN
    v_kind := CASE WHEN v_variance>0 THEN 'transfer_fee_debit'
                   ELSE 'transfer_fee_credit' END;
    INSERT INTO public.payout_ledger_adjustments (
      release_id,brand_id,currency,kind,amount_cents,provider_ref,idempotency_key
    ) VALUES (
      v_leg.release_id,v_release.brand_id,v_release.currency,v_kind,
      abs(v_variance),v_leg.provider_transfer_code,
      'paystack-fee-reconcile:'||p_leg_id::text
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  -- Finalize the release once every organiser leg is succeeded AND reconciled.
  SELECT count(*)::integer INTO v_outstanding
  FROM public.payout_transfer_legs
  WHERE release_id=v_leg.release_id AND kind='organiser'
    AND NOT (status='succeeded' AND reconciled_at IS NOT NULL);
  IF v_outstanding=0 THEN
    SELECT coalesce(sum(principal_cents),0)::integer,
           (array_agg(provider_transfer_code ORDER BY chunk_index))[1]
      INTO v_delivered,v_code
    FROM public.payout_transfer_legs
    WHERE release_id=v_leg.release_id AND kind='organiser'
      AND status='succeeded';
    UPDATE public.brand_payout_releases
    SET status='released',
        released_at=p_now,
        organiser_cash_delivered_cents=v_delivered,
        paystack_transfer_code=coalesce(v_code,paystack_transfer_code),
        error_message=NULL,
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=v_leg.release_id AND status<>'released';
    RETURN 'released';
  END IF;
  RETURN 'reconciled';
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- transfer.reversed — credit ONLY the principal Paystack actually returned;
-- reduce organiser_cash_delivered_cents accordingly.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reverse_paystack_transfer_leg(
  p_leg_id uuid,
  p_returned_principal_cents integer,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_leg public.payout_transfer_legs;
  v_release public.brand_payout_releases;
  v_returned integer;
BEGIN
  IF p_returned_principal_cents IS NULL OR p_returned_principal_cents<0 THEN
    RAISE EXCEPTION 'invalid_reversal_amount' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_leg
  FROM public.payout_transfer_legs
  WHERE id=p_leg_id AND kind='organiser'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_organiser_leg_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_leg.status='reversed' THEN
    RETURN 'reversed'; -- idempotent
  END IF;
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=v_leg.release_id AND provider='paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE='P0002';
  END IF;
  -- Never credit more than the leg principal.
  v_returned := least(p_returned_principal_cents,v_leg.principal_cents);

  UPDATE public.payout_transfer_legs
  SET status='reversed'
  WHERE id=p_leg_id;

  IF v_returned>0 THEN
    INSERT INTO public.payout_ledger_adjustments (
      release_id,brand_id,currency,kind,amount_cents,provider_ref,idempotency_key
    ) VALUES (
      v_leg.release_id,v_release.brand_id,v_release.currency,
      'transfer_fee_credit',v_returned,v_leg.provider_transfer_code,
      'paystack-reversal:'||p_leg_id::text
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    UPDATE public.brand_payout_releases
    SET organiser_cash_delivered_cents=greatest(
          0,organiser_cash_delivered_cents-v_returned
        ),
        updated_at=p_now
    WHERE id=v_leg.release_id;
  END IF;
  RETURN 'reversed';
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- Sub-floor roll-forward (SC-3): the organiser pool is below the ₦50 transfer
-- floor, so NO leg is planned and NO transfer fires. Return the release to
-- pending under the claim guard (zero fee, no attempt burn).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.defer_paystack_payout_release(
  p_release_id uuid,
  p_claim_id uuid,
  p_reason text,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.brand_payout_releases
  SET status='pending',
      paystack_execution_claim_id=NULL,
      paystack_execution_claimed_at=NULL,
      error_message=left(coalesce(p_reason,'paystack_release_deferred'),1000),
      updated_at=p_now
  WHERE id=p_release_id
    AND provider='paystack'
    AND paystack_execution_claim_id=p_claim_id
    AND status='in_flight';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION public.defer_paystack_payout_release(uuid,uuid,text,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.defer_paystack_payout_release(uuid,uuid,text,timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_paystack_payout_releases(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_paystack_leg_plan(uuid,uuid,jsonb,timestamptz)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.authorize_paystack_payout_execution(uuid,uuid,timestamptz)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_paystack_transfer_leg_outcome(
  uuid,uuid,text,text,text,text,timestamptz
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reconcile_paystack_transfer_leg_fee(
  uuid,integer,integer,timestamptz
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reverse_paystack_transfer_leg(uuid,integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_payout_releases(integer,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_paystack_leg_plan(uuid,uuid,jsonb,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.authorize_paystack_payout_execution(uuid,uuid,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_paystack_transfer_leg_outcome(
  uuid,uuid,text,text,text,text,timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_paystack_transfer_leg_fee(
  uuid,integer,integer,timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_paystack_transfer_leg(uuid,integer,timestamptz)
  TO service_role;

COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='brand_payout_releases'
      AND column_name='paystack_execution_claim_id'
  ) THEN
    RAISE EXCEPTION '#1177 advisory: paystack_execution_claim_id missing after migration';
  END IF;
  RAISE NOTICE '#1177 Paystack organiser execution layer installed (DARK until PAYOUT_RELEASE_EXECUTE=true).';
END$$;
