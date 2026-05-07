-- B2a Path C V3 — webhook retry_count idempotency safety net
-- Per outputs/SPEC_B2_PATH_C_V3.md §4 + §8 migration ordering.
--
-- WHY this migration exists:
-- 20260510000001_b2a_path_c_trigger_detach_cascade.sql already added retry_count +
-- retries_exhausted columns to payment_webhook_events as part of the V2-D-V2-3 / V3-D-V3-5
-- webhook replay-after-failure retry policy. This migration is an idempotent SAFETY NET that
-- ensures the columns exist even if 20260510000001 was somehow skipped or partially applied
-- on a particular environment.
--
-- IF NOT EXISTS clauses make this a no-op when 20260510000001 already added the columns.
-- The migration runs cleanly regardless of prior state.
--
-- Keeping this as a separate migration file (rather than relying solely on 20260510000001)
-- provides defense-in-depth for migration replay scenarios and matches the SPEC v3 §8
-- migration ordering enumeration.

ALTER TABLE "public"."payment_webhook_events"
  ADD COLUMN IF NOT EXISTS "retry_count" int NOT NULL DEFAULT 0;

ALTER TABLE "public"."payment_webhook_events"
  ADD COLUMN IF NOT EXISTS "retries_exhausted" boolean NOT NULL DEFAULT false;

-- Comments on these columns are set by 20260510000001; not re-set here to avoid clobbering.
