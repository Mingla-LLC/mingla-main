-- Issue #1173 (sub-issue D of #1013) — Stripe event-anchored payout SCHEDULE FLIP.
--
-- Adds the atomic per-brand CUTOVER STAMP machinery that pairs with the
-- already-live Stripe schedule flip (setManualPayoutSchedule, _shared/
-- stripeBlueprintClient.ts). The stamp writes brands.payout_hold_cutover_at
-- (column ALREADY created by 20270110000001:7 — DO NOT re-add it) so the live
-- ledger/sweep (B/#1171, C/#1172) begins counting only post-cutover money.
--
-- This migration touches NO payment provider and moves NO money. The real
-- production flip ships DARK (PAYOUT_HOLD_ONBOARD_FLIP off; admin migration
-- gated behind B's soak + a separate explicit go).
--
-- Ships:
--   (a) payout_hold_cutover_migrations — append-only batch/audit ledger.
--   (b) stamp_payout_hold_cutover(...)    — SECURITY DEFINER, stamps once.
--   (c) rollback_payout_hold_cutover(...) — SECURITY DEFINER, NULLs the stamp.
--
-- Enforces (DRAFT until CLOSE): I-PROPOSED-1173-FLIP-STAMP-ATOMIC +
-- I-PROPOSED-1173-CUTOVER-STAMP-ONCE. Preserves I-1013-CUTOVER-EXCLUDES-PRE
-- (the stamp is the only gate that admits money; attach_payout_release
-- 20270110000001:376-380 excludes sources at/<= cutover).

BEGIN;

--------------------------------------------------------------------------------
-- (a) Batch / audit ledger. Append-only: one row per per-brand attempt.
--------------------------------------------------------------------------------
CREATE TABLE public.payout_hold_cutover_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  stripe_account_id text,
  direction text NOT NULL CHECK (direction IN ('hold','rollback')),
  prior_interval text,
  new_interval text,
  cutover_before timestamptz,
  cutover_after timestamptz,
  result text NOT NULL CHECK (result IN (
    'flipped','skipped_already_stamped','skipped_no_account','flip_failed',
    'stamp_failed_rolled_back','rolled_back','rollback_failed'
  )),
  error_message text,
  actor_email text,
  actor_uid uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payout_hold_cutover_migrations_batch_idx
  ON public.payout_hold_cutover_migrations (batch_id, created_at);
CREATE INDEX payout_hold_cutover_migrations_brand_idx
  ON public.payout_hold_cutover_migrations (brand_id, created_at);

ALTER TABLE public.payout_hold_cutover_migrations ENABLE ROW LEVEL SECURITY;

-- Admin read only (established single admin gate — public.is_admin_user()).
-- No client write policy: service_role bypasses RLS for the direct skip/fail
-- inserts, and the SECURITY DEFINER RPCs below write the mutating-success rows.
CREATE POLICY payout_hold_cutover_migrations_admin_read
  ON public.payout_hold_cutover_migrations
  FOR SELECT TO authenticated USING (public.is_admin_user());

GRANT SELECT, INSERT ON public.payout_hold_cutover_migrations TO service_role;

--------------------------------------------------------------------------------
-- (b) stamp_payout_hold_cutover — atomic, idempotent per-brand cutover stamp.
--
-- ONE transaction: FOR UPDATE lock on the brand row + the atomic
-- `WHERE ... IS NULL` update make concurrent stamps idempotent (only one wins;
-- the loser reads a non-NULL cutover after the winner commits → skip). The
-- stamp is per-BRAND and at-most-ONCE: a re-onboarding / country-replacement
-- brand is a no-op.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_payout_hold_cutover(
  p_brand_id uuid,
  p_stripe_account_id text,
  p_batch_id uuid,
  p_actor_email text,
  p_actor_uid uuid,
  p_reason text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_brand_exists boolean;
  v_cutover timestamptz;
  v_new_cutover timestamptz;
BEGIN
  SELECT true, payout_hold_cutover_at
    INTO v_brand_exists, v_cutover
  FROM public.brands
  WHERE id = p_brand_id
  FOR UPDATE;

  IF NOT COALESCE(v_brand_exists, false) THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_cutover IS NOT NULL THEN
    -- Already stamped — record the idempotent skip, do not re-stamp.
    INSERT INTO public.payout_hold_cutover_migrations (
      batch_id, brand_id, stripe_account_id, direction,
      prior_interval, new_interval, cutover_before, cutover_after,
      result, actor_email, actor_uid, reason
    ) VALUES (
      p_batch_id, p_brand_id, p_stripe_account_id, 'hold',
      'manual', 'manual', v_cutover, v_cutover,
      'skipped_already_stamped', p_actor_email, p_actor_uid, p_reason
    );
    RETURN 'skipped_already_stamped';
  END IF;

  UPDATE public.brands
     SET payout_hold_cutover_at = now()
   WHERE id = p_brand_id AND payout_hold_cutover_at IS NULL
  RETURNING payout_hold_cutover_at INTO v_new_cutover;

  INSERT INTO public.payout_hold_cutover_migrations (
    batch_id, brand_id, stripe_account_id, direction,
    prior_interval, new_interval, cutover_before, cutover_after,
    result, actor_email, actor_uid, reason
  ) VALUES (
    p_batch_id, p_brand_id, p_stripe_account_id, 'hold',
    'daily', 'manual', NULL, v_new_cutover,
    'flipped', p_actor_email, p_actor_uid, p_reason
  );
  RETURN 'flipped';
END;
$fn$;

--------------------------------------------------------------------------------
-- (c) rollback_payout_hold_cutover — restore the status quo (NULL the stamp).
--
-- Called by the admin fn ONLY AFTER a successful restoreDailyPayoutSchedule.
-- NULLs payout_hold_cutover_at when currently set (idempotent otherwise) and
-- records a rolled_back row. Ledger rows are append-only and harmless when a
-- brand is un-stamped: attach_payout_release raises source_not_after_cutover
-- (20270110000001:378) once cutover is NULL, so no releases compute.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rollback_payout_hold_cutover(
  p_brand_id uuid,
  p_stripe_account_id text,
  p_batch_id uuid,
  p_actor_email text,
  p_actor_uid uuid,
  p_reason text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_brand_exists boolean;
  v_cutover timestamptz;
BEGIN
  SELECT true, payout_hold_cutover_at
    INTO v_brand_exists, v_cutover
  FROM public.brands
  WHERE id = p_brand_id
  FOR UPDATE;

  IF NOT COALESCE(v_brand_exists, false) THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_cutover IS NOT NULL THEN
    UPDATE public.brands
       SET payout_hold_cutover_at = NULL
     WHERE id = p_brand_id;
  END IF;

  INSERT INTO public.payout_hold_cutover_migrations (
    batch_id, brand_id, stripe_account_id, direction,
    prior_interval, new_interval, cutover_before, cutover_after,
    result, actor_email, actor_uid, reason
  ) VALUES (
    p_batch_id, p_brand_id, p_stripe_account_id, 'rollback',
    'manual', 'daily', v_cutover, NULL,
    'rolled_back', p_actor_email, p_actor_uid, p_reason
  );
  RETURN 'rolled_back';
END;
$fn$;

-- Least privilege: service_role only (edge fns call after their own admin gate).
REVOKE ALL ON FUNCTION public.stamp_payout_hold_cutover(uuid,text,uuid,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stamp_payout_hold_cutover(uuid,text,uuid,text,uuid,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_payout_hold_cutover(uuid,text,uuid,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.rollback_payout_hold_cutover(uuid,text,uuid,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rollback_payout_hold_cutover(uuid,text,uuid,text,uuid,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_payout_hold_cutover(uuid,text,uuid,text,uuid,text) TO service_role;

--------------------------------------------------------------------------------
-- Self-assert: apply FAILS if the table or either function is absent post-create.
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'payout_hold_cutover_migrations'
  ) THEN
    RAISE EXCEPTION '#1173: payout_hold_cutover_migrations table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'stamp_payout_hold_cutover'
  ) THEN
    RAISE EXCEPTION '#1173: stamp_payout_hold_cutover function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rollback_payout_hold_cutover'
  ) THEN
    RAISE EXCEPTION '#1173: rollback_payout_hold_cutover function missing';
  END IF;
END $$;

COMMIT;
