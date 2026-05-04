-- Cycle 14 Phase 5 — creator_avatars storage bucket for operator profile photos.
--
-- D-14-2 SPEC-pivot per SPEC_BIZ_CYCLE_14_ACCOUNT.md §1.5:
-- Forensics + SPEC-time verification confirmed `brand_covers` bucket does NOT
-- exist (0 migrations match). Cycle 7 brand "cover" is hue-based via
-- EventCover.tsx, not image-upload. Dispatch §3.3 anticipated this fallback
-- under name `profile_photos`; renamed to `creator_avatars` for naming
-- consistency with consumer-app `avatars` bucket pattern
-- (20250226000007_create_avatars_storage_bucket.sql).
--
-- Mirrors consumer-app avatars bucket pattern with TIGHTER path-scoped RLS —
-- mingla-business operator can ONLY upload/update files where the file name
-- prefix matches their own auth.uid().
--
-- Path convention: creator_avatars/{userId}.{ext} where ext is jpg|png|webp.
-- Public read so brand profile pages (anon access via PR #59 anon SELECT
-- policy on creator_accounts) can fetch avatars by URL.

-- Create the bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'creator_avatars',
  'creator_avatars',
  true, -- Public bucket so avatars can be served on organiser profile pages
  10485760, -- 10MB file size limit (matches consumer-app avatars)
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for creator_avatars bucket
-- Path structure: creator_avatars/{userId}.{ext}

DROP POLICY IF EXISTS "Creator can upload own avatar"
  ON storage.objects;
DROP POLICY IF EXISTS "Creator can update own avatar"
  ON storage.objects;
DROP POLICY IF EXISTS "Creator can delete own avatar"
  ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read creator avatars"
  ON storage.objects;

-- Authenticated user can upload only to their own userId path
CREATE POLICY "Creator can upload own avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

-- Authenticated user can update only their own avatar file
CREATE POLICY "Creator can update own avatar"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

-- Authenticated user can delete only their own avatar file
CREATE POLICY "Creator can delete own avatar"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

-- Anyone can read avatars (organiser profile pages are anon-accessible)
CREATE POLICY "Anyone can read creator avatars"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'creator_avatars');
