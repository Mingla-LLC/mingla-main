-- Issue #1217 + #1219 — pre-flip NG payout gates for the #1013 event-anchored
-- payout cutover. Forward-only hardening of two functions first shipped by
-- #1172 (20270110000002) and #1177 (20270110000008); the originals are NOT
-- edited in place (migration-history-drift rule).
--
-- #1217 — Paystack payout-release alerts never drain. #1177 writes three
--   Paystack alert kinds into payout_release_alert_outbox, but the drain
--   claim_payout_release_alerts (1172) hard-filters alert_kind='stripe_attempt_
--   cap', so those rows were written + deduped but NEVER delivered. Widen the
--   claim to include the Paystack kinds and RETURN alert_kind so the worker can
--   pick rail-aware copy. record_payout_release_alert_delivery is already
--   alert_kind-agnostic and is NOT changed.
--
-- #1219 — reversal credits a fabricated amount when the amount is missing. The
--   sweep reconcile path used to fall back to the FULL leg principal; the engine
--   now credits only what Paystack returns (0 when absent — mirroring the
--   webhook). This migration hardens reverse_paystack_transfer_leg so a NULL
--   returned-amount is treated as "amount unknown" → park + alert (new alert
--   kind paystack_reversal_unreconciled) crediting NOTHING, rather than RAISE or
--   trust a caller-supplied fabricated value. Mirrors the fee_unreconciled park.
--
-- Everything stays DARK behind PAYOUT_RELEASE_EXECUTE. The verified-correct fee
-- schedule (#1216) is NOT touched. transfer_fee_credit/_debit adjustments remain
-- unconsumed by any net_release computation — this migration keeps them so.

BEGIN;

-- ── #1217 / #1219: widen the alert-outbox kinds (append the reversal kind) ──
-- Keep every previously-allowed kind; add paystack_reversal_unreconciled so the
-- #1219 park path can persist its ops alert.
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
    'paystack_reversal_unreconciled'
  ));

-- ── #1217: widen the drain claim + return alert_kind ──
-- The RETURNS TABLE gains an alert_kind column, so the function must be DROPPED
-- before re-create (CREATE OR REPLACE cannot change OUT columns). DROP also drops
-- the grants, so they are re-applied below.
DROP FUNCTION IF EXISTS public.claim_payout_release_alerts(integer,timestamptz);
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
        'paystack_reversal_unreconciled'
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

-- ── #1219: reversal credits ONLY what Paystack returns; NULL ⇒ park + alert ──
-- Same signature/return as #1177, so CREATE OR REPLACE keeps the existing grants.
--   * p_returned_principal_cents IS NULL  → amount unknown: mark the leg reversed,
--     credit NOTHING, and raise a paystack_reversal_unreconciled alert for ops to
--     reconcile manually. Mirrors the fee_unreconciled park; never fabricates a
--     credit and never trusts a caller-supplied guess.
--   * 0                                    → credit nothing, mark the leg reversed
--     (the money-safe baseline the webhook and the sweep both use on absent).
--   * > 0                                  → credit ONLY the returned principal,
--     capped at the leg principal (unchanged from #1177).
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
  -- A negative amount is still a hard input error; NULL is NOT (it means unknown).
  IF p_returned_principal_cents IS NOT NULL AND p_returned_principal_cents < 0 THEN
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

  -- Amount unknown: park + alert, credit NOTHING. Mark the leg reversed (terminal
  -- so the reconcile-first sweep never re-processes it) but post no adjustment; the
  -- paystack_reversal_unreconciled alert is the ops signal to reconcile manually.
  IF p_returned_principal_cents IS NULL THEN
    UPDATE public.payout_transfer_legs
    SET status='reversed'
    WHERE id=p_leg_id;
    INSERT INTO public.payout_release_alert_outbox (
      release_id,alert_kind,idempotency_key,brand_id,error_message,
      created_at,updated_at
    ) VALUES (
      v_leg.release_id,'paystack_reversal_unreconciled',
      'paystack_reversal_unreconciled:'||v_leg.release_id::text,
      v_release.brand_id,'paystack_transfer_reversal_unreconciled',p_now,p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    RETURN 'reversal_unreconciled';
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

COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='payout_release_alert_outbox_alert_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%paystack_reversal_unreconciled%'
  ) THEN
    RAISE EXCEPTION '#1217 advisory: reversal alert kind not present in outbox CHECK after migration';
  END IF;
  RAISE NOTICE '#1217/#1219 NG payout alert-drain + reversal gates installed (DARK until PAYOUT_RELEASE_EXECUTE=true).';
END$$;
