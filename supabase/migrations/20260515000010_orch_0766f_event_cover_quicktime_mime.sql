-- ORCH-0766F: allow real-device iPhone MOV/QuickTime event covers.
--
-- App-side ORCH-0766C now accepts MOV/QuickTime and uploads iPhone videos
-- with content type video/quicktime. Keep the storage bucket contract aligned.

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
    EXECUTE $sql$
      UPDATE storage.buckets
      SET
        allowed_mime_types = (
          SELECT ARRAY(
            SELECT DISTINCT mime
            FROM unnest(
              COALESCE(allowed_mime_types, ARRAY[]::text[])
              || ARRAY[
                'image/jpeg',
                'image/png',
                'image/webp',
                'image/gif',
                'video/mp4',
                'video/webm',
                'video/quicktime'
              ]::text[]
            ) AS mime
            ORDER BY mime
          )
        ),
        file_size_limit = 31457280,
        public = true
      WHERE id = 'event_covers'
    $sql$;
  ELSIF has_public AND has_file_size_limit THEN
    EXECUTE $sql$
      UPDATE storage.buckets
      SET
        file_size_limit = 31457280,
        public = true
      WHERE id = 'event_covers'
    $sql$;
  ELSIF has_public THEN
    EXECUTE $sql$
      UPDATE storage.buckets
      SET public = true
      WHERE id = 'event_covers'
    $sql$;
  END IF;
END $$;
