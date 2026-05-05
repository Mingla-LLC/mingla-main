-- Migration: rewrite_friend_decline_cascade
-- Description: Rewrites cascade_friend_decline_to_collabs() to implement the correct
-- cascade model: friend decline → cancel invites → remove participants → delete empty sessions.
--
-- KEPT: pending_invites cancellation, referral_credits expiration
-- CHANGED: collaboration_invites are cancelled (previously also did this, now also checks
--          if sessions should be deleted when empty)
-- ADDED: session deletion when no participants remain besides creator

CREATE OR REPLACE FUNCTION public.cascade_friend_decline_to_collabs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  affected_session RECORD;
  remaining_count INTEGER;
BEGIN
  IF NEW.status = 'declined' AND OLD.status = 'pending' THEN

    -- ── 1. Cancel collaboration invites (both directions) ──
    -- When a friend request is declined, any session invites between these
    -- two users are invalid — friendship is a prerequisite for collaboration.
    UPDATE public.collaboration_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.sender_id
    AND invited_user_id = NEW.receiver_id
    AND status = 'pending';

    UPDATE public.collaboration_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.receiver_id
    AND invited_user_id = NEW.sender_id
    AND status = 'pending';

    -- ── 2. Delete session_participants for cancelled invites (both directions) ──
    DELETE FROM public.session_participants
    WHERE user_id = NEW.receiver_id
    AND session_id IN (
      SELECT session_id FROM public.collaboration_invites
      WHERE inviter_id = NEW.sender_id AND invited_user_id = NEW.receiver_id
    );

    DELETE FROM public.session_participants
    WHERE user_id = NEW.sender_id
    AND session_id IN (
      SELECT session_id FROM public.collaboration_invites
      WHERE inviter_id = NEW.receiver_id AND invited_user_id = NEW.sender_id
    );

    -- ── 3. Delete empty sessions ──
    -- For each session affected by the cancelled invites, check if any
    -- participants remain besides the creator. If not, delete the session.
    -- A session with only its creator has no purpose.
    FOR affected_session IN
      SELECT DISTINCT cs.id AS session_id, cs.created_by
      FROM public.collaboration_sessions cs
      WHERE cs.id IN (
        SELECT session_id FROM public.collaboration_invites
        WHERE (inviter_id = NEW.sender_id AND invited_user_id = NEW.receiver_id)
           OR (inviter_id = NEW.receiver_id AND invited_user_id = NEW.sender_id)
      )
      AND cs.status IN ('pending', 'active')
    LOOP
      -- Count participants OTHER than the creator
      SELECT COUNT(*) INTO remaining_count
      FROM public.session_participants sp
      WHERE sp.session_id = affected_session.session_id
      AND sp.user_id != affected_session.created_by;

      IF remaining_count = 0 THEN
        -- No one left — delete the session entirely
        DELETE FROM public.collaboration_sessions
        WHERE id = affected_session.session_id;
      END IF;
    END LOOP;

    -- ── 4. Cancel pending phone invites (friend-specific) ──
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

    -- ── 5. Expire referral credits ──
    UPDATE public.referral_credits
    SET status = 'expired'
    WHERE ((referrer_id = NEW.sender_id AND referred_id = NEW.receiver_id)
       OR  (referrer_id = NEW.receiver_id AND referred_id = NEW.sender_id))
    AND status = 'pending';

  END IF;
  RETURN NEW;
END;
$$;
