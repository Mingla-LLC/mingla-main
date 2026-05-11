-- ORCH-0786 — Re-add creator_avatars storage bucket + RLS policies to active migrations.
-- Bucket was created out-of-band on 2026-05-04 21:07 UTC during Cycle 14 J-A1 and
-- referenced in artifacts as 20260504_b1_phase5_creator_avatars.sql, but that file
-- never landed in supabase/migrations/. This migration re-establishes the source of
-- truth so any fresh environment (CI fixtures, dev reset, staging rebuild) recreates
-- the bucket + 4 policies in the exact shape that exists in production.
--
-- Idempotent: safe to re-apply against production where the bucket + policies
-- already exist.

-- 1. Bucket: insert only if absent
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'creator_avatars',
  'creator_avatars',
  true,
  10485760, -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. RLS policies on storage.objects (drop-then-create for idempotency)

DROP POLICY IF EXISTS "Anyone can read creator avatars" ON storage.objects;
CREATE POLICY "Anyone can read creator avatars"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'creator_avatars');

DROP POLICY IF EXISTS "Creator can upload own avatar" ON storage.objects;
CREATE POLICY "Creator can upload own avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Creator can update own avatar" ON storage.objects;
CREATE POLICY "Creator can update own avatar"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Creator can delete own avatar" ON storage.objects;
CREATE POLICY "Creator can delete own avatar"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

-- DO NOT add COMMENT ON POLICY ... ON storage.objects — storage.objects ownership
-- is reserved for supabase_storage_admin and decorative comments are rejected at
-- migration time (the same hotfix Cycle 14 had to apply to the original file).
