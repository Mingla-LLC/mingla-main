-- Fix infinite recursion in RLS policies by using simpler policies

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view sessions they created or participate in" ON public.collaboration_sessions;
DROP POLICY IF EXISTS "Users can view participants of their sessions" ON public.session_participants;
DROP POLICY IF EXISTS "Session creators can add participants" ON public.session_participants;

-- Create simpler, non-recursive policies for collaboration_sessions
CREATE POLICY "Users can view sessions they created" 
ON public.collaboration_sessions 
FOR SELECT 
USING (auth.uid() = created_by);

CREATE POLICY "Users can view sessions they participate in"
ON public.collaboration_sessions 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM session_participants 
    WHERE session_participants.session_id = collaboration_sessions.id 
    AND session_participants.user_id = auth.uid()
  )
);

-- Create simpler policies for session_participants  
CREATE POLICY "Users can view their own participation" 
ON public.session_participants 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Session creators can view all participants"
ON public.session_participants 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM collaboration_sessions 
    WHERE collaboration_sessions.id = session_participants.session_id 
    AND collaboration_sessions.created_by = auth.uid()
  )
);

CREATE POLICY "Session creators can add participants" 
ON public.session_participants 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM collaboration_sessions 
    WHERE collaboration_sessions.id = session_participants.session_id 
    AND collaboration_sessions.created_by = auth.uid()
  )
);