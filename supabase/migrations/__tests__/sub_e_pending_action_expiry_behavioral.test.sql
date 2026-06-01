-- META-ORCH-1009 Sub-E (C4) — BEHAVIORAL test for expire_agent_pending_actions
-- (SPEC §11.1). Unlike sub_e_pending_action_expiry.test.sql (which only checks
-- the function exists + is SECURITY DEFINER), this test exercises the actual
-- UPDATE behaviour against seeded rows:
--   1. stale `pending` rows (expires_at < now) flip to `expired`;
--   2. non-stale `pending` rows (expires_at > now) stay `pending`;
--   3. `executed` / `failed` / `cancelled` rows are NEVER touched, even if stale.
--   4. the function returns the count of rows it flipped.
--
-- Run after applying 20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql.
-- Self-contained: seeds its own rows under a savepoint and rolls back so it
-- leaves zero residue in agent_pending_actions.
--
-- fails-on-revert: if expire_agent_pending_actions did NOT flip stale pending
-- rows (the pre-Sub-E state where the function was absent), assertion (1) raises.

DO $$
DECLARE
  v_uid uuid;
  v_stale_id uuid := gen_random_uuid();
  v_fresh_id uuid := gen_random_uuid();
  v_executed_id uuid := gen_random_uuid();
  v_failed_id uuid := gen_random_uuid();
  v_cancelled_id uuid := gen_random_uuid();
  v_stale_executed_id uuid := gen_random_uuid();
  v_flipped integer;
  v_status text;
BEGIN
  -- Borrow any existing auth user for the NOT NULL user_id FK; skip cleanly if none.
  SELECT id INTO v_uid FROM auth.users LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'SUB-E BEHAVIORAL SKIP: no auth.users row to seed against';
    RETURN;
  END IF;

  -- Seed rows inside a savepoint so we can roll back regardless of outcome.
  -- agent_pending_actions columns: id, user_id, tool_name, tool_args, status,
  -- expires_at, source (per 20260603000001 + 20260623000000).
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, expires_at, source)
  VALUES
    (v_stale_id,          v_uid, 'create_experience', '{}'::jsonb, 'pending',   now() - interval '1 hour', 'hub_experience'),
    (v_fresh_id,          v_uid, 'create_experience', '{}'::jsonb, 'pending',   now() + interval '6 days',  'hub_experience'),
    (v_executed_id,       v_uid, 'create_experience', '{}'::jsonb, 'executed',  now() - interval '1 hour', 'hub_experience'),
    (v_failed_id,         v_uid, 'create_experience', '{}'::jsonb, 'failed',    now() - interval '1 hour', 'hub_experience'),
    (v_cancelled_id,      v_uid, 'create_experience', '{}'::jsonb, 'cancelled', now() - interval '1 hour', 'hub_experience'),
    (v_stale_executed_id, v_uid, 'create_experience', '{}'::jsonb, 'executed',  now() - interval '2 hour', 'hub_experience');

  -- Run the sweeper.
  SELECT public.expire_agent_pending_actions(now()) INTO v_flipped;

  -- (1) stale pending -> expired
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_stale_id;
  IF v_status IS DISTINCT FROM 'expired' THEN
    RAISE EXCEPTION 'SUB-E BEHAVIORAL FAIL: stale pending row not flipped to expired (got %)', v_status;
  END IF;

  -- (2) fresh pending stays pending
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_fresh_id;
  IF v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'SUB-E BEHAVIORAL FAIL: non-stale pending row was changed (got %)', v_status;
  END IF;

  -- (3) terminal rows untouched even when stale
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_executed_id;
  IF v_status IS DISTINCT FROM 'executed' THEN
    RAISE EXCEPTION 'SUB-E BEHAVIORAL FAIL: executed row was touched (got %)', v_status;
  END IF;
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_failed_id;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'SUB-E BEHAVIORAL FAIL: failed row was touched (got %)', v_status;
  END IF;
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_cancelled_id;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'SUB-E BEHAVIORAL FAIL: cancelled row was touched (got %)', v_status;
  END IF;
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_stale_executed_id;
  IF v_status IS DISTINCT FROM 'executed' THEN
    RAISE EXCEPTION 'SUB-E BEHAVIORAL FAIL: stale executed row was flipped (got %)', v_status;
  END IF;

  -- (4) return count covers exactly the 1 stale pending row seeded here
  IF v_flipped < 1 THEN
    RAISE EXCEPTION 'SUB-E BEHAVIORAL FAIL: expire fn returned % (expected >= 1)', v_flipped;
  END IF;

  -- Clean up seeded rows (no COMMIT; this DO block is meant to run in a
  -- transaction the harness rolls back, but delete defensively too).
  DELETE FROM public.agent_pending_actions
   WHERE id IN (v_stale_id, v_fresh_id, v_executed_id, v_failed_id, v_cancelled_id, v_stale_executed_id);

  RAISE NOTICE 'SUB-E BEHAVIORAL PASS: expire_agent_pending_actions flips stale pending only (% flipped incl. seeded)', v_flipped;
END $$;
