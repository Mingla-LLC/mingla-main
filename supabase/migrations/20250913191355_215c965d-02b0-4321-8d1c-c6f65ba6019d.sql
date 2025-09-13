-- Fix infinite recursion by using simpler policies that don't reference conversation_participants from within conversation_participants policies

-- Drop the recursive policies
DROP POLICY IF EXISTS "Users can add participants to conversations they're in" ON public.conversation_participants;
DROP POLICY IF EXISTS "Users can view participants of their conversations" ON public.conversation_participants;

-- Create simpler, non-recursive policies
-- Allow users to see conversation participants for conversations they're part of
CREATE POLICY "Users can view conversation participants" 
ON public.conversation_participants 
FOR SELECT 
USING (user_id = auth.uid() OR EXISTS (
  SELECT 1 FROM conversation_participants cp2 
  WHERE cp2.conversation_id = conversation_participants.conversation_id 
  AND cp2.user_id = auth.uid()
));

-- Allow conversation creators to add participants
CREATE POLICY "Users can add participants to their conversations" 
ON public.conversation_participants 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c 
    WHERE c.id = conversation_participants.conversation_id 
    AND c.created_by = auth.uid()
  )
);