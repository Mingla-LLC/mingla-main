-- Auto-delete collaboration sessions that have fewer than 2 participants
-- and clean up any existing orphan/singleton sessions.

CREATE OR REPLACE FUNCTION public.cleanup_session_if_under_two_participants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_session_id UUID;
  participant_count INTEGER;
BEGIN
  target_session_id := OLD.session_id;

  IF target_session_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO participant_count
    FROM public.session_participants
    WHERE session_id = target_session_id;

    IF participant_count < 2 THEN
      DELETE FROM public.collaboration_sessions
      WHERE id = target_session_id;
    END IF;
  END IF;

  target_session_id := NEW.session_id;

  IF target_session_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO participant_count
    FROM public.session_participants
    WHERE session_id = target_session_id;

    IF participant_count < 2 THEN
      DELETE FROM public.collaboration_sessions
      WHERE id = target_session_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_session_under_two_participants ON public.session_participants;
CREATE TRIGGER trg_cleanup_session_under_two_participants
AFTER INSERT OR UPDATE OR DELETE ON public.session_participants
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_session_if_under_two_participants();

-- One-time cleanup for leftover sessions already in invalid state.
DELETE FROM public.collaboration_sessions cs
WHERE (
  SELECT COUNT(*)
  FROM public.session_participants sp
  WHERE sp.session_id = cs.id
) < 2;
