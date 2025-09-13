-- Fix infinite recursion in RLS policies by creating much simpler policies

-- Drop all existing policies for collaboration_sessions
DROP POLICY IF EXISTS "Session creators can update their sessions" ON collaboration_sessions;
DROP POLICY IF EXISTS "Users can create sessions" ON collaboration_sessions;
DROP POLICY IF EXISTS "Users can view sessions they created" ON collaboration_sessions;
DROP POLICY IF EXISTS "Users can view sessions they participate in" ON collaboration_sessions;

-- Drop all existing policies for session_participants  
DROP POLICY IF EXISTS "Session creators can add participants" ON session_participants;
DROP POLICY IF EXISTS "Session creators can view all participants" ON session_participants;
DROP POLICY IF EXISTS "Users can update their own participation" ON session_participants;
DROP POLICY IF EXISTS "Users can view their own participation" ON session_participants;

-- Drop all existing policies for collaboration_invites
DROP POLICY IF EXISTS "Users can create invites for their sessions" ON collaboration_invites;
DROP POLICY IF EXISTS "Users can update invites they sent or received" ON collaboration_invites;
DROP POLICY IF EXISTS "Users can view invites they sent or received" ON collaboration_invites;

-- Drop all existing policies for conversations
DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
DROP POLICY IF EXISTS "Users can view conversations they participate in" ON conversations;

-- Create simple, non-recursive policies for collaboration_sessions
CREATE POLICY "Users can manage their own sessions" ON collaboration_sessions
FOR ALL USING (auth.uid() = created_by);

-- Create simple, non-recursive policies for session_participants
CREATE POLICY "Anyone authenticated can view participants" ON session_participants
FOR SELECT USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Anyone authenticated can insert participants" ON session_participants
FOR INSERT WITH CHECK (auth.role() = 'authenticated'::text);

CREATE POLICY "Users can update their own participation" ON session_participants
FOR UPDATE USING (auth.uid() = user_id);

-- Create simple, non-recursive policies for collaboration_invites
CREATE POLICY "Users can manage invites they sent or received" ON collaboration_invites
FOR ALL USING (auth.uid() = invited_by OR auth.uid() = invited_user_id);

-- Create simple, non-recursive policies for conversations
CREATE POLICY "Users can create conversations" ON conversations
FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can view all conversations" ON conversations  
FOR SELECT USING (auth.role() = 'authenticated'::text);

-- Create simple, non-recursive policies for conversation_participants
CREATE POLICY "Anyone can manage conversation participants" ON conversation_participants
FOR ALL USING (auth.role() = 'authenticated'::text);