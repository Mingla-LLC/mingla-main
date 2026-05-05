-- ===========================================
-- ADD is_admin COLUMN TO session_participants
-- This allows board creators to promote other members to admin status
-- ===========================================

-- Add is_admin column to session_participants table
ALTER TABLE public.session_participants
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Create index for querying admins
CREATE INDEX IF NOT EXISTS idx_session_participants_is_admin 
  ON public.session_participants(session_id, is_admin) 
  WHERE is_admin = true;

-- Add comment for documentation
COMMENT ON COLUMN public.session_participants.is_admin IS 'Indicates whether the participant has admin privileges for this session. The session creator is always an admin regardless of this flag.';
