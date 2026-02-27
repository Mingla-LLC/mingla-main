-- Add explicit foreign key from session_participants.user_id to profiles.id
-- This allows PostgREST to auto-detect and join the profiles relationship
-- User IDs are the same between auth.users and profiles tables (profiles.id = auth.users.id)

-- First, check if the FK already exists and drop it if needed
ALTER TABLE public.session_participants
DROP CONSTRAINT IF EXISTS session_participants_user_id_fkey;

-- Add the new FK explicitly to profiles for PostgREST relationship detection
ALTER TABLE public.session_participants
ADD CONSTRAINT session_participants_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Verify the constraint was added
COMMENT ON CONSTRAINT session_participants_user_id_fkey ON public.session_participants IS 
'FK from session_participants to profiles for PostgREST relationship auto-detection';
