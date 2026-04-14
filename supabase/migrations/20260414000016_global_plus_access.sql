-- ============================================================
-- ORCH-0410: Global Plus Access
--
-- Makes ALL users Mingla Plus members by adding a global override
-- flag to app_config and checking it in get_effective_tier().
--
-- Revert: UPDATE app_config SET config_value = 'false' WHERE config_key = 'global_plus_access';
-- ============================================================

-- ─── Step 1: Insert global Plus flag ────────────────────────────────────────

INSERT INTO public.app_config (config_key, config_value, value_type, description)
VALUES (
  'global_plus_access',
  'true',
  'boolean',
  'When true, get_effective_tier() returns mingla_plus for ALL users regardless of subscription state. Pre-launch promotional access. Set to false when monetization begins.'
)
ON CONFLICT (config_key) DO UPDATE
SET config_value = 'true', updated_at = now();

-- ─── Step 2: Replace get_effective_tier() with global flag check ────────────
-- Adds Priority -1 (global promotional access) above all existing logic.
-- All existing logic (admin override, paid sub, trial, referral) is preserved
-- verbatim from the authoritative version in 20260411000001_price_tier_restructure.sql.

CREATE OR REPLACE FUNCTION get_effective_tier(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_sub RECORD;
  v_override_tier TEXT;
  v_global_plus TEXT;
BEGIN
  -- Priority -1: Global promotional access (pre-launch)
  -- When enabled, ALL users get mingla_plus regardless of subscription state.
  -- Toggle via app_config: SET config_value = 'false' to disable.
  SELECT config_value INTO v_global_plus
  FROM app_config
  WHERE config_key = 'global_plus_access';

  IF v_global_plus = 'true' THEN
    RETURN 'mingla_plus';
  END IF;

  -- Priority 0: Active admin override (highest priority after global)
  SELECT tier INTO v_override_tier
  FROM admin_subscription_overrides
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND starts_at <= now()
    AND expires_at > now()
  ORDER BY
    CASE tier WHEN 'mingla_plus' THEN 2 ELSE 1 END DESC
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
  IF v_sub.tier = 'mingla_plus'
     AND v_sub.is_active = true
     AND v_sub.current_period_end > now() THEN
    RETURN 'mingla_plus';
  END IF;

  -- Backward compat: active trial (existing users only — no new trials granted)
  IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at > now() THEN
    RETURN 'mingla_plus';
  END IF;

  -- Referral bonus (date-based expiry, 30 days per referral from start date)
  IF v_sub.referral_bonus_months > 0
     AND v_sub.referral_bonus_started_at IS NOT NULL
     AND v_sub.referral_bonus_started_at
         + (v_sub.referral_bonus_months * INTERVAL '30 days') > now() THEN
    RETURN 'mingla_plus';
  END IF;

  RETURN 'free';
END;
$$;
