-- Fix security issue: Restrict conversation visibility to participants only

-- Drop the overly permissive existing policy that allows any authenticated user to view all conversations
DROP POLICY IF EXISTS "Users can view all conversations" ON public.conversations;

-- Create new, secure policy that only allows users to view conversations they participate in
CREATE POLICY "Users can only view conversations they participate in" 
ON public.conversations 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.conversation_participants 
  WHERE conversation_participants.conversation_id = conversations.id 
    AND conversation_participants.user_id = auth.uid()
));

-- Keep existing INSERT policy as it's already secure
-- CREATE POLICY "Users can create conversations" 
-- ON public.conversations 
-- FOR INSERT 
-- WITH CHECK (auth.uid() = created_by);