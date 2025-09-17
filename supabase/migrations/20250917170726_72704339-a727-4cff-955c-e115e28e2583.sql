-- Clean up invalid sessions with only one participant
DELETE FROM collaboration_sessions 
WHERE id IN (
  SELECT cs.id 
  FROM collaboration_sessions cs
  LEFT JOIN session_participants sp ON cs.id = sp.session_id
  GROUP BY cs.id
  HAVING COUNT(sp.user_id) <= 1
);

-- Clean up orphaned session participants
DELETE FROM session_participants 
WHERE session_id NOT IN (SELECT id FROM collaboration_sessions);

-- Clean up orphaned collaboration invites
DELETE FROM collaboration_invites 
WHERE session_id NOT IN (SELECT id FROM collaboration_sessions);

-- Add a function to validate session participant count
CREATE OR REPLACE FUNCTION validate_session_participants()
RETURNS TRIGGER AS $$
BEGIN
  -- For active sessions, ensure there are at least 2 participants
  IF NEW.status = 'active' THEN
    IF (SELECT COUNT(*) FROM session_participants WHERE session_id = NEW.id) < 2 THEN
      RAISE EXCEPTION 'Active collaboration sessions must have at least 2 participants';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to validate session status changes
DROP TRIGGER IF EXISTS validate_session_status_trigger ON collaboration_sessions;
CREATE TRIGGER validate_session_status_trigger
  BEFORE UPDATE OF status ON collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION validate_session_participants();

-- Add a function to auto-cleanup sessions when participants leave
CREATE OR REPLACE FUNCTION cleanup_empty_sessions()
RETURNS TRIGGER AS $$
DECLARE
  participant_count INTEGER;
BEGIN
  -- Count remaining participants for the session
  SELECT COUNT(*) INTO participant_count 
  FROM session_participants 
  WHERE session_id = OLD.session_id;
  
  -- If no participants left, delete the session
  IF participant_count = 0 THEN
    DELETE FROM collaboration_sessions WHERE id = OLD.session_id;
    DELETE FROM collaboration_invites WHERE session_id = OLD.session_id;
  -- If only one participant left, set session to pending (invalid for active)
  ELSIF participant_count = 1 THEN
    UPDATE collaboration_sessions 
    SET status = 'pending' 
    WHERE id = OLD.session_id AND status = 'active';
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for when participants are removed
DROP TRIGGER IF EXISTS cleanup_sessions_on_participant_removal ON session_participants;
CREATE TRIGGER cleanup_sessions_on_participant_removal
  AFTER DELETE ON session_participants
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_empty_sessions();