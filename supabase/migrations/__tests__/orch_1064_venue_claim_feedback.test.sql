-- ORCH-1064 — post-apply probe for the venue-claim feedback loop.
-- Hand-run after `supabase db push --linked`. Asserts the table, RLS policies,
-- the active-feedback view, and the three new RPCs exist with SECURITY DEFINER +
-- pinned search_path + correct grant matrix + admin/owner gating.
-- Pure introspection + guarded error-path probes; no surviving mutation.
--
-- fails-on-revert: if 20260901000000_orch_1064_venue_claim_feedback.sql is
-- absent (table/fns don't exist), F-01..F-06 RAISE EXCEPTION immediately.

\set ON_ERROR_STOP on

-- ─── F-01: table venue_claim_feedback exists with RLS enabled ────────────────
DO $$
BEGIN
  IF to_regclass('public.venue_claim_feedback') IS NULL THEN
    RAISE EXCEPTION 'F-01 FAIL: public.venue_claim_feedback table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.venue_claim_feedback'::regclass AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'F-01 FAIL: RLS not enabled on venue_claim_feedback';
  END IF;
  RAISE NOTICE 'F-01 PASS: venue_claim_feedback exists with RLS enabled';
END$$;

-- ─── F-02: the category + status CHECK constraints are present ───────────────
DO $$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.venue_claim_feedback'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%category%'
  ) THEN
    RAISE EXCEPTION 'F-02 FAIL: category CHECK constraint missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.venue_claim_feedback'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
      AND pg_get_constraintdef(oid) LIKE '%open%'
      AND pg_get_constraintdef(oid) LIKE '%fixed%'
  ) THEN
    RAISE EXCEPTION 'F-02 FAIL: status open/fixed CHECK constraint missing';
  END IF;
  RAISE NOTICE 'F-02 PASS: category + status CHECK constraints present';
END$$;

-- ─── F-03: the active-feedback view exists and is security_invoker ───────────
DO $$
DECLARE
  v_opts text;
BEGIN
  IF to_regclass('public.venue_claim_active_feedback') IS NULL THEN
    RAISE EXCEPTION 'F-03 FAIL: venue_claim_active_feedback view missing';
  END IF;
  SELECT array_to_string(c.reloptions, ',') INTO v_opts
  FROM pg_class c WHERE c.oid = 'public.venue_claim_active_feedback'::regclass;
  IF v_opts IS NULL OR v_opts NOT LIKE '%security_invoker=%' THEN
    RAISE EXCEPTION 'F-03 FAIL: view not marked security_invoker (got: %)', coalesce(v_opts, 'null');
  END IF;
  RAISE NOTICE 'F-03 PASS: venue_claim_active_feedback view exists (security_invoker)';
END$$;

-- ─── F-04: all three RPCs exist as SECURITY DEFINER with pinned search_path ──
DO $$
DECLARE
  fn text;
  v_secdef boolean;
  v_cfg text[];
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'admin_add_venue_claim_feedback',
    'biz_mark_feedback_item_fixed',
    'biz_resubmit_venue_claim'
  ] LOOP
    SELECT prosecdef, proconfig INTO v_secdef, v_cfg
    FROM pg_proc WHERE proname = fn AND pronamespace = 'public'::regnamespace
    LIMIT 1;
    IF v_secdef IS NULL THEN
      RAISE EXCEPTION 'F-04 FAIL: % missing', fn;
    END IF;
    IF NOT v_secdef THEN
      RAISE EXCEPTION 'F-04 FAIL: % not SECURITY DEFINER', fn;
    END IF;
    IF v_cfg IS NULL OR array_to_string(v_cfg, ',') NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION 'F-04 FAIL: % missing pinned search_path', fn;
    END IF;
  END LOOP;
  RAISE NOTICE 'F-04 PASS: all 3 RPCs SECURITY DEFINER with pinned search_path';
END$$;

-- ─── F-05: grant matrix — anon none, authenticated execute ───────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_add_venue_claim_feedback(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F-05 FAIL: anon must NOT execute admin_add_venue_claim_feedback';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_add_venue_claim_feedback(uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F-05 FAIL: authenticated must execute admin_add_venue_claim_feedback';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.biz_mark_feedback_item_fixed(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F-05 FAIL: authenticated must execute biz_mark_feedback_item_fixed';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.biz_resubmit_venue_claim(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F-05 FAIL: authenticated must execute biz_resubmit_venue_claim';
  END IF;
  RAISE NOTICE 'F-05 PASS: grant matrix correct (anon none, authenticated execute)';
END$$;

-- ─── F-06: admin-gated fn rejects a non-admin caller (server-side gate) ──────
-- auth.uid() is NULL in a raw psql session → the gate raises
-- not_authenticated/forbidden BEFORE any write (I-ADMIN-WRITE-GATED).
DO $$
DECLARE
  v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM public.admin_add_venue_claim_feedback(
      '00000000-0000-0000-0000-000000000000'::uuid,
      jsonb_build_array(jsonb_build_object('category','photos','note','x')));
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM NOT IN ('not_authenticated', 'forbidden') THEN
      RAISE EXCEPTION 'F-06 FAIL: expected not_authenticated/forbidden, got: %', SQLERRM;
    END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'F-06 FAIL: admin_add_venue_claim_feedback did not gate a non-admin caller';
  END IF;
  RAISE NOTICE 'F-06 PASS: admin_add fn gates non-admin server-side';
END$$;

-- ─── F-07: owner-only RLS — no owner INSERT/UPDATE/DELETE policy exists ──────
-- I-1064-RPC-WRITES-ONLY: only the admin (FOR ALL) + owner (FOR SELECT) policies.
DO $$
DECLARE
  v_cmds text;
BEGIN
  SELECT string_agg(distinct cmd, ',' ORDER BY cmd) INTO v_cmds
  FROM pg_policies WHERE schemaname='public' AND tablename='venue_claim_feedback';
  -- Expect only ALL (admin) + SELECT (owner). No INSERT/UPDATE/DELETE owner policy.
  IF v_cmds IS NULL THEN
    RAISE EXCEPTION 'F-07 FAIL: no RLS policies on venue_claim_feedback';
  END IF;
  IF v_cmds LIKE '%INSERT%' OR v_cmds LIKE '%UPDATE%' OR v_cmds LIKE '%DELETE%' THEN
    RAISE EXCEPTION 'F-07 FAIL: unexpected write policy present (cmds: %) — writes must be RPC-only', v_cmds;
  END IF;
  RAISE NOTICE 'F-07 PASS: only admin-ALL + owner-SELECT policies (cmds: %)', v_cmds;
END$$;

\echo 'ORCH-1064 venue-claim feedback probe: ALL PASS'
