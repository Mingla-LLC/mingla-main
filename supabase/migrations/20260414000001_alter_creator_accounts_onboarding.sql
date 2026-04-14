-- Add onboarding fields to creator_accounts.
-- All new columns are nullable or have defaults to avoid breaking existing rows.

ALTER TABLE public.creator_accounts
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS phone text UNIQUE,
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS intent text CHECK (intent IN ('place', 'events', 'both')),
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_creator_accounts_phone
  ON public.creator_accounts (phone) WHERE phone IS NOT NULL;

COMMENT ON COLUMN public.creator_accounts.phone IS 'E.164 format. Unique across all business accounts.';
COMMENT ON COLUMN public.creator_accounts.onboarding_step IS '0=language, 1=name, 2=phone, 3=intent, 4=done';
