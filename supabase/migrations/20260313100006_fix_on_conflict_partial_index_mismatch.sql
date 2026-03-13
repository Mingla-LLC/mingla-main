-- Migration: fix_on_conflict_partial_index_mismatch
-- Description: Fixes ON CONFLICT clauses in two trigger functions that reference a
-- partial unique index (session_id, invited_user_id) WHERE status IN ('pending','accepted')
-- which does NOT exist. The table only has a full unique constraint:
--   collaboration_invites_session_invited_user_unique UNIQUE (session_id, invited_user_id)
--
-- PostgreSQL refuses to match a partial ON CONFLICT spec against a full constraint,
-- raising SQLSTATE 42P10. This crashes the trigger, rolling back the entire transaction.
--
-- Affected flows:
--   1. OTP phone verification during onboarding (convert_pending_invites_on_phone_verified)
--      → "Phone verified but save failed. Contact support."
--   2. Friend request acceptance (credit_referral_on_friend_accepted)
--      → would crash when accepting a friend who had pending session invites
--
-- Fix: Replace partial ON CONFLICT specs with the full constraint reference.
-- For DO UPDATE cases, move the status filter into a WHERE on the UPDATE clause
-- to preserve the original intent (only update pending/accepted rows).

-- ═══════════════════════════════════════════════════════════
-- FIX 1: convert_pending_invites_on_phone_verified
-- Broken in: 20260313000004_phone_conversion_set_pending_friendship.sql
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

  -- PART 2: Convert pending SESSION invites — pending_friendship = true
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
    ON CONFLICT (session_id, invited_user_id) DO NOTHING  -- FIX: removed partial WHERE clause
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

-- ═══════════════════════════════════════════════════════════
-- FIX 2: credit_referral_on_friend_accepted
-- Broken in: 20260313000003_reveal_invites_on_friend_accepted.sql
-- ═══════════════════════════════════════════════════════════

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
  -- PART 1.5: Reveal hidden collaboration invites (UNCHANGED)
  -- ═══════════════════════════════════════════
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
      session_id, inviter_id, invited_user_id, status, pending_friendship, invite_method
    ) VALUES (
      v_pending_session.session_id,
      v_pending_session.inviter_id,
      NEW.receiver_id,
      'pending',
      false,  -- friendship just accepted, invite is immediately visible
      'friends_list'
    )
    ON CONFLICT (session_id, invited_user_id)                          -- FIX: removed partial WHERE clause
    DO UPDATE SET pending_friendship = false, updated_at = NOW()
    WHERE collaboration_invites.status IN ('pending', 'accepted');     -- FIX: status filter moved here

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
    ON CONFLICT (session_id, invited_user_id)                          -- FIX: removed partial WHERE clause
    DO UPDATE SET pending_friendship = false, updated_at = NOW()
    WHERE collaboration_invites.status IN ('pending', 'accepted');     -- FIX: status filter moved here

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
