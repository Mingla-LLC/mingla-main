-- Migration: remove_friend_link_feature
-- Description: Fully removes all friend link / link consent database artifacts.
-- Tables, columns, indexes, RLS policies, functions, and trigger references — everything goes.

-- 1. Remove linking columns from saved_people (must drop FK and index first)
ALTER TABLE public.saved_people DROP CONSTRAINT IF EXISTS saved_people_link_id_fkey;
DROP INDEX IF EXISTS idx_saved_people_linked_user;
DROP INDEX IF EXISTS idx_saved_people_linked_user_unique;

ALTER TABLE public.saved_people
  DROP COLUMN IF EXISTS linked_user_id,
  DROP COLUMN IF EXISTS link_id,
  DROP COLUMN IF EXISTS is_linked;

-- 2. Drop the RPC used by link consent (correct signature: UUID, TEXT — not UUID, TEXT, BOOLEAN)
DROP FUNCTION IF EXISTS public.set_link_consent_and_return(UUID, TEXT);

-- 3. Recreate credit_referral_on_friend_accepted WITHOUT PART 3 (friend link intents).
-- PART 3 references pending_friend_link_intents and friend_links tables which are being dropped.
-- Without this recreation, every friend request acceptance would crash.
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

  -- PART 3 (friend link intents) removed — tables dropped below.

  RETURN NEW;
END;
$$;

-- 4. Drop pending_friend_link_intents table (CASCADE drops its RLS policies and indexes)
DROP TABLE IF EXISTS public.pending_friend_link_intents CASCADE;

-- 5. Drop friend_links table (CASCADE drops its RLS policies, indexes, and any remaining FKs)
DROP TABLE IF EXISTS public.friend_links CASCADE;
