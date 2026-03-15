-- ============================================================
-- BEFORE INSERT trigger on collaboration_sessions to enforce
-- tier-based session creation limits at the database level.
--
-- This ensures that even if the client bypasses the UI gate,
-- the database rejects session creation beyond the user's
-- tier limit.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_session_creation_limit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_check RECORD;
BEGIN
  -- Use the existing check function to determine if creation is allowed
  SELECT * INTO v_check
  FROM check_session_creation_allowed(NEW.created_by);

  IF NOT v_check.allowed THEN
    RAISE EXCEPTION 'session_limit_reached: You have reached your % limit of % active session(s).',
      v_check.tier, v_check.max_allowed
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Only fire on INSERT (not UPDATE) to avoid blocking status changes
CREATE TRIGGER enforce_session_creation_limit_trigger
  BEFORE INSERT ON collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_session_creation_limit();
