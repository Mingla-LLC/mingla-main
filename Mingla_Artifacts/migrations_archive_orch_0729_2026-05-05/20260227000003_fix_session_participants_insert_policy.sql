-- ============================================
-- FIX: Simplify session_participants INSERT RLS policy
-- ============================================
-- Problem: The is_session_creator() check in the INSERT policy is failing,
-- preventing session creators from adding friends as participants.
-- This migration simplifies the logic by:
-- 1. Allowing users to insert their own row
-- 2. Allowing users who are already participants to add others
-- 3. Allowing session creators to add anyone

-- Drop and recreate the INSERT policy with clearer logic
DROP POLICY IF EXISTS "sp_insert" ON public.session_participants;

-- Simplified INSERT policy:
-- - Users can add themselves
-- - Existing participants can add others (implicit trust among participants)
-- - Session creators can add anyone
CREATE POLICY "sp_insert" ON public.session_participants
FOR INSERT WITH CHECK (
  auth.uid() = user_id
  OR public.is_session_creator(session_id, auth.uid())
  OR public.is_session_participant(session_id, auth.uid())
);

-- Also ensure UPDATE allows participants to change their own acceptance status
DROP POLICY IF EXISTS "sp_update" ON public.session_participants;

CREATE POLICY "sp_update" ON public.session_participants
FOR UPDATE USING (
  auth.uid() = user_id
  OR public.is_session_creator(session_id, auth.uid())
)
WITH CHECK (
  auth.uid() = user_id
  OR public.is_session_creator(session_id, auth.uid())
);

-- Ensure SELECT allows viewing participants you're involved with
DROP POLICY IF EXISTS "sp_select" ON public.session_participants;

CREATE POLICY "sp_select" ON public.session_participants
FOR SELECT USING (
  auth.uid() = user_id
  OR public.is_session_creator(session_id, auth.uid())
  OR public.is_session_participant(session_id, auth.uid())
);

-- DELETE policy stays the same but ensure it's defined
DROP POLICY IF EXISTS "sp_delete" ON public.session_participants;

CREATE POLICY "sp_delete" ON public.session_participants
FOR DELETE USING (
  auth.uid() = user_id
  OR public.is_session_creator(session_id, auth.uid())
);
