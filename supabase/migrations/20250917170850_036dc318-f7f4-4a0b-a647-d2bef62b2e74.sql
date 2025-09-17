-- Add DELETE policy for session_participants to allow users to remove themselves
CREATE POLICY "Users can remove their own participation" 
ON session_participants 
FOR DELETE 
USING (auth.uid() = user_id);