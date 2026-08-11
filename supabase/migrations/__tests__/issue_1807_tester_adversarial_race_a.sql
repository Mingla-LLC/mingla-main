-- #1807 TESTER ADVERSARIAL — race session A. Launched in the BACKGROUND by the
-- #1173 workflow; see ..._race_setup.sql for the shape of the whole proof.
--
-- A stamps both race brands and then HOLDS its transaction open, keeping the
-- FOR UPDATE row lock that stamp_payout_hold_cutover takes. Session B fires into
-- that lock while it is held. Neither process is told it is the winner: the
-- assertions in the main suite are written so that whichever one commits first,
-- the outcome must be exactly one stamp and exactly one idempotent skip.
--
-- The sleep is the contention window. It is deliberately far longer than the
-- delay the workflow waits before starting B, so B is guaranteed to arrive while
-- the lock is still held even on a slow runner.

\set ON_ERROR_STOP on

BEGIN;

SELECT public.stamp_payout_hold_cutover(
  '18079999-0000-4000-8000-000000000011'::uuid,   -- NG, Paystack rail
  NULL,
  '18079999-0000-4000-8000-0000000000a1'::uuid,
  'admin@usemingla.com',
  '18079999-0000-4000-8000-000000000001'::uuid,
  'adversarial race A') AS ng_result;

SELECT public.stamp_payout_hold_cutover(
  '18079999-0000-4000-8000-000000000012'::uuid,   -- US, Stripe rail
  'acct_adv_1807',
  '18079999-0000-4000-8000-0000000000c1'::uuid,
  'admin@usemingla.com',
  '18079999-0000-4000-8000-000000000001'::uuid,
  'adversarial stripe race C') AS us_result;

SELECT pg_sleep(6);

COMMIT;
