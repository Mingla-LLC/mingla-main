-- Migration: 20260311100003_add_updated_at_to_referral_credits.sql
-- Already applied remotely. The column addition is also covered by
-- 20260311100004 with IF NOT EXISTS, so this is a no-op on re-run.

ALTER TABLE public.referral_credits
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
