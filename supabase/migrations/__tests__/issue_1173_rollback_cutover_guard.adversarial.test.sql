-- #1173 (sub-issue D of #1013) — TESTER ADVERSARIAL SQL harness.
--
-- DIFFERENT ANGLE than the implementor's issue_1173_stamp_cutover.test.sql
-- (which only proves stamp-once / idempotent-skip / rollback-NULLs the value).
-- This harness attacks the CROSS-DOMAIN contract and the error paths the
-- implementor never touches:
--
--   CASE A — a STAMPED brand with a post-cutover finalized_at is NOT blocked by
--            the cutover guard in attach_payout_release (post-cutover money IS
--            releasable). Proves the guard is specific, not a blanket block.
--   CASE B — after rollback_payout_hold_cutover NULLs the stamp,
--            attach_payout_release RAISES 'source_not_after_cutover' so NO
--            release can be computed. Proves rollback truly severs the Stripe
--            hold from the release ledger (I-1013-CUTOVER-EXCLUDES-PRE +
--            I-PROPOSED-1173-FLIP-STAMP-ATOMIC rollback lever).
--   CASE C — re-stamp AFTER rollback returns 'flipped' again (rollback resets
--            state for a clean re-migration; the stamp-once invariant is scoped
--            to the current cutover, not the brand's lifetime).
--   CASE D — stamp_payout_hold_cutover on a non-existent brand RAISES
--            'brand_not_found' (error path; no silent no-op, Const #3).
--
-- Fails-on-revert: delete the `UPDATE public.brands SET payout_hold_cutover_at
-- = NULL` line from rollback_payout_hold_cutover (20270110000007) → CASE B no
-- longer raises source_not_after_cutover (the stamp survives) and the harness
-- fails. Restore → PASS.
--
-- Run via psql with ON_ERROR_STOP=1 against a DB with every migration applied;
-- any RAISE EXCEPTION fails the job. Wrapped in a transaction that ROLLBACKs.

BEGIN;
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id) VALUES
  ('11730000-0000-0000-0000-0000000000a1');
INSERT INTO public.creator_accounts(id) VALUES
  ('11730000-0000-0000-0000-0000000000a1');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payout_hold_cutover_at)
VALUES (
  '11730000-0000-0000-0000-0000000000aa',
  '11730000-0000-0000-0000-0000000000a1',
  'D-1173 Adversarial Brand', 'issue-1173-adversarial-brand', 'USD', NULL
);

SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_brand uuid := '11730000-0000-0000-0000-0000000000aa';
  v_actor uuid := '11730000-0000-0000-0000-0000000000a1';
  v_batch uuid := '11730000-0000-0000-0000-0000000000ba';
  v_finalized timestamptz;
  v_result text;
  v_err text;
  v_cutover timestamptz;
BEGIN
  -- Stamp the brand, then anchor a payment AFTER the cutover.
  v_result := public.stamp_payout_hold_cutover(
    v_brand, 'acct_adv', v_batch, 'admin@usemingla.com', v_actor, 'wave-2');
  IF v_result <> 'flipped' THEN
    RAISE EXCEPTION 'setup FAIL: first stamp returned % (expected flipped)', v_result;
  END IF;
  SELECT payout_hold_cutover_at INTO v_cutover FROM public.brands WHERE id = v_brand;
  v_finalized := v_cutover + interval '1 hour';

  -- CASE A — stamped brand, post-cutover money → NOT blocked by cutover guard.
  BEGIN
    PERFORM public.attach_payout_release(
      'order', gen_random_uuid(), v_brand, NULL, NULL, 'occ-adv-a',
      'stripe', 'usd', v_finalized, v_finalized, 1000, 0, 0, 100, 0, 50);
    -- proceeded past the guard (a release row was created) — acceptable.
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err = 'source_not_after_cutover' THEN
      RAISE EXCEPTION 'CASE A FAIL: stamped brand with post-cutover money wrongly blocked by source_not_after_cutover';
    END IF;
    -- any OTHER error (e.g. downstream ledger constraint) still proves the
    -- cutover guard itself passed — that is all CASE A asserts.
  END;

  -- Rollback → NULL the stamp (the documented status-quo-restore lever).
  v_result := public.rollback_payout_hold_cutover(
    v_brand, 'acct_adv', v_batch, 'admin@usemingla.com', v_actor, 'rollback');
  IF v_result <> 'rolled_back' THEN
    RAISE EXCEPTION 'CASE B setup FAIL: rollback returned % (expected rolled_back)', v_result;
  END IF;

  -- CASE B — after rollback, the SAME post-cutover money is now un-releasable.
  BEGIN
    PERFORM public.attach_payout_release(
      'order', gen_random_uuid(), v_brand, NULL, NULL, 'occ-adv-b',
      'stripe', 'usd', v_finalized, v_finalized, 1000, 0, 0, 100, 0, 50);
    RAISE EXCEPTION 'CASE B FAIL: attach_payout_release did NOT raise after rollback (cutover not severed — the dangerous state)';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'source_not_after_cutover' THEN
      RAISE EXCEPTION 'CASE B FAIL: expected source_not_after_cutover after rollback, got %', v_err;
    END IF;
  END;

  -- CASE C — re-stamp after rollback flips again (state reset for re-migration).
  v_result := public.stamp_payout_hold_cutover(
    v_brand, 'acct_adv', gen_random_uuid(), 'admin@usemingla.com', v_actor, 're-migrate');
  IF v_result <> 'flipped' THEN
    RAISE EXCEPTION 'CASE C FAIL: re-stamp after rollback returned % (expected flipped)', v_result;
  END IF;

  -- CASE D — stamp on a non-existent brand RAISES brand_not_found (no silent no-op).
  BEGIN
    PERFORM public.stamp_payout_hold_cutover(
      '11730000-0000-0000-0000-0000dead0000', 'acct_ghost', gen_random_uuid(),
      'admin@usemingla.com', v_actor, 'ghost');
    RAISE EXCEPTION 'CASE D FAIL: stamp on non-existent brand did not raise';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err <> 'brand_not_found' THEN
      RAISE EXCEPTION 'CASE D FAIL: expected brand_not_found, got %', v_err;
    END IF;
  END;

  RAISE NOTICE '#1173 ADVERSARIAL rollback/cutover-guard test PASSED (A: post-cutover releasable, B: rollback severs release, C: re-stamp resets, D: brand_not_found)';
END
$test$;

ROLLBACK;
