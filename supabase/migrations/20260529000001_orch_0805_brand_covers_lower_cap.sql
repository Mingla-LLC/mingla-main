-- ORCH-0805 hotfix (2026-05-12) — Lower `brand_covers` bucket `file_size_limit`
-- from 15 MB to 8 MB after operator device smoke reported full app freeze
-- on a real GIF pick. Root cause: reading 15–30 MB of bytes through
-- expo-file-system blocks the JS thread for many seconds. 8 MB keeps
-- cover quality high while bounding the worst-case read time on real
-- devices to ~1–2 seconds.
--
-- Client cap (`mingla-business/src/utils/brandCoverRules.ts ->
-- BRAND_COVER_MAX_BYTES`) lowered in the same change to keep
-- Constitution #13 (exclusion-consistency) intact across the client
-- validation and server enforcement.
--
-- Guarded by column-detection so the migration applies cleanly on CI's
-- legacy `storage.buckets` schema (which lacks `file_size_limit`).
-- Production has the column; the bucket already exists with the old
-- 15 MB cap, so this is a single in-place UPDATE.

BEGIN;

DO $$
DECLARE
  has_file_size_limit boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
      AND column_name = 'file_size_limit'
  ) INTO has_file_size_limit;

  IF has_file_size_limit THEN
    UPDATE storage.buckets
    SET file_size_limit = 8388608  -- 8 MB
    WHERE id = 'brand_covers';
  END IF;
END $$;

COMMIT;
