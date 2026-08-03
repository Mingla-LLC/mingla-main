-- #1173 (sub-issue D of #1013) — SQL behavior test for the cutover-stamp RPCs.
-- Proves (SC-3 / SC-5 / SC-8) that stamp_payout_hold_cutover is atomic +
-- idempotent (stamps once, second call skips without re-stamping) and that
-- rollback_payout_hold_cutover restores the status quo (NULLs the stamp).
-- Run via psql with ON_ERROR_STOP=1 against a DB with every migration applied;
-- any RAISE EXCEPTION fails the job. Wrapped in a transaction that ROLLBACKs.
--
-- Fails-on-revert: delete the `UPDATE brands SET payout_hold_cutover_at = now()`
-- line from the stamp RPC → the "cutover set after flip" assertion fails.

BEGIN;
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id) VALUES
  ('11730000-0000-0000-0000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES
  ('11730000-0000-0000-0000-000000000001');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payout_hold_cutover_at)
VALUES (
  '11730000-0000-0000-0000-000000000011',
  '11730000-0000-0000-0000-000000000001',
  'D-1173 Stamp Brand', 'issue-1173-stamp-brand', 'USD', NULL
);

SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_brand uuid := '11730000-0000-0000-0000-000000000011';
  v_batch uuid := '11730000-0000-0000-0000-0000000000b1';
  v_batch2 uuid := '11730000-0000-0000-0000-0000000000b2';
  v_batch3 uuid := '11730000-0000-0000-0000-0000000000b3';
  v_result text;
  v_cutover timestamptz;
  v_cutover_after_skip timestamptz;
  v_flipped_count int;
  v_skipped_count int;
  v_rolled_count int;
BEGIN
  -- 1) First stamp on an unstamped brand → 'flipped', cutover set, one row.
  v_result := public.stamp_payout_hold_cutover(
    v_brand, 'acct_1173', v_batch, 'admin@usemingla.com',
    '11730000-0000-0000-0000-000000000001', 'wave-2'
  );
  IF v_result <> 'flipped' THEN
    RAISE EXCEPTION 'first stamp returned % (expected flipped)', v_result;
  END IF;

  SELECT payout_hold_cutover_at INTO v_cutover FROM public.brands WHERE id = v_brand;
  IF v_cutover IS NULL THEN
    RAISE EXCEPTION 'cutover was not stamped after flip';
  END IF;

  SELECT count(*) INTO v_flipped_count
  FROM public.payout_hold_cutover_migrations
  WHERE brand_id = v_brand AND result = 'flipped'
    AND direction = 'hold' AND new_interval = 'manual' AND cutover_after IS NOT NULL;
  IF v_flipped_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 flipped ledger row, found %', v_flipped_count;
  END IF;

  -- 2) Second stamp (already stamped) → 'skipped_already_stamped', NO re-stamp.
  v_result := public.stamp_payout_hold_cutover(
    v_brand, 'acct_1173', v_batch2, 'admin@usemingla.com',
    '11730000-0000-0000-0000-000000000001', 'wave-2 rerun'
  );
  IF v_result <> 'skipped_already_stamped' THEN
    RAISE EXCEPTION 'second stamp returned % (expected skipped_already_stamped)', v_result;
  END IF;

  SELECT payout_hold_cutover_at INTO v_cutover_after_skip FROM public.brands WHERE id = v_brand;
  IF v_cutover_after_skip IS DISTINCT FROM v_cutover THEN
    RAISE EXCEPTION 'idempotent skip re-stamped the cutover (% -> %)', v_cutover, v_cutover_after_skip;
  END IF;

  SELECT count(*) INTO v_flipped_count
  FROM public.payout_hold_cutover_migrations
  WHERE brand_id = v_brand AND result = 'flipped';
  SELECT count(*) INTO v_skipped_count
  FROM public.payout_hold_cutover_migrations
  WHERE brand_id = v_brand AND result = 'skipped_already_stamped';
  IF v_flipped_count <> 1 OR v_skipped_count <> 1 THEN
    RAISE EXCEPTION 'ledger rows wrong after skip: flipped=% skipped=%', v_flipped_count, v_skipped_count;
  END IF;

  -- 3) Rollback → 'rolled_back', cutover NULL, a rollback row recording the prior value.
  v_result := public.rollback_payout_hold_cutover(
    v_brand, 'acct_1173', v_batch3, 'admin@usemingla.com',
    '11730000-0000-0000-0000-000000000001', 'rollback'
  );
  IF v_result <> 'rolled_back' THEN
    RAISE EXCEPTION 'rollback returned % (expected rolled_back)', v_result;
  END IF;

  SELECT payout_hold_cutover_at INTO v_cutover FROM public.brands WHERE id = v_brand;
  IF v_cutover IS NOT NULL THEN
    RAISE EXCEPTION 'rollback did not NULL the cutover';
  END IF;

  SELECT count(*) INTO v_rolled_count
  FROM public.payout_hold_cutover_migrations
  WHERE brand_id = v_brand AND result = 'rolled_back'
    AND direction = 'rollback' AND cutover_before IS NOT NULL AND cutover_after IS NULL;
  IF v_rolled_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 rolled_back ledger row, found %', v_rolled_count;
  END IF;

  RAISE NOTICE '#1173 stamp/rollback RPC behavior test PASSED';
END
$test$;

ROLLBACK;
