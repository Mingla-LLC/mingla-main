-- ORCH-1066 — post-apply probe for the 4 deck-score-tuner RPCs.
-- Hand-run after `supabase db push --linked`. Pure introspection + function-body
-- text assertions; no surviving data mutation.
--
-- fails-on-revert: if 20260904000000_orch_1066_deck_score_tuner.sql is absent
-- (functions don't exist / lack the invariant bodies), the DO blocks below
-- RAISE EXCEPTION immediately.

\set ON_ERROR_STOP on

-- ─── M-01: all four functions exist as SECURITY DEFINER ───────────────────────
DO $$
DECLARE v_missing text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_set_place_signal_score'
                 AND pronamespace='public'::regnamespace AND prosecdef) THEN
    v_missing := v_missing || 'admin_set_place_signal_score ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_pin_place_to_top'
                 AND pronamespace='public'::regnamespace AND prosecdef) THEN
    v_missing := v_missing || 'admin_pin_place_to_top ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_place_deck_rank'
                 AND pronamespace='public'::regnamespace AND prosecdef) THEN
    v_missing := v_missing || 'admin_place_deck_rank ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_score_place_preview'
                 AND pronamespace='public'::regnamespace AND prosecdef) THEN
    v_missing := v_missing || 'admin_score_place_preview ';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'M-01 FAIL: missing/non-SECURITY-DEFINER fns: %', v_missing;
  END IF;
  RAISE NOTICE 'M-01 PASS: all 4 deck-score-tuner RPCs exist as SECURITY DEFINER';
END$$;

-- ─── M-02: search_path is pinned on all four ─────────────────────────────────
DO $$
DECLARE v_proc text; v_cfg text[];
BEGIN
  FOREACH v_proc IN ARRAY ARRAY['admin_set_place_signal_score','admin_pin_place_to_top',
                                'admin_place_deck_rank','admin_score_place_preview'] LOOP
    SELECT proconfig INTO v_cfg FROM pg_proc
    WHERE proname=v_proc AND pronamespace='public'::regnamespace;
    IF v_cfg IS NULL OR NOT ('search_path=public, pg_temp' = ANY(v_cfg)
                             OR '"search_path"=public, pg_temp' = ANY(v_cfg)
                             OR array_to_string(v_cfg,',') LIKE '%search_path%public%pg_temp%') THEN
      RAISE EXCEPTION 'M-02 FAIL: % search_path not pinned: %', v_proc, v_cfg;
    END IF;
  END LOOP;
  RAISE NOTICE 'M-02 PASS: search_path pinned on all 4';
END$$;

-- ─── M-03: anon has NO execute; authenticated has execute ────────────────────
DO $$
DECLARE v_proc text;
BEGIN
  FOREACH v_proc IN ARRAY ARRAY['admin_set_place_signal_score','admin_pin_place_to_top',
                                'admin_place_deck_rank','admin_score_place_preview'] LOOP
    IF has_function_privilege('anon', (SELECT oid FROM pg_proc
        WHERE proname=v_proc AND pronamespace='public'::regnamespace LIMIT 1), 'EXECUTE') THEN
      RAISE EXCEPTION 'M-03 FAIL: anon can execute %', v_proc;
    END IF;
    IF NOT has_function_privilege('authenticated', (SELECT oid FROM pg_proc
        WHERE proname=v_proc AND pronamespace='public'::regnamespace LIMIT 1), 'EXECUTE') THEN
      RAISE EXCEPTION 'M-03 FAIL: authenticated cannot execute %', v_proc;
    END IF;
  END LOOP;
  RAISE NOTICE 'M-03 PASS: anon REVOKEd, authenticated GRANTed on all 4';
END$$;

-- ─── M-04: every function body re-asserts is_admin_user() (admin gate) ───────
DO $$
DECLARE v_proc text; v_def text;
BEGIN
  FOREACH v_proc IN ARRAY ARRAY['admin_set_place_signal_score','admin_pin_place_to_top',
                                'admin_place_deck_rank','admin_score_place_preview'] LOOP
    SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
    WHERE proname=v_proc AND pronamespace='public'::regnamespace LIMIT 1;
    IF position('is_admin_user()' IN v_def) = 0 THEN
      RAISE EXCEPTION 'M-04 FAIL: % does not gate on is_admin_user()', v_proc;
    END IF;
    IF position('not_authenticated' IN v_def) = 0 THEN
      RAISE EXCEPTION 'M-04 FAIL: % missing not_authenticated guard', v_proc;
    END IF;
  END LOOP;
  RAISE NOTICE 'M-04 PASS: all 4 gate on is_admin_user() + not_authenticated';
END$$;

-- ─── M-05: I-1066-PIN-COMPUTED-NOT-HARDCODED — pin body computes max(ps.score) ─
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
  WHERE proname='admin_pin_place_to_top' AND pronamespace='public'::regnamespace LIMIT 1;
  IF position('max(ps.score)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-05 FAIL: pin does not compute local max(ps.score)';
  END IF;
  IF position('LEAST(200, v_local_max + 1)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-05 FAIL: pin target is not LEAST(200, local_max+1) — possible hardcoded 200';
  END IF;
  RAISE NOTICE 'M-05 PASS: pin computes local max and uses LEAST(200, local_max+1)';
END$$;

-- ─── M-06: I-1066-ONDEMAND-NO-SERVABLE-FLIP — seed touches only place_scores ──
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
  WHERE proname='admin_score_place_preview' AND pronamespace='public'::regnamespace LIMIT 1;
  -- Must NOT UPDATE place_pool at all (the only writes are INSERTs into place_scores).
  -- A bare `WHERE sd.is_active = true` READ filter is fine; an UPDATE place_pool ... is not.
  IF v_def ~* 'UPDATE\s+public\.place_pool' OR v_def ~* 'UPDATE\s+place_pool' THEN
    RAISE EXCEPTION 'M-06 FAIL: seed function UPDATEs place_pool (forbidden — must not flip is_servable/is_active)';
  END IF;
  IF position('ON CONFLICT (place_id, signal_id) DO NOTHING' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-06 FAIL: seed is not idempotent (missing ON CONFLICT DO NOTHING)';
  END IF;
  RAISE NOTICE 'M-06 PASS: seed never flips is_servable/is_active and is idempotent';
END$$;

-- ─── M-07: set body rejects out-of-range + writes the _admin_set sticky marker ─
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
  WHERE proname='admin_set_place_signal_score' AND pronamespace='public'::regnamespace LIMIT 1;
  IF position('score_out_of_range' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-07 FAIL: set missing score_out_of_range guard';
  END IF;
  IF position('_admin_set' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-07 FAIL: set does not stamp the _admin_set sticky marker';
  END IF;
  RAISE NOTICE 'M-07 PASS: set guards range + stamps _admin_set';
END$$;

-- ─── M-08: 1062 admin_apply_score_override still exists (SC-8, untouched) ─────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_apply_score_override'
                 AND pronamespace='public'::regnamespace AND prosecdef) THEN
    RAISE EXCEPTION 'M-08 FAIL: 1062 admin_apply_score_override missing (must be preserved)';
  END IF;
  RAISE NOTICE 'M-08 PASS: 1062 admin_apply_score_override preserved';
END$$;

DO $$ BEGIN RAISE NOTICE 'ORCH-1066 migration shape test: all M-01..M-08 PASS'; END$$;
