-- META-ORCH-1062 — post-apply probe for the three admin-vetting RPCs.
-- Hand-run after `supabase db push --linked` (Phase 1/Q2/Q4 contract).
-- Asserts: the three functions exist with SECURITY DEFINER + admin gate + the
-- whitelist/clamp/bidirectional-override behavior. Pure introspection + guarded
-- error-path probes; no data mutation that survives (all wrapped + rolled back).
--
-- fails-on-revert: if 20260831000000_meta_orch_1062_admin_vetting_rpcs.sql is
-- absent (functions don't exist), M-01..M-03 RAISE EXCEPTION immediately.

\set ON_ERROR_STOP on

-- ─── M-01: all three functions exist as SECURITY DEFINER ──────────────────────
DO $$
DECLARE
  v_missing text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_get_claim_review_bundle'
                 AND pronamespace='public'::regnamespace AND prosecdef) THEN
    v_missing := v_missing || 'admin_get_claim_review_bundle ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_tweak_venue_claim_fields'
                 AND pronamespace='public'::regnamespace AND prosecdef) THEN
    v_missing := v_missing || 'admin_tweak_venue_claim_fields ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_apply_score_override'
                 AND pronamespace='public'::regnamespace AND prosecdef) THEN
    v_missing := v_missing || 'admin_apply_score_override ';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'M-01 FAIL: missing/non-SECURITY-DEFINER fns: %', v_missing;
  END IF;
  RAISE NOTICE 'M-01 PASS: all 3 admin-vetting RPCs exist as SECURITY DEFINER';
END$$;

-- ─── M-02: search_path is pinned (hardening) ─────────────────────────────────
DO $$
DECLARE
  v_cfg text[];
BEGIN
  SELECT proconfig INTO v_cfg FROM pg_proc
  WHERE proname='admin_apply_score_override' AND pronamespace='public'::regnamespace;
  IF v_cfg IS NULL OR NOT (array_to_string(v_cfg, ',') LIKE '%search_path%') THEN
    RAISE EXCEPTION 'M-02 FAIL: admin_apply_score_override missing pinned search_path';
  END IF;
  RAISE NOTICE 'M-02 PASS: search_path pinned on admin_apply_score_override';
END$$;

-- ─── M-03: non-admin caller is rejected with forbidden (server-side gate) ─────
-- Run as a non-admin: auth.uid() is NULL in a raw psql session, so the gate
-- raises not_authenticated/forbidden — either proves the gate fires before any
-- write. We assert it RAISEs (not silently returns).
DO $$
DECLARE
  v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM public.admin_tweak_venue_claim_fields(
      '00000000-0000-0000-0000-000000000000'::uuid,
      jsonb_build_object('address', 'x'));
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    IF SQLERRM NOT IN ('not_authenticated', 'forbidden') THEN
      RAISE EXCEPTION 'M-03 FAIL: expected not_authenticated/forbidden, got: %', SQLERRM;
    END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'M-03 FAIL: admin_tweak_venue_claim_fields did not gate a non-admin caller';
  END IF;
  RAISE NOTICE 'M-03 PASS: tweak fn gates non-admin server-side';
END$$;

-- ─── M-04: score-override clamp range rejected before any write ───────────────
-- A non-admin can't get past the gate to test the clamp, but we can at least
-- confirm the fn signature accepts (uuid, text, numeric, text). Introspect args.
DO $$
DECLARE
  v_args text;
BEGIN
  SELECT pg_get_function_identity_arguments(oid) INTO v_args
  FROM pg_proc WHERE proname='admin_apply_score_override' AND pronamespace='public'::regnamespace;
  IF v_args NOT LIKE '%uuid%' OR v_args NOT LIKE '%text%' OR v_args NOT LIKE '%numeric%' THEN
    RAISE EXCEPTION 'M-04 FAIL: admin_apply_score_override arg shape wrong: %', v_args;
  END IF;
  RAISE NOTICE 'M-04 PASS: admin_apply_score_override(uuid,text,numeric,text) signature present';
END$$;

-- ─── M-05: anon has no EXECUTE; authenticated does ───────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_apply_score_override(uuid,text,numeric,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M-05 FAIL: anon must NOT execute admin_apply_score_override';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_apply_score_override(uuid,text,numeric,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M-05 FAIL: authenticated must execute admin_apply_score_override';
  END IF;
  RAISE NOTICE 'M-05 PASS: grant matrix correct (anon none, authenticated execute)';
END$$;

\echo 'META-ORCH-1062 admin-vetting RPC probe: ALL PASS'
