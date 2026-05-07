-- Cycle B2a Path C — idempotent payout mirror upserts from Stripe webhooks.
-- Ports forward Taofeek's 20260506120000_b2_payouts_stripe_id_unique.sql; reordered
-- per Path C SPEC §8 to land after 20260508000000_b2a_stripe_connect_onboarding.sql.
-- Backs the payout.* webhook handlers in _shared/stripeWebhookRouter.ts (Phase 1).

CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_stripe_payout_id_unique
  ON public.payouts (stripe_payout_id);
