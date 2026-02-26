-- Fix RLS policy on collaboration_sessions to allow users to see sessions they're invited to
-- or are participants in, not just sessions they created

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Users can manage their own sessions" ON public.collaboration_sessions;

-- Create a new SELECT policy that allows users to see:
-- 1. Sessions they created
-- 2. Sessions they're participants in
-- 3. Sessions they're invited to (via collaboration_invites)
CREATE POLICY "Users can view sessions they created, are participants in, or are invited to" 
ON public.collaboration_sessions
FOR SELECT
USING (
  -- User created the session
  auth.uid() = created_by
  OR
  -- User is a participant in the session
  EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = collaboration_sessions.id
    AND sp.user_id = auth.uid()
  )
  OR
  -- User has an invite to the session
  EXISTS (
    SELECT 1 FROM public.collaboration_invites ci
    WHERE ci.session_id = collaboration_sessions.id
    AND ci.invited_user_id = auth.uid()
    AND ci.status = 'pending'
  )
);

-- Keep the existing INSERT, UPDATE, DELETE policies for creators only
CREATE POLICY "Users can create their own sessions" 
ON public.collaboration_sessions
FOR INSERT
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own sessions" 
ON public.collaboration_sessions
FOR UPDATE
USING (auth.uid() = created_by)
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can delete their own sessions" 
ON public.collaboration_sessions
FOR DELETE
USING (auth.uid() = created_by);

