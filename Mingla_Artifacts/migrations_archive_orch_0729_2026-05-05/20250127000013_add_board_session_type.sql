-- ===========================================
-- ADD 'board' TO SESSION_TYPE CONSTRAINT
-- Allows board sessions to be created
-- ===========================================

-- Drop the existing constraint
ALTER TABLE public.collaboration_sessions
DROP CONSTRAINT IF EXISTS collaboration_sessions_session_type_check;

-- Add new constraint that includes 'board'
ALTER TABLE public.collaboration_sessions
ADD CONSTRAINT collaboration_sessions_session_type_check
CHECK (session_type IN ('group_hangout', 'date_night', 'squad_outing', 'business_meeting', 'board', 'collaboration'));

