-- ============================================
-- COMPREHENSIVE FIX: Break ALL RLS Recursion and Fix Trigger Permissions
-- ============================================
-- This migration addresses three systemic problems:
--
-- 1. INFINITE RECURSION: Multiple tables have RLS policies that query
--    session_participants directly. Since session_participants now has its own
--    RLS policies (which reference collaboration_sessions, which references
--    session_participants), this creates circular evaluation chains.
--    FIX: Replace all direct session_participants/collaboration_sessions
--    subqueries with SECURITY DEFINER helper functions.
--
-- 2. TRIGGER AUTH CONTEXT: Trigger functions (auto_create_presence,
--    update_session_last_activity, mark_presence_offline) run in the
--    context of the calling user (auth.uid()). When user A creates a
--    session_participants row for user B, the trigger tries to write
--    to board_participant_presence as user A, but RLS requires user_id = auth.uid().
--    FIX: Make trigger functions SECURITY DEFINER so they bypass RLS.
--
-- 3. POLICY COMPLETENESS: Some tables are missing INSERT policies for
--    session creators adding rows on behalf of participants.
--    FIX: Add appropriate policies.
-- ============================================

-- ===========================================
-- Step 1: Ensure SECURITY DEFINER helper functions exist
-- (These were created in migration 20250227000004, but we re-declare
--  them here for safety in case that migration is rerun independently)
-- ===========================================

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
-- Step 2: Fix trigger functions to use SECURITY DEFINER
-- ===========================================

-- auto_create_presence: fires when a row is inserted into session_participants
-- Must be SECURITY DEFINER because the inserting user may not be the participant
CREATE OR REPLACE FUNCTION public.auto_create_presence()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.board_participant_presence (session_id, user_id, is_online, last_seen_at)
  VALUES (NEW.session_id, NEW.user_id, true, now())
  ON CONFLICT (session_id, user_id) 
  DO UPDATE SET is_online = true, last_seen_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- mark_presence_offline: fires when a row is deleted from session_participants
CREATE OR REPLACE FUNCTION public.mark_presence_offline()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.board_participant_presence
  SET is_online = false, last_seen_at = now()
  WHERE session_id = OLD.session_id AND user_id = OLD.user_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- update_session_last_activity: fires when cards/messages are saved
CREATE OR REPLACE FUNCTION public.update_session_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.collaboration_sessions
  SET last_activity_at = now()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ===========================================
-- Step 3: Fix board_participant_presence RLS policies
-- ===========================================

DROP POLICY IF EXISTS "Participants can view presence in their sessions" ON public.board_participant_presence;
DROP POLICY IF EXISTS "Users can update their own presence" ON public.board_participant_presence;

-- SELECT: participant can see presence of others in same session
CREATE POLICY "bpp_select" ON public.board_participant_presence
FOR SELECT USING (
  user_id = auth.uid()
  OR public.is_session_participant(session_id, auth.uid())
);

-- INSERT: user can insert their own presence, or session creator can insert for anyone
CREATE POLICY "bpp_insert" ON public.board_participant_presence
FOR INSERT WITH CHECK (
  user_id = auth.uid()
  OR public.is_session_creator(session_id, auth.uid())
);

-- UPDATE: user can update their own presence
CREATE POLICY "bpp_update" ON public.board_participant_presence
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- DELETE: user can delete their own presence
CREATE POLICY "bpp_delete" ON public.board_participant_presence
FOR DELETE USING (
  user_id = auth.uid()
);

-- ===========================================
-- Step 4: Fix board_typing_indicators RLS policies
-- ===========================================

DROP POLICY IF EXISTS "Participants can view typing indicators" ON public.board_typing_indicators;
DROP POLICY IF EXISTS "Users can update their own typing status" ON public.board_typing_indicators;

CREATE POLICY "bti_select" ON public.board_typing_indicators
FOR SELECT USING (
  user_id = auth.uid()
  OR public.is_session_participant(session_id, auth.uid())
);

CREATE POLICY "bti_all" ON public.board_typing_indicators
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ===========================================
-- Step 5: Fix board_session_preferences RLS policies
-- ===========================================

DROP POLICY IF EXISTS "Users can view session preferences for their sessions" ON public.board_session_preferences;
DROP POLICY IF EXISTS "Admins can update session preferences" ON public.board_session_preferences;
DROP POLICY IF EXISTS "Admins can insert session preferences" ON public.board_session_preferences;
DROP POLICY IF EXISTS "Users can view their own session preferences" ON public.board_session_preferences;
DROP POLICY IF EXISTS "Users can update their own session preferences" ON public.board_session_preferences;
DROP POLICY IF EXISTS "Users can insert their own session preferences" ON public.board_session_preferences;
DROP POLICY IF EXISTS "Users can delete their own session preferences" ON public.board_session_preferences;

CREATE POLICY "bsp_select" ON public.board_session_preferences
FOR SELECT USING (
  user_id = auth.uid()
  OR public.is_session_participant(session_id, auth.uid())
);

CREATE POLICY "bsp_insert" ON public.board_session_preferences
FOR INSERT WITH CHECK (
  user_id = auth.uid()
  OR public.is_session_creator(session_id, auth.uid())
);

CREATE POLICY "bsp_update" ON public.board_session_preferences
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "bsp_delete" ON public.board_session_preferences
FOR DELETE USING (user_id = auth.uid());

-- ===========================================
-- Step 6: Fix board_saved_cards RLS policies
-- ===========================================

DROP POLICY IF EXISTS "Participants can view saved cards in their sessions" ON public.board_saved_cards;
DROP POLICY IF EXISTS "Participants can add cards to their sessions" ON public.board_saved_cards;

CREATE POLICY "bsc_select" ON public.board_saved_cards
FOR SELECT USING (
  saved_by = auth.uid()
  OR public.is_session_participant(session_id, auth.uid())
);

CREATE POLICY "bsc_insert" ON public.board_saved_cards
FOR INSERT WITH CHECK (
  saved_by = auth.uid()
  AND public.is_session_participant(session_id, auth.uid())
);

-- ===========================================
-- Step 7: Fix board_messages RLS policies
-- ===========================================

DROP POLICY IF EXISTS "Participants can view messages in their sessions" ON public.board_messages;
DROP POLICY IF EXISTS "Participants can send messages" ON public.board_messages;

CREATE POLICY "bm_select" ON public.board_messages
FOR SELECT USING (
  (deleted_at IS NULL)
  AND public.is_session_participant(session_id, auth.uid())
);

CREATE POLICY "bm_insert" ON public.board_messages
FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND public.is_session_participant(session_id, auth.uid())
);

-- ===========================================
-- Step 8: Fix board_card_messages RLS policies
-- ===========================================

DROP POLICY IF EXISTS "Participants can view card messages in their sessions" ON public.board_card_messages;
DROP POLICY IF EXISTS "Participants can send card messages" ON public.board_card_messages;

CREATE POLICY "bcm_select" ON public.board_card_messages
FOR SELECT USING (
  (deleted_at IS NULL)
  AND public.is_session_participant(session_id, auth.uid())
);

CREATE POLICY "bcm_insert" ON public.board_card_messages
FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND public.is_session_participant(session_id, auth.uid())
);

-- ===========================================
-- Step 9: Fix board_message_reads RLS policies
-- (These join through board_messages → session_participants, causing recursion)
-- ===========================================

DROP POLICY IF EXISTS "Users can view read receipts for messages" ON public.board_message_reads;

-- Simplified: users can see their own read receipts
CREATE POLICY "bmr_select" ON public.board_message_reads
FOR SELECT USING (
  user_id = auth.uid()
);

-- ===========================================
-- Step 10: Fix board_card_message_reads RLS policies
-- ===========================================

DROP POLICY IF EXISTS "Users can view read receipts for card messages" ON public.board_card_message_reads;

CREATE POLICY "bcmr_select" ON public.board_card_message_reads
FOR SELECT USING (
  user_id = auth.uid()
);

-- ===========================================
-- Step 11: Fix board_votes RLS policies (session-based votes)
-- These use EXECUTE format so we need dynamic SQL
-- ===========================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_votes' 
    AND column_name = 'session_id'
  ) THEN
    -- Drop old policies
    DROP POLICY IF EXISTS "Users can view votes in boards and sessions they have access to" ON public.board_votes;
    DROP POLICY IF EXISTS "Users can delete their own votes" ON public.board_votes;
    
    -- Recreate SELECT policy using helper function
    EXECUTE 'CREATE POLICY "bv_select" ON public.board_votes
      FOR SELECT USING (
        (
          session_id IS NOT NULL
          AND public.is_session_participant(session_id, auth.uid())
        )
        OR
        (
          board_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.boards b
            WHERE b.id = board_votes.board_id
            AND (b.created_by = auth.uid() OR b.is_public = true)
          )
        )
      )';
    
    -- Recreate DELETE policy using helper function
    EXECUTE 'CREATE POLICY "bv_delete" ON public.board_votes
      FOR DELETE USING (
        auth.uid() = user_id
        AND (
          (
            session_id IS NOT NULL
            AND public.is_session_participant(session_id, auth.uid())
          )
          OR
          (
            board_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.boards b
              WHERE b.id = board_votes.board_id
              AND (b.created_by = auth.uid() OR b.is_public = true)
            )
          )
        )
      )';
  END IF;
END $$;

-- ===========================================
-- Step 12: Fix board_card_rsvps RLS policies
-- ===========================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_card_rsvps' 
    AND column_name = 'session_id'
  ) THEN
    DROP POLICY IF EXISTS "Participants can view RSVPs in their sessions" ON public.board_card_rsvps;
    
    EXECUTE 'CREATE POLICY "bcr_select" ON public.board_card_rsvps
      FOR SELECT USING (
        user_id = auth.uid()
        OR public.is_session_participant(session_id, auth.uid())
      )';
  END IF;
END $$;

-- ===========================================
-- Step 13: Fix board_user_swipe_states RLS policies
-- ===========================================

DROP POLICY IF EXISTS "Users can view their own swipe states" ON public.board_user_swipe_states;
DROP POLICY IF EXISTS "Users can manage their own swipe states" ON public.board_user_swipe_states;

CREATE POLICY "buss_select" ON public.board_user_swipe_states
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "buss_all" ON public.board_user_swipe_states
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
