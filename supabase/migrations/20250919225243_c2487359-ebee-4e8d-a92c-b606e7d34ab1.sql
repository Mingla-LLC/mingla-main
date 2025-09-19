-- Clean up orphaned collaboration data and fix any inconsistencies
-- This migration ensures data integrity after collaboration system fixes

-- 1. Clean up sessions without any participants (orphaned sessions)
DELETE FROM collaboration_sessions 
WHERE id NOT IN (
  SELECT DISTINCT session_id 
  FROM session_participants 
  WHERE session_id IS NOT NULL
);

-- 2. Clean up invites for non-existent sessions
DELETE FROM collaboration_invites 
WHERE session_id NOT IN (
  SELECT id FROM collaboration_sessions
);

-- 3. Update any sessions that should be active but aren't
-- (sessions where all participants have accepted and there are 2+ participants)
UPDATE collaboration_sessions 
SET status = 'pending'
WHERE id IN (
  SELECT cs.id
  FROM collaboration_sessions cs
  JOIN (
    SELECT session_id, COUNT(*) as total_participants, COUNT(CASE WHEN has_accepted THEN 1 END) as accepted_participants
    FROM session_participants
    GROUP BY session_id
    HAVING COUNT(*) >= 2 AND COUNT(CASE WHEN has_accepted THEN 1 END) = COUNT(*)
  ) p ON cs.id = p.session_id
  WHERE cs.status = 'pending'
);

-- 4. Ensure all collaboration_invites have corresponding session_participants
INSERT INTO session_participants (session_id, user_id, has_accepted, joined_at, created_at)
SELECT 
  ci.session_id,
  ci.invited_user_id,
  CASE WHEN ci.status = 'accepted' THEN true ELSE false END,
  CASE WHEN ci.status = 'accepted' THEN ci.updated_at ELSE null END,
  ci.created_at
FROM collaboration_invites ci
LEFT JOIN session_participants sp ON (ci.session_id = sp.session_id AND ci.invited_user_id = sp.user_id)
WHERE sp.id IS NULL
  AND ci.status IN ('pending', 'accepted');

-- 5. Create indexes for better performance on collaboration queries
CREATE INDEX IF NOT EXISTS idx_collaboration_invites_invited_user_status 
ON collaboration_invites(invited_user_id, status);

CREATE INDEX IF NOT EXISTS idx_collaboration_invites_session_status 
ON collaboration_invites(session_id, status);

CREATE INDEX IF NOT EXISTS idx_session_participants_session_accepted 
ON session_participants(session_id, has_accepted);

CREATE INDEX IF NOT EXISTS idx_session_participants_user_session 
ON session_participants(user_id, session_id);

-- 6. Add a function to automatically clean up empty sessions
CREATE OR REPLACE FUNCTION cleanup_empty_sessions_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  participant_count INTEGER;
BEGIN
  -- Count remaining participants for the session
  SELECT COUNT(*) INTO participant_count 
  FROM session_participants 
  WHERE session_id = OLD.session_id;
  
  -- If no participants left, delete the session and related data
  IF participant_count = 0 THEN
    -- Delete related invites first
    DELETE FROM collaboration_invites WHERE session_id = OLD.session_id;
    -- Delete the session
    DELETE FROM collaboration_sessions WHERE id = OLD.session_id;
  -- If only one participant left and they're the creator, allow it (solo sessions)
  ELSIF participant_count = 1 THEN
    UPDATE collaboration_sessions 
    SET status = 'pending', board_id = NULL
    WHERE id = OLD.session_id AND status = 'active';
  END IF;
  
  RETURN OLD;
END;
$$;

-- Replace the old trigger if it exists
DROP TRIGGER IF EXISTS cleanup_empty_sessions_trigger ON session_participants;
CREATE TRIGGER cleanup_empty_sessions_trigger
  AFTER DELETE ON session_participants
  FOR EACH ROW EXECUTE FUNCTION cleanup_empty_sessions_v2();