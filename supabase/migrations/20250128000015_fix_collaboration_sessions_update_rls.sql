-- Fix RLS policy on collaboration_sessions to allow participants to update session status
-- Previously only the creator could update, but we need participants to be able to
-- update the session status to 'active' when they accept an invite

-- Drop the existing restrictive update policy
DROP POLICY IF EXISTS "Users can update their own sessions" ON public.collaboration_sessions;

-- Create a new UPDATE policy that allows:
-- 1. Creators can update all fields
-- 2. Participants who have accepted can update the session (for status changes)
CREATE POLICY "Users can update sessions they created or participate in" 
ON public.collaboration_sessions
FOR UPDATE
USING (
  -- User created the session
  auth.uid() = created_by
  OR
  -- User is an accepted participant in the session
  EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = collaboration_sessions.id
    AND sp.user_id = auth.uid()
    AND sp.has_accepted = true
  )
)
WITH CHECK (
  -- User created the session
  auth.uid() = created_by
  OR
  -- User is an accepted participant in the session
  EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = collaboration_sessions.id
    AND sp.user_id = auth.uid()
    AND sp.has_accepted = true
  )
);
