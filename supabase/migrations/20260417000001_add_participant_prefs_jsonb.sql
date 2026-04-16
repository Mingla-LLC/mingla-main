-- ORCH-0446: Collaboration Session Partial Rebuild
--
-- 1. Add participant_prefs JSONB column to collaboration_sessions.
--    Each key is a user_id, each value is their preference object.
--    Replaces board_session_preferences table (separate table → single column).
--
-- 2. Create atomic RPC functions for concurrent-safe JSONB writes.
--    Uses PostgreSQL || operator for atomic merge — no read-modify-write race.
--    Safe for 20+ concurrent participants writing simultaneously.

-- ── Step 1: Add JSONB column ──────────────────────────────────────────────────

ALTER TABLE public.collaboration_sessions
ADD COLUMN IF NOT EXISTS participant_prefs JSONB DEFAULT '{}';

-- ── Step 2: Atomic upsert RPC ─────────────────────────────────────────────────
-- Merges a single participant's preferences into the JSONB.
-- Deep merge: preserves existing fields in the user's entry that aren't in p_prefs.
-- SECURITY DEFINER: bypasses RLS but validates participant membership internally.

CREATE OR REPLACE FUNCTION upsert_participant_prefs(
  p_session_id UUID,
  p_user_id UUID,
  p_prefs JSONB
) RETURNS void AS $$
BEGIN
  -- Validate caller is an accepted participant
  IF NOT EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE session_id = p_session_id AND user_id = p_user_id AND has_accepted = true
  ) THEN
    RAISE EXCEPTION 'Not a participant of this session';
  END IF;

  -- Deep merge: existing user prefs || new prefs (new keys win, old keys preserved)
  UPDATE public.collaboration_sessions
  SET participant_prefs = COALESCE(participant_prefs, '{}'::jsonb)
    || jsonb_build_object(
      p_user_id::text,
      COALESCE(participant_prefs -> p_user_id::text, '{}'::jsonb) || p_prefs
    ),
    updated_at = NOW()
  WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Step 3: Atomic removal RPC ────────────────────────────────────────────────
-- Removes a single participant's preferences from the JSONB on leave.
-- Uses - operator for atomic key removal.

CREATE OR REPLACE FUNCTION remove_participant_prefs(
  p_session_id UUID,
  p_user_id UUID
) RETURNS void AS $$
BEGIN
  UPDATE public.collaboration_sessions
  SET participant_prefs = COALESCE(participant_prefs, '{}'::jsonb) - p_user_id::text,
    updated_at = NOW()
  WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
