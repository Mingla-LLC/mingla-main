-- Migration: 20260310000005_preferences_friend_read_policy.sql
-- Description: Allows friends to read preferences for users whose
-- visibility_mode is 'public' or 'friends'.
-- NOTE: The friends table uses user_id/friend_user_id columns (not sender_id/receiver_id).

CREATE POLICY "Friends can read friend preferences"
  ON public.preferences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = preferences.profile_id
      AND p.visibility_mode IN ('public', 'friends')
      AND (
        EXISTS (
          SELECT 1 FROM public.friends
          WHERE status = 'accepted'
          AND (
            (user_id = auth.uid() AND friend_user_id = p.id)
            OR (friend_user_id = auth.uid() AND user_id = p.id)
          )
        )
      )
    )
  );
