-- ORCH-0640 ch13 — Drop ai_approved + ai_validated_at columns from place_pool (DEC-043)
-- MUST run AFTER admin_place_pool_mv rebuild (ch03 / migration 20260425000003).
-- Column-dependent indexes are dropped first, then the columns themselves.
-- Bouncer (is_servable + bouncer_validated_at) is the sole quality gate going forward.

BEGIN;

-- Step 1: Drop indexes that depend on ai_approved
DROP INDEX IF EXISTS public.idx_place_pool_ai_approved;
DROP INDEX IF EXISTS public.idx_place_pool_ai_category_first;
DROP INDEX IF EXISTS public.idx_place_pool_approved_with_photos;
DROP INDEX IF EXISTS public.idx_place_pool_city_active_approved;

-- Step 2: Drop the columns
ALTER TABLE public.place_pool
  DROP COLUMN IF EXISTS ai_approved,
  DROP COLUMN IF EXISTS ai_validated_at,
  DROP COLUMN IF EXISTS ai_approved_by,
  DROP COLUMN IF EXISTS ai_approved_at,
  DROP COLUMN IF EXISTS ai_validation_notes;
-- ai_categories column INTENTIONALLY KEPT — still used by admin_place_pool_mv for
-- primary_category projection. Derived from signal/bouncer outputs going forward.

COMMIT;
