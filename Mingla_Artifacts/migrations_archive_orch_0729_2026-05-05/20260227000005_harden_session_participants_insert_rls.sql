-- Harden session_participants INSERT policy for real app flows.
-- Ensures session creator can always add invited friends as participants,
-- even if helper function behavior drifts across migrations.

DROP POLICY IF EXISTS "sp_insert" ON public.session_participants;

CREATE POLICY "sp_insert" ON public.session_participants
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.collaboration_sessions cs
    WHERE cs.id = session_participants.session_id
      AND cs.created_by = auth.uid()
  )
  OR public.is_session_participant(session_id, auth.uid())
);
