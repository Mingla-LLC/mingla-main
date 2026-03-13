-- Migration: consolidate_collaboration_invite_columns
-- Description: Removes duplicate alias columns (invitee_id, invited_by) from
-- collaboration_invites table and their sync triggers. After this migration,
-- the table has exactly two participant columns: inviter_id (sender) and
-- invited_user_id (recipient).
--
-- PREREQUISITE: All app code must already use invited_user_id / inviter_id
-- exclusively. Verify no code references invitee_id or invited_by before running.

-- ═══════════════════════════════════════════════════════════
-- Step 1: Final sync — ensure no rows have data only in alias columns
-- ═══════════════════════════════════════════════════════════

-- Copy any invitee_id-only values to invited_user_id
UPDATE public.collaboration_invites
SET invited_user_id = invitee_id
WHERE invited_user_id IS NULL AND invitee_id IS NOT NULL;

-- Copy any invited_by-only values to inviter_id
UPDATE public.collaboration_invites
SET inviter_id = invited_by
WHERE inviter_id IS NULL AND invited_by IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- Step 2: Drop sync triggers (they reference the alias columns)
-- ═══════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS sync_invite_ids ON public.collaboration_invites;
DROP FUNCTION IF EXISTS public.sync_invite_user_id();

DROP TRIGGER IF EXISTS sync_invite_inviter_ids ON public.collaboration_invites;
DROP FUNCTION IF EXISTS public.sync_invite_inviter_id();

-- ═══════════════════════════════════════════════════════════
-- Step 3: Update RLS policies to remove alias column references
-- ═══════════════════════════════════════════════════════════

-- SELECT policy: was checking 4 columns, now checks 2
DROP POLICY IF EXISTS "ci_select" ON public.collaboration_invites;
CREATE POLICY "ci_select" ON public.collaboration_invites
FOR SELECT USING (
  auth.uid() = invited_user_id
  OR auth.uid() = inviter_id
  OR public.is_session_creator(session_id, auth.uid())
);

-- INSERT policy: was checking inviter_id OR invited_by, now just inviter_id
DROP POLICY IF EXISTS "ci_insert" ON public.collaboration_invites;
CREATE POLICY "ci_insert" ON public.collaboration_invites
FOR INSERT WITH CHECK (
  auth.uid() = inviter_id
  OR public.is_session_creator(session_id, auth.uid())
);

-- UPDATE policy: was checking 4 columns, now checks 2
DROP POLICY IF EXISTS "ci_update" ON public.collaboration_invites;
CREATE POLICY "ci_update" ON public.collaboration_invites
FOR UPDATE USING (
  auth.uid() = invited_user_id
  OR auth.uid() = inviter_id
  OR public.is_session_creator(session_id, auth.uid())
);

-- DELETE policy: was checking 4 columns, now checks 2
DROP POLICY IF EXISTS "ci_delete" ON public.collaboration_invites;
CREATE POLICY "ci_delete" ON public.collaboration_invites
FOR DELETE USING (
  auth.uid() = invited_user_id
  OR auth.uid() = inviter_id
  OR public.is_session_creator(session_id, auth.uid())
);

-- ═══════════════════════════════════════════════════════════
-- Step 4: Update helper function that checks both columns
-- ═══════════════════════════════════════════════════════════

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
    AND invited_user_id = p_user_id
    AND status IN ('pending', 'accepted')
  );
$$;

-- ═══════════════════════════════════════════════════════════
-- Step 5: Update the phone invite conversion trigger to use canonical columns
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.convert_pending_invites_on_phone_verified()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pending RECORD;
  session_pending RECORD;
  new_invite_id UUID;
BEGIN
  IF NEW.phone IS NULL OR (OLD.phone IS NOT NULL AND OLD.phone = NEW.phone) THEN
    RETURN NEW;
  END IF;

  -- PART 1: Convert pending friend invites (unchanged)
  FOR pending IN
    SELECT * FROM public.pending_invites
    WHERE phone_e164 = NEW.phone
      AND status = 'pending'
      AND inviter_id != NEW.id
  LOOP
    INSERT INTO public.friend_requests (sender_id, receiver_id, status)
    VALUES (pending.inviter_id, NEW.id, 'pending')
    ON CONFLICT (sender_id, receiver_id) DO NOTHING;

    INSERT INTO public.friend_links (requester_id, target_id, status)
    VALUES (pending.inviter_id, NEW.id, 'pending')
    ON CONFLICT DO NOTHING;

    UPDATE public.pending_invites
    SET status = 'converted', converted_user_id = NEW.id, converted_at = NOW()
    WHERE id = pending.id;

    INSERT INTO public.referral_credits (referrer_id, referred_id, pending_invite_id, status)
    VALUES (pending.inviter_id, NEW.id, pending.id, 'pending')
    ON CONFLICT (referrer_id, referred_id) DO NOTHING;
  END LOOP;

  -- PART 2: Convert pending SESSION invites — now uses canonical columns
  FOR session_pending IN
    SELECT * FROM public.pending_session_invites
    WHERE phone_e164 = NEW.phone
      AND status = 'pending'
      AND inviter_id != NEW.id
  LOOP
    INSERT INTO public.collaboration_invites (
      session_id, inviter_id, invited_user_id, status
    )
    VALUES (
      session_pending.session_id,
      session_pending.inviter_id,
      NEW.id,
      'pending'
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO new_invite_id;

    IF new_invite_id IS NOT NULL THEN
      INSERT INTO public.session_participants (session_id, user_id, has_accepted)
      VALUES (session_pending.session_id, NEW.id, false)
      ON CONFLICT (session_id, user_id) DO NOTHING;
    END IF;

    UPDATE public.pending_session_invites
    SET status = 'converted',
        converted_invite_id = COALESCE(new_invite_id, converted_invite_id),
        updated_at = NOW()
    WHERE id = session_pending.id;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Re-attach trigger (idempotent)
DROP TRIGGER IF EXISTS trg_convert_pending_invites_on_phone ON public.profiles;
CREATE TRIGGER trg_convert_pending_invites_on_phone
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.convert_pending_invites_on_phone_verified();

-- ═══════════════════════════════════════════════════════════
-- Step 5b: Rewrite trigger functions that still reference alias columns
-- These MUST be updated before Step 6 drops the columns, or they crash.
-- ═══════════════════════════════════════════════════════════

-- 5b-1: cascade_friend_decline_to_collabs — replace invitee_id → invited_user_id
CREATE OR REPLACE FUNCTION public.cascade_friend_decline_to_collabs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'declined' AND OLD.status = 'pending' THEN
    -- Cancel collaboration invites where sender invited receiver
    UPDATE public.collaboration_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.sender_id AND invited_user_id = NEW.receiver_id AND status = 'pending';

    DELETE FROM public.session_participants
    WHERE user_id = NEW.receiver_id
    AND session_id IN (
      SELECT session_id FROM public.collaboration_invites
      WHERE inviter_id = NEW.sender_id AND invited_user_id = NEW.receiver_id
    );

    -- Cancel collaboration invites where receiver invited sender
    UPDATE public.collaboration_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.receiver_id AND invited_user_id = NEW.sender_id AND status = 'pending';

    DELETE FROM public.session_participants
    WHERE user_id = NEW.sender_id
    AND session_id IN (
      SELECT session_id FROM public.collaboration_invites
      WHERE inviter_id = NEW.receiver_id AND invited_user_id = NEW.sender_id
    );

    -- Cancel pending invites (non-app user invites)
    UPDATE public.pending_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.sender_id
    AND converted_user_id = NEW.receiver_id
    AND status = 'pending';

    UPDATE public.pending_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.receiver_id
    AND converted_user_id = NEW.sender_id
    AND status = 'pending';

    -- Expire any pending referral credits between the two
    UPDATE public.referral_credits
    SET status = 'expired'
    WHERE ((referrer_id = NEW.sender_id AND referred_id = NEW.receiver_id)
       OR  (referrer_id = NEW.receiver_id AND referred_id = NEW.sender_id))
    AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

-- 5b-2: handle_user_deletion_cleanup — replace invitee_id/invited_by → invited_user_id/inviter_id
CREATE OR REPLACE FUNCTION public.handle_user_deletion_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  session_record RECORD;
  oldest_member_id UUID;
  participant_count INTEGER;
BEGIN
  -- Step 1: Handle each session where the deleted user was a participant
  FOR session_record IN
    SELECT DISTINCT sp.session_id, sp.is_admin
    FROM session_participants sp
    WHERE sp.user_id = OLD.id
  LOOP
    -- If user was admin, reassign to oldest remaining member
    IF session_record.is_admin THEN
      SELECT user_id INTO oldest_member_id
      FROM session_participants
      WHERE session_id = session_record.session_id
        AND user_id != OLD.id
      ORDER BY created_at ASC
      LIMIT 1;

      IF oldest_member_id IS NOT NULL THEN
        UPDATE session_participants
        SET is_admin = TRUE
        WHERE session_id = session_record.session_id
          AND user_id = oldest_member_id;
      END IF;
    END IF;

    -- Remove user from session
    DELETE FROM session_participants
    WHERE session_id = session_record.session_id
      AND user_id = OLD.id;

    -- Check remaining participant count
    SELECT COUNT(*) INTO participant_count
    FROM session_participants
    WHERE session_id = session_record.session_id;

    -- If fewer than 2 members remain, delete the session
    IF participant_count < 2 THEN
      -- Delete related data first
      DELETE FROM board_session_preferences WHERE session_id = session_record.session_id;
      DELETE FROM session_votes WHERE session_id = session_record.session_id;
      DELETE FROM collaboration_invites WHERE session_id = session_record.session_id;
      DELETE FROM session_presence WHERE session_id = session_record.session_id;
      DELETE FROM typing_indicators WHERE session_id = session_record.session_id;
      -- Delete the session itself
      DELETE FROM collaboration_sessions WHERE id = session_record.session_id;
    END IF;
  END LOOP;

  -- Step 2: Transfer creator ownership for any remaining sessions
  UPDATE collaboration_sessions cs
  SET created_by = (
    SELECT sp.user_id
    FROM session_participants sp
    WHERE sp.session_id = cs.id
      AND sp.user_id != OLD.id
    ORDER BY sp.created_at ASC
    LIMIT 1
  )
  WHERE cs.created_by = OLD.id
    AND EXISTS (
      SELECT 1 FROM session_participants sp
      WHERE sp.session_id = cs.id
        AND sp.user_id != OLD.id
    );

  -- Step 3: Anonymize messages (soft delete) instead of hard delete
  UPDATE messages
  SET deleted_at = NOW()
  WHERE sender_id = OLD.id
    AND deleted_at IS NULL;

  -- Step 4: Remove from conversation participants
  DELETE FROM conversation_participants WHERE user_id = OLD.id;

  -- Step 5: Clean up friends, friend links, and social data
  DELETE FROM friends WHERE user_id = OLD.id OR friend_user_id = OLD.id;
  DELETE FROM friend_requests WHERE sender_id = OLD.id OR receiver_id = OLD.id;
  DELETE FROM friend_links WHERE requester_id = OLD.id OR target_id = OLD.id;
  DELETE FROM blocked_users WHERE blocker_id = OLD.id OR blocked_id = OLD.id;
  DELETE FROM muted_users WHERE muter_id = OLD.id OR muted_id = OLD.id;
  DELETE FROM collaboration_invites WHERE inviter_id = OLD.id OR invited_user_id = OLD.id;
  DELETE FROM user_presence WHERE user_id = OLD.id;
  DELETE FROM session_presence WHERE user_id = OLD.id;
  DELETE FROM typing_indicators WHERE user_id = OLD.id;
  DELETE FROM session_votes WHERE user_id = OLD.id;
  DELETE FROM calendar_entries WHERE user_id = OLD.id;
  DELETE FROM board_session_preferences WHERE user_id = OLD.id;
  DELETE FROM preference_history WHERE user_id = OLD.id;
  DELETE FROM user_activity WHERE user_id = OLD.id;
  DELETE FROM user_interactions WHERE user_id = OLD.id;
  DELETE FROM user_location_history WHERE user_id = OLD.id;
  DELETE FROM user_preference_learning WHERE user_id = OLD.id;
  DELETE FROM user_sessions WHERE user_id = OLD.id;

  -- Step 6: Clean up saved_people entries where OTHER users had the deleted user as a linked friend.
  -- CASCADE from saved_people automatically removes their person_experiences and person_audio_clips.
  DELETE FROM saved_people WHERE linked_user_id = OLD.id;

  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but don't prevent profile deletion
    RAISE WARNING 'Error during user deletion cleanup for user %: %', OLD.id, SQLERRM;
    RETURN OLD;
END;
$$;

-- 5b-3: credit_referral_on_friend_accepted — remove invited_by from INSERT columns
CREATE OR REPLACE FUNCTION public.credit_referral_on_friend_accepted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_referral referral_credits%ROWTYPE;
  v_referral_reverse referral_credits%ROWTYPE;
  v_pending_session pending_session_invites%ROWTYPE;
BEGIN
  -- Only fire on pending → accepted transition
  IF NEW.status != 'accepted' OR OLD.status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- ═══════════════════════════════════════════
  -- PART 1: Credit referrals
  -- ═══════════════════════════════════════════

  SELECT * INTO v_referral
    FROM public.referral_credits
    WHERE referrer_id = NEW.sender_id AND referred_id = NEW.receiver_id
      AND status = 'pending'
    LIMIT 1;

  IF FOUND THEN
    UPDATE public.referral_credits
      SET status = 'credited', credited_at = NOW(), updated_at = NOW()
      WHERE id = v_referral.id;

    UPDATE public.subscriptions
      SET referral_bonus_months = COALESCE(referral_bonus_months, 0) + 1,
          updated_at = NOW()
      WHERE user_id = NEW.sender_id;
  END IF;

  SELECT * INTO v_referral_reverse
    FROM public.referral_credits
    WHERE referrer_id = NEW.receiver_id AND referred_id = NEW.sender_id
      AND status = 'pending'
    LIMIT 1;

  IF FOUND THEN
    UPDATE public.referral_credits
      SET status = 'credited', credited_at = NOW(), updated_at = NOW()
      WHERE id = v_referral_reverse.id;

    UPDATE public.subscriptions
      SET referral_bonus_months = COALESCE(referral_bonus_months, 0) + 1,
          updated_at = NOW()
      WHERE user_id = NEW.receiver_id;
  END IF;

  -- ═══════════════════════════════════════════
  -- PART 2: Convert pending_session_invites
  -- ═══════════════════════════════════════════

  FOR v_pending_session IN
    SELECT psi.* FROM public.pending_session_invites psi
    JOIN public.pending_invites pi
      ON pi.inviter_id = psi.inviter_id AND pi.phone_e164 = psi.phone_e164
    WHERE pi.converted_user_id = NEW.receiver_id
      AND psi.inviter_id = NEW.sender_id
      AND psi.status = 'pending'
  LOOP
    INSERT INTO public.collaboration_invites (
      session_id, inviter_id, invited_user_id, status, invite_method
    ) VALUES (
      v_pending_session.session_id,
      v_pending_session.inviter_id,
      NEW.receiver_id,
      'pending',
      'friends_list'
    ) ON CONFLICT DO NOTHING;

    INSERT INTO public.session_participants (
      session_id, user_id, has_accepted, role
    ) VALUES (
      v_pending_session.session_id,
      NEW.receiver_id,
      false,
      'member'
    ) ON CONFLICT DO NOTHING;

    UPDATE public.pending_session_invites
      SET status = 'converted', updated_at = NOW()
      WHERE id = v_pending_session.id;
  END LOOP;

  FOR v_pending_session IN
    SELECT psi.* FROM public.pending_session_invites psi
    JOIN public.pending_invites pi
      ON pi.inviter_id = psi.inviter_id AND pi.phone_e164 = psi.phone_e164
    WHERE pi.converted_user_id = NEW.sender_id
      AND psi.inviter_id = NEW.receiver_id
      AND psi.status = 'pending'
  LOOP
    INSERT INTO public.collaboration_invites (
      session_id, inviter_id, invited_user_id, status, invite_method
    ) VALUES (
      v_pending_session.session_id,
      v_pending_session.inviter_id,
      NEW.sender_id,
      'pending',
      'friends_list'
    ) ON CONFLICT DO NOTHING;

    INSERT INTO public.session_participants (
      session_id, user_id, has_accepted, role
    ) VALUES (
      v_pending_session.session_id,
      NEW.sender_id,
      false,
      'member'
    ) ON CONFLICT DO NOTHING;

    UPDATE public.pending_session_invites
      SET status = 'converted', updated_at = NOW()
      WHERE id = v_pending_session.id;
  END LOOP;

  -- PART 3 (friend link intents) removed — tables dropped in prior migration.

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- Step 6: Drop the alias columns
-- ═══════════════════════════════════════════════════════════

-- Drop index on invited_by first
DROP INDEX IF EXISTS idx_collaboration_invites_invited_by;

-- Drop alias columns
ALTER TABLE public.collaboration_invites DROP COLUMN IF EXISTS invitee_id;
ALTER TABLE public.collaboration_invites DROP COLUMN IF EXISTS invited_by;
