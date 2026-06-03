-- META-ORCH-1009 Sub-E pending-action expiry function contract.

DO $$
BEGIN
  IF to_regprocedure('public.expire_agent_pending_actions(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'SUB-E FAIL: expire_agent_pending_actions(timestamptz) missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'expire_agent_pending_actions'
      AND p.prosecdef = true
  ) THEN
    RAISE EXCEPTION 'SUB-E FAIL: expire_agent_pending_actions must be SECURITY DEFINER';
  END IF;

  RAISE NOTICE 'SUB-E PASS: pending-action expiry function exists';
END $$;
