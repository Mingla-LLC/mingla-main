-- ORCH-0671 — Delete standalone Photo Pool admin surface.
-- Founder Q-671-1 = Option C (DELETE). Investigation:
--   Mingla_Artifacts/reports/INVESTIGATION_ORCH-0671_PHOTO_TAB_BOUNCER_AWARENESS.md
-- Spec:
--   Mingla_Artifacts/specs/SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md
--
-- This migration:
--   1. Creates admin_backfill_log_archive_orch_0671 (1:1 mirror + 2 audit cols)
--   2. Archives the 4 completed photo_backfill rows ($84.88 historical baseline)
--   3. Deletes the 2 failed + 17 pending photo_backfill rows + any category_fill rows
--   4. Shrinks admin_backfill_log.operation_type CHECK to 'place_refresh' only
--   5. Drops 12 RPCs (no consumers — Constitution #8 subtract-before-add)
--
-- Idempotent: every operation uses IF [NOT] EXISTS. Safe to re-run.
-- Rollback: see 20260428100002_orch_0671_ROLLBACK.sql.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- Step 1: Archive table for historical photo_backfill spend baseline (DEC-671)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_backfill_log_archive_orch_0671 (
  id                  UUID PRIMARY KEY,
  operation_type      TEXT NOT NULL,
  triggered_by        UUID,
  status              TEXT NOT NULL,
  place_ids           UUID[],
  target_category     TEXT,
  target_lat          DOUBLE PRECISION,
  target_lng          DOUBLE PRECISION,
  target_radius_m     INTEGER,
  total_places        INTEGER NOT NULL DEFAULT 0,
  success_count       INTEGER NOT NULL DEFAULT 0,
  failure_count       INTEGER NOT NULL DEFAULT 0,
  error_details       JSONB DEFAULT '[]'::jsonb,
  api_calls_made      INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd  NUMERIC(8,4) NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ,
  -- Audit columns added by ORCH-0671:
  archived_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  archive_reason      TEXT NOT NULL
);

ALTER TABLE public.admin_backfill_log_archive_orch_0671 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_only_archive_orch_0671"
  ON public.admin_backfill_log_archive_orch_0671;
CREATE POLICY "service_role_only_archive_orch_0671"
  ON public.admin_backfill_log_archive_orch_0671
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.admin_backfill_log_archive_orch_0671 IS
  'ORCH-0671 archive: historical photo_backfill rows preserved when the standalone Photo Pool admin page was retired. Read-only baseline for pre-bouncer-cutover spend research. See spec at Mingla_Artifacts/specs/SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md';

-- ──────────────────────────────────────────────────────────────────────────
-- Step 2: Archive the 4 completed photo_backfill rows
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.admin_backfill_log_archive_orch_0671 (
  id, operation_type, triggered_by, status, place_ids,
  target_category, target_lat, target_lng, target_radius_m,
  total_places, success_count, failure_count, error_details,
  api_calls_made, estimated_cost_usd,
  started_at, completed_at, created_at, updated_at,
  archive_reason
)
SELECT
  id, operation_type, triggered_by, status, place_ids,
  target_category, target_lat, target_lng, target_radius_m,
  total_places, success_count, failure_count, error_details,
  api_calls_made, estimated_cost_usd,
  started_at, completed_at, created_at, updated_at,
  'ORCH-0671 photo_backfill consumer retired (DEC-671)'
FROM public.admin_backfill_log
WHERE operation_type = 'photo_backfill' AND status = 'completed'
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- Step 3: Delete all photo_backfill + category_fill rows from main table
-- (4 completed are already archived above; 2 failed + 17 pending are dropped.)
-- ──────────────────────────────────────────────────────────────────────────
DELETE FROM public.admin_backfill_log
WHERE operation_type IN ('photo_backfill', 'category_fill');

-- ──────────────────────────────────────────────────────────────────────────
-- Step 4: Shrink the operation_type CHECK constraint to 'place_refresh' only
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_backfill_log
  DROP CONSTRAINT IF EXISTS admin_backfill_log_operation_type_check;
ALTER TABLE public.admin_backfill_log
  ADD CONSTRAINT admin_backfill_log_operation_type_check
  CHECK (operation_type = 'place_refresh');

-- ──────────────────────────────────────────────────────────────────────────
-- Step 5: Drop 12 RPCs (Constitution #8 — subtract before add)
-- ──────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_photo_pool_summary();
DROP FUNCTION IF EXISTS public.admin_photo_pool_missing_places(integer, integer);
DROP FUNCTION IF EXISTS public.admin_photo_pool_categories();
DROP FUNCTION IF EXISTS public.admin_photo_pool_locations();
DROP FUNCTION IF EXISTS public.admin_photo_pool_refresh_health();
DROP FUNCTION IF EXISTS public.admin_pool_category_detail(text);
DROP FUNCTION IF EXISTS public.admin_trigger_backfill(text, uuid[]);
DROP FUNCTION IF EXISTS public.admin_trigger_category_fill(
  text, double precision, double precision, integer, integer);
DROP FUNCTION IF EXISTS public.admin_pool_stats_overview();
DROP FUNCTION IF EXISTS public.admin_backfill_log_list(integer, integer);
DROP FUNCTION IF EXISTS public.admin_backfill_status(uuid);
DROP FUNCTION IF EXISTS public.admin_backfill_weekly_costs();

-- ──────────────────────────────────────────────────────────────────────────
-- Step 6: Post-condition assertions (raise if cleanup didn't take)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_remaining_orphans BIGINT;
  v_remaining_rpcs BIGINT;
  v_archive_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_remaining_orphans FROM public.admin_backfill_log
    WHERE operation_type IN ('photo_backfill', 'category_fill');
  IF v_remaining_orphans > 0 THEN
    RAISE EXCEPTION 'ORCH-0671 post-condition FAILED: % orphan rows remain', v_remaining_orphans;
  END IF;

  SELECT COUNT(*) INTO v_remaining_rpcs FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_photo_pool_summary','admin_photo_pool_missing_places',
        'admin_photo_pool_categories','admin_photo_pool_locations',
        'admin_photo_pool_refresh_health','admin_pool_category_detail',
        'admin_trigger_backfill','admin_trigger_category_fill',
        'admin_pool_stats_overview','admin_backfill_log_list',
        'admin_backfill_status','admin_backfill_weekly_costs'
      );
  IF v_remaining_rpcs > 0 THEN
    RAISE EXCEPTION 'ORCH-0671 post-condition FAILED: % RPCs not dropped', v_remaining_rpcs;
  END IF;

  SELECT COUNT(*) INTO v_archive_count
    FROM public.admin_backfill_log_archive_orch_0671;
  IF v_archive_count < 4 THEN
    RAISE EXCEPTION 'ORCH-0671 post-condition FAILED: archive holds % rows (expected >=4)', v_archive_count;
  END IF;

  RAISE NOTICE 'ORCH-0671 migration: post-conditions OK. Orphans=0, RPCs dropped=12, archive=%', v_archive_count;
END $$;

COMMIT;
