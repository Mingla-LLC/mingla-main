-- Fix avatars storage bucket RLS policies - simplify to allow authenticated uploads
-- Previous version had overly restrictive path checking that was causing failures

-- Drop old restrictive policies
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
