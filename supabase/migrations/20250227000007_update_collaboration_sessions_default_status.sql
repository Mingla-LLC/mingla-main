-- Update the default status for collaboration_sessions to 'pending' instead of 'active'
-- This ensures new collaboration sessions start in 'pending' state until at least one participant accepts

-- Alter the default value for the status column
ALTER TABLE public.collaboration_sessions 
ALTER COLUMN status SET DEFAULT 'pending';

-- Update any existing sessions with status 'active' that are completely empty (no accepted participants)
-- to 'pending' so they show as invites until someone accepts
UPDATE public.collaboration_sessions cs
SET status = 'pending'
WHERE status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = cs.id
      AND sp.has_accepted = true
  );

-- Add a comment describing the status field
COMMENT ON COLUMN public.collaboration_sessions.status IS 
'Session status: pending (initial state until at least 1 participant accepts), active (at least 1 accepted), archived (completed)';
