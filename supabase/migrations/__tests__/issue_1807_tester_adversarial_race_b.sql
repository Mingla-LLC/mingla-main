-- #1807 TESTER ADVERSARIAL — race session B. Run in the FOREGROUND by the #1173
-- workflow a couple of seconds after session A is launched in the background;
-- see ..._race_setup.sql for the shape of the whole proof.
--
-- B attempts the same two stamps A is already holding a row lock on. Each
-- statement BLOCKS until A commits, then re-reads the row under its own lock.
-- If the FOR UPDATE lock or the atomic `WHERE ... payout_hold_cutover_at IS
-- NULL` update in stamp_payout_hold_cutover were removed, B would instead write
-- a SECOND 'flipped' row — a permanent, uncorrectable claim in an append-only
-- money ledger that a business was put on hold twice. The main suite asserts
-- exactly that cannot happen.
--
-- No explicit transaction: each statement is its own, which is how the edge
-- function calls the RPC.

\set ON_ERROR_STOP on

SELECT public.stamp_payout_hold_cutover(
  '18079999-0000-4000-8000-000000000011'::uuid,   -- NG, Paystack rail
  NULL,
  '18079999-0000-4000-8000-0000000000a2'::uuid,
  'admin@usemingla.com',
  '18079999-0000-4000-8000-000000000001'::uuid,
  'adversarial race B') AS ng_result;

SELECT public.stamp_payout_hold_cutover(
  '18079999-0000-4000-8000-000000000012'::uuid,   -- US, Stripe rail
  'acct_adv_1807',
  '18079999-0000-4000-8000-0000000000c2'::uuid,
  'admin@usemingla.com',
  '18079999-0000-4000-8000-000000000001'::uuid,
  'adversarial stripe race D') AS us_result;
