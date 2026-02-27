-- Create storage bucket for user avatars and profile photos
-- This bucket stores profile pictures that users upload

-- Create the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true, -- Public bucket so avatars can be accessed
  10485760, -- 10MB file size limit for images
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for avatars bucket
-- File path structure: avatars/{userId}_{timestamp}.{extension}

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload their own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatars" ON storage.objects;

-- Authenticated users can upload avatar files
CREATE POLICY "Users can upload their own avatars"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'avatars' AND
  auth.role() = 'authenticated'
);

-- Anyone can read avatars (they are public profile pictures)
CREATE POLICY "Anyone can read avatars"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'avatars'
);

-- Authenticated users can delete their own avatar files
CREATE POLICY "Users can delete their own avatars"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'avatars' AND
  auth.role() = 'authenticated'
);
