-- Issue #3355 rework 6 — payout readiness is answered only for brand members
-- (enforced by 20280702143355_issue_3355_scope_payout_readiness_to_members.sql).
--
--   P1  the brand owner and an accepted scanner get the readiness answer
--       (true for a brand with a payout account, false for one without);
--   P2  a signed-in user who is not in the brand, and a removed member, get
--       SQLSTATE 42501 from pg_brand_can_payout_for_caller;
--   P3  a signed-in user can no longer EXECUTE pg_brand_can_payout directly;
--   P4  the service role keeps both, and brand_readiness (a SECURITY DEFINER
--       caller of the predicate) still reports can_be_paid_out for a member.
-- Reverting 20280702143355 raises P2 (the outsider is answered) and P3.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('33550000-0a70-4000-8000-000000000001','po-owner@test.local'),
  ('33550000-0a70-4000-8000-000000000002','po-scanner@test.local'),
  ('33550000-0a70-4000-8000-000000000003','po-outsider@test.local'),
  ('33550000-0a70-4000-8000-000000000004','po-removed@test.local');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('33550000-0a70-4000-8000-000000000001','po-owner@test.local','Po Owner','po3355_owner','business'),
  ('33550000-0a70-4000-8000-000000000002','po-scanner@test.local','Po Scanner','po3355_scanner','business'),
  ('33550000-0a70-4000-8000-000000000003','po-outsider@test.local','Po Outsider','po3355_outsider','business'),
  ('33550000-0a70-4000-8000-000000000004','po-removed@test.local','Po Removed','po3355_removed','business');
INSERT INTO public.creator_accounts(id,email,display_name,business_name) VALUES
  ('33550000-0a70-4000-8000-000000000001','po-owner@test.local','Po Owner','Po Host'),
  ('33550000-0a70-4000-8000-000000000003','po-outsider@test.local','Po Outsider','Po Other');
INSERT INTO public.brands(id,account_id,name,slug,paystack_subaccount_code) VALUES
  ('33550000-0a70-4000-8000-0000000000b1','33550000-0a70-4000-8000-000000000001','Payout Ready','po3355-ready','ACCT_po3355'),
  ('33550000-0a70-4000-8000-0000000000b2','33550000-0a70-4000-8000-000000000001','Payout Not Ready','po3355-not-ready',NULL),
  ('33550000-0a70-4000-8000-0000000000b3','33550000-0a70-4000-8000-000000000003','Outsider Brand','po3355-outsider',NULL);
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at,removed_at) VALUES
  ('33550000-0a70-4000-8000-0000000000b1','33550000-0a70-4000-8000-000000000002','scanner',now(),NULL),
  ('33550000-0a70-4000-8000-0000000000b2','33550000-0a70-4000-8000-000000000002','scanner',now(),NULL),
  ('33550000-0a70-4000-8000-0000000000b1','33550000-0a70-4000-8000-000000000004','brand_admin',now(),now());

CREATE OR REPLACE FUNCTION pg_temp.po_as(p_user uuid, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', p_role)::text, true);
END;
$$;

-- ── P1 members get the answer ─────────────────────────────────────────────
DO $p1$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.po_as('33550000-0a70-4000-8000-000000000001');
  IF public.pg_brand_can_payout_for_caller('33550000-0a70-4000-8000-0000000000b1') IS NOT TRUE THEN
    RAISE EXCEPTION 'P1 the owner did not get true for the payout-ready brand';
  END IF;
  IF public.pg_brand_can_payout_for_caller('33550000-0a70-4000-8000-0000000000b2') IS NOT FALSE THEN
    RAISE EXCEPTION 'P1 the owner did not get false for the brand without a payout account';
  END IF;
  PERFORM pg_temp.po_as('33550000-0a70-4000-8000-000000000002');
  IF public.pg_brand_can_payout_for_caller('33550000-0a70-4000-8000-0000000000b1') IS NOT TRUE THEN
    RAISE EXCEPTION 'P1 the scanner did not get true for their payout-ready brand';
  END IF;
  IF public.pg_brand_can_payout_for_caller('33550000-0a70-4000-8000-0000000000b2') IS NOT FALSE THEN
    RAISE EXCEPTION 'P1 the scanner did not get false for their brand without a payout account';
  END IF;
  RESET ROLE;
END
$p1$;

-- ── P2 non-members are refused ─────────────────────────────────────────────
DO $p2$
DECLARE
  v_user uuid;
  v_brand uuid;
  v_refused boolean;
BEGIN
  FOR v_user, v_brand IN VALUES
    ('33550000-0a70-4000-8000-000000000003'::uuid, '33550000-0a70-4000-8000-0000000000b1'::uuid),
    ('33550000-0a70-4000-8000-000000000003'::uuid, '33550000-0a70-4000-8000-0000000000b2'::uuid),
    ('33550000-0a70-4000-8000-000000000004'::uuid, '33550000-0a70-4000-8000-0000000000b1'::uuid),
    ('33550000-0a70-4000-8000-000000000001'::uuid, '33550000-0a70-4000-8000-0000000000b3'::uuid)
  LOOP
    v_refused := false;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.po_as(v_user);
    BEGIN
      PERFORM public.pg_brand_can_payout_for_caller(v_brand);
    EXCEPTION WHEN SQLSTATE '42501' THEN
      v_refused := true;
    END;
    RESET ROLE;
    IF NOT v_refused THEN
      RAISE EXCEPTION 'P2 % was answered for brand % they are not a member of', v_user, v_brand;
    END IF;
  END LOOP;
  -- No brand id: refused, never a default answer.
  v_refused := false;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.po_as('33550000-0a70-4000-8000-000000000001');
  BEGIN
    PERFORM public.pg_brand_can_payout_for_caller(NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_refused := true;
  END;
  RESET ROLE;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'P2 a null brand id was answered';
  END IF;
END
$p2$;

-- ── P3 the predicate itself is not callable by signed-in users ─────────────
DO $p3$
BEGIN
  IF has_function_privilege('authenticated', 'public.pg_brand_can_payout(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P3 authenticated can still EXECUTE pg_brand_can_payout';
  END IF;
  IF has_function_privilege('anon', 'public.pg_brand_can_payout(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P3 anon can EXECUTE pg_brand_can_payout';
  END IF;
  IF has_function_privilege('anon', 'public.pg_brand_can_payout_for_caller(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P3 anon can EXECUTE pg_brand_can_payout_for_caller';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.pg_brand_can_payout_for_caller(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P3 authenticated cannot EXECUTE pg_brand_can_payout_for_caller';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.pg_brand_can_payout_for_caller(uuid)'::regprocedure
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'P3 pg_brand_can_payout_for_caller is not SECURITY DEFINER with an empty search_path';
  END IF;
END
$p3$;

-- ── P4 the service role and SECURITY DEFINER callers keep working ──────────
DO $p4$
DECLARE
  v_ready jsonb;
BEGIN
  IF NOT has_function_privilege('service_role', 'public.pg_brand_can_payout(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P4 service_role lost EXECUTE on pg_brand_can_payout';
  END IF;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.po_as(NULL, 'service_role');
  IF public.pg_brand_can_payout('33550000-0a70-4000-8000-0000000000b1') IS NOT TRUE THEN
    RAISE EXCEPTION 'P4 service_role did not get true from pg_brand_can_payout';
  END IF;
  IF public.pg_brand_can_payout_for_caller('33550000-0a70-4000-8000-0000000000b1') IS NOT TRUE THEN
    RAISE EXCEPTION 'P4 service_role was refused by pg_brand_can_payout_for_caller';
  END IF;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.po_as('33550000-0a70-4000-8000-000000000001');
  v_ready := public.brand_readiness('33550000-0a70-4000-8000-0000000000b1', NULL);
  RESET ROLE;
  IF v_ready::text NOT LIKE '%"can_be_paid_out": true%' THEN
    RAISE EXCEPTION 'P4 brand_readiness no longer reports can_be_paid_out true for the owner: %',
      left(v_ready::text, 400);
  END IF;
END
$p4$;

ROLLBACK;
