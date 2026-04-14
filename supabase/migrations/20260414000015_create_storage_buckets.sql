-- Storage buckets for business content.
-- business-photos and event-media are public (images served to consumer app).
-- menu-photos is private (only accessed by extract-menu-items edge function).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('business-photos', 'business-photos', true, 10485760, '{image/jpeg,image/png,image/webp}'),
  ('event-media', 'event-media', true, 52428800, '{image/jpeg,image/png,image/webp,video/mp4,video/quicktime}'),
  ('menu-photos', 'menu-photos', false, 10485760, '{image/jpeg,image/png,image/webp}')
ON CONFLICT (id) DO NOTHING;

-- business-photos: owner upload, public read
DO $$ BEGIN
  CREATE POLICY "bp_photos_owner_upload" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'business-photos' AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.business_profiles WHERE creator_account_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "bp_photos_public_read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'business-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- event-media: event creator upload, public read (including anon for web pages)
DO $$ BEGIN
  CREATE POLICY "event_media_owner_upload" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'event-media' AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.events WHERE creator_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "event_media_public_read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'event-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "event_media_anon_read" ON storage.objects FOR SELECT TO anon
    USING (bucket_id = 'event-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- menu-photos: owner upload, service role read only (edge function extracts)
DO $$ BEGIN
  CREATE POLICY "menu_photos_owner_upload" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'menu-photos' AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.business_profiles WHERE creator_account_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "menu_photos_service_read" ON storage.objects FOR SELECT TO service_role
    USING (bucket_id = 'menu-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
