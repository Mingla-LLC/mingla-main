-- Fix auto-cleanup trigger so pending sessions are not deleted during creation
-- Problem: previous trigger ran on INSERT/UPDATE/DELETE and deleted sessions with < 2 participants.
-- During session creation, creator insert makes participant_count = 1, so session was immediately deleted.

CREATE OR REPLACE FUNCTION public.cleanup_session_if_under_two_participants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_session_id UUID;
  accepted_count INTEGER;
  session_status TEXT;
BEGIN
  target_session_id := COALESCE(OLD.session_id, NEW.session_id);

  IF target_session_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only evaluate cleanup when membership can shrink
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Only auto-delete active sessions that dropped below 2 accepted participants
  SELECT cs.status
  INTO session_status
  FROM public.collaboration_sessions cs
  WHERE cs.id = target_session_id;

  IF session_status IS NULL OR session_status <> 'active' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COUNT(*)
  INTO accepted_count
  FROM public.session_participants sp
  WHERE sp.session_id = target_session_id
    AND sp.has_accepted = true;

  IF accepted_count < 2 THEN
    DELETE FROM public.collaboration_sessions
    WHERE id = target_session_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_session_under_two_participants ON public.session_participants;
CREATE TRIGGER trg_cleanup_session_under_two_participants
AFTER DELETE OR UPDATE ON public.session_participants
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_session_if_under_two_participants();

-- Correct prior cleanup scope: only remove active sessions with fewer than 2 accepted participants.
DELETE FROM public.collaboration_sessions cs
WHERE cs.status = 'active'
  AND (
    SELECT COUNT(*)
    FROM public.session_participants sp
    WHERE sp.session_id = cs.id
      AND sp.has_accepted = true
  ) < 2;
