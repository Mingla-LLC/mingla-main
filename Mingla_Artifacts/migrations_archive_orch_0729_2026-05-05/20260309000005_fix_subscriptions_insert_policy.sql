-- Migration: 20260309000005_fix_subscriptions_insert_policy.sql
-- Description: CRIT-001 fix — Drop the overly permissive INSERT policy on subscriptions.
-- The SECURITY DEFINER trigger (create_subscription_on_onboarding_complete) handles all
-- legitimate inserts. No user should be able to INSERT into subscriptions directly.

DROP POLICY IF EXISTS "Service role can insert subscriptions" ON public.subscriptions;
