-- Migration: phone_conversion_set_pending_friendship
-- Description: When a non-Mingla user signs up and their phone matches a
-- pending_session_invite, the conversion trigger creates a collaboration_invite.
-- Under the new model, this invite must be hidden (pending_friendship = true)
-- until the friend request is accepted.
--
-- This is a minimal patch to the existing convert_pending_invites_on_phone_verified
-- function from migration 20260312400003. Only the collaboration_invites INSERT
-- is changed — all other logic is preserved exactly.

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

  -- PART 1: Convert pending friend invites (UNCHANGED)
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

  -- PART 2: Convert pending SESSION invites — CHANGED: pending_friendship = true
  FOR session_pending IN
    SELECT * FROM public.pending_session_invites
    WHERE phone_e164 = NEW.phone
      AND status = 'pending'
      AND inviter_id != NEW.id
  LOOP
    INSERT INTO public.collaboration_invites (
      session_id, inviter_id, invited_user_id, status, pending_friendship
    )
    VALUES (
      session_pending.session_id,
      session_pending.inviter_id,
      NEW.id,
      'pending',
      true  -- HIDDEN until friend request accepted
    )
    ON CONFLICT (session_id, invited_user_id)
      WHERE status IN ('pending', 'accepted')
    DO NOTHING
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
