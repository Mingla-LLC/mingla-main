-- Fix collaboration system membership and cascade deletes
-- Create proper session_members table for membership-based visibility
CREATE TABLE IF NOT EXISTS session_members (
  session_id uuid NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text CHECK (role IN ('owner','participant')) NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

-- Update sessions to have proper cascade for boards
CREATE TABLE IF NOT EXISTS collaboration_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid UNIQUE NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add cascade constraints to existing tables
ALTER TABLE collaboration_invites 
  DROP CONSTRAINT IF EXISTS collaboration_invites_session_id_fkey,
  ADD CONSTRAINT collaboration_invites_session_id_fkey 
  FOREIGN KEY (session_id) REFERENCES collaboration_sessions(id) ON DELETE CASCADE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_session_members_user ON session_members(user_id);
CREATE INDEX IF NOT EXISTS idx_session_members_session ON session_members(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_invite ON collaboration_invites(session_id, invited_user_id) WHERE status='pending';

-- Migrate existing data
-- Add session creators as owners in session_members
INSERT INTO session_members (session_id, user_id, role, joined_at)
SELECT id, created_by, 'owner', created_at
FROM collaboration_sessions
ON CONFLICT (session_id, user_id) DO NOTHING;

-- Add accepted participants as participants in session_members
INSERT INTO session_members (session_id, user_id, role, joined_at)
SELECT sp.session_id, sp.user_id, 'participant', COALESCE(sp.joined_at, sp.created_at)
FROM session_participants sp
WHERE sp.has_accepted = true
  AND sp.user_id NOT IN (
    SELECT created_by FROM collaboration_sessions cs WHERE cs.id = sp.session_id
  )
ON CONFLICT (session_id, user_id) DO NOTHING;

-- Create function to check if user can delete session (owner only)
CREATE OR REPLACE FUNCTION can_delete_session(session_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM session_members sm
    WHERE sm.session_id = $1 
      AND sm.user_id = $2 
      AND sm.role = 'owner'
  );
$$;