-- ============================================================================
-- Fix: collaboration_sessions.created_by CASCADE → SET NULL
-- ============================================================================
-- When a user deletes their account, their sessions should survive and be
-- transferred to another participant. CASCADE would destroy them, losing
-- all other participants' data. SET NULL lets the session survive with
-- created_by = NULL until the edge function transfers ownership.
-- ============================================================================

ALTER TABLE public.collaboration_sessions
  DROP CONSTRAINT IF EXISTS collaboration_sessions_created_by_fkey;

ALTER TABLE public.collaboration_sessions
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.collaboration_sessions
  ADD CONSTRAINT collaboration_sessions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
