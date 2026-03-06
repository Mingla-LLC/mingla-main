-- Migration: 20260309000004_friend_decline_cascade.sql
-- Description: When a friend request is declined, cancel all pending collaboration invites
-- between the two users (in both directions) and remove session_participants rows.

CREATE OR REPLACE FUNCTION public.cascade_friend_decline_to_collabs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'declined' AND OLD.status = 'pending' THEN
    -- Cancel collaboration invites where sender invited receiver
    UPDATE public.collaboration_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.sender_id AND invitee_id = NEW.receiver_id AND status = 'pending';

    DELETE FROM public.session_participants
    WHERE user_id = NEW.receiver_id
    AND session_id IN (
      SELECT session_id FROM public.collaboration_invites
      WHERE inviter_id = NEW.sender_id AND invitee_id = NEW.receiver_id
    );

    -- Cancel collaboration invites where receiver invited sender
    UPDATE public.collaboration_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.receiver_id AND invitee_id = NEW.sender_id AND status = 'pending';

    DELETE FROM public.session_participants
    WHERE user_id = NEW.sender_id
    AND session_id IN (
      SELECT session_id FROM public.collaboration_invites
      WHERE inviter_id = NEW.receiver_id AND invitee_id = NEW.sender_id
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

DROP TRIGGER IF EXISTS trg_cascade_friend_decline ON public.friend_requests;
CREATE TRIGGER trg_cascade_friend_decline
  AFTER UPDATE ON public.friend_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_friend_decline_to_collabs();
