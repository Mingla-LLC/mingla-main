-- Storage bucket for beta feedback audio
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'beta-feedback',
  'beta-feedback',
  false,
  52428800,  -- 50MB (5 min audio at 128kbps ≈ 4.8MB, generous buffer)
  ARRAY['audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/aac']
);

-- Users can upload to their own folder
CREATE POLICY "Beta testers can upload feedback audio"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'beta-feedback'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_beta_tester = true)
  );

-- Users can read their own audio
CREATE POLICY "Users can read own feedback audio"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'beta-feedback'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins can read all feedback audio
CREATE POLICY "Admins can read all feedback audio"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'beta-feedback'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
