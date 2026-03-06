-- Add UPDATE and DELETE policies for voice-reviews storage bucket.
-- The original migration (20260303000015) only had INSERT and SELECT for regular users.
-- UPDATE is required for upsert uploads (re-recording overwrites).
-- DELETE is required for the "Start over" flow in onboarding audio recording.

CREATE POLICY "users_update_own_voice_reviews"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'voice-reviews'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "users_delete_own_voice_reviews"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'voice-reviews'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
