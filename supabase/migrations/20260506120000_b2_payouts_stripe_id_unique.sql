-- Cycle B2 — idempotent payout mirror upserts from Stripe webhooks (issue #47).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_stripe_payout_id_unique
  ON public.payouts (stripe_payout_id);
