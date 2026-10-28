-- #4137 wave 3 — the `blog-media` storage bucket and its policies (spec §4.6).
--
-- Public read (objects are unguessable `<uploader uid>/<media uuid>.<ext>`
-- paths that public posts need). 5 MiB, JPEG/PNG/WebP only: no GIF, no SVG.
-- Spend-cap hold #1643: nothing here or in any reader uses /render/image.
-- Static SQL only (#1860 C7): the bucket shape is probed, never EXECUTEd.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $bucket$
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
    VALUES ('blog-media', 'blog-media', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('blog-media', 'blog-media', true)
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
  ELSE
    INSERT INTO storage.buckets (id, name)
    VALUES ('blog-media', 'blog-media')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  END IF;
END
$bucket$;

DROP POLICY IF EXISTS issue_4137_blog_media_public_read ON storage.objects;
CREATE POLICY issue_4137_blog_media_public_read
  ON storage.objects FOR SELECT
  USING (bucket_id = 'blog-media');

-- A writer uploads only into their own folder.
DROP POLICY IF EXISTS issue_4137_blog_media_writer_insert ON storage.objects;
CREATE POLICY issue_4137_blog_media_writer_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'blog-media'
    AND public.issue_4137_blog_can_write()
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- No UPDATE policy: an uploaded image is never replaced in place.

DROP POLICY IF EXISTS issue_4137_blog_media_publisher_delete ON storage.objects;
CREATE POLICY issue_4137_blog_media_publisher_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'blog-media' AND public.issue_4137_blog_can_publish());

-- No COMMENT ON POLICY here: storage.objects is owned by the storage admin,
-- so a migration may create policies on it but not comment them.

COMMIT;
