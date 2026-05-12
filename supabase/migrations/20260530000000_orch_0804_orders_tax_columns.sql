-- ORCH-0804 — Stripe Tax enablement on ticket Checkout Sessions.
--
-- Adds two columns to public.orders so the webhook router can persist
-- Stripe-side tax data when checkout.session.completed fires:
--   - tax_amount_cents: integer (NOT NULL DEFAULT 0) — Stripe's computed tax
--     in cents, sourced from session.total_details.amount_tax.
--   - tax_calculation_id: text (nullable) — Stripe's tax_calculation reference
--     for downstream reporting + audit trail.
--
-- Per ORCH-0804 SPEC §4.1. Establishes I-PROPOSED-BF
-- STRIPE_TAX_ENABLED_ON_CHECKOUT at the DB tier.
--
-- Idempotent: safe to re-apply (uses ADD COLUMN IF NOT EXISTS).
-- No RLS changes — orders RLS already gates by brand membership via events.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tax_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_calculation_id text;

-- Non-negative constraint (idempotent via the IF NOT EXISTS pattern is not
-- supported on CONSTRAINT in older Postgres, so use the DO block).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_tax_non_negative'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_tax_non_negative CHECK (tax_amount_cents >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.orders.tax_amount_cents IS
  'Stripe Tax amount collected on this order, in cents. Populated by stripeWebhookRouter.handleCheckoutSessionCompleted from session.total_details.amount_tax. Brand is merchant of record (Connect destination charge with automatic_tax.liability.type=account). ORCH-0804.';

COMMENT ON COLUMN public.orders.tax_calculation_id IS
  'Stripe tax_calculation reference (tc_...) for the order. NULL on historical orders predating ORCH-0804 + on free / door-sale orders. ORCH-0804.';

-- In-migration verification probe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'tax_amount_cents'
  ) THEN
    RAISE EXCEPTION 'ORCH-0804 verification probe failed: orders.tax_amount_cents missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'tax_calculation_id'
  ) THEN
    RAISE EXCEPTION 'ORCH-0804 verification probe failed: orders.tax_calculation_id missing';
  END IF;
END $$;

COMMIT;
