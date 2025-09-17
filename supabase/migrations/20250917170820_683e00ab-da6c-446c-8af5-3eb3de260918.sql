-- Fix search_path for validation function
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
$$ LANGUAGE plpgsql SET search_path = public;

-- Fix search_path for cleanup function  
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
$$ LANGUAGE plpgsql SET search_path = public;