-- Migration: 20260309000001_subscriptions.sql
-- Description: Tracks user subscription tier, trial period, and referral bonus months.
-- Also adds referral_code to profiles and auto-generates it.

-- ============================================================
-- 1. SUBSCRIPTIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'elite')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  referral_bonus_months INTEGER NOT NULL DEFAULT 0,
  referral_bonus_used_months INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id ON public.subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own subscription" ON public.subscriptions;
CREATE POLICY "Users can read their own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own subscription" ON public.subscriptions;
CREATE POLICY "Users can update their own subscription"
  ON public.subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can insert subscriptions" ON public.subscriptions;
CREATE POLICY "Service role can insert subscriptions"
  ON public.subscriptions FOR INSERT
  WITH CHECK (true);

DROP TRIGGER IF EXISTS set_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. GET EFFECTIVE TIER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_effective_tier(p_user_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  sub RECORD;
BEGIN
  SELECT * INTO sub FROM public.subscriptions WHERE user_id = p_user_id;

  IF sub IS NULL THEN
    RETURN 'free';
  END IF;

  -- Active paid subscription
  IF sub.tier != 'free' AND sub.is_active = true AND sub.current_period_end > NOW() THEN
    RETURN sub.tier;
  END IF;

  -- Active trial
  IF sub.trial_ends_at IS NOT NULL AND sub.trial_ends_at > NOW() THEN
    RETURN 'elite';
  END IF;

  -- Unused referral bonus months
  IF sub.referral_bonus_months > sub.referral_bonus_used_months THEN
    RETURN 'elite';
  END IF;

  RETURN 'free';
END;
$$;

-- ============================================================
-- 3. AUTO-CREATE SUBSCRIPTION ON ONBOARDING COMPLETE
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_subscription_on_onboarding_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.has_completed_onboarding = true AND (OLD.has_completed_onboarding IS NULL OR OLD.has_completed_onboarding = false) THEN
    INSERT INTO public.subscriptions (user_id, tier, trial_ends_at)
    VALUES (NEW.id, 'free', NOW() + INTERVAL '7 days')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_subscription_on_onboarding ON public.profiles;
CREATE TRIGGER trg_create_subscription_on_onboarding
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_subscription_on_onboarding_complete();

-- ============================================================
-- 4. ADD REFERRAL_CODE TO PROFILES
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

UPDATE public.profiles
SET referral_code = 'MGL-' || UPPER(SUBSTR(MD5(id::text || created_at::text), 1, 8))
WHERE referral_code IS NULL;

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := 'MGL-' || UPPER(SUBSTR(MD5(NEW.id::text || NOW()::text), 1, 8));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_referral_code ON public.profiles;
CREATE TRIGGER trg_generate_referral_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_referral_code();

CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON public.profiles(referral_code)
  WHERE referral_code IS NOT NULL;
