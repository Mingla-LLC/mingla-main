-- Issue #1807 — truthful cutover-ledger rows for the Paystack (Nigerian) rail.
--
-- Forward-only hardening of two functions and one CHECK constraint first
-- shipped by #1173 (20270110000007); the original is NOT edited in place
-- (migration-history-drift rule — #1217/20270110000010 is the precedent for
-- hardening a shipped payout function this way).
--
-- Context. #1807 adds a Paystack lane to admin-payout-hold-migrate so a
-- Paystack-only brand can be stamped onto event-anchored held payouts. That
-- lane has NO payout-schedule flip: Paystack has no payout-schedule concept,
-- so settlement routing is decided per charge by the split fields. The cutover
-- stamp is the whole transaction on that rail.
--
-- Two things in the #1173 ledger therefore record fabricated data for a
-- Paystack brand, and payout_hold_cutover_migrations is an APPEND-ONLY money
-- audit ledger — a wrong row can never be corrected, only appended to. Zero
-- Paystack stamps exist today, so this lands BEFORE the first one.
--
--   (1) stamp_payout_hold_cutover / rollback_payout_hold_cutover hardcode the
--       Stripe schedule intervals ('daily'/'manual' and 'manual'/'daily') in
--       the ledger row they write on success, and stamp_payout_hold_cutover
--       does the same ('manual'/'manual') in its idempotent-skip branch. A row
--       claiming a Stripe payout schedule moved daily -> manual, for a brand
--       that has no Stripe account at all, is fabricated. All three now write
--       NULL intervals when there is no Stripe account id, and are
--       byte-identical otherwise.
--
--       The skip branch is NOT theoretical on the Paystack rail: it is what the
--       losing session of a concurrent stamp writes (proven with two real
--       PostgreSQL sessions in
--       __tests__/issue_1807_paystack_ledger_truth.tester_adversarial.test.sql,
--       attack A1), and what an admin retry writes when the stamp lands between
--       the edge function's read and this RPC. rollback_payout_hold_cutover has
--       no skip branch — one unconditional INSERT, one return value.
--
--       ZERO STRIPE IMPACT, structurally: the Stripe lane ALWAYS passes a
--       non-null p_stripe_account_id (it resolves stripe_connect_accounts and
--       skips the brand entirely when there is no row), so the CASE can never
--       take its NULL arm on that rail. Asserted, not merely stated, by
--       __tests__/issue_1807_paystack_ledger_truth.test.sql and by the
--       pre-existing __tests__/issue_1173_stamp_cutover.test.sql, which still
--       asserts new_interval = 'manual' for a Stripe stamp.
--
--   (2) The result CHECK has no value for "the stamp failed and there was no
--       provider mutation to compensate". The nearest existing value,
--       stamp_failed_rolled_back, falsely claims a compensating rollback ran;
--       flip_failed falsely claims a schedule flip was attempted. Adds
--       'stamp_failed'. Every previously-allowed value is kept.
--
--   (3) The table was never actually append-only. #1173:63 grants exactly
--       `SELECT, INSERT ... TO service_role` and documents append-only intent,
--       but the baseline squash carries Supabase's platform default privileges
--       (20260505000000:18606-18609 — ALTER DEFAULT PRIVILEGES FOR ROLE postgres
--       IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated,
--       service_role), so this table was granted ALL at CREATE and the narrow
--       grant narrowed nothing. RLS was the only protection it ever had — and
--       service_role bypasses RLS. A money audit ledger whose writing role can
--       UPDATE, DELETE or TRUNCATE it is not an audit ledger. Restored with a
--       targeted REVOKE, below.
--
-- Moves NO money. Touches NO charge path, NO release amounts, NO feature flag,
-- and NO publish/sell gating. Changes NO function signature (so CREATE OR
-- REPLACE is safe and existing grants survive; they are re-stated below for
-- explicitness).

BEGIN;

--------------------------------------------------------------------------------
-- (1) Widen the result CHECK — append 'stamp_failed', keep every prior value.
-- Established DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT pattern (#1177
-- 20270110000008, #1217 20270110000010).
--------------------------------------------------------------------------------
ALTER TABLE public.payout_hold_cutover_migrations
  DROP CONSTRAINT IF EXISTS payout_hold_cutover_migrations_result_check;
ALTER TABLE public.payout_hold_cutover_migrations
  ADD CONSTRAINT payout_hold_cutover_migrations_result_check
  CHECK (result IN (
    'flipped',
    'skipped_already_stamped',
    'skipped_no_account',
    'flip_failed',
    'stamp_failed',
    'stamp_failed_rolled_back',
    'rolled_back',
    'rollback_failed'
  ));

COMMENT ON COLUMN public.payout_hold_cutover_migrations.prior_interval IS
  '#1807: Stripe payout-schedule interval before the attempt. NULL on the Paystack rail, which has no payout-schedule concept — never fabricated.';
COMMENT ON COLUMN public.payout_hold_cutover_migrations.new_interval IS
  '#1807: Stripe payout-schedule interval after the attempt. NULL on the Paystack rail, which has no payout-schedule concept — never fabricated.';

--------------------------------------------------------------------------------
-- (2) stamp_payout_hold_cutover — byte-identical to 20270110000007 except the
-- two interval literals in the successful-flip INSERT, which become rail-aware.
-- The FOR UPDATE lock, the already-stamped skip row, the atomic
-- `WHERE ... payout_hold_cutover_at IS NULL` update, SECURITY DEFINER and the
-- search_path pin are all unchanged.
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
      -- #1807: rail-aware, same as the successful-flip row below. This branch
      -- IS reachable on the Paystack rail — it is what the losing session of a
      -- concurrent stamp writes, and what an admin retry writes when the stamp
      -- lands between the edge function's read and this RPC.
      CASE WHEN p_stripe_account_id IS NULL THEN NULL ELSE 'manual' END,
      CASE WHEN p_stripe_account_id IS NULL THEN NULL ELSE 'manual' END,
      v_cutover, v_cutover,
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
    -- #1807: Stripe schedule intervals, or NULL on a rail that has no payout
    -- schedule. The Stripe lane always passes a non-null account id, so the
    -- NULL arm is unreachable from it.
    CASE WHEN p_stripe_account_id IS NULL THEN NULL ELSE 'daily'  END,
    CASE WHEN p_stripe_account_id IS NULL THEN NULL ELSE 'manual' END,
    NULL, v_new_cutover,
    'flipped', p_actor_email, p_actor_uid, p_reason
  );
  RETURN 'flipped';
END;
$fn$;

--------------------------------------------------------------------------------
-- (3) rollback_payout_hold_cutover — same treatment, same hardcoding, mirrored.
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
    -- #1807: see the stamp function above.
    CASE WHEN p_stripe_account_id IS NULL THEN NULL ELSE 'manual' END,
    CASE WHEN p_stripe_account_id IS NULL THEN NULL ELSE 'daily'  END,
    v_cutover, NULL,
    'rolled_back', p_actor_email, p_actor_uid, p_reason
  );
  RETURN 'rolled_back';
END;
$fn$;

-- Least privilege, unchanged from #1173: service_role only (edge fns call
-- after their own admin gate). Signatures are unchanged, so CREATE OR REPLACE
-- preserved these; re-stated so the grant posture is readable in one place.
REVOKE ALL ON FUNCTION public.stamp_payout_hold_cutover(uuid,text,uuid,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stamp_payout_hold_cutover(uuid,text,uuid,text,uuid,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_payout_hold_cutover(uuid,text,uuid,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.rollback_payout_hold_cutover(uuid,text,uuid,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rollback_payout_hold_cutover(uuid,text,uuid,text,uuid,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_payout_hold_cutover(uuid,text,uuid,text,uuid,text) TO service_role;

--------------------------------------------------------------------------------
-- (4) APPEND-ONLY, ACTUALLY — targeted REVOKE on this ONE table.
--
-- Deliberately NOT a schema-wide privilege sweep. Every table in public inherits
-- the same platform default privileges; that is a separate, systemic question.
-- This fixes the one table whose append-only claim #1807 actively relies on.
--
-- Verified before writing this: nothing in supabase/functions, supabase/
-- migrations or the admin app UPDATEs, DELETEs or TRUNCATEs this table — the
-- only writes are INSERTs (the two SECURITY DEFINER RPCs above, and the edge
-- function's direct skip/fail insert), plus reads. This removes capability
-- nobody uses.
--
-- What each grantee keeps, and why:
--   service_role  SELECT + INSERT — admin-payout-hold-migrate's recordLedger
--                 inserts directly and reads back.
--   authenticated SELECT ONLY, and SELECT is LOAD-BEARING: the #1173 policy
--                 payout_hold_cutover_migrations_admin_read is
--                 `FOR SELECT TO authenticated`, and an RLS policy still
--                 requires the underlying table GRANT. Revoking SELECT here
--                 would silently break Admin's ability to read the ledger while
--                 every catalog check still looked correct.
--   anon          nothing. No policy grants anon anything.
--   postgres      untouched — it owns the SECURITY DEFINER RPCs that write the
--                 successful-flip, skip and rollback rows.
--------------------------------------------------------------------------------
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.payout_hold_cutover_migrations FROM service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.payout_hold_cutover_migrations FROM authenticated;

REVOKE ALL
  ON public.payout_hold_cutover_migrations FROM anon;

-- Re-assert the surviving intent positively, so the end state is readable in one
-- place and survives a future REVOKE ALL that forgets to put these back.
GRANT SELECT, INSERT ON public.payout_hold_cutover_migrations TO service_role;
GRANT SELECT ON public.payout_hold_cutover_migrations TO authenticated;

--------------------------------------------------------------------------------
-- Self-assert: apply FAILS if the widened CHECK did not actually replace the
-- old one, if either function went missing, or if the grant matrix is not
-- exactly what (4) documents — in BOTH directions. Asserting only that the
-- dangerous privileges are gone would pass a migration that revoked everything
-- and broke Admin's read.
--
-- The count check is deliberate. The #1173 CHECK was created inline and
-- UNNAMED, so it carries PostgreSQL's auto-generated name. If that name ever
-- differed from the literal dropped above, the DROP ... IF EXISTS would
-- silently no-op and the ADD would leave TWO result CHECKs — the stale one
-- still rejecting 'stamp_failed'. Asserting exactly one closes that.
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_count int;
  v_def text;
  v_value text;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.payout_hold_cutover_migrations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%flipped%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      '#1807: expected exactly 1 result CHECK on payout_hold_cutover_migrations, found %',
      v_count;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.payout_hold_cutover_migrations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%flipped%';

  FOREACH v_value IN ARRAY ARRAY[
    'flipped', 'skipped_already_stamped', 'skipped_no_account', 'flip_failed',
    'stamp_failed', 'stamp_failed_rolled_back', 'rolled_back', 'rollback_failed'
  ] LOOP
    IF v_def NOT LIKE '%' || v_value || '%' THEN
      RAISE EXCEPTION '#1807: result CHECK lost value %. Got: %', v_value, v_def;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'stamp_payout_hold_cutover'
  ) THEN
    RAISE EXCEPTION '#1807: stamp_payout_hold_cutover function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rollback_payout_hold_cutover'
  ) THEN
    RAISE EXCEPTION '#1807: rollback_payout_hold_cutover function missing';
  END IF;

  -- (4) service_role: SELECT + INSERT, and nothing that can rewrite history.
  FOREACH v_value IN ARRAY ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(
         'service_role', 'public.payout_hold_cutover_migrations', v_value) THEN
      RAISE EXCEPTION
        '#1807: APPEND-ONLY BROKEN — service_role still holds % on the cutover ledger',
        v_value;
    END IF;
  END LOOP;
  IF NOT has_table_privilege(
       'service_role', 'public.payout_hold_cutover_migrations', 'SELECT') THEN
    RAISE EXCEPTION '#1807: service_role lost SELECT on the cutover ledger';
  END IF;
  IF NOT has_table_privilege(
       'service_role', 'public.payout_hold_cutover_migrations', 'INSERT') THEN
    RAISE EXCEPTION
      '#1807: service_role lost INSERT on the cutover ledger — the skip/fail rows would vanish';
  END IF;

  -- (4) authenticated: SELECT only. SELECT is load-bearing for the admin read.
  FOREACH v_value IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(
         'authenticated', 'public.payout_hold_cutover_migrations', v_value) THEN
      RAISE EXCEPTION
        '#1807: a client role still holds % on the cutover ledger', v_value;
    END IF;
  END LOOP;
  IF NOT has_table_privilege(
       'authenticated', 'public.payout_hold_cutover_migrations', 'SELECT') THEN
    RAISE EXCEPTION
      '#1807: authenticated lost SELECT — payout_hold_cutover_migrations_admin_read is FOR SELECT TO authenticated and an RLS policy still requires the table GRANT, so Admin could no longer read the ledger';
  END IF;

  -- (4) anon: nothing at all.
  FOREACH v_value IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(
         'anon', 'public.payout_hold_cutover_migrations', v_value) THEN
      RAISE EXCEPTION '#1807: anon still holds % on the cutover ledger', v_value;
    END IF;
  END LOOP;

  -- (4) RLS must still be on — the grants are a second layer, not a replacement.
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.payout_hold_cutover_migrations'::regclass) THEN
    RAISE EXCEPTION '#1807: RLS was disabled on the cutover ledger';
  END IF;
END $$;

COMMIT;
