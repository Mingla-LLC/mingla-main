-- ORCH-0377: Allow users to delete their own feedback submissions

-- Users can delete their own feedback rows
CREATE POLICY "Users can delete own feedback"
  ON beta_feedback FOR DELETE
  USING (auth.uid() = user_id);

-- Users can delete their own files from the beta-feedback storage bucket
CREATE POLICY "Users can delete own feedback files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'beta-feedback'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
