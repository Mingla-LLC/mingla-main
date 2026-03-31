-- ============================================================
-- ORCH-0144: Referral Bonus Expiry (date-based, 30 days per referral)
--
-- Changes:
--   1. Add referral_bonus_started_at column to subscriptions
--   2. Backfill from earliest credited referral_credits.credited_at
--   3. Replace credit_referral_on_friend_accepted() — add started_at logic
--   4. Replace get_effective_tier() — date-based referral check (supersedes 000001)
--   5. Deprecate referral_bonus_used_months with COMMENT
-- ============================================================

-- 1. New column
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS referral_bonus_started_at TIMESTAMPTZ;

-- 2. Backfill: set started_at to earliest credited referral date
UPDATE public.subscriptions s
SET referral_bonus_started_at = sub.earliest
FROM (
  SELECT rc.referrer_id, MIN(rc.credited_at) AS earliest
  FROM public.referral_credits rc
  WHERE rc.status = 'credited'
  GROUP BY rc.referrer_id
) sub
WHERE s.user_id = sub.referrer_id
  AND s.referral_bonus_months > 0
  AND s.referral_bonus_started_at IS NULL;

-- 3. Replace trigger: add referral_bonus_started_at logic to both directions
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
      SET referral_bonus_months = referral_bonus_months + 1,
          -- Start the clock on first referral, or restart if previous bonus fully expired
          referral_bonus_started_at = CASE
            WHEN referral_bonus_started_at IS NULL THEN NOW()
            WHEN referral_bonus_started_at + (referral_bonus_months * INTERVAL '30 days') <= NOW()
              THEN NOW()
            ELSE referral_bonus_started_at
          END,
          updated_at = NOW()
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
      SET referral_bonus_months = referral_bonus_months + 1,
          -- Start the clock on first referral, or restart if previous bonus fully expired
          referral_bonus_started_at = CASE
            WHEN referral_bonus_started_at IS NULL THEN NOW()
            WHEN referral_bonus_started_at + (referral_bonus_months * INTERVAL '30 days') <= NOW()
              THEN NOW()
            ELSE referral_bonus_started_at
          END,
          updated_at = NOW()
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

-- 4. Replace get_effective_tier() — date-based referral, supersedes 000001
-- Includes: admin override (Priority 0), paid sub, onboarding trial,
-- active trial, date-based referral expiry → 'elite'
CREATE OR REPLACE FUNCTION get_effective_tier(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_sub RECORD;
  v_override_tier TEXT;
  v_has_completed_onboarding BOOLEAN;
BEGIN
  -- Priority 0: Active admin override (highest priority)
  SELECT tier INTO v_override_tier
  FROM admin_subscription_overrides
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND starts_at <= now()
    AND expires_at > now()
  ORDER BY
    CASE tier WHEN 'elite' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC
  LIMIT 1;

  IF v_override_tier IS NOT NULL THEN
    RETURN v_override_tier;
  END IF;

  -- Priority 1+: subscription-based logic
  SELECT * INTO v_sub
  FROM subscriptions
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'free';
  END IF;

  -- Active paid subscription
  IF v_sub.tier IN ('pro', 'elite')
     AND v_sub.is_active = true
     AND v_sub.current_period_end > now() THEN
    RETURN v_sub.tier;
  END IF;

  -- Trial (during onboarding: trial_ends_at is NULL, user is not onboarded = elite)
  SELECT has_completed_onboarding INTO v_has_completed_onboarding
  FROM profiles
  WHERE id = p_user_id;

  IF v_sub.trial_ends_at IS NULL AND v_has_completed_onboarding IS NOT TRUE THEN
    RETURN 'elite';  -- onboarding trial
  END IF;

  IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at > now() THEN
    RETURN 'elite';  -- active post-onboarding trial
  END IF;

  -- Referral bonus (date-based expiry, 30 days per referral from start date)
  IF v_sub.referral_bonus_months > 0
     AND v_sub.referral_bonus_started_at IS NOT NULL
     AND v_sub.referral_bonus_started_at
         + (v_sub.referral_bonus_months * INTERVAL '30 days') > now() THEN
    RETURN 'elite';
  END IF;

  RETURN 'free';
END;
$$;

-- 5. Deprecate referral_bonus_used_months
COMMENT ON COLUMN public.subscriptions.referral_bonus_used_months IS
  'DEPRECATED — replaced by date-based expiry via referral_bonus_started_at. Safe to drop after rollout confirmed.';
