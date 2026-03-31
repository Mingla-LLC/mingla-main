-- ============================================================
-- ORCH-0149: Trial Abuse Prevention
--
-- Prevents infinite free Elite via delete + re-signup.
-- Phone-hash table survives account deletion, checked at onboarding.
--
-- Changes:
--   1. Enable pgcrypto extension
--   2. Create used_trial_phones table (no RLS, service-role only)
--   3. Create phone_has_used_trial() helper
--   4. Create record_trial_phone() helper
--   5. Backfill existing trial users
--   6. Replace create_subscription_on_onboarding_complete() with phone check
-- ============================================================

-- 1. pgcrypto for SHA-256 hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Phone hash table — no FK, no RLS, survives CASCADE deletes
CREATE TABLE IF NOT EXISTS public.used_trial_phones (
  phone_hash     TEXT PRIMARY KEY,
  first_trial_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_trial_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  trial_count    INTEGER NOT NULL DEFAULT 1
);

-- No RLS — service-role only. Regular users cannot read or write.
-- The table has no FK to auth.users, so CASCADE deletes do not touch it.

COMMENT ON TABLE public.used_trial_phones IS
  'Phone hashes (SHA-256 of E.164) that have used a free trial. '
  'Survives account deletion to prevent trial abuse via re-signup. '
  'No RLS = service-role only access.';

-- 3. Check if a phone has used a trial
CREATE OR REPLACE FUNCTION public.phone_has_used_trial(p_phone TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF p_phone IS NULL OR p_phone = '' THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.used_trial_phones
    WHERE phone_hash = encode(digest(p_phone, 'sha256'), 'hex')
  );
END;
$$;

-- 4. Record a phone's trial usage
CREATE OR REPLACE FUNCTION public.record_trial_phone(p_phone TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_phone IS NULL OR p_phone = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.used_trial_phones (phone_hash, first_trial_at, last_trial_at, trial_count)
  VALUES (encode(digest(p_phone, 'sha256'), 'hex'), now(), now(), 1)
  ON CONFLICT (phone_hash) DO UPDATE
  SET last_trial_at = now(),
      trial_count = used_trial_phones.trial_count + 1;
END;
$$;

-- 5. Backfill: hash phones of all users who have had a trial
INSERT INTO public.used_trial_phones (phone_hash, first_trial_at, last_trial_at, trial_count)
SELECT
  encode(digest(p.phone, 'sha256'), 'hex'),
  COALESCE(s.created_at, now()),
  COALESCE(s.created_at, now()),
  1
FROM public.profiles p
INNER JOIN public.subscriptions s ON s.user_id = p.id
WHERE p.phone IS NOT NULL
  AND (s.trial_ends_at IS NOT NULL OR s.created_at IS NOT NULL)
ON CONFLICT (phone_hash) DO NOTHING;

-- 6. Replace onboarding completion trigger — add phone hash check
CREATE OR REPLACE FUNCTION public.create_subscription_on_onboarding_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone TEXT;
  v_has_used_trial BOOLEAN;
BEGIN
  IF NEW.has_completed_onboarding = true
     AND (OLD.has_completed_onboarding IS NULL OR OLD.has_completed_onboarding = false) THEN

    -- Read the verified phone from the profile (set during onboarding Step 1c)
    v_phone := NEW.phone;
    v_has_used_trial := phone_has_used_trial(v_phone);

    IF v_has_used_trial THEN
      -- Repeat user: expire trial immediately (trial_ends_at = NOW() means "no trial")
      UPDATE public.subscriptions
      SET trial_ends_at = NOW(),
          updated_at = NOW()
      WHERE user_id = NEW.id
        AND trial_ends_at IS NULL;
    ELSE
      -- First-time user: grant the 7-day Elite trial
      UPDATE public.subscriptions
      SET trial_ends_at = NOW() + INTERVAL '7 days',
          updated_at = NOW()
      WHERE user_id = NEW.id
        AND trial_ends_at IS NULL;
    END IF;

    -- Safety net: if no subscription row exists, create one.
    -- Must run BEFORE record_trial_phone — PERFORM clobbers FOUND.
    IF NOT FOUND THEN
      INSERT INTO public.subscriptions (user_id, tier, trial_ends_at)
      VALUES (NEW.id, 'free',
              CASE WHEN v_has_used_trial THEN NOW()
                   ELSE NOW() + INTERVAL '7 days' END)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;

    -- Record phone hash for first-time users (after FOUND check)
    IF NOT v_has_used_trial THEN
      PERFORM record_trial_phone(v_phone);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
