-- ============================================
-- COMPREHENSIVE FIX: Break RLS Infinite Recursion
-- ============================================
-- Problem: Circular dependency between RLS policies:
--   collaboration_sessions SELECT → queries session_participants → triggers session_participants SELECT
--   session_participants SELECT → queries collaboration_sessions → triggers collaboration_sessions SELECT
--   Result: PostgreSQL error 42P17 "infinite recursion detected in policy"
--
-- Solution: Use SECURITY DEFINER helper functions that bypass RLS when checking
-- cross-table membership. This is the standard PostgreSQL pattern for breaking
-- RLS circular dependencies. The functions run with the privileges of the
-- function owner (postgres), so they can read from tables without triggering
-- RLS policies, while the policies themselves still protect the tables.
-- ============================================

-- ===========================================
-- Step 1: Create SECURITY DEFINER helper functions
-- ===========================================
-- These functions bypass RLS when called from within a policy,
-- breaking the circular dependency chain.

-- Check if a user is a participant in a given session
CREATE OR REPLACE FUNCTION public.is_session_participant(p_session_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE session_id = p_session_id
    AND user_id = p_user_id
  );
$$;

-- Check if a user is the creator of a given session
CREATE OR REPLACE FUNCTION public.is_session_creator(p_session_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collaboration_sessions
    WHERE id = p_session_id
    AND created_by = p_user_id
  );
$$;

-- Check if a user has a pending invite to a given session
CREATE OR REPLACE FUNCTION public.has_session_invite(p_session_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collaboration_invites
    WHERE session_id = p_session_id
    AND (invitee_id = p_user_id OR invited_user_id = p_user_id)
    AND status = 'pending'
  );
$$;

-- ===========================================
-- Step 2: Drop ALL existing policies on the three tables
-- ===========================================
-- Clean slate to avoid any leftover policies causing conflicts

-- collaboration_sessions policies
DROP POLICY IF EXISTS "Users can manage their own sessions" ON public.collaboration_sessions;
DROP POLICY IF EXISTS "Users can view sessions they created, are participants in, or are invited to" ON public.collaboration_sessions;
DROP POLICY IF EXISTS "Users can create their own sessions" ON public.collaboration_sessions;
DROP POLICY IF EXISTS "Users can update their own sessions" ON public.collaboration_sessions;
DROP POLICY IF EXISTS "Users can delete their own sessions" ON public.collaboration_sessions;
DROP POLICY IF EXISTS "Users can update sessions they created or participate in" ON public.collaboration_sessions;

-- session_participants policies
DROP POLICY IF EXISTS "Users can view session participants in sessions they're in" ON public.session_participants;
DROP POLICY IF EXISTS "Users can add themselves or others as session participants" ON public.session_participants;
DROP POLICY IF EXISTS "Users can update session participation status" ON public.session_participants;
DROP POLICY IF EXISTS "Users can remove themselves from sessions" ON public.session_participants;

-- collaboration_invites policies
DROP POLICY IF EXISTS "Users can view their own invites" ON public.collaboration_invites;
DROP POLICY IF EXISTS "Users can create invites for sessions they're organizing" ON public.collaboration_invites;
DROP POLICY IF EXISTS "Users can update invite status" ON public.collaboration_invites;
DROP POLICY IF EXISTS "Users can delete invites" ON public.collaboration_invites;

-- ===========================================
-- Step 3: Recreate collaboration_sessions policies
-- (Uses is_session_participant() to avoid querying session_participants directly)
-- ===========================================

CREATE POLICY "cs_select" ON public.collaboration_sessions
FOR SELECT USING (
  auth.uid() = created_by
  OR public.is_session_participant(id, auth.uid())
  OR public.has_session_invite(id, auth.uid())
);

CREATE POLICY "cs_insert" ON public.collaboration_sessions
FOR INSERT WITH CHECK (
  auth.uid() = created_by
);

CREATE POLICY "cs_update" ON public.collaboration_sessions
FOR UPDATE
USING (
  auth.uid() = created_by
  OR public.is_session_participant(id, auth.uid())
)
WITH CHECK (
  auth.uid() = created_by
  OR public.is_session_participant(id, auth.uid())
);

CREATE POLICY "cs_delete" ON public.collaboration_sessions
FOR DELETE USING (
  auth.uid() = created_by
);

-- ===========================================
-- Step 4: Recreate session_participants policies
-- (Uses is_session_creator() to avoid querying collaboration_sessions directly)
-- ===========================================

CREATE POLICY "sp_select" ON public.session_participants
FOR SELECT USING (
  auth.uid() = user_id
  OR public.is_session_creator(session_id, auth.uid())
);

CREATE POLICY "sp_insert" ON public.session_participants
FOR INSERT WITH CHECK (
  auth.uid() = user_id
  OR public.is_session_creator(session_id, auth.uid())
  OR public.is_session_participant(session_id, auth.uid())
);

CREATE POLICY "sp_update" ON public.session_participants
FOR UPDATE USING (
  auth.uid() = user_id
  OR public.is_session_creator(session_id, auth.uid())
);

CREATE POLICY "sp_delete" ON public.session_participants
FOR DELETE USING (
  auth.uid() = user_id
  OR public.is_session_creator(session_id, auth.uid())
);

-- ===========================================
-- Step 5: Recreate collaboration_invites policies
-- (Uses helper functions to avoid cross-table recursion)
-- ===========================================

CREATE POLICY "ci_select" ON public.collaboration_invites
FOR SELECT USING (
  auth.uid() = invitee_id
  OR auth.uid() = invited_user_id
  OR auth.uid() = inviter_id
  OR auth.uid() = invited_by
  OR public.is_session_creator(session_id, auth.uid())
);

CREATE POLICY "ci_insert" ON public.collaboration_invites
FOR INSERT WITH CHECK (
  auth.uid() = inviter_id
  OR auth.uid() = invited_by
  OR public.is_session_creator(session_id, auth.uid())
);

CREATE POLICY "ci_update" ON public.collaboration_invites
FOR UPDATE USING (
  auth.uid() = invitee_id
  OR auth.uid() = invited_user_id
  OR auth.uid() = inviter_id
  OR auth.uid() = invited_by
  OR public.is_session_creator(session_id, auth.uid())
);

CREATE POLICY "ci_delete" ON public.collaboration_invites
FOR DELETE USING (
  auth.uid() = invitee_id
  OR auth.uid() = invited_user_id
  OR auth.uid() = inviter_id
  OR auth.uid() = invited_by
  OR public.is_session_creator(session_id, auth.uid())
);
