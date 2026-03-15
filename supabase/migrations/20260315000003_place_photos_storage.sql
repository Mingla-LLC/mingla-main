-- Migration: Store place photos in Supabase Storage instead of relying on
-- expiring Google Places photo references.
--
-- Adds a stored_photo_urls column to place_pool for Supabase Storage URLs.
-- Creates the place-photos storage bucket (public, for CDN access).

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 1: Add stored_photo_urls column to place_pool
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS stored_photo_urls TEXT[] DEFAULT '{}';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 2: Create the place-photos storage bucket (public for CDN access)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'place-photos',
  'place-photos',
  true,
  5242880,  -- 5MB max per photo
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access (photos are not sensitive)
DROP POLICY IF EXISTS "Public read access for place photos" ON storage.objects;
CREATE POLICY "Public read access for place photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'place-photos');

-- Allow service role to upload (edge functions use service role key)
DROP POLICY IF EXISTS "Service role upload for place photos" ON storage.objects;
CREATE POLICY "Service role upload for place photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'place-photos' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role update for place photos" ON storage.objects;
CREATE POLICY "Service role update for place photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'place-photos' AND auth.role() = 'service_role');
