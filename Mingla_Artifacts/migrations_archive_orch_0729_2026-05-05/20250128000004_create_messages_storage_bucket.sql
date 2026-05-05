-- Create storage bucket for messages (images, videos, documents)
-- This bucket stores media files sent in direct messages

-- Create the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'messages',
  'messages',
  true, -- Public bucket so messages can be accessed
  52428800, -- 50MB file size limit
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for messages bucket
-- Users can upload files to conversations they are part of
-- File path structure: {conversation_id}/{filename}
-- Note: Using a helper function to check conversation participation to avoid RLS recursion

-- Create a helper function to check if user is participant (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION public.is_message_conversation_participant(conv_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = conv_id
    AND cp.user_id = u_id
  );
END;
$$;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload messages files" ON storage.objects;
DROP POLICY IF EXISTS "Users can read messages files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete message files" ON storage.objects;

-- Users can upload files to conversations they are part of
CREATE POLICY "Users can upload messages files"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'messages' AND
  auth.role() = 'authenticated' AND
  public.is_message_conversation_participant(
    (storage.foldername(name))[1]::UUID,
    auth.uid()
  )
);

-- Users can read files from conversations they are part of
CREATE POLICY "Users can read messages files"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'messages' AND
  auth.role() = 'authenticated' AND
  public.is_message_conversation_participant(
    (storage.foldername(name))[1]::UUID,
    auth.uid()
  )
);

-- Users can delete files from conversations they are part of
CREATE POLICY "Users can delete message files"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'messages' AND
  auth.role() = 'authenticated' AND
  public.is_message_conversation_participant(
    (storage.foldername(name))[1]::UUID,
    auth.uid()
  )
);

