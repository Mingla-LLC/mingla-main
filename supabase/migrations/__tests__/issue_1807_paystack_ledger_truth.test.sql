-- #1807 — SQL behavior test for the rail-aware cutover ledger.
-- Modelled on issue_1173_stamp_cutover.test.sql. Run via psql with
-- ON_ERROR_STOP=1 against a DB with every migration applied; any RAISE
-- EXCEPTION fails the job. Wrapped in a transaction that ROLLBACKs.
--
-- Proves:
--   (a) a NULL stripe account id (the Paystack rail) writes NULL intervals on
--       both the stamp and the rollback — never fabricated 'daily'/'manual';
--   (b) a NON-NULL stripe account id still writes exactly 'daily'/'manual' and
--       'manual'/'daily' — the STRIPE REGRESSION GUARD, which is the whole
--       zero-impact claim of 20270317001807 made falsifiable;
--   (c) the widened result CHECK accepts 'stamp_failed' AND still accepts every
--       previously-allowed value, and still rejects an unknown value;
--   (e) the append-only GRANT matrix, in BOTH directions — the dangerous
--       privileges are gone AND the load-bearing ones (service_role SELECT +
--       INSERT, authenticated SELECT) survive;
--   (f) a REAL UPDATE as service_role is refused at runtime, not merely absent
--       from the catalog;
--   (d) the IDEMPOTENT-SKIP row inside the stamp RPC is rail-aware too — NULL
--       intervals on the Paystack rail, still exactly 'manual'/'manual' on the
--       Stripe rail. That branch is reachable on both rails via the concurrent
--       stamp / admin-retry path, so it is not a theoretical row.
--
-- Fails-on-revert: revert either CASE expression in
-- 20270317001807_issue_1807_paystack_cutover_ledger_truth.sql back to the
-- hardcoded literals and assertion (a) fails; drop 'stamp_failed' from the
-- widened CHECK and assertion (c) fails.

BEGIN;
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id) VALUES
  ('18070000-0000-0000-0000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES
  ('18070000-0000-0000-0000-000000000001');
-- Paystack-only (Nigerian) brand.
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payout_hold_cutover_at)
VALUES (
  '18070000-0000-0000-0000-000000000011',
  '18070000-0000-0000-0000-000000000001',
  'issue-1807 Paystack Brand', 'issue-1807-paystack-brand', 'NGN', NULL
);
-- Stripe brand — the unchanged-behaviour control.
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payout_hold_cutover_at)
VALUES (
  '18070000-0000-0000-0000-000000000012',
  '18070000-0000-0000-0000-000000000001',
  'issue-1807 Stripe Brand', 'issue-1807-stripe-brand', 'USD', NULL
);

SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_ng_brand uuid := '18070000-0000-0000-0000-000000000011';
  v_us_brand uuid := '18070000-0000-0000-0000-000000000012';
  v_actor uuid := '18070000-0000-0000-0000-000000000001';
  v_batch1 uuid := '18070000-0000-0000-0000-0000000000b1';
  v_batch2 uuid := '18070000-0000-0000-0000-0000000000b2';
  v_batch3 uuid := '18070000-0000-0000-0000-0000000000b3';
  v_batch4 uuid := '18070000-0000-0000-0000-0000000000b4';
  v_batch5 uuid := '18070000-0000-0000-0000-0000000000b5';
  v_batch6 uuid := '18070000-0000-0000-0000-0000000000b6';
  v_result text;
  v_prior text;
  v_new text;
  v_account text;
  v_count int;
  v_value text;
  v_rejected boolean;
BEGIN
  ------------------------------------------------------------------------------
  -- (a) PAYSTACK RAIL — NULL account id must write NULL intervals on the stamp.
  ------------------------------------------------------------------------------
  v_result := public.stamp_payout_hold_cutover(
    v_ng_brand, NULL, v_batch1, 'admin@usemingla.com', v_actor, 'ng cutover'
  );
  IF v_result <> 'flipped' THEN
    RAISE EXCEPTION '#1807(a): paystack stamp returned % (expected flipped)', v_result;
  END IF;

  SELECT prior_interval, new_interval, stripe_account_id
    INTO v_prior, v_new, v_account
  FROM public.payout_hold_cutover_migrations
  WHERE batch_id = v_batch1 AND brand_id = v_ng_brand AND result = 'flipped';

  IF v_account IS NOT NULL THEN
    RAISE EXCEPTION '#1807(a): paystack flipped row carried a stripe account id (%)', v_account;
  END IF;
  IF v_prior IS NOT NULL OR v_new IS NOT NULL THEN
    RAISE EXCEPTION
      '#1807(a): paystack flipped row fabricated schedule intervals (prior=%, new=%)',
      COALESCE(v_prior, '<null>'), COALESCE(v_new, '<null>');
  END IF;

  ------------------------------------------------------------------------------
  -- (a cont.) PAYSTACK RAIL — the rollback row must also carry NULL intervals.
  ------------------------------------------------------------------------------
  v_result := public.rollback_payout_hold_cutover(
    v_ng_brand, NULL, v_batch2, 'admin@usemingla.com', v_actor, 'ng rollback'
  );
  IF v_result <> 'rolled_back' THEN
    RAISE EXCEPTION '#1807(a): paystack rollback returned % (expected rolled_back)', v_result;
  END IF;

  SELECT prior_interval, new_interval INTO v_prior, v_new
  FROM public.payout_hold_cutover_migrations
  WHERE batch_id = v_batch2 AND brand_id = v_ng_brand AND result = 'rolled_back';

  IF v_prior IS NOT NULL OR v_new IS NOT NULL THEN
    RAISE EXCEPTION
      '#1807(a): paystack rolled_back row fabricated schedule intervals (prior=%, new=%)',
      COALESCE(v_prior, '<null>'), COALESCE(v_new, '<null>');
  END IF;

  IF (SELECT payout_hold_cutover_at FROM public.brands WHERE id = v_ng_brand) IS NOT NULL THEN
    RAISE EXCEPTION '#1807(a): paystack brand still stamped after rollback';
  END IF;

  ------------------------------------------------------------------------------
  -- (b) STRIPE REGRESSION GUARD — a non-null account id is byte-identical to
  -- the #1173 behaviour: 'daily' -> 'manual' on the stamp, 'manual' -> 'daily'
  -- on the rollback. This is the falsifiable form of the zero-impact claim.
  ------------------------------------------------------------------------------
  v_result := public.stamp_payout_hold_cutover(
    v_us_brand, 'acct_1807', v_batch3, 'admin@usemingla.com', v_actor, 'stripe control'
  );
  IF v_result <> 'flipped' THEN
    RAISE EXCEPTION '#1807(b): stripe stamp returned % (expected flipped)', v_result;
  END IF;

  SELECT prior_interval, new_interval, stripe_account_id
    INTO v_prior, v_new, v_account
  FROM public.payout_hold_cutover_migrations
  WHERE batch_id = v_batch3 AND brand_id = v_us_brand AND result = 'flipped';

  IF v_prior IS DISTINCT FROM 'daily' OR v_new IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION
      '#1807(b): STRIPE REGRESSION — flipped row intervals changed (prior=%, new=%; expected daily/manual)',
      COALESCE(v_prior, '<null>'), COALESCE(v_new, '<null>');
  END IF;
  IF v_account IS DISTINCT FROM 'acct_1807' THEN
    RAISE EXCEPTION '#1807(b): STRIPE REGRESSION — account id not recorded (%)',
      COALESCE(v_account, '<null>');
  END IF;

  v_result := public.rollback_payout_hold_cutover(
    v_us_brand, 'acct_1807', v_batch4, 'admin@usemingla.com', v_actor, 'stripe control rollback'
  );
  IF v_result <> 'rolled_back' THEN
    RAISE EXCEPTION '#1807(b): stripe rollback returned % (expected rolled_back)', v_result;
  END IF;

  SELECT prior_interval, new_interval INTO v_prior, v_new
  FROM public.payout_hold_cutover_migrations
  WHERE batch_id = v_batch4 AND brand_id = v_us_brand AND result = 'rolled_back';

  IF v_prior IS DISTINCT FROM 'manual' OR v_new IS DISTINCT FROM 'daily' THEN
    RAISE EXCEPTION
      '#1807(b): STRIPE REGRESSION — rolled_back row intervals changed (prior=%, new=%; expected manual/daily)',
      COALESCE(v_prior, '<null>'), COALESCE(v_new, '<null>');
  END IF;

  ------------------------------------------------------------------------------
  -- (b cont.) The #1173 idempotent-skip row inside the stamp RPC is UNCHANGED
  -- by #1807 and still records 'manual'/'manual'. Pinned so a later change to
  -- that row is a deliberate decision rather than an accident.
  ------------------------------------------------------------------------------
  v_result := public.stamp_payout_hold_cutover(
    v_ng_brand, NULL, v_batch5, 'admin@usemingla.com', v_actor, 'ng first'
  );
  IF v_result <> 'flipped' THEN
    RAISE EXCEPTION '#1807: re-stamp setup returned % (expected flipped)', v_result;
  END IF;
  v_result := public.stamp_payout_hold_cutover(
    v_ng_brand, NULL, v_batch5, 'admin@usemingla.com', v_actor, 'ng second'
  );
  IF v_result <> 'skipped_already_stamped' THEN
    RAISE EXCEPTION '#1807: second stamp returned % (expected skipped_already_stamped)', v_result;
  END IF;

  ------------------------------------------------------------------------------
  -- (d) The IDEMPOTENT-SKIP row is rail-aware too. This branch is genuinely
  -- reachable on the Paystack rail: it is what the losing session of a
  -- concurrent stamp writes (tester adversarial A1 proves that with two real
  -- PostgreSQL sessions), and what an admin retry writes when the stamp lands
  -- between the edge function's read and this RPC.
  ------------------------------------------------------------------------------
  SELECT prior_interval, new_interval, stripe_account_id
    INTO v_prior, v_new, v_account
  FROM public.payout_hold_cutover_migrations
  WHERE batch_id = v_batch5 AND brand_id = v_ng_brand
    AND result = 'skipped_already_stamped';

  IF v_account IS NOT NULL THEN
    RAISE EXCEPTION '#1807(d): paystack skip row carried a stripe account id (%)', v_account;
  END IF;
  IF v_prior IS NOT NULL OR v_new IS NOT NULL THEN
    RAISE EXCEPTION
      '#1807(d): paystack skipped_already_stamped row fabricated schedule intervals (prior=%, new=%)',
      COALESCE(v_prior, '<null>'), COALESCE(v_new, '<null>');
  END IF;

  ------------------------------------------------------------------------------
  -- (d cont.) STRIPE CONTROL for the same branch — the skip row must still
  -- carry exactly 'manual'/'manual'. Must fail loudly if that ever changes.
  ------------------------------------------------------------------------------
  v_result := public.stamp_payout_hold_cutover(
    v_us_brand, 'acct_1807', v_batch6, 'admin@usemingla.com', v_actor, 'stripe skip setup'
  );
  IF v_result <> 'flipped' THEN
    RAISE EXCEPTION '#1807(d): stripe skip setup returned % (expected flipped)', v_result;
  END IF;
  v_result := public.stamp_payout_hold_cutover(
    v_us_brand, 'acct_1807', v_batch6, 'admin@usemingla.com', v_actor, 'stripe skip'
  );
  IF v_result <> 'skipped_already_stamped' THEN
    RAISE EXCEPTION '#1807(d): stripe second stamp returned % (expected skipped_already_stamped)', v_result;
  END IF;

  SELECT prior_interval, new_interval, stripe_account_id
    INTO v_prior, v_new, v_account
  FROM public.payout_hold_cutover_migrations
  WHERE batch_id = v_batch6 AND brand_id = v_us_brand
    AND result = 'skipped_already_stamped';

  IF v_prior IS DISTINCT FROM 'manual' OR v_new IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION
      '#1807(d): STRIPE REGRESSION — skip row intervals changed (prior=%, new=%; expected manual/manual)',
      COALESCE(v_prior, '<null>'), COALESCE(v_new, '<null>');
  END IF;
  IF v_account IS DISTINCT FROM 'acct_1807' THEN
    RAISE EXCEPTION '#1807(d): STRIPE REGRESSION — skip row lost the account id (%)',
      COALESCE(v_account, '<null>');
  END IF;

  ------------------------------------------------------------------------------
  -- (c) The widened result CHECK: 'stamp_failed' is accepted, every prior value
  -- is still accepted, and an unknown value is still rejected.
  ------------------------------------------------------------------------------
  FOREACH v_value IN ARRAY ARRAY[
    'flipped', 'skipped_already_stamped', 'skipped_no_account', 'flip_failed',
    'stamp_failed', 'stamp_failed_rolled_back', 'rolled_back', 'rollback_failed'
  ] LOOP
    BEGIN
      INSERT INTO public.payout_hold_cutover_migrations (
        batch_id, brand_id, stripe_account_id, direction,
        prior_interval, new_interval, result, actor_email, actor_uid, reason
      ) VALUES (
        gen_random_uuid(), v_ng_brand, NULL, 'hold',
        NULL, NULL, v_value, 'admin@usemingla.com', v_actor, 'check probe'
      );
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION '#1807(c): result CHECK rejected the allowed value %', v_value;
    END;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM public.payout_hold_cutover_migrations
  WHERE brand_id = v_ng_brand AND reason = 'check probe';
  IF v_count <> 8 THEN
    RAISE EXCEPTION '#1807(c): expected 8 probe rows, found %', v_count;
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO public.payout_hold_cutover_migrations (
      batch_id, brand_id, stripe_account_id, direction,
      prior_interval, new_interval, result, actor_email, actor_uid, reason
    ) VALUES (
      gen_random_uuid(), v_ng_brand, NULL, 'hold',
      NULL, NULL, 'not_a_real_result', 'admin@usemingla.com', v_actor, 'negative probe'
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION '#1807(c): result CHECK accepted an unknown value — the widen was too broad';
  END IF;

  ------------------------------------------------------------------------------
  -- (e) APPEND-ONLY GRANT MATRIX, asserted in BOTH directions.
  --
  -- The table was granted ALL at CREATE by Supabase's platform default
  -- privileges, so #1173's narrow `GRANT SELECT, INSERT ... TO service_role`
  -- never narrowed anything and RLS — which service_role bypasses — was the only
  -- protection. Asserting only that the dangerous privileges are gone would pass
  -- a migration that revoked everything and silently broke Admin's read, so the
  -- privileges that must SURVIVE are asserted just as hard.
  ------------------------------------------------------------------------------
  FOREACH v_value IN ARRAY ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(
         'service_role', 'public.payout_hold_cutover_migrations', v_value) THEN
      RAISE EXCEPTION
        '#1807(e): APPEND-ONLY BROKEN — service_role holds % on the cutover ledger',
        v_value;
    END IF;
  END LOOP;

  -- POSITIVE: service_role must keep SELECT + INSERT or recordLedger stops
  -- writing the skip/fail rows and the audit trail silently loses them.
  IF NOT has_table_privilege(
       'service_role', 'public.payout_hold_cutover_migrations', 'SELECT') THEN
    RAISE EXCEPTION '#1807(e): service_role lost SELECT on the cutover ledger';
  END IF;
  IF NOT has_table_privilege(
       'service_role', 'public.payout_hold_cutover_migrations', 'INSERT') THEN
    RAISE EXCEPTION '#1807(e): service_role lost INSERT on the cutover ledger';
  END IF;

  FOREACH v_value IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(
         'authenticated', 'public.payout_hold_cutover_migrations', v_value) THEN
      RAISE EXCEPTION
        '#1807(e): authenticated holds % on the cutover ledger', v_value;
    END IF;
  END LOOP;

  -- POSITIVE, and the easiest thing to get wrong: the #1173 admin-read policy is
  -- FOR SELECT TO authenticated, and an RLS policy still requires the underlying
  -- table GRANT. Without this, Admin's ledger view goes blank with no error.
  IF NOT has_table_privilege(
       'authenticated', 'public.payout_hold_cutover_migrations', 'SELECT') THEN
    RAISE EXCEPTION
      '#1807(e): authenticated lost SELECT — the admin_read RLS policy needs the table GRANT, so Admin could no longer read the ledger';
  END IF;

  FOREACH v_value IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(
         'anon', 'public.payout_hold_cutover_migrations', v_value) THEN
      RAISE EXCEPTION '#1807(e): anon holds % on the cutover ledger', v_value;
    END IF;
  END LOOP;

  -- The admin-read policy itself must still exist, or the surviving SELECT grant
  -- is protecting nothing.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'payout_hold_cutover_migrations'
       AND policyname = 'payout_hold_cutover_migrations_admin_read'
  ) THEN
    RAISE EXCEPTION '#1807(e): the admin-read policy is gone';
  END IF;

  RAISE NOTICE '#1807 paystack ledger truth: all assertions passed';
END $test$;

--------------------------------------------------------------------------------
-- (f) The catalog is not the behaviour. Attempt a REAL UPDATE as service_role
-- and require it to be REFUSED with insufficient_privilege (42501).
--
-- This is the assertion a catalog-only check cannot make. Note RLS would NOT
-- have caught this: with no UPDATE policy an unprivileged UPDATE silently
-- affects zero rows rather than erroring, and service_role bypasses RLS in
-- production anyway. `WHERE false` is deliberate — the privilege check happens
-- before any row is considered, so nothing can be mutated even if it passed.
--------------------------------------------------------------------------------
DO $priv$
DECLARE
  v_refused boolean := false;
BEGIN
  -- Vacuity guard: if we cannot actually become service_role, a "permission
  -- denied to set role" would ALSO raise insufficient_privilege and this test
  -- would pass without ever attempting the UPDATE. Fail loudly instead.
  IF NOT pg_has_role(current_user, 'service_role', 'USAGE') THEN
    RAISE EXCEPTION
      '#1807(f): cannot assume service_role from % — the runtime refusal check would be vacuous',
      current_user;
  END IF;

  SET LOCAL ROLE service_role;
  BEGIN
    EXECUTE 'UPDATE public.payout_hold_cutover_migrations SET reason = ''tamper'' WHERE false';
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := true;
  END;
  RESET ROLE;

  IF NOT v_refused THEN
    RAISE EXCEPTION
      '#1807(f): service_role was ALLOWED to UPDATE the append-only cutover ledger';
  END IF;
  RAISE NOTICE '#1807 append-only enforcement: service_role UPDATE refused at runtime';
END $priv$;

ROLLBACK;
