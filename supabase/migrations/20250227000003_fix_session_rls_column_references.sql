-- ============================================
-- Fix RLS Policies - Correct Column References
-- ============================================
-- The previous migration had table-qualified column names in WHERE clauses
-- This migration fixes them to use unqualified names (the standard for RLS)

-- ===========================================
-- Fix session_participants RLS Policies
-- ===========================================

DROP POLICY IF EXISTS "Users can view session participants in sessions they're in" ON public.session_participants;
CREATE POLICY "Users can view session participants in sessions they're in" 
ON public.session_participants
FOR SELECT
USING (
  auth.uid() = user_id
  OR
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_id
    AND cs.created_by = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = session_id
    AND sp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can add themselves or others as session participants" ON public.session_participants;
CREATE POLICY "Users can add themselves or others as session participants" 
ON public.session_participants
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  OR
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_id
    AND cs.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update session participation status" ON public.session_participants;
CREATE POLICY "Users can update session participation status" 
ON public.session_participants
FOR UPDATE
USING (
  auth.uid() = user_id
  OR
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_id
    AND cs.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can remove themselves from sessions" ON public.session_participants;
CREATE POLICY "Users can remove themselves from sessions" 
ON public.session_participants
FOR DELETE
USING (
  auth.uid() = user_id
  OR
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_id
    AND cs.created_by = auth.uid()
  )
);

-- ===========================================
-- Fix collaboration_invites RLS Policies
-- ===========================================

DROP POLICY IF EXISTS "Users can view their own invites" ON public.collaboration_invites;
CREATE POLICY "Users can view their own invites" 
ON public.collaboration_invites
FOR SELECT
USING (
  auth.uid() = invitee_id
  OR
  auth.uid() = invited_user_id
  OR
  auth.uid() = inviter_id
  OR
  auth.uid() = invited_by
  OR
  EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = session_id
    AND sp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can create invites for sessions they're organizing" ON public.collaboration_invites;
CREATE POLICY "Users can create invites for sessions they're organizing" 
ON public.collaboration_invites
FOR INSERT
WITH CHECK (
  auth.uid() = inviter_id
  OR
  auth.uid() = invited_by
  OR
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_id
    AND cs.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update invite status" ON public.collaboration_invites;
CREATE POLICY "Users can update invite status" 
ON public.collaboration_invites
FOR UPDATE
USING (
  auth.uid() = invitee_id
  OR
  auth.uid() = invited_user_id
  OR
  auth.uid() = inviter_id
  OR
  auth.uid() = invited_by
  OR
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_id
    AND cs.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can delete invites" ON public.collaboration_invites;
CREATE POLICY "Users can delete invites" 
ON public.collaboration_invites
FOR DELETE
USING (
  auth.uid() = invitee_id
  OR
  auth.uid() = invited_user_id
  OR
  auth.uid() = inviter_id
  OR
  auth.uid() = invited_by
  OR
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_id
    AND cs.created_by = auth.uid()
  )
);
