-- ============================================
-- Add RLS Policies for session_participants and collaboration_invites
-- ============================================
-- These tables had RLS enabled but NO policies defined, causing all access to be blocked!
-- This migration adds the necessary policies to allow the app to function

-- ===========================================
-- RLS Policies for session_participants
-- ===========================================
-- Allow users to view and manage participants in sessions they're involved with

DROP POLICY IF EXISTS "Users can view session participants in sessions they're in" ON public.session_participants;
CREATE POLICY "Users can view session participants in sessions they're in" 
ON public.session_participants
FOR SELECT
USING (
  -- User is a participant in the session
  auth.uid() = user_id
  OR
  -- User created the session
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_participants.session_id
    AND cs.created_by = auth.uid()
  )
  OR
  -- User is another participant in the same session
  EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = session_participants.session_id
    AND sp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can add themselves or others as session participants" ON public.session_participants;
CREATE POLICY "Users can add themselves or others as session participants" 
ON public.session_participants
FOR INSERT
WITH CHECK (
  -- User is creating participant record for themselves
  auth.uid() = user_id
  OR
  -- User is the creator of the session
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_participants.session_id
    AND cs.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update session participation status" ON public.session_participants;
CREATE POLICY "Users can update session participation status" 
ON public.session_participants
FOR UPDATE
USING (
  -- User is updating their own participation
  auth.uid() = user_id
  OR
  -- User is the session creator (can manage all participants)
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_participants.session_id
    AND cs.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can remove themselves from sessions" ON public.session_participants;
CREATE POLICY "Users can remove themselves from sessions" 
ON public.session_participants
FOR DELETE
USING (
  -- User can remove themselves
  auth.uid() = user_id
  OR
  -- Session creator can remove participants
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = session_participants.session_id
    AND cs.created_by = auth.uid()
  )
);

-- ===========================================
-- RLS Policies for collaboration_invites
-- ===========================================
-- Allow users to view and manage invites they're involved with

DROP POLICY IF EXISTS "Users can view their own invites" ON public.collaboration_invites;
CREATE POLICY "Users can view their own invites" 
ON public.collaboration_invites
FOR SELECT
USING (
  -- User is the invitee
  auth.uid() = invitee_id
  OR
  auth.uid() = invited_user_id
  OR
  -- User is the inviter
  auth.uid() = inviter_id
  OR
  auth.uid() = invited_by
  OR
  -- User is a participant in the session
  EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = collaboration_invites.session_id
    AND sp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can create invites for sessions they're organizing" ON public.collaboration_invites;
CREATE POLICY "Users can create invites for sessions they're organizing" 
ON public.collaboration_invites
FOR INSERT
WITH CHECK (
  -- User is the inviter
  auth.uid() = inviter_id
  OR
  auth.uid() = invited_by
  OR
  -- User created the session
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = collaboration_invites.session_id
    AND cs.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update invite status" ON public.collaboration_invites;
CREATE POLICY "Users can update invite status" 
ON public.collaboration_invites
FOR UPDATE
USING (
  -- Invitee can update their invite status
  auth.uid() = invitee_id
  OR
  auth.uid() = invited_user_id
  OR
  -- Inviter can update
  auth.uid() = inviter_id
  OR
  auth.uid() = invited_by
  OR
  -- Session creator can update
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = collaboration_invites.session_id
    AND cs.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can delete invites" ON public.collaboration_invites;
CREATE POLICY "Users can delete invites" 
ON public.collaboration_invites
FOR DELETE
USING (
  -- Invitee can delete
  auth.uid() = invitee_id
  OR
  auth.uid() = invited_user_id
  OR
  -- Inviter can delete
  auth.uid() = inviter_id
  OR
  auth.uid() = invited_by
  OR
  -- Session creator can delete
  EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
    WHERE cs.id = collaboration_invites.session_id
    AND cs.created_by = auth.uid()
  )
);
