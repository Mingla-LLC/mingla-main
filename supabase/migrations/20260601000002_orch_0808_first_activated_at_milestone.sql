-- ORCH-0808 — follow-up: add `first_activated_at` to brand_appsflyer_milestones.
--
-- The base ORCH-0808 migration (20260601000000) was applied before the
-- post-QA rework added `first_activated_at` to bring T-08 back to spec
-- compliance (per-brand milestone, not per-transition gate). This migration
-- adds the missing column. Edge function deploy already references the
-- column via claimBrandMilestone() in stripeWebhookRouter syncAccount —
-- without this migration, that call returns false silently because the
-- column doesn't exist.
--
-- See: QA report findings #1 + §11 rework path.

BEGIN;

ALTER TABLE public.brand_appsflyer_milestones
  ADD COLUMN IF NOT EXISTS first_activated_at timestamptz;

-- Self-verify probe — confirm the column landed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'brand_appsflyer_milestones'
      AND column_name = 'first_activated_at'
  ) THEN
    RAISE EXCEPTION
      'ORCH-0808 follow-up: first_activated_at column did not land on brand_appsflyer_milestones';
  END IF;
END $$;

COMMIT;
