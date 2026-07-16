-- ISSUE-864 WP4 [Full Rooms Ad Engine — Campaign Builder UI] — SPEC §4.5.
--
-- The ONLY backend change in #864: the `meta-ad-creatives` Storage bucket the
-- builder uploads ad images into. The bucket is PUBLIC-READ because Meta ad
-- review DOWNLOADS creative image_url at validate/create time (COMMS-0102 —
-- robots-blocked hosts hard-fail with subcode 3858258); Supabase Storage
-- public URLs are crawler-permissive.
--
-- #866 (creative library) already references this bucket by name
-- (ad_creatives.storage_bucket = 'meta-ad-creatives' — "864's bucket, reused,
-- OD-7"); this migration is the missing source of truth that creates it.
--
-- Bounds (SPEC §4.5, as corrected by A4.c): 30 MB / {png,jpeg} is the STORAGE
-- bound only — Meta's byte cap. It is NOT the acceptance criterion: the
-- builder's dropzone surfaces the per-channel caps (Snap 5 MB, Google
-- 5,120 KB) and the #866 server-side byte-probe (admin-ad-creative-upload)
-- is the validator of record.
--
-- RLS (I-PROPOSED-864-CREATIVE-BUCKET-ADMIN-WRITE): writes require
-- public.is_admin_user(); reads are public (the bucket is public-read).
--
-- Idempotent: safe to re-apply. Column-existence guards mirror the ORCH-0786
-- creator_avatars migration so this replays cleanly against older baseline
-- images in CI.

DO $$
DECLARE
  has_public boolean;
  has_file_size_limit boolean;
  has_allowed_mime_types boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public'
  ) INTO has_public;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit'
  ) INTO has_file_size_limit;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types'
  ) INTO has_allowed_mime_types;

  IF has_public AND has_file_size_limit AND has_allowed_mime_types THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'meta-ad-creatives',
      'meta-ad-creatives',
      true,
      31457280, -- 30 MB (Meta's image byte cap — the storage bound, A4.c)
      ARRAY['image/jpeg','image/png']
    )
    ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('meta-ad-creatives', 'meta-ad-creatives', true)
    ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public;
  ELSE
    INSERT INTO storage.buckets (id, name)
    VALUES ('meta-ad-creatives', 'meta-ad-creatives')
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name;
  END IF;
END $$;

-- RLS policies on storage.objects (drop-then-create for idempotency).
-- SELECT: public (Meta's crawler must fetch the image by URL).
DROP POLICY IF EXISTS "Anyone can read meta ad creatives" ON storage.objects;
CREATE POLICY "Anyone can read meta ad creatives"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'meta-ad-creatives');

-- INSERT/UPDATE/DELETE: active admins only (is_admin_user() — the same gate
-- the admin-ad-* edge functions enforce in code).
DROP POLICY IF EXISTS "Admins can upload meta ad creatives" ON storage.objects;
CREATE POLICY "Admins can upload meta ad creatives"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'meta-ad-creatives' AND public.is_admin_user());

DROP POLICY IF EXISTS "Admins can update meta ad creatives" ON storage.objects;
CREATE POLICY "Admins can update meta ad creatives"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'meta-ad-creatives' AND public.is_admin_user())
  WITH CHECK (bucket_id = 'meta-ad-creatives' AND public.is_admin_user());

DROP POLICY IF EXISTS "Admins can delete meta ad creatives" ON storage.objects;
CREATE POLICY "Admins can delete meta ad creatives"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'meta-ad-creatives' AND public.is_admin_user());
