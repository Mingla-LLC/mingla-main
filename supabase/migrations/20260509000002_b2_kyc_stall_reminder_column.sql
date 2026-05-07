-- Cycle B2a Path C — KYC stall reminder tracking (J-B2.4 folded in from B2b).
-- Ports forward Taofeek's 20260506130000_b2_kyc_stall_reminder.sql; reordered per
-- Path C SPEC §8 to land after 20260508000000_b2a_stripe_connect_onboarding.sql.
-- Read by stripe-kyc-stall-reminder/ edge function (Phase 4); cleared by webhook
-- router on account.updated → charges_enabled=true (Phase 1).

ALTER TABLE public.stripe_connect_accounts
  ADD COLUMN IF NOT EXISTS kyc_stall_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.stripe_connect_accounts.kyc_stall_reminder_sent_at IS
  'Set when KYC stall email sent; cleared when charges_enabled (webhook sync). See SPEC §6 — stripe-kyc-stall-reminder + stripeWebhookRouter handlers.';
