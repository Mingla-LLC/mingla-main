-- Migration: reveal_invites_on_friend_accepted
-- Description: When a friend request is accepted, reveal any hidden collaboration
-- invites between the two users (set pending_friendship = false).
-- This makes the session invite visible to the invitee.
--
-- The existing credit_referral_on_friend_accepted function already fires on
-- friend_requests UPDATE (pending → accepted). We extend it to also reveal
-- hidden collaboration invites.
--
-- PRESERVED: All existing referral crediting + subscription bonus logic
-- PRESERVED: All existing pending_session_invites conversion logic
-- ADDED: UPDATE collaboration_invites SET pending_friendship = false
-- CHANGED: ON CONFLICT clause now uses partial unique index for safety

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
  -- PART 1: Credit referrals (UNCHANGED)
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
  -- PART 1.5: Reveal hidden collaboration invites (NEW)
  -- ═══════════════════════════════════════════
  -- These invites were created with pending_friendship = true when the
  -- session was created with a non-friend. Now that friendship is accepted,
  -- make them visible to the invitee.
  UPDATE public.collaboration_invites
  SET pending_friendship = false, updated_at = NOW()
  WHERE pending_friendship = true
  AND status = 'pending'
  AND (
    (inviter_id = NEW.sender_id AND invited_user_id = NEW.receiver_id)
    OR
    (inviter_id = NEW.receiver_id AND invited_user_id = NEW.sender_id)
  );

  -- ═══════════════════════════════════════════
  -- PART 2: Convert pending_session_invites (PRESERVED + UPDATED ON CONFLICT)
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
      session_id, inviter_id, invited_user_id, status, pending_friendship, invite_method
    ) VALUES (
      v_pending_session.session_id,
      v_pending_session.inviter_id,
      NEW.receiver_id,
      'pending',
      false,  -- friendship just accepted, invite is immediately visible
      'friends_list'
    )
    ON CONFLICT (session_id, invited_user_id)
      WHERE status IN ('pending', 'accepted')
    DO UPDATE SET pending_friendship = false, updated_at = NOW();

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
      session_id, inviter_id, invited_user_id, status, pending_friendship, invite_method
    ) VALUES (
      v_pending_session.session_id,
      v_pending_session.inviter_id,
      NEW.sender_id,
      'pending',
      false,
      'friends_list'
    )
    ON CONFLICT (session_id, invited_user_id)
      WHERE status IN ('pending', 'accepted')
    DO UPDATE SET pending_friendship = false, updated_at = NOW();

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

  RETURN NEW;
END;
$$;
