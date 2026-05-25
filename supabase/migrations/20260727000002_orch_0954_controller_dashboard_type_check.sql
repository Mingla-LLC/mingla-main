-- ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk].
-- Replace the legacy Connect account-type CHECK with Stripe Accounts v2
-- controller dashboard values so dashboard:none accounts can persist.

BEGIN;

ALTER TABLE public.stripe_connect_accounts
  DROP CONSTRAINT IF EXISTS stripe_connect_accounts_type_check;

UPDATE public.stripe_connect_accounts
SET
  controller_dashboard_type = CASE controller_dashboard_type
    WHEN 'standard' THEN 'full'
    WHEN 'custom' THEN 'none'
    ELSE controller_dashboard_type
  END,
  updated_at = now()
WHERE controller_dashboard_type IN ('standard', 'custom');

ALTER TABLE public.stripe_connect_accounts
  ADD CONSTRAINT stripe_connect_accounts_type_check
  CHECK (controller_dashboard_type = ANY (ARRAY['full'::text, 'express'::text, 'none'::text]));

COMMENT ON CONSTRAINT stripe_connect_accounts_type_check ON public.stripe_connect_accounts IS
  'ORCH-0954: controller_dashboard_type stores Stripe Accounts v2 dashboard values only (full|express|none), replacing legacy standard|express|custom account-type values.';

COMMIT;
