-- B2a Path C V3 hotfix — backfill brand_team_members for brand owners
-- Discovered post-deploy: V3 ToS gate (edge fn brand-mingla-tos-accept) UPDATEs
-- brand_team_members for the calling user_id + brand_id. Brand OWNERS (identified
-- by brands.account_id) historically have NO row in brand_team_members because
-- the table was designed for INVITED team members only. Sub-A migration
-- 20260511000005 grandfathered existing accepted+active rows but never created
-- owner rows.
--
-- Result: any brand owner attempting the V3 ToS gate gets a 404
-- "membership_not_found" from the edge fn.
--
-- Fix: insert one brand_team_members row per (brand owner, brand) pair, marked
-- account_owner + grandfathered ToS so the gate auto-passes for them. Future
-- brand creates should also create this row — separate fix in the brand
-- creation flow (not this migration).
--
-- Idempotent: ON CONFLICT does nothing for owners who already have a row.
-- Safe to re-run.

-- Schema check at write time (2026-05-07): brand_team_members has no
-- unique constraint on (brand_id, user_id), so ON CONFLICT can't be used.
-- The LEFT JOIN ... WHERE tm.user_id IS NULL clause guards against duplicate
-- inserts on re-run. No `invited_by` column exists; ownership is implicit.
INSERT INTO public.brand_team_members (
  brand_id,
  user_id,
  role,
  invited_at,
  accepted_at,
  removed_at,
  mingla_tos_accepted_at,
  mingla_tos_version_accepted
)
SELECT
  b.id AS brand_id,
  b.account_id AS user_id,
  'account_owner' AS role,
  b.created_at AS invited_at,                -- align with brand creation
  b.created_at AS accepted_at,               -- owner is auto-accepted
  NULL::timestamptz AS removed_at,           -- still active
  now() AS mingla_tos_accepted_at,           -- grandfather: owners are deemed
                                             --              to have accepted V3 ToS
                                             --              for V3 onboarding flow access
  'pre-v3-grandfathered' AS mingla_tos_version_accepted
FROM public.brands b
LEFT JOIN public.brand_team_members tm
  ON tm.brand_id = b.id
  AND tm.user_id = b.account_id
WHERE tm.user_id IS NULL
  AND b.deleted_at IS NULL;

-- Audit trail in DB comment
COMMENT ON TABLE public.brand_team_members IS
  'Brand team membership rows. As of B2a Path C V3 (2026-05-07 backfill 20260513000001), every brand owner is guaranteed to have a row here with role=account_owner. Future brand creates must also create this row in the same transaction; track as a separate ORCH if not already.';
