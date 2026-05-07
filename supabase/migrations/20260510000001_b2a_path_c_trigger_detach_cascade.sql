-- B2a Path C V3 — trigger detach cascade fix + payment_webhook_events.retry_count column
-- Per outputs/SPEC_B2_PATH_C_V3.md §6 + D-V3-1 (V2 D-V2-1 carry-forward) + D-V3-5 (webhook retry policy).
-- Per Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_AUDIT.md R-1 (trigger gap) + R-2 (replay-skip-all).
--
-- WHY this migration exists:
-- The original B2a migration 20260508000000_b2a_stripe_connect_onboarding.sql declared a
-- trigger function tg_sync_brand_stripe_cache that mirrors stripe_connect_accounts → brands
-- denormalized cache columns. The original definition does NOT consider NEW.detached_at —
-- it always mirrors the live values regardless of detach state. SPEC v1 D-B2-29 incorrectly
-- claimed the trigger handled detach cascade; forensics R-1 caught the gap.
--
-- This migration replaces tg_sync_brand_stripe_cache with the corrected version that uses
-- CASE WHEN NEW.detached_at IS NOT NULL THEN <cleared values> ELSE <live values> END for
-- all 3 mirror columns. Preserves I-PROPOSED-P (single canonical writer = trigger only).
--
-- Also adds payment_webhook_events.retry_count + retries_exhausted columns to support the
-- D-V3-5 webhook replay-after-failure retry policy (max 5 attempts; mark exhausted after).

-- =============================================================================
-- 1. Replace tg_sync_brand_stripe_cache trigger function with detach-aware version
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."tg_sync_brand_stripe_cache"()
RETURNS "trigger"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'pg_temp'
AS $$
BEGIN
  -- D-V3-1: When stripe_connect_accounts row is detached (NEW.detached_at IS NOT NULL),
  -- mirror NULL/false to brands.stripe_* cache columns to clear the stale "connected" state.
  -- When NOT detached, mirror live values per D-B2-3.
  --
  -- This preserves I-PROPOSED-P: brands.stripe_* are denormalized cache mirrored ONLY by
  -- this trigger. App code MUST NOT write these columns directly (CI gate enforces).

  UPDATE public.brands
  SET
    stripe_connect_id =
      CASE WHEN NEW.detached_at IS NOT NULL THEN NULL ELSE NEW.stripe_account_id END,
    stripe_charges_enabled =
      CASE WHEN NEW.detached_at IS NOT NULL THEN false ELSE NEW.charges_enabled END,
    stripe_payouts_enabled =
      CASE WHEN NEW.detached_at IS NOT NULL THEN false ELSE NEW.payouts_enabled END
  WHERE id = NEW.brand_id;

  RETURN NEW;
END;
$$;

-- ALTER FUNCTION OWNER + GRANTs are preserved by CREATE OR REPLACE; no re-declaration needed.

COMMENT ON FUNCTION "public"."tg_sync_brand_stripe_cache"() IS
  'Mirrors stripe_connect_accounts → brands.stripe_* cache. When NEW.detached_at IS NOT NULL, clears cache to NULL/false (D-V3-1). Otherwise mirrors live values (D-B2-3). Preserves I-PROPOSED-P single-canonical-writer pattern.';

-- =============================================================================
-- 2. Add payment_webhook_events.retry_count + retries_exhausted for D-V3-5
-- =============================================================================

ALTER TABLE "public"."payment_webhook_events"
  ADD COLUMN IF NOT EXISTS "retry_count" int NOT NULL DEFAULT 0;

ALTER TABLE "public"."payment_webhook_events"
  ADD COLUMN IF NOT EXISTS "retries_exhausted" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."payment_webhook_events"."retry_count" IS
  'Number of processing attempts. Webhook router increments on each retry; caps at 5 per D-V3-5. retries_exhausted=true when cap reached.';

COMMENT ON COLUMN "public"."payment_webhook_events"."retries_exhausted" IS
  'Set true when retry_count reaches max (5 per D-V3-5). When true, webhook router skips processing on replay; row preserved for forensics.';
