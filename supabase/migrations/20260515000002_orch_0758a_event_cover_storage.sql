-- ORCH-0758A: event/public ticket cover media storage.
-- Canonical event metadata already lives on public.events.cover_media_url/type.

DO $$
DECLARE
  has_public boolean;
  has_file_size_limit boolean;
  has_allowed_mime_types boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
      AND column_name = 'public'
  ) INTO has_public;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
      AND column_name = 'file_size_limit'
  ) INTO has_file_size_limit;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
      AND column_name = 'allowed_mime_types'
  ) INTO has_allowed_mime_types;

  IF has_public AND has_file_size_limit AND has_allowed_mime_types THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'event_covers',
      'event_covers',
      true,
      31457280,
      ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'video/mp4',
        'video/webm'
      ]
    )
    ON CONFLICT (id) DO UPDATE
    SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('event_covers', 'event_covers', true)
    ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public;
  ELSE
    INSERT INTO storage.buckets (id, name)
    VALUES ('event_covers', 'event_covers')
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name;
  END IF;
END $$;

DROP POLICY IF EXISTS "Public can read event covers" ON storage.objects;
DROP POLICY IF EXISTS "Event managers can upload event covers" ON storage.objects;
DROP POLICY IF EXISTS "Event managers can update event covers" ON storage.objects;
DROP POLICY IF EXISTS "Event managers can delete event covers" ON storage.objects;

CREATE POLICY "Public can read event covers"
ON storage.objects
FOR SELECT
USING (bucket_id = 'event_covers');

CREATE POLICY "Event managers can upload event covers"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 2
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);

CREATE POLICY "Event managers can update event covers"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 2
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
)
WITH CHECK (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 2
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);

CREATE POLICY "Event managers can delete event covers"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 2
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);
