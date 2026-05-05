-- Privacy: allow users to hide recent activity from friends while keeping profile visibility separate.
-- App: AccountSettings "Show activity" toggle (authService.updateUserProfile).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_activity BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.show_activity IS
  'When false, the user''s activity feed / presence is hidden from others (friends-only UX; exact enforcement in app/queries).';
