-- Fix the storage policy that references conversation_participants to prevent recursion

-- Drop the problematic storage policy
DROP POLICY IF EXISTS "Users can view attachments in their conversations" ON storage.objects;

-- Create a simpler policy for message attachments that doesn't cause recursion
CREATE POLICY "Users can view their own message attachments" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'message-attachments' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);