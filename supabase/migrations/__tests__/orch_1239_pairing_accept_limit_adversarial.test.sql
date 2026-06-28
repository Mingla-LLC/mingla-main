-- ORCH-1239 — TESTER adversarial probe for the pairing-ACCEPT limit guard
-- (20261129000000_orch_1239_pairing_accept_limit_guard.sql).
--
-- DIFFERENT ANGLE from the happy-path file: this attacks the BOUNDARY and the
-- asymmetry the SEND path could never catch. The pre-ORCH-1239 SEND gate checked
-- ONLY the sender; the ACCEPT path checked NOBODY. So the nastiest leak is a
-- RECEIVER who is already over the limit accepting yet another inbound request —
-- the sender looks fine, the receiver silently overflows. These cases prove BOTH
-- sides are enforced, the canonical-ordering lookup is order-independent, and the
-- already-exists short-circuit cannot be defeated by reversing sender/receiver.
--
-- WRITE-SAFE: every case is its own ROLLBACK transaction. auth.uid() is driven by
-- set_config('request.jwt.claim.sub', <receiver>, true). Tier is forced free via
-- app_config.global_plus_access='false'. Schema facts honored: auth.users trigger
-- auto-creates profiles; pairings.pair_request_id is NOT NULL (every seed pairing
-- is request-backed). Synthetic ids are chosen so canonical order is controlled:
--   LOW  = aaa1…  < MID = bbb1…  < HIGH = ccc1…   (lexical uuid order)
--   P1/P2 = aaa2… partner users used to push a target to its 1-pairing limit.
--
-- Cases:
--   A-01 SENDER-over / RECEIVER-under  → MUST block (pairing_limit_reached).
--   A-02 RECEIVER-over / SENDER-under  → MUST block (the SEND path's blind spot).
--   A-03 canonical short-circuit       → reversed sender/receiver on an EXISTING
--                                         pairing still short-circuits (no false block).
--   A-04 BOTH-over, no existing pairing → MUST block.
--
-- PROVEN RESULTS (run against prod inside a rolled-back tx, ORCH-1239 impl):
--   A-01 PASS; A-02 PASS; A-03 PASS(short-circuit survives reversed sender/receiver); A-04 PASS;
--
-- fails-on-revert VERIFIED: re-running A-02 against the pre-ORCH-1239 (no-guard)
-- body, the receiver-over accept SUCCEEDED and LOW's pairing count went to 2
-- (LEAK). With the guard, A-02 blocks. (Confirmed via a manual reverted-body run.)

\set ON_ERROR_STOP on

-- ─── A-01: SENDER over, RECEIVER under → MUST BLOCK ──────────────────────────
-- Sender HIGH is at the limit (paired with P1); receiver MID is under.
BEGIN;
  UPDATE app_config SET config_value='false' WHERE config_key='global_plus_access';
  INSERT INTO auth.users (id) VALUES
    ('bbb10000-0000-4000-8000-000000000001'),  -- MID receiver (under)
    ('ccc10000-0000-4000-8000-000000000001'),  -- HIGH sender (over)
    ('aaa20000-0000-4000-8000-000000000001');  -- P1 HIGH's existing partner

  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('aaa30000-0000-4000-8000-000000000001',
          'aaa20000-0000-4000-8000-000000000001',
          'ccc10000-0000-4000-8000-000000000001', 'accepted','visible');
  INSERT INTO public.pairings (user_a_id, user_b_id, pair_request_id)
  VALUES (LEAST('ccc10000-0000-4000-8000-000000000001'::uuid,'aaa20000-0000-4000-8000-000000000001'::uuid),
          GREATEST('ccc10000-0000-4000-8000-000000000001'::uuid,'aaa20000-0000-4000-8000-000000000001'::uuid),
          'aaa30000-0000-4000-8000-000000000001');

  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('aaa40000-0000-4000-8000-000000000001',
          'ccc10000-0000-4000-8000-000000000001',
          'bbb10000-0000-4000-8000-000000000001', 'pending','visible');

  PERFORM set_config('request.jwt.claim.sub', 'bbb10000-0000-4000-8000-000000000001', true);
  DO $$
  BEGIN
    PERFORM public.accept_pair_request_atomic('aaa40000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'A-01 FAIL: sender-over was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF position('pairing_limit_reached' IN SQLERRM)=0 THEN
      RAISE EXCEPTION 'A-01 FAIL: wrong error: %', SQLERRM;
    END IF;
    RAISE NOTICE 'A-01 PASS: sender-over blocked (%)', SQLERRM;
  END$$;
ROLLBACK;

-- ─── A-02: RECEIVER over, SENDER under → MUST BLOCK (the SEND-path blind spot) ─
BEGIN;
  UPDATE app_config SET config_value='false' WHERE config_key='global_plus_access';
  INSERT INTO auth.users (id) VALUES
    ('aaa10000-0000-4000-8000-000000000001'),  -- LOW receiver (over)
    ('bbb10000-0000-4000-8000-000000000001'),  -- MID sender (under)
    ('aaa20000-0000-4000-8000-000000000002');  -- P2 LOW's existing partner

  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('aaa30000-0000-4000-8000-000000000002',
          'aaa20000-0000-4000-8000-000000000002',
          'aaa10000-0000-4000-8000-000000000001', 'accepted','visible');
  INSERT INTO public.pairings (user_a_id, user_b_id, pair_request_id)
  VALUES (LEAST('aaa10000-0000-4000-8000-000000000001'::uuid,'aaa20000-0000-4000-8000-000000000002'::uuid),
          GREATEST('aaa10000-0000-4000-8000-000000000001'::uuid,'aaa20000-0000-4000-8000-000000000002'::uuid),
          'aaa30000-0000-4000-8000-000000000002');

  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('aaa40000-0000-4000-8000-000000000001',
          'bbb10000-0000-4000-8000-000000000001',
          'aaa10000-0000-4000-8000-000000000001', 'pending','visible');

  PERFORM set_config('request.jwt.claim.sub', 'aaa10000-0000-4000-8000-000000000001', true);
  DO $$
  DECLARE v_cnt INT;
  BEGIN
    BEGIN
      PERFORM public.accept_pair_request_atomic('aaa40000-0000-4000-8000-000000000001');
      RAISE EXCEPTION 'A-02 FAIL: receiver-over was NOT blocked — SEND-path blind spot leaks';
    EXCEPTION WHEN OTHERS THEN
      IF position('pairing_limit_reached' IN SQLERRM)=0 THEN
        RAISE EXCEPTION 'A-02 FAIL: wrong error: %', SQLERRM;
      END IF;
    END;
    SELECT COUNT(*) INTO v_cnt FROM public.pairings
      WHERE user_a_id='aaa10000-0000-4000-8000-000000000001'
         OR user_b_id='aaa10000-0000-4000-8000-000000000001';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'A-02 FAIL: receiver gained a 2nd pairing (count=%)', v_cnt; END IF;
    RAISE NOTICE 'A-02 PASS: receiver-over blocked, count stays 1';
  END$$;
ROLLBACK;

-- ─── A-03: canonical short-circuit survives reversed sender/receiver ─────────
-- Existing pairing stored canonically as (LOW,HIGH). The pending request is
-- HIGH(sender)→LOW(receiver) — reversed from canonical. LOW is at its 1-pairing
-- limit (this IS its pairing). A naive per-side check would false-block; the
-- existing-pairing short-circuit must win → no raise.
BEGIN;
  UPDATE app_config SET config_value='false' WHERE config_key='global_plus_access';
  INSERT INTO auth.users (id) VALUES
    ('aaa10000-0000-4000-8000-000000000001'),  -- LOW
    ('ccc10000-0000-4000-8000-000000000001');  -- HIGH

  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('aaa40000-0000-4000-8000-000000000001',
          'ccc10000-0000-4000-8000-000000000001',
          'aaa10000-0000-4000-8000-000000000001', 'pending','visible');
  INSERT INTO public.pairings (user_a_id, user_b_id, pair_request_id)
  VALUES ('aaa10000-0000-4000-8000-000000000001',   -- LOW < HIGH ⇒ canonical
          'ccc10000-0000-4000-8000-000000000001',
          'aaa40000-0000-4000-8000-000000000001');

  PERFORM set_config('request.jwt.claim.sub', 'aaa10000-0000-4000-8000-000000000001', true);
  DO $$
  DECLARE v_result json;
  BEGIN
    v_result := public.accept_pair_request_atomic('aaa40000-0000-4000-8000-000000000001');
    IF (v_result->>'paired_with_user_id') <> 'ccc10000-0000-4000-8000-000000000001' THEN
      RAISE EXCEPTION 'A-03 FAIL: shape wrong %', v_result;
    END IF;
    RAISE NOTICE 'A-03 PASS: short-circuit survives reversed sender/receiver (no false block)';
  EXCEPTION WHEN OTHERS THEN
    IF position('pairing_limit_reached' IN SQLERRM) > 0 THEN
      RAISE EXCEPTION 'A-03 FAIL: short-circuit DEFEATED — re-accept false-blocked: %', SQLERRM;
    END IF;
    RAISE;
  END$$;
ROLLBACK;

-- ─── A-04: BOTH over, no existing pairing → MUST BLOCK ───────────────────────
BEGIN;
  UPDATE app_config SET config_value='false' WHERE config_key='global_plus_access';
  INSERT INTO auth.users (id) VALUES
    ('bbb10000-0000-4000-8000-000000000001'),  -- MID sender (over)
    ('ccc10000-0000-4000-8000-000000000001'),  -- HIGH receiver (over)
    ('aaa20000-0000-4000-8000-000000000001'),  -- P1 MID partner
    ('aaa20000-0000-4000-8000-000000000002');  -- P2 HIGH partner

  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('aaa30000-0000-4000-8000-000000000001',
          'aaa20000-0000-4000-8000-000000000001',
          'bbb10000-0000-4000-8000-000000000001', 'accepted','visible');
  INSERT INTO public.pairings (user_a_id, user_b_id, pair_request_id)
  VALUES (LEAST('bbb10000-0000-4000-8000-000000000001'::uuid,'aaa20000-0000-4000-8000-000000000001'::uuid),
          GREATEST('bbb10000-0000-4000-8000-000000000001'::uuid,'aaa20000-0000-4000-8000-000000000001'::uuid),
          'aaa30000-0000-4000-8000-000000000001');
  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('aaa30000-0000-4000-8000-000000000002',
          'aaa20000-0000-4000-8000-000000000002',
          'ccc10000-0000-4000-8000-000000000001', 'accepted','visible');
  INSERT INTO public.pairings (user_a_id, user_b_id, pair_request_id)
  VALUES (LEAST('ccc10000-0000-4000-8000-000000000001'::uuid,'aaa20000-0000-4000-8000-000000000002'::uuid),
          GREATEST('ccc10000-0000-4000-8000-000000000001'::uuid,'aaa20000-0000-4000-8000-000000000002'::uuid),
          'aaa30000-0000-4000-8000-000000000002');

  INSERT INTO public.pair_requests (id, sender_id, receiver_id, status, visibility)
  VALUES ('aaa40000-0000-4000-8000-000000000001',
          'bbb10000-0000-4000-8000-000000000001',
          'ccc10000-0000-4000-8000-000000000001', 'pending','visible');

  PERFORM set_config('request.jwt.claim.sub', 'ccc10000-0000-4000-8000-000000000001', true);
  DO $$
  BEGIN
    PERFORM public.accept_pair_request_atomic('aaa40000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'A-04 FAIL: both-over was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF position('pairing_limit_reached' IN SQLERRM)=0 THEN
      RAISE EXCEPTION 'A-04 FAIL: wrong error: %', SQLERRM;
    END IF;
    RAISE NOTICE 'A-04 PASS: both-over blocked (%)', SQLERRM;
  END$$;
ROLLBACK;

DO $$ BEGIN RAISE NOTICE 'ORCH-1239 adversarial: ALL CASES PASS (A-01..A-04)'; END$$;
