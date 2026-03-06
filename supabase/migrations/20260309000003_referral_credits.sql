-- Migration: 20260309000003_referral_credits.sql
-- Description: Audit log of each referral credit earned. One row per qualifying referral.
-- Also includes trigger to credit referrer when friend request is accepted.

-- ============================================================
-- 1. REFERRAL_CREDITS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.referral_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pending_invite_id UUID REFERENCES public.pending_invites(id) ON DELETE SET NULL,
  friend_request_id UUID REFERENCES public.friend_requests(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'expired')),
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(referrer_id, referred_id)
);

ALTER TABLE public.referral_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own referral credits" ON public.referral_credits;
CREATE POLICY "Users can read their own referral credits"
  ON public.referral_credits FOR SELECT
  USING (auth.uid() = referrer_id);

-- ============================================================
-- 2. CREDIT REFERRAL ON FRIEND REQUEST ACCEPTED
-- ============================================================

CREATE OR REPLACE FUNCTION public.credit_referral_on_friend_accepted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  credit RECORD;
  pending_session RECORD;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    -- Check for pending referral credit (sender referred receiver)
    SELECT * INTO credit FROM public.referral_credits
    WHERE referrer_id = NEW.sender_id AND referred_id = NEW.receiver_id AND status = 'pending';

    IF credit IS NOT NULL THEN
      UPDATE public.referral_credits
      SET status = 'credited', credited_at = NOW(), friend_request_id = NEW.id
      WHERE id = credit.id;

      UPDATE public.subscriptions
      SET referral_bonus_months = referral_bonus_months + 1, updated_at = NOW()
      WHERE user_id = credit.referrer_id;
    END IF;

    -- Also check reverse direction (receiver referred sender)
    SELECT * INTO credit FROM public.referral_credits
    WHERE referrer_id = NEW.receiver_id AND referred_id = NEW.sender_id AND status = 'pending';

    IF credit IS NOT NULL THEN
      UPDATE public.referral_credits
      SET status = 'credited', credited_at = NOW(), friend_request_id = NEW.id
      WHERE id = credit.id;

      UPDATE public.subscriptions
      SET referral_bonus_months = referral_bonus_months + 1, updated_at = NOW()
      WHERE user_id = credit.referrer_id;
    END IF;

    -- Convert pending_session_invites for the newly friended pair
    -- Direction 1: sender invited receiver's phone
    FOR pending_session IN
      SELECT psi.* FROM public.pending_session_invites psi
      JOIN public.pending_invites pi ON pi.inviter_id = psi.inviter_id AND pi.phone_e164 = psi.phone_e164
      WHERE psi.inviter_id = NEW.sender_id
        AND pi.converted_user_id = NEW.receiver_id
        AND psi.status = 'pending'
    LOOP
      INSERT INTO public.collaboration_invites (session_id, inviter_id, invitee_id, status, invite_method)
      VALUES (pending_session.session_id, pending_session.inviter_id, NEW.receiver_id, 'pending', 'friends_list')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.session_participants (session_id, user_id, has_accepted)
      VALUES (pending_session.session_id, NEW.receiver_id, false)
      ON CONFLICT (session_id, user_id) DO NOTHING;

      UPDATE public.pending_session_invites
      SET status = 'converted', updated_at = NOW()
      WHERE id = pending_session.id;
    END LOOP;

    -- Direction 2: receiver invited sender's phone
    FOR pending_session IN
      SELECT psi.* FROM public.pending_session_invites psi
      JOIN public.pending_invites pi ON pi.inviter_id = psi.inviter_id AND pi.phone_e164 = psi.phone_e164
      WHERE psi.inviter_id = NEW.receiver_id
        AND pi.converted_user_id = NEW.sender_id
        AND psi.status = 'pending'
    LOOP
      INSERT INTO public.collaboration_invites (session_id, inviter_id, invitee_id, status, invite_method)
      VALUES (pending_session.session_id, pending_session.inviter_id, NEW.sender_id, 'pending', 'friends_list')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.session_participants (session_id, user_id, has_accepted)
      VALUES (pending_session.session_id, NEW.sender_id, false)
      ON CONFLICT (session_id, user_id) DO NOTHING;

      UPDATE public.pending_session_invites
      SET status = 'converted', updated_at = NOW()
      WHERE id = pending_session.id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_referral_on_friend_accepted ON public.friend_requests;
CREATE TRIGGER trg_credit_referral_on_friend_accepted
  AFTER UPDATE ON public.friend_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_referral_on_friend_accepted();
