-- Migration: 20260311100003_add_updated_at_to_referral_credits.sql
-- Description: Adds missing updated_at column to referral_credits table.
-- The extended trigger (20260311100002) references referral_credits.updated_at
-- but the original CREATE TABLE (20260309000003) never included it.

ALTER TABLE public.referral_credits
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
