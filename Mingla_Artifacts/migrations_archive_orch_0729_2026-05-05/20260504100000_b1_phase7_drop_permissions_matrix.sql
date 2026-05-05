-- =====================================================================
-- Cycle 13b Q4 — permissions_matrix DECOMMISSIONED
-- =====================================================================
-- Mobile uses MIN_RANK constants in mingla-business/src/utils/permissionGates.ts.
-- Backend uses biz_role_rank() function via SECURITY DEFINER helpers
-- (biz_is_brand_admin_plus_for_caller, biz_is_event_manager_plus_for_caller, ...).
-- The matrix was scaffolding from PR #59 author's design that didn't pay off
-- (zero mobile consumers; zero backend RLS reads).
--
-- Per Cycle 13b SPEC §4.1.1 / DEC-093 (forthcoming on 13b CLOSE).
-- Memory: feedback_permissions_matrix_decommissioned.md (status: DRAFT, flips ACTIVE on CLOSE).
-- Mirrors DEC-092 (Cycle 13a Path A J-A9 BrandTeamView subtract precedent).

DROP POLICY IF EXISTS "Authenticated can read permissions_matrix" ON public.permissions_matrix;

DROP TABLE IF EXISTS public.permissions_matrix;
