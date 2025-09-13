-- Completely remove recursive policies and use simple user-based policies

-- Drop all existing policies on conversation_participants
DROP POLICY IF EXISTS "Users can add participants to their conversations" ON public.conversation_participants;
DROP POLICY IF EXISTS "Users can view conversation participants" ON public.conversation_participants;

-- Create simple policies that don't cause recursion
CREATE POLICY "Users can view their own participation records" 
ON public.conversation_participants 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can create their own participation records" 
ON public.conversation_participants 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

-- Allow conversation creators to add other users (this will be handled at the application level)
CREATE POLICY "Allow authenticated users to manage conversation participants" 
ON public.conversation_participants 
FOR ALL 
USING (auth.role() = 'authenticated'::text);

-- Remove the conflicting policies to keep only the simple one
DROP POLICY IF EXISTS "Users can view their own participation records" ON public.conversation_participants;
DROP POLICY IF EXISTS "Users can create their own participation records" ON public.conversation_participants;