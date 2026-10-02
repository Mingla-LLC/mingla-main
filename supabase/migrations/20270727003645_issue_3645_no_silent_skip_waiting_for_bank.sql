-- Issue #3645 PR8 — no silent skip when money is due but payout is not ready.
--
-- Bug. claim_stripe_payout_releases / claim_paystack_payout_releases INNER JOIN
-- the bank destination (Stripe Connect with payouts_enabled / active Paystack
-- recipient). A mature release for a sell-before-bank brand therefore never
-- enters claim, never gets an error_message, and never raises an ops alert —
-- the organiser is unpaid forever with nobody told.
--
-- Also: both claim helpers still filtered occurrence maturity as
-- event_dates.end_at + 3 days even though #3645 PR1 moved maturity to
-- payment + 24h (releasable_at). That residual gate could delay claim past
-- ledger maturity for event-anchored rows.
--
-- Fix (subtractive; no parallel rail):
--   1. Claim maturity is releasable_at only (drop event_end+3d).
--   2. Stripe claim requires payouts_enabled (fail-closed; matches
--      pg_brand_can_payout / execute truth).
--   3. surface_payout_releases_waiting_for_bank marks mature pending releases
--      that cannot be claimed yet with error_message='waiting_for_bank',
--      leaves status='pending', and writes ONE durable alert-outbox row
--      (kind waiting_for_bank) so ops drain + organiser notify can fire.
--   4. Widen alert CHECK + drain allowlist in the same migration (#1217 trap).
--
-- Moves no money. Live brand cutover apply remains admin-gated and awaits
-- Seth + E2E proof on both rails before production use.

BEGIN;

-- ── Alert kind + drain (append-only; #1217 indivisible pair) ─────────────────
ALTER TABLE public.payout_release_alert_outbox
  DROP CONSTRAINT IF EXISTS payout_release_alert_outbox_alert_kind_check;
ALTER TABLE public.payout_release_alert_outbox
  ADD CONSTRAINT payout_release_alert_outbox_alert_kind_check
  CHECK (alert_kind IN (
    'stripe_attempt_cap',
    'paystack_otp_blocked',
    'paystack_attempt_cap',
    'paystack_fee_unreconciled',
    'paystack_over_cap',
    'paystack_reversal_unreconciled',
    'paystack_balance_blocked',
    'paystack_float_shortfall',
    'waiting_for_bank'
  ));

CREATE OR REPLACE FUNCTION public.claim_payout_release_alerts(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  alert_id uuid,
  release_id uuid,
  brand_id uuid,
  alert_kind text,
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
    WHERE o.alert_kind IN (
        'stripe_attempt_cap',
        'paystack_otp_blocked',
        'paystack_attempt_cap',
        'paystack_fee_unreconciled',
        'paystack_over_cap',
        'paystack_reversal_unreconciled',
        'paystack_balance_blocked',
        'paystack_float_shortfall',
        'waiting_for_bank'
      )
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
    c.alert_kind,
    c.error_message,
    c.idempotency_key,
    c.dispatch_claim_id
  FROM claimed c
  ORDER BY c.created_at,c.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_payout_release_alerts(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payout_release_alerts(integer,timestamptz)
  TO service_role;

-- ── Claim Stripe: releasable_at maturity + payouts_enabled required ──────────
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
      ON sca.brand_id=r.brand_id
     AND sca.detached_at IS NULL
     AND sca.payouts_enabled IS TRUE
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
    ON sca.brand_id=c.brand_id
   AND sca.detached_at IS NULL
   AND sca.payouts_enabled IS TRUE
  ORDER BY c.releasable_at,c.created_at,c.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_stripe_payout_releases(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_payout_releases(integer,timestamptz)
  TO service_role;

-- ── Claim Paystack: releasable_at maturity (recipient join unchanged) ────────
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

REVOKE ALL ON FUNCTION public.claim_paystack_payout_releases(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_payout_releases(integer,timestamptz)
  TO service_role;

-- ── Surface mature money waiting on bank / recipient (fail-closed wait) ─────
CREATE OR REPLACE FUNCTION public.surface_payout_releases_waiting_for_bank(
  p_limit integer DEFAULT 50,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  release_id uuid,
  brand_id uuid,
  provider text,
  net_due_cents integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      r.id,
      r.brand_id,
      r.provider,
      r.net_release_cents + coalesce((
        SELECT sum(a.amount_cents)::integer
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0) AS due_cents
    FROM public.brand_payout_releases r
    WHERE r.status='pending'
      AND r.attempt_count<10
      AND r.releasable_at<=p_now
      AND r.net_release_cents + coalesce((
        SELECT sum(a.amount_cents)::integer
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0) > 0
      AND (
        r.event_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id=r.event_id AND e.status<>'cancelled'
        )
      )
      AND (
        (
          r.provider='stripe'
          AND NOT EXISTS (
            SELECT 1
            FROM public.stripe_connect_accounts sca
            WHERE sca.brand_id=r.brand_id
              AND sca.detached_at IS NULL
              AND sca.payouts_enabled IS TRUE
          )
        )
        OR (
          r.provider='paystack'
          AND NOT EXISTS (
            SELECT 1
            FROM public.brand_paystack_recipients rec
            WHERE rec.brand_id=r.brand_id
              AND rec.is_active IS TRUE
          )
        )
      )
    ORDER BY r.releasable_at,r.created_at,r.id
    FOR UPDATE OF r SKIP LOCKED
    LIMIT greatest(1,least(p_limit,100))
  ),
  marked AS (
    UPDATE public.brand_payout_releases r
    SET error_message='waiting_for_bank',
        updated_at=p_now
    FROM candidates c
    WHERE r.id=c.id
    RETURNING r.id AS rel_id, r.brand_id AS rel_brand, r.provider AS rel_provider,
              c.due_cents AS rel_due
  ),
  alerts AS (
    INSERT INTO public.payout_release_alert_outbox (
      release_id,
      alert_kind,
      idempotency_key,
      brand_id,
      error_message,
      created_at,
      updated_at
    )
    SELECT
      m.rel_id,
      'waiting_for_bank',
      'ops.payout_release_waiting_for_bank:' || m.rel_id::text,
      m.rel_brand,
      'waiting_for_bank',
      p_now,
      p_now
    FROM marked m
    ON CONFLICT (release_id, alert_kind) DO NOTHING
    RETURNING release_id
  )
  -- Reference alerts so the INSERT CTE is never optimized away; LEFT JOIN
  -- keeps every marked row even when the outbox row already existed.
  SELECT m.rel_id, m.rel_brand, m.rel_provider, m.rel_due
  FROM marked m
  LEFT JOIN alerts a ON a.release_id = m.rel_id
  ORDER BY m.rel_id;
END;
$fn$;

COMMENT ON FUNCTION public.surface_payout_releases_waiting_for_bank(integer,timestamptz) IS
  'Issue #3645 PR8: mature pending releases that cannot be claimed for lack of bank/recipient stay pending with error_message=waiting_for_bank and one durable alert-outbox row. Never drops money; never initiates transfer.';

REVOKE ALL ON FUNCTION public.surface_payout_releases_waiting_for_bank(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.surface_payout_releases_waiting_for_bank(integer,timestamptz)
  TO service_role;

-- Self-checks: waiting_for_bank in CHECK + drain; claim bodies lack event+3d.
DO $guard$
DECLARE
  v_check text;
  v_drain text;
  v_stripe text;
  v_paystack text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_check
  FROM pg_constraint
  WHERE conname='payout_release_alert_outbox_alert_kind_check';
  IF position('waiting_for_bank' IN coalesce(v_check,'')) = 0 THEN
    RAISE EXCEPTION 'issue-3645: waiting_for_bank missing from alert_kind CHECK';
  END IF;

  v_drain := pg_get_functiondef(
    'public.claim_payout_release_alerts(integer,timestamptz)'::regprocedure
  );
  IF position('waiting_for_bank' IN v_drain) = 0 THEN
    RAISE EXCEPTION 'issue-3645: waiting_for_bank missing from alert drain (#1217 trap)';
  END IF;

  v_stripe := pg_get_functiondef(
    'public.claim_stripe_payout_releases(integer,timestamptz)'::regprocedure
  );
  v_paystack := pg_get_functiondef(
    'public.claim_paystack_payout_releases(integer,timestamptz)'::regprocedure
  );
  IF position('end_at+interval ''3 days''' IN v_stripe) > 0
     OR position('end_at + interval ''3 days''' IN v_stripe) > 0 THEN
    RAISE EXCEPTION 'issue-3645: claim_stripe still gates on event_end+3d';
  END IF;
  IF position('end_at+interval ''3 days''' IN v_paystack) > 0
     OR position('end_at + interval ''3 days''' IN v_paystack) > 0 THEN
    RAISE EXCEPTION 'issue-3645: claim_paystack still gates on event_end+3d';
  END IF;
  IF position('payouts_enabled' IN v_stripe) = 0 THEN
    RAISE EXCEPTION 'issue-3645: claim_stripe missing payouts_enabled fail-closed';
  END IF;
END
$guard$;

COMMIT;
