-- #1807 TESTER ADVERSARIAL — race fixtures.
--
-- Part one of a three-process concurrency proof driven by the #1173 workflow:
--   1. this file          — create the fixtures (synchronous)
--   2. ..._race_a.sql     — session A stamps and HOLDS its transaction open
--   3. ..._race_b.sql     — session B contends for the same rows
-- and then issue_1807_paystack_ledger_truth.tester_adversarial.test.sql asserts
-- what the two of them produced, and cleans up.
--
-- Why real OS processes rather than dblink: dblink_connect and dblink_connect_u
-- are the SAME C function, differing only in SECURITY DEFINER, and the C code
-- gates on superuser(). supabase/postgres de-superusers `postgres`, and the
-- extension is created BY `postgres` here, so `postgres` owns dblink_connect_u
-- and SECURITY DEFINER resolves to a non-superuser — the bypass is inert and
-- every conninfo is refused with "Non-superusers may only connect using
-- credentials they provide". Two psql processes authenticate exactly the way
-- every other step in this job already does, so the proof rests on nothing that
-- has to be guessed.
--
-- Idempotent: safe to re-run against the shared CI database.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL session_replication_role = replica;

DELETE FROM public.payout_hold_cutover_migrations
 WHERE brand_id IN (
   '18079999-0000-4000-8000-000000000011',
   '18079999-0000-4000-8000-000000000012',
   '18079999-0000-4000-8000-000000000013');
DELETE FROM public.brands WHERE id IN (
   '18079999-0000-4000-8000-000000000011',
   '18079999-0000-4000-8000-000000000012',
   '18079999-0000-4000-8000-000000000013');
DELETE FROM public.creator_accounts WHERE id = '18079999-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id = '18079999-0000-4000-8000-000000000001';

INSERT INTO auth.users(id) VALUES ('18079999-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('18079999-0000-4000-8000-000000000001');

-- NG: Paystack-only. US: Stripe. NEVER: stamped by nobody, used for rollback.
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payout_hold_cutover_at)
VALUES
  ('18079999-0000-4000-8000-000000000011','18079999-0000-4000-8000-000000000001',
   'issue-1807 adversarial NG','issue-1807-adversarial-ng','NGN',NULL),
  ('18079999-0000-4000-8000-000000000012','18079999-0000-4000-8000-000000000001',
   'issue-1807 adversarial US','issue-1807-adversarial-us','USD',NULL),
  ('18079999-0000-4000-8000-000000000013','18079999-0000-4000-8000-000000000001',
   'issue-1807 adversarial NEVER','issue-1807-adversarial-never','NGN',NULL);

COMMIT;

DO $check$
BEGIN
  IF (SELECT count(*) FROM public.brands
       WHERE id IN ('18079999-0000-4000-8000-000000000011',
                    '18079999-0000-4000-8000-000000000012',
                    '18079999-0000-4000-8000-000000000013')) <> 3 THEN
    RAISE EXCEPTION '#1807(race setup): fixtures were not created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brands
              WHERE id IN ('18079999-0000-4000-8000-000000000011',
                           '18079999-0000-4000-8000-000000000012')
                AND payout_hold_cutover_at IS NOT NULL) THEN
    RAISE EXCEPTION '#1807(race setup): a race brand started out already stamped';
  END IF;
  RAISE NOTICE '#1807 race fixtures ready';
END $check$;
