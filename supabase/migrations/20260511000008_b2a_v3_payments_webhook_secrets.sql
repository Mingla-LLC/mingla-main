-- B2a Path C V3 — webhook secret rotation env var documentation (D-V3-9)
-- Per outputs/SPEC_B2_PATH_C_V3.md §6 + investigation Thread 23.
--
-- WHY this migration exists:
-- Webhook secret rotation per D-V3-9 uses dual-secret env var pattern. NO SCHEMA CHANGE.
-- This migration is a placeholder that exists to:
-- 1. Document the runtime env var contract for future maintainers via SQL COMMENT ON SCHEMA
-- 2. Match the SPEC v3 §8 migration ordering (10-migration enumeration)
-- 3. Provide a stable migration ID for the rotation procedure runbook to reference
--
-- ENV VAR CONTRACT (configured in Supabase Edge Function Secrets, NOT in DB):
-- - STRIPE_WEBHOOK_SECRET = current active webhook signing secret (whsec_*)
-- - STRIPE_WEBHOOK_SECRET_PREVIOUS = previous secret during rotation window only
--   (set during rotation; unset 7+ days after rotation when in-flight events have drained)
--
-- ROTATION PROCEDURE (runbook at docs/runbooks/B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md):
-- 1. Add new endpoint in Stripe Dashboard
-- 2. Set STRIPE_WEBHOOK_SECRET_PREVIOUS = STRIPE_WEBHOOK_SECRET
-- 3. Set STRIPE_WEBHOOK_SECRET = <new endpoint secret>
-- 4. Wait 7+ days for in-flight events to drain
-- 5. Delete old endpoint in Stripe Dashboard
-- 6. Unset STRIPE_WEBHOOK_SECRET_PREVIOUS
--
-- The stripe-webhook/index.ts handler tries STRIPE_WEBHOOK_SECRET first; on signature
-- verification failure, retries with STRIPE_WEBHOOK_SECRET_PREVIOUS if set. Both fail = 400.

COMMENT ON SCHEMA "public" IS
  'Mingla DB schema. WEBHOOK SECRET ROTATION: Stripe webhook handler at supabase/functions/stripe-webhook/index.ts uses dual-secret pattern via env vars STRIPE_WEBHOOK_SECRET (current) + STRIPE_WEBHOOK_SECRET_PREVIOUS (during rotation window). Configured in Supabase Edge Function Secrets, not in DB. See docs/runbooks/B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md for procedure. Per D-V3-9.';
