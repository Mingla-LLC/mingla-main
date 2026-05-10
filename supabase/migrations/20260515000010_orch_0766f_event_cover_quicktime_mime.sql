-- ORCH-0766F: allow real-device iPhone MOV/QuickTime event covers.
--
-- App-side ORCH-0766C now accepts MOV/QuickTime and uploads iPhone videos
-- with content type video/quicktime. Keep the storage bucket contract aligned.

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
WHERE id = 'event_covers';
