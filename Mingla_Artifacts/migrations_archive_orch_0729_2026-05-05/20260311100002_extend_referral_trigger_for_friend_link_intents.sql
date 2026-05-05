-- Migration: 20260311100002_extend_referral_trigger_for_friend_link_intents.sql
-- Description: Extends credit_referral_on_friend_accepted to also convert
-- pending_friend_link_intents when a friend request is accepted.

CREATE OR REPLACE FUNCTION public.credit_referral_on_friend_accepted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_referral referral_credits%ROWTYPE;
  v_referral_reverse referral_credits%ROWTYPE;
  v_pending_session pending_session_invites%ROWTYPE;
  v_pending_fl_intent pending_friend_link_intents%ROWTYPE;
  v_new_link_id UUID;
BEGIN
  -- Only fire on pending → accepted transition
  IF NEW.status != 'accepted' OR OLD.status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- ═══════════════════════════════════════════
  -- PART 1: Credit referrals (existing logic)
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
  -- PART 2: Convert pending_session_invites (existing logic)
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
      session_id, inviter_id, invited_user_id, invited_by, status, invite_method
    ) VALUES (
      v_pending_session.session_id,
      v_pending_session.inviter_id,
      NEW.receiver_id,
      v_pending_session.inviter_id,
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
      session_id, inviter_id, invited_user_id, invited_by, status, invite_method
    ) VALUES (
      v_pending_session.session_id,
      v_pending_session.inviter_id,
      NEW.sender_id,
      v_pending_session.inviter_id,
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

  -- ═══════════════════════════════════════════
  -- PART 3: Convert pending_friend_link_intents (NEW)
  -- ═══════════════════════════════════════════

  FOR v_pending_fl_intent IN
    SELECT pfli.* FROM public.pending_friend_link_intents pfli
    JOIN public.pending_invites pi
      ON pi.inviter_id = pfli.inviter_id AND pi.phone_e164 = pfli.phone_e164
    WHERE pi.converted_user_id = NEW.receiver_id
      AND pfli.inviter_id = NEW.sender_id
      AND pfli.status = 'pending'
  LOOP
    INSERT INTO public.friend_links (
      requester_id, target_id, status, requester_person_id
    ) VALUES (
      v_pending_fl_intent.inviter_id,
      NEW.receiver_id,
      'pending',
      v_pending_fl_intent.person_id
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_new_link_id;

    IF v_new_link_id IS NOT NULL THEN
      UPDATE public.pending_friend_link_intents
        SET status = 'converted',
            converted_link_id = v_new_link_id,
            converted_at = NOW(),
            updated_at = NOW()
        WHERE id = v_pending_fl_intent.id;
    END IF;
  END LOOP;

  FOR v_pending_fl_intent IN
    SELECT pfli.* FROM public.pending_friend_link_intents pfli
    JOIN public.pending_invites pi
      ON pi.inviter_id = pfli.inviter_id AND pi.phone_e164 = pfli.phone_e164
    WHERE pi.converted_user_id = NEW.sender_id
      AND pfli.inviter_id = NEW.receiver_id
      AND pfli.status = 'pending'
  LOOP
    INSERT INTO public.friend_links (
      requester_id, target_id, status, requester_person_id
    ) VALUES (
      v_pending_fl_intent.inviter_id,
      NEW.sender_id,
      'pending',
      v_pending_fl_intent.person_id
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_new_link_id;

    IF v_new_link_id IS NOT NULL THEN
      UPDATE public.pending_friend_link_intents
        SET status = 'converted',
            converted_link_id = v_new_link_id,
            converted_at = NOW(),
            updated_at = NOW()
        WHERE id = v_pending_fl_intent.id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
