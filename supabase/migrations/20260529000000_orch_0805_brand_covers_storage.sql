-- ORCH-0805 — Brand cover storage bucket + RLS policies.
--
-- Plain-English: every brand has an optional cover media URL stored at
-- `brands.cover_media_url` (column already exists per
-- 20260506000000_brand_kind_address_cover_hue_media.sql). This migration
-- creates the `brand_covers` Storage bucket that holds device uploads
-- (image/jpeg, image/png, image/webp, image/gif) and pins public read +
-- brand-admin-only write policies on it.
--
-- Path convention: `{brandId}/{token}.{ext}` — enforced by the service
-- layer via `brandCoverStoragePath()`. RLS reads the brand UUID from the
-- first '/'-segment of the object name and checks that the caller is
-- brand_admin+ on that brand.
--
-- Public read because brand pages render anonymously to buyers on `/b/{slug}`.
--
-- Mirrors the `creator_avatars` precedent from ORCH-0786, generalised for
-- larger files and a path-segment-based RLS shape (brand UUID as folder).
--
-- Per ORCH-0805 SPEC §4 + §10. Establishes I-PROPOSED-BE
-- BRAND_COVER_MEDIA_HONORED at the storage tier.

BEGIN;

-- 1. Create the bucket. public = true so anonymous buyers can render the
--    cover on `/b/{slug}` without a signed URL roundtrip.
--
--    Use a column-detection fallback so the migration applies cleanly on
--    older `storage.buckets` schemas in CI (Supabase Postgres test image
--    pre-dates the `public` / `file_size_limit` / `allowed_mime_types`
--    columns; production has them). Mirrors the ORCH-0786 creator_avatars
--    bucket precedent at `20260515000019_orch_0786_creator_avatars_bucket.sql:15-69`.
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
      'brand_covers',
      'brand_covers',
      true,
      15728640, -- 15 MB
      ARRAY['image/jpeg','image/png','image/webp','image/gif']
    )
    ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('brand_covers', 'brand_covers', true)
    ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public;
  ELSE
    INSERT INTO storage.buckets (id, name)
    VALUES ('brand_covers', 'brand_covers')
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name;
  END IF;
END $$;

-- 2. Public read on every object in the bucket (matches event_covers and
--    creator_avatars precedent).
DROP POLICY IF EXISTS "brand_covers_public_read" ON storage.objects;
CREATE POLICY "brand_covers_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'brand_covers');

-- 3. Authenticated INSERT scoped by brand admin membership. The first
--    path segment of `name` is the brand UUID; cast to uuid and resolve
--    the caller's effective rank on that brand via the canonical helper
--    `biz_brand_effective_rank_for_caller(uuid)` (SECURITY DEFINER + STABLE,
--    uses auth.uid() internally, accounts for both account_owner privileges
--    AND brand_team_members membership). brand_admin (50) or above can
--    write covers; lower ranks are denied.
--
--    NOTE — fixed on the re-push pass: the original draft of this migration
--    called the wrong helper signature (`biz_brand_effective_rank(text)` —
--    no such function exists). The canonical helper is the for_caller
--    variant which takes only the brand uuid.
DROP POLICY IF EXISTS "brand_covers_admin_write" ON storage.objects;
CREATE POLICY "brand_covers_admin_write"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'brand_covers'
  AND public.biz_brand_effective_rank_for_caller(
    (split_part(name, '/', 1))::uuid
  ) >= public.biz_role_rank('brand_admin')
);

-- 4. Authenticated UPDATE (covers `upsert: true` from the client) scoped
--    by the same brand admin membership predicate.
DROP POLICY IF EXISTS "brand_covers_admin_update" ON storage.objects;
CREATE POLICY "brand_covers_admin_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'brand_covers'
  AND public.biz_brand_effective_rank_for_caller(
    (split_part(name, '/', 1))::uuid
  ) >= public.biz_role_rank('brand_admin')
);

-- 5. Authenticated DELETE for orphan-cleanup after path rotation.
DROP POLICY IF EXISTS "brand_covers_admin_delete" ON storage.objects;
CREATE POLICY "brand_covers_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'brand_covers'
  AND public.biz_brand_effective_rank_for_caller(
    (split_part(name, '/', 1))::uuid
  ) >= public.biz_role_rank('brand_admin')
);

-- 6. Bucket-level MIME allowlist + size cap. Image + GIF only; video MIME
--    types intentionally excluded (deferred to future ORCH per SPEC §2
--    non-goals). 15 MB cap to accommodate GIF covers.
--
--    Already applied via the INSERT path above when columns exist; this
--    extra UPDATE is a no-op on modern schemas (covered by ON CONFLICT
--    SET) and is intentionally skipped on legacy schemas where these
--    columns do not exist.
DO $$
DECLARE
  has_file_size_limit boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit'
  ) INTO has_file_size_limit;

  IF has_file_size_limit THEN
    UPDATE storage.buckets
    SET
      allowed_mime_types = ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif'
      ],
      file_size_limit = 15728640  -- 15 MB
    WHERE id = 'brand_covers';
  END IF;
END $$;

-- 7. Apply-time verification probes. Fail fast on apply if the bucket or
--    public read policy is missing, so a broken migration cannot land
--    silently and surface as a runtime mystery.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'brand_covers') THEN
    RAISE EXCEPTION 'ORCH-0805 verification probe failed: brand_covers bucket missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'brand_covers_public_read'
  ) THEN
    RAISE EXCEPTION 'ORCH-0805 verification probe failed: brand_covers public read policy missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'brand_covers_admin_write'
  ) THEN
    RAISE EXCEPTION 'ORCH-0805 verification probe failed: brand_covers admin write policy missing';
  END IF;
END $$;

COMMIT;
