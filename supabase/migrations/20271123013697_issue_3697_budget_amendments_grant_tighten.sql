-- #3697: ad_plan_budget_amendments is admin-read only. Supabase default
-- privileges left authenticated holding MAINTAIN, REFERENCES, TRIGGER and
-- TRUNCATE; the #1856 grant-class gate rejects those. Keep SELECT (RLS
-- limits it to admins) and remove everything else.

BEGIN;

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE
  ON public.ad_plan_budget_amendments FROM authenticated;

COMMIT;
