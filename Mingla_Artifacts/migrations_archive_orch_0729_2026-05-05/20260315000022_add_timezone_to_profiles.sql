-- Add timezone column to profiles for local-time notification scheduling
-- Updated on each app launch from device timezone (e.g., 'America/Los_Angeles')
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT;
