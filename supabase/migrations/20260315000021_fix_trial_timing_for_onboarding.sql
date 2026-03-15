-- ============================================================
-- Fix: Create subscription row at signup (profile INSERT),
-- not at onboarding completion. This ensures users have Elite
-- access during onboarding (e.g. pairing at Step 5).
--
-- Strategy:
--   1. On profile INSERT → create subscription with trial_ends_at = NULL
--      (NULL means "trial not started yet, user is still onboarding")
--   2. get_effective_tier treats NULL trial_ends_at + not-yet-onboarded as 'elite'
--   3. On onboarding completion → stamp trial_ends_at = NOW() + 7 days
--      (the 7-day clock starts AFTER onboarding, not at signup)
-- ============================================================

-- 1. New trigger: create subscription row on profile creation (signup)
CREATE OR REPLACE FUNCTION public.create_subscription_on_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, tier, trial_ends_at)
  VALUES (NEW.id, 'free', NULL)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_subscription_on_signup ON public.profiles;
CREATE TRIGGER trg_create_subscription_on_signup
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_subscription_on_signup();

-- 2. Update onboarding-completion trigger: stamp trial_ends_at instead of inserting
CREATE OR REPLACE FUNCTION public.create_subscription_on_onboarding_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.has_completed_onboarding = true
     AND (OLD.has_completed_onboarding IS NULL OR OLD.has_completed_onboarding = false) THEN
    -- Row should already exist from signup trigger; stamp the 7-day trial start
    UPDATE public.subscriptions
    SET trial_ends_at = NOW() + INTERVAL '7 days',
        updated_at = NOW()
    WHERE user_id = NEW.id
      AND trial_ends_at IS NULL;

    -- Safety net: if row somehow doesn't exist, create it
    IF NOT FOUND THEN
      INSERT INTO public.subscriptions (user_id, tier, trial_ends_at)
      VALUES (NEW.id, 'free', NOW() + INTERVAL '7 days')
      ON CONFLICT (user_id) DO UPDATE
      SET trial_ends_at = EXCLUDED.trial_ends_at,
          updated_at = NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger already exists, function is replaced in-place (no need to recreate trigger)

-- 3. Update get_effective_tier: treat NULL trial_ends_at as "onboarding elite"
CREATE OR REPLACE FUNCTION public.get_effective_tier(p_user_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  sub RECORD;
  v_onboarded BOOLEAN;
BEGIN
  SELECT * INTO sub FROM public.subscriptions WHERE user_id = p_user_id;

  IF sub IS NULL THEN
    RETURN 'free';
  END IF;

  -- Active paid subscription
  IF sub.tier != 'free' AND sub.is_active = true AND sub.current_period_end > NOW() THEN
    RETURN sub.tier;
  END IF;

  -- Active trial (7-day clock is ticking)
  IF sub.trial_ends_at IS NOT NULL AND sub.trial_ends_at > NOW() THEN
    RETURN 'elite';
  END IF;

  -- Onboarding trial: subscription exists but trial not yet started
  -- User is still in onboarding → grant Elite access
  IF sub.trial_ends_at IS NULL THEN
    SELECT has_completed_onboarding INTO v_onboarded
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_onboarded IS NULL OR v_onboarded = false THEN
      RETURN 'elite';
    END IF;
  END IF;

  -- Unused referral bonus months
  IF sub.referral_bonus_months > sub.referral_bonus_used_months THEN
    RETURN 'elite';
  END IF;

  RETURN 'free';
END;
$$;

-- 4. Backfill: create subscription rows for any existing users who signed up
--    but don't have a subscription row yet (edge case for users mid-onboarding)
--    Join auth.users to skip orphaned profiles that would violate the FK constraint.
INSERT INTO public.subscriptions (user_id, tier, trial_ends_at)
SELECT p.id, 'free', NULL
FROM public.profiles p
INNER JOIN auth.users u ON u.id = p.id
LEFT JOIN public.subscriptions s ON s.user_id = p.id
WHERE s.id IS NULL
  AND (p.has_completed_onboarding IS NULL OR p.has_completed_onboarding = false)
ON CONFLICT (user_id) DO NOTHING;
