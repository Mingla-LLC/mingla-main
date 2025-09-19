-- Fix security issues: Enable RLS and create policies for new tables

-- Enable RLS on session_members table
ALTER TABLE session_members ENABLE ROW LEVEL SECURITY;

-- Enable RLS on collaboration_boards table  
ALTER TABLE collaboration_boards ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for session_members
CREATE POLICY "Users can view their own memberships" 
ON session_members FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can view session participants they belong to" 
ON session_members FOR SELECT 
USING (
  session_id IN (
    SELECT session_id FROM session_members WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Owners can manage session memberships" 
ON session_members FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM session_members sm 
    WHERE sm.session_id = session_members.session_id 
      AND sm.user_id = auth.uid() 
      AND sm.role = 'owner'
  )
);

-- Create RLS policies for collaboration_boards
CREATE POLICY "Session members can view boards" 
ON collaboration_boards FOR SELECT 
USING (
  session_id IN (
    SELECT session_id FROM session_members WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Session owners can manage boards" 
ON collaboration_boards FOR ALL 
USING (
  session_id IN (
    SELECT session_id FROM session_members 
    WHERE user_id = auth.uid() AND role = 'owner'
  )
);

-- Fix function search path issue
CREATE OR REPLACE FUNCTION can_delete_session(session_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session_members sm
    WHERE sm.session_id = $1 
      AND sm.user_id = $2 
      AND sm.role = 'owner'
  );
$$;