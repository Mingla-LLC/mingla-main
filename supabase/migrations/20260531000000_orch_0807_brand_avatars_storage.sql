-- ORCH-0807 — Brand avatar storage bucket + RLS policies.
--
-- Plain-English: every brand has an optional profile photo URL stored at
-- `brands.profile_photo_url` (column already exists per
-- 20260506000000_brand_kind_address_cover_hue_media.sql). This migration
-- creates the `brand_avatars` Storage bucket that holds device uploads
-- (image/jpeg, image/png, image/webp — NO GIF, NO video) and pins public
-- read + brand-admin-only write policies on it.
--
-- Path convention: `{brandId}/{token}.{ext}` — enforced by the service
-- layer via `brandAvatarStoragePath()`. RLS reads the brand UUID from the
-- first '/'-segment of the object name and checks that the caller is
-- brand_admin+ on that brand.
--
-- Public read because brand profile photos render anonymously to buyers
-- on `/b/{slug}` (and on ticket-confirmation emails via the buyer-side
-- render path).
--
-- Mirrors the `brand_covers` precedent from ORCH-0805 exactly (same
-- path-segment RLS shape, column-detection fallback for CI compatibility),
-- with tighter parameters: 5 MB cap (avatars are small) and no GIF/video
-- MIME types (v1 supports static images only per SPEC §2 non-goals).
--
-- Per ORCH-0807 SPEC §4.2 + §8. Establishes I-PROPOSED-BG
-- BRAND_AVATAR_SQUARE_ONLY at the storage tier.

BEGIN;

-- 1. Create the bucket. public = true so anonymous buyers can render the
--    avatar on `/b/{slug}` and in transactional emails without a signed
--    URL roundtrip.
--
--    Use a column-detection fallback so the migration applies cleanly on
--    older `storage.buckets` schemas in CI (Supabase Postgres test image
--    pre-dates the `public` / `file_size_limit` / `allowed_mime_types`
--    columns; production has them). Mirrors the ORCH-0805 brand_covers
--    bucket precedent.
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
      'brand_avatars',
      'brand_avatars',
      true,
      5242880, -- 5 MB
      ARRAY['image/jpeg','image/png','image/webp']
    )
    ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('brand_avatars', 'brand_avatars', true)
    ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public;
  ELSE
    INSERT INTO storage.buckets (id, name)
    VALUES ('brand_avatars', 'brand_avatars')
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name;
  END IF;
END $$;

-- 2. Public read on every object in the bucket (matches brand_covers and
--    creator_avatars precedent).
DROP POLICY IF EXISTS "brand_avatars_public_read" ON storage.objects;
CREATE POLICY "brand_avatars_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'brand_avatars');

-- 3. Authenticated INSERT scoped by brand admin membership. The first
--    path segment of `name` is the brand UUID; cast to uuid and resolve
--    the caller's effective rank on that brand via the canonical helper
--    `biz_brand_effective_rank_for_caller(uuid)` (SECURITY DEFINER + STABLE,
--    uses auth.uid() internally, accounts for both account_owner privileges
--    AND brand_team_members membership). brand_admin (50) or above can
--    write avatars; lower ranks are denied.
DROP POLICY IF EXISTS "brand_avatars_admin_write" ON storage.objects;
CREATE POLICY "brand_avatars_admin_write"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'brand_avatars'
  AND public.biz_brand_effective_rank_for_caller(
    (split_part(name, '/', 1))::uuid
  ) >= public.biz_role_rank('brand_admin')
);

-- 4. Authenticated UPDATE (covers `upsert: true` from the client) scoped
--    by the same brand admin membership predicate.
DROP POLICY IF EXISTS "brand_avatars_admin_update" ON storage.objects;
CREATE POLICY "brand_avatars_admin_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'brand_avatars'
  AND public.biz_brand_effective_rank_for_caller(
    (split_part(name, '/', 1))::uuid
  ) >= public.biz_role_rank('brand_admin')
);

-- 5. Authenticated DELETE for orphan-cleanup after path rotation.
DROP POLICY IF EXISTS "brand_avatars_admin_delete" ON storage.objects;
CREATE POLICY "brand_avatars_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'brand_avatars'
  AND public.biz_brand_effective_rank_for_caller(
    (split_part(name, '/', 1))::uuid
  ) >= public.biz_role_rank('brand_admin')
);

-- 6. Bucket-level MIME allowlist + size cap. Image only — NO GIF (v1 is
--    static images per SPEC §2), NO video. 5 MB cap because avatars render
--    at 84×84 hero (168px @2x retina) and 40×40 row (80px @2x); the 512×512
--    post-manipulator output is well under 5 MB at quality 0.9.
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
        'image/webp'
      ],
      file_size_limit = 5242880  -- 5 MB
    WHERE id = 'brand_avatars';
  END IF;
END $$;

-- 7. Apply-time verification probes. Fail fast on apply if the bucket or
--    public read policy is missing, so a broken migration cannot land
--    silently and surface as a runtime mystery.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'brand_avatars') THEN
    RAISE EXCEPTION 'ORCH-0807 verification probe failed: brand_avatars bucket missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'brand_avatars_public_read'
  ) THEN
    RAISE EXCEPTION 'ORCH-0807 verification probe failed: brand_avatars public read policy missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'brand_avatars_admin_write'
  ) THEN
    RAISE EXCEPTION 'ORCH-0807 verification probe failed: brand_avatars admin write policy missing';
  END IF;
END $$;

COMMIT;
