-- ORCH-1271 [Admin authorization & audit FOUNDATION] — (2a) admin_audit_log extend.
--
-- Adds the two requested-but-missing audit fields as NULLABLE columns (backward
-- compatible with the existing client-side lib/auditLog.js `logAdminAction`
-- inserts, which do NOT set actor_uid / reason) and the target index that the
-- wave-2 "audit trail for this entity" view needs.
--
--   actor_uid  uuid  — server-resolved auth.uid(); the true PK of the actor
--                       (admin_email already exists but is not a stable key).
--   reason     text  — typed reason; the admin_write_audit helper rejects an
--                       empty reason for high-risk writes (p_require_reason).
--
-- Canonical metadata shape stays { "before": {...}, "after": {...}, ... } in the
-- existing jsonb `metadata` column (Open Question Q1 default: no dedicated
-- before/after columns — zero NOT-NULL churn, backward compatible).
--
-- admin_audit_log append-only-ness is enforced by RLS having only INSERT+SELECT
-- policies (no UPDATE/DELETE policy). No append-only trigger exists on this
-- table (the trg_audit_log_block_update trigger is on a DIFFERENT table,
-- `audit_log`). This migration does not change that posture.

ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS actor_uid uuid,
  ADD COLUMN IF NOT EXISTS reason    text;

CREATE INDEX IF NOT EXISTS idx_audit_log_target
  ON public.admin_audit_log (target_type, target_id);

COMMENT ON COLUMN public.admin_audit_log.actor_uid IS
  'ORCH-1271: server-resolved auth.uid() of the admin actor (nullable; legacy client inserts leave it null).';
COMMENT ON COLUMN public.admin_audit_log.reason IS
  'ORCH-1271: typed reason for the admin action (nullable; required for high-risk writes via admin_write_audit).';

--------------------------------------------------------------------------------
-- Self-assert: apply FAILS if either new column or the index is absent.
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
       AND column_name = 'actor_uid'
  ) THEN
    RAISE EXCEPTION 'ORCH-1271 audit extend: actor_uid column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
       AND column_name = 'reason'
  ) THEN
    RAISE EXCEPTION 'ORCH-1271 audit extend: reason column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'admin_audit_log'
       AND indexname = 'idx_audit_log_target'
  ) THEN
    RAISE EXCEPTION 'ORCH-1271 audit extend: idx_audit_log_target index missing';
  END IF;
END $$;
