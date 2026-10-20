-- Issue #3697 — one ad_campaigns row per frozen plan version and provider.
--
-- A plan-bound create reaches the provider before the campaign row exists.
-- Nothing in the database stopped a second row for the same plan version and
-- provider, and ad_plan_assert_launchable still accepts a plan that is already
-- in platform_review. A repeated or concurrent create for the same plan hash
-- could therefore leave two paid provider campaigns. With this index the
-- second insert fails, and admin-ad-create-campaign's persist-failure branch
-- deletes the duplicate provider objects it just made.
--
-- Production had no duplicate (plan_version_id, platform) pairs on
-- 2026-10-20, so the index builds without touching any row.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ad_campaigns_one_per_plan_version_platform
  ON public.ad_campaigns (plan_version_id, platform)
  WHERE plan_version_id IS NOT NULL;

COMMENT ON INDEX public.ad_campaigns_one_per_plan_version_platform IS
  'Issue #3697: a frozen plan version creates at most one campaign per provider.';

COMMIT;
