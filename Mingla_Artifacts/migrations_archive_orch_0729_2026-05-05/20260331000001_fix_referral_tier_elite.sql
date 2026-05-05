-- Fix: get_effective_tier() returns 'pro' for referral bonus users.
-- Product intent (and client-side logic + notification copy) is 'elite'.
-- This migration changes the referral-bonus branch from 'pro' → 'elite'.
-- No other logic is changed.

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

  -- Priority 1+: existing logic
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

  -- Referral bonus → elite (matches client logic + notification copy)
  IF v_sub.referral_bonus_months > v_sub.referral_bonus_used_months THEN
    RETURN 'elite';
  END IF;

  RETURN 'free';
END;
$$;
