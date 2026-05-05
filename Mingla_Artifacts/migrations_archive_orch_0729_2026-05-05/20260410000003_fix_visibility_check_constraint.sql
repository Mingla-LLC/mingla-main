-- Fix: live DB CHECK constraint on user_map_settings.visibility_level is missing
-- 'friends_of_friends'. The original migration (20260326000001) included it, but
-- the live DB was created before that value was added.
-- This closes the CONDITIONAL item from QA Wave 1 (ORCH-0358, T-09).

ALTER TABLE public.user_map_settings
  DROP CONSTRAINT user_map_settings_visibility_level_check;

ALTER TABLE public.user_map_settings
  ADD CONSTRAINT user_map_settings_visibility_level_check
  CHECK (visibility_level IN ('off', 'paired', 'friends', 'friends_of_friends', 'everyone'));
