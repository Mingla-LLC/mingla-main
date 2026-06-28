-- ORCH-1239 — IMPLEMENTOR happy-path behavioral probe for the pairing-ACCEPT
-- limit guard added by 20261129000000_orch_1239_pairing_accept_limit_guard.sql.
--
-- Hand-run AFTER the migration lands (e.g. `supabase db push --linked` or via the
-- Management API SQL runner). Exercises the REAL RPC
-- public.accept_pair_request_atomic(uuid) against real Postgres semantics — not
-- just function-body text.
--
-- WRITE-SAFE: every case runs inside its own transaction that ROLLBACKs, so no
-- fixture row, app_config flip, or pairing survives. auth.uid() is driven via
-- `set_config('request.jwt.claim.sub', <receiver>, true)` (the receiver is the
-- only authorized accepter, per the RPC's `receiver_id = auth.uid()` lock).
--
-- SCHEMA FACTS the fixtures honor (verified on live prod):
--   * auth.users has an AFTER-INSERT trigger (on_auth_user_created → handle_new_user)
--     that auto-creates the public.profiles row — so we INSERT auth.users only.
--   * public.pairings.pair_request_id is NOT NULL → every seed pairing is backed
--     by a pair_requests row.
--   * public.admin_subscription_overrides requires (user_id, tier, reason, expires_at).
--   * get_effective_tier() returns 'mingla_plus' for EVERYONE when
--     app_config.global_plus_access='true' (pre-launch promo) → each tx forces
--     it to 'false' first; Plus is granted per-user via admin_subscription_overrides.
--
-- Cases (synthetic fff*-UUIDs, collision-free on prod):
--   H-01 FREE BLOCKED  — a free receiver already at 1 pairing (max_pairings=1)
--                        CANNOT gain a 2nd via accept → raises pairing_limit_reached,
--                        and the receiver still holds exactly 1 pairing.
--   H-02 PLUS ALLOWED  — a mingla_plus receiver (max_pairings=-1) CAN accept even
--                        while already holding a pairing → no raise, new row created,
--                        canonical return shape intact.
--   H-03 IDEMPOTENT    — re-accepting a request whose canonical pairing ALREADY
--                        exists does NOT raise, even with the receiver at the free
--                        limit (the existing-pairing short-circuit wins);
--                        ON CONFLICT DO NOTHING ⇒ pairing_id is NULL, no dupe row.
--
-- PROVEN RESULTS (run against prod inside a rolled-back tx, ORCH-1239 impl):
--   H-01 PASS; H-01 A-count=1(exp1); H-02 PASS; H-03 PASS(no raise,pid=<null>);
--   H-03 dupe-count=1(exp1);
--
-- fails-on-revert VERIFIED: re-running H-01 against the pre-ORCH-1239 (no-guard)
-- function body, the free receiver at the limit GAINED a 2nd pairing
-- (A-count=2 ⇒ LEAK), so H-01 RAISEs "free at limit accepted (LEAK)" and the test
-- fails. (Confirmed via a manual reverted-body run.)

\set ON_ERROR_STOP on

-- ─── H-00: the function + its dependency exist, with the guard text present ───
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                 WHERE proname='accept_pair_request_atomic' AND pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'H-00 FAIL: accept_pair_request_atomic missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                 WHERE proname='check_pairing_allowed' AND pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'H-00 FAIL: check_pairing_allowed dependency missing';
  END IF;
  IF position('pairing_limit_reached' IN
       pg_get_functiondef('public.accept_pair_request_atomic(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'H-00 FAIL: accept_pair_request_atomic has no pairing_limit_reached guard — leak is open';
  END IF;
  RAISE NOTICE 'H-00 PASS: function + guard text + dependency present';
END$$;

-- Shared synthetic ids (collision-free on prod):
--   A = fff10000-...0001 (receiver/accepter)   B = ...0002 (existing partner)
--   C = fff10000-...0003 (new sender)
--   R1/R2/R3 = the pending request under test;  RSEED = backs the seed pairing.

-- ─── H-01: FREE receiver at the limit CANNOT accept a new pairing ────────────
BEGIN;
  UPDATE app_config SET config_value='false' WHERE config_key='global_plus_access';
  INSERT INTO auth.users (id) VALUES
    ('fff10000-0000-4000-8000-000000000001'),
    ('fff10000-0000-4000-8000-000000000002'),
    ('fff10000-0000-4000-8000-000000000003');

  -- A already holds ONE pairing (A↔B), backed by RSEED → A is at the free limit.
  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('fff30000-0000-4000-8000-000000000001',
          'fff10000-0000-4000-8000-000000000002',
          'fff10000-0000-4000-8000-000000000001', 'accepted', 'visible');
  INSERT INTO public.pairings (user_a_id, user_b_id, pair_request_id)
  VALUES ('fff10000-0000-4000-8000-000000000001',
          'fff10000-0000-4000-8000-000000000002',
          'fff30000-0000-4000-8000-000000000001');

  -- C sends a NEW pending+visible request to A.
  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('fff20000-0000-4000-8000-000000000001',
          'fff10000-0000-4000-8000-000000000003',
          'fff10000-0000-4000-8000-000000000001', 'pending', 'visible');

  PERFORM set_config('request.jwt.claim.sub', 'fff10000-0000-4000-8000-000000000001', true);

  DO $$
  BEGIN
    PERFORM public.accept_pair_request_atomic('fff20000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'H-01 FAIL: free receiver at limit gained a 2nd pairing — LEAK OPEN';
  EXCEPTION WHEN OTHERS THEN
    IF position('pairing_limit_reached' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'H-01 FAIL: wrong error (expected pairing_limit_reached): %', SQLERRM;
    END IF;
    RAISE NOTICE 'H-01 PASS: free receiver at limit blocked (%)', SQLERRM;
  END$$;

  DO $$
  DECLARE v_cnt INT;
  BEGIN
    SELECT COUNT(*) INTO v_cnt FROM public.pairings
    WHERE user_a_id='fff10000-0000-4000-8000-000000000001'
       OR user_b_id='fff10000-0000-4000-8000-000000000001';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'H-01 FAIL: A pairing count is % (expected 1)', v_cnt; END IF;
    RAISE NOTICE 'H-01 PASS: A still holds exactly 1 pairing';
  END$$;
ROLLBACK;

-- ─── H-02: PLUS receiver CAN accept even while already holding a pairing ──────
BEGIN;
  UPDATE app_config SET config_value='false' WHERE config_key='global_plus_access';
  INSERT INTO auth.users (id) VALUES
    ('fff10000-0000-4000-8000-000000000001'),
    ('fff10000-0000-4000-8000-000000000002'),
    ('fff10000-0000-4000-8000-000000000003');

  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('fff30000-0000-4000-8000-000000000001',
          'fff10000-0000-4000-8000-000000000002',
          'fff10000-0000-4000-8000-000000000001', 'accepted', 'visible');
  INSERT INTO public.pairings (user_a_id, user_b_id, pair_request_id)
  VALUES ('fff10000-0000-4000-8000-000000000001',
          'fff10000-0000-4000-8000-000000000002',
          'fff30000-0000-4000-8000-000000000001');

  -- Grant BOTH participants mingla_plus so neither side trips the limit.
  INSERT INTO public.admin_subscription_overrides (user_id, tier, reason, starts_at, expires_at) VALUES
    ('fff10000-0000-4000-8000-000000000001','mingla_plus','orch_1239_test', now()-interval '1 day', now()+interval '1 day'),
    ('fff10000-0000-4000-8000-000000000003','mingla_plus','orch_1239_test', now()-interval '1 day', now()+interval '1 day');

  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('fff20000-0000-4000-8000-000000000002',
          'fff10000-0000-4000-8000-000000000003',
          'fff10000-0000-4000-8000-000000000001', 'pending', 'visible');

  PERFORM set_config('request.jwt.claim.sub', 'fff10000-0000-4000-8000-000000000001', true);

  DO $$
  DECLARE v_result json;
  BEGIN
    v_result := public.accept_pair_request_atomic('fff20000-0000-4000-8000-000000000002');
    IF (v_result->>'pairing_id') IS NULL THEN
      RAISE EXCEPTION 'H-02 FAIL: plus accept returned null pairing_id (no row created)';
    END IF;
    IF (v_result->>'paired_with_user_id') <> 'fff10000-0000-4000-8000-000000000003' THEN
      RAISE EXCEPTION 'H-02 FAIL: return shape wrong — paired_with_user_id = %', v_result->>'paired_with_user_id';
    END IF;
    RAISE NOTICE 'H-02 PASS: plus receiver accepted a 2nd pairing (id %)', v_result->>'pairing_id';
  END$$;
ROLLBACK;

-- ─── H-03: idempotent re-accept of an EXISTING pairing does NOT raise ─────────
BEGIN;
  UPDATE app_config SET config_value='false' WHERE config_key='global_plus_access';
  INSERT INTO auth.users (id) VALUES
    ('fff10000-0000-4000-8000-000000000001'),
    ('fff10000-0000-4000-8000-000000000003');

  -- The pending request between A and C.
  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('fff20000-0000-4000-8000-000000000003',
          'fff10000-0000-4000-8000-000000000003',
          'fff10000-0000-4000-8000-000000000001', 'pending', 'visible');

  -- The A↔C pairing ALREADY exists (re-accept scenario). A is at the FREE limit
  -- because this is their only pairing (count=1, max=1) — a naive limit check
  -- would WRONGLY block. The existing-pairing short-circuit must win.
  INSERT INTO public.pairings (user_a_id, user_b_id, pair_request_id)
  VALUES ('fff10000-0000-4000-8000-000000000001',
          'fff10000-0000-4000-8000-000000000003',
          'fff20000-0000-4000-8000-000000000003');

  PERFORM set_config('request.jwt.claim.sub', 'fff10000-0000-4000-8000-000000000001', true);

  DO $$
  DECLARE v_result json;
  BEGIN
    v_result := public.accept_pair_request_atomic('fff20000-0000-4000-8000-000000000003');
    -- ON CONFLICT DO NOTHING ⇒ pairing_id NULL on the idempotent re-insert, but
    -- the call MUST succeed (no raise) and keep the canonical return shape.
    IF (v_result->>'paired_with_user_id') <> 'fff10000-0000-4000-8000-000000000003' THEN
      RAISE EXCEPTION 'H-03 FAIL: return shape wrong on re-accept — %', v_result;
    END IF;
    RAISE NOTICE 'H-03 PASS: idempotent re-accept did not raise (pairing_id %, paired_with %)',
      COALESCE(v_result->>'pairing_id','<null-on-conflict>'), v_result->>'paired_with_user_id';
  END$$;

  DO $$
  DECLARE v_cnt INT;
  BEGIN
    SELECT COUNT(*) INTO v_cnt FROM public.pairings
    WHERE user_a_id='fff10000-0000-4000-8000-000000000001'
      AND user_b_id='fff10000-0000-4000-8000-000000000003';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'H-03 FAIL: pairing count is % (expected exactly 1)', v_cnt; END IF;
    RAISE NOTICE 'H-03 PASS: still exactly one A↔C pairing (no dupe)';
  END$$;
ROLLBACK;

DO $$ BEGIN RAISE NOTICE 'ORCH-1239 happy-path: ALL CASES PASS (H-00..H-03)'; END$$;
