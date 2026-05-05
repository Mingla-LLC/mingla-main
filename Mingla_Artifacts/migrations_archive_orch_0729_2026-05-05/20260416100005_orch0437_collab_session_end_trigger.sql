-- ===========================================
-- ORCH-0437: Near You Leaderboard — Phase 1
-- Migration 5: Trigger to restore leaderboard presence when collab ends
-- ===========================================

-- When a collaboration session transitions to 'completed' or 'archived',
-- all participants who were on the leaderboard get their seats restored
-- and their active_collab_session_id cleared. This makes them reappear
-- on the leaderboard with their original preferences.

CREATE OR REPLACE FUNCTION public.handle_collab_session_end()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'archived') AND OLD.status NOT IN ('completed', 'archived') THEN
    -- Restore leaderboard presence for all participants of this session
    UPDATE leaderboard_presence lp
    SET
      available_seats = COALESCE(
        (SELECT ums.available_seats FROM user_map_settings ums WHERE ums.user_id = lp.user_id),
        1
      ),
      active_collab_session_id = NULL,
      updated_at = now()
    WHERE lp.active_collab_session_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_collab_session_end
  AFTER UPDATE OF status ON public.collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_collab_session_end();
