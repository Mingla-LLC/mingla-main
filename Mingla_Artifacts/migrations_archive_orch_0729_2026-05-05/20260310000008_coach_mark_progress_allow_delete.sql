-- Migration: 20260310000008_coach_mark_progress_allow_delete.sql
-- Description: Allow users to delete their own coach mark progress rows.
-- Required by the "Replay Tips" feature in profile settings.

CREATE POLICY "Users can delete their own progress"
  ON public.coach_mark_progress FOR DELETE
  USING (auth.uid() = user_id);
