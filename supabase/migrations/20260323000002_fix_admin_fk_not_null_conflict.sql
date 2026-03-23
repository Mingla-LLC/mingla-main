-- ============================================================================
-- Fix: DROP NOT NULL on 3 admin columns that now have ON DELETE SET NULL FKs
-- ============================================================================
-- Migration 20260323000001 changed these FKs to ON DELETE SET NULL, but the
-- columns still carry NOT NULL constraints. When PostgreSQL cascades a user
-- deletion it tries SET NULL → hits NOT NULL → rolls back the entire delete.
--
-- Dropping NOT NULL lets SET NULL succeed. Existing non-null values are
-- unaffected. Admin dashboard queries already use LEFT JOIN / COALESCE.
-- ============================================================================

ALTER TABLE public.admin_backfill_log ALTER COLUMN triggered_by DROP NOT NULL;
ALTER TABLE public.admin_subscription_overrides ALTER COLUMN granted_by DROP NOT NULL;
ALTER TABLE public.place_admin_actions ALTER COLUMN acted_by DROP NOT NULL;
