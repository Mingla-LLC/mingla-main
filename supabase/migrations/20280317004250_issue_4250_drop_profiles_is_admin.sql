-- Issue #4250: drop the dead profiles.is_admin column without reopening view
-- write access.
--
-- Supersedes 20260922000000_meta_orch_1104_drop_profiles_is_admin.sql, which
-- stays held and must never be applied to production: it recreates
-- profiles_with_segment with only `GRANT SELECT TO authenticated`, and this
-- project's default privileges hand anon and authenticated ALL rights on any
-- new relation, so the rebuilt view would regain the INSERT/UPDATE/DELETE that
-- #1856 revoked. Its `SELECT p.*` would also add explorer_deleted_at to the view.
--
-- This migration:
--   * refuses to drop the column if any profile still has it set to true
--     (the values are also kept in public._deprecated_profiles_is_admin_backup);
--   * recreates profiles_with_segment with the exact column list production
--     serves today, minus is_admin, as security_invoker;
--   * re-applies #1856's grants (SELECT only for anon and authenticated).
--
-- Safe on both chains: in production the column and the old view still exist;
-- on a fresh replay 20260922000000 already dropped the column, so the guard and
-- the drop are no-ops and only the view and its grants are rebuilt.
--
-- Rollback: ALTER TABLE public.profiles ADD COLUMN is_admin boolean DEFAULT false;
-- restore values from public._deprecated_profiles_is_admin_backup, then recreate
-- the view with is_admin between is_beta_tester and is_seed.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_admin'
  ) THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE is_admin IS TRUE) THEN
      RAISE EXCEPTION 'issue_4250_is_admin_still_set'
        USING DETAIL = 'A profile still has is_admin = true; refusing to drop the column.';
    END IF;
  END IF;
END $$;

DROP VIEW IF EXISTS public.profiles_with_segment;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_admin;

CREATE VIEW public.profiles_with_segment
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.email,
  p.display_name,
  p.username,
  p.first_name,
  p.last_name,
  p.currency,
  p.measurement_system,
  p.share_location,
  p.share_budget,
  p.share_categories,
  p.share_date_time,
  p.created_at,
  p.bio,
  p.location,
  p.preferences,
  p.updated_at,
  p.phone,
  p.has_completed_onboarding,
  p.email_verified,
  p.onboarding_step,
  p.account_type,
  p.active,
  p.visibility_mode,
  p.avatar_url,
  p.birthday,
  p.gender,
  p.referral_code,
  p.country,
  p.preferred_language,
  p.photos,
  p.timezone,
  p.is_beta_tester,
  p.is_seed,
  p.show_activity,
  p.coach_mark_step,
  public.derive_user_segment(p.id) AS segment
FROM public.profiles p;

-- #1856: read-only for clients. Default privileges granted ALL above.
REVOKE ALL ON public.profiles_with_segment FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles_with_segment TO anon, authenticated;

COMMIT;
