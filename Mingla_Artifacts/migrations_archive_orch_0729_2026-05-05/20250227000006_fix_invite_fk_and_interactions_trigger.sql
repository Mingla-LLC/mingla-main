-- ============================================
-- FIX 1: invited_by FK must reference profiles(id) for PostgREST joins
-- FIX 2: update_user_preferences_from_interaction() has wrong column refs
-- FIX 3: has_session_invite() should also match 'accepted' status
-- ============================================

-- ===========================================
-- FIX 1: Re-point invited_by FK to profiles(id)
-- ===========================================
-- The app query uses:
--   profiles!collaboration_invites_invited_by_fkey(...)
-- PostgREST resolves this by looking for a FK named
-- "collaboration_invites_invited_by_fkey" that points to the profiles table.
-- Currently the FK points to auth.users(id), which PostgREST cannot
-- use to join to profiles. We need it to point to public.profiles(id).

-- Drop the existing FK (auto-named collaboration_invites_invited_by_fkey)
ALTER TABLE public.collaboration_invites
  DROP CONSTRAINT IF EXISTS collaboration_invites_invited_by_fkey;

-- Also drop any other auto-generated FK name variant
ALTER TABLE public.collaboration_invites
  DROP CONSTRAINT IF EXISTS collaboration_invites_invited_by_fkey1;

-- Re-create the FK pointing to profiles(id) with the exact name PostgREST expects
ALTER TABLE public.collaboration_invites
  ADD CONSTRAINT collaboration_invites_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ===========================================
-- FIX 2: Fix update_user_preferences_from_interaction()
-- ===========================================
-- Problems in the old function:
--   a) NEW.metadata does not exist; the column is interaction_data
--   b) user_preference_learning has (preference_type, preference_key, preference_value)
--      not (category, preference_score)
--   c) ON CONFLICT (user_id, category) doesn't match any unique constraint
--   d) Function is not SECURITY DEFINER, so INSERT into user_preference_learning
--      hits its RLS even though the user_id matches (trigger context)
--
-- Fix: Rewrite with correct column names, SECURITY DEFINER, and graceful handling

CREATE OR REPLACE FUNCTION public.update_user_preferences_from_interaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  category_name TEXT;
  interaction_weight DOUBLE PRECISION;
BEGIN
  -- Extract category from interaction_data (not 'metadata')
  category_name := NEW.interaction_data->>'category';

  -- If no category in interaction_data, skip
  IF category_name IS NULL OR category_name = '' THEN
    RETURN NEW;
  END IF;

  -- Determine weight based on interaction type
  CASE NEW.interaction_type
    WHEN 'like' THEN interaction_weight := 0.1;
    WHEN 'dislike' THEN interaction_weight := -0.1;
    WHEN 'save' THEN interaction_weight := 0.2;
    WHEN 'view' THEN interaction_weight := 0.05;
    WHEN 'swipe_right' THEN interaction_weight := 0.15;
    WHEN 'swipe_left' THEN interaction_weight := -0.05;
    WHEN 'click_details' THEN interaction_weight := 0.1;
    WHEN 'tap' THEN interaction_weight := 0.05;
    ELSE interaction_weight := 0.0;
  END CASE;

  -- Update or insert preference learning record
  -- Table schema: (user_id, preference_type, preference_key, preference_value, confidence, ...)
  -- Unique constraint: (user_id, preference_type, preference_key)
  INSERT INTO public.user_preference_learning
    (user_id, preference_type, preference_key, preference_value, confidence)
  VALUES
    (NEW.user_id, 'category', category_name, 0.5 + interaction_weight, 0.1)
  ON CONFLICT (user_id, preference_type, preference_key)
  DO UPDATE SET
    preference_value = GREATEST(0.0, LEAST(1.0,
      user_preference_learning.preference_value + interaction_weight)),
    confidence = LEAST(1.0, user_preference_learning.confidence + 0.05),
    interaction_count = user_preference_learning.interaction_count + 1,
    last_updated = now();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never let a preference-tracking failure block the main interaction insert
    RAISE WARNING 'update_user_preferences_from_interaction failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- ===========================================
-- FIX 3: has_session_invite() should match pending AND accepted invites
-- ===========================================
-- The invited user's grey pill query fetches invited sessions with status
-- 'pending', but the session itself may have become 'active'.
-- The cs_select RLS policy uses has_session_invite() to decide if the
-- invited user can see the collaboration_session row. If the invite was
-- accepted the function must still return true so the user can see it.

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
    AND status IN ('pending', 'accepted')
  );
$$;
