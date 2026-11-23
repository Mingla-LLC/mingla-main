-- issue #4522 M5 — trip payment plans v2: switch on.
--
-- Flips public.issue_4522_plan_v2_enabled() from false to true. That one
-- switch lets hosts save v2 plans (tier_metadata.payment_plan), lets checkout
-- quote them, and lets travelers take flexible payments.
--
-- Applied LAST, by the owner only, and only after slices 1-12 are merged and
-- live-checked in their dark (switch-off) state. It is never part of a
-- routine replay-and-push of earlier slices.
--
-- Kill switch: do not edit or revert this file. Ship a later migration that
-- re-emits the same function returning false (same attributes and grants).
-- Saving new v2 plans and starting new flexible payments then stop; existing
-- v2 orders keep their rows, the cron keeps charging them (cron does not read
-- the switch), and open flexible rows finish through webhooks.
--
-- Drift guard: refuses to run unless the function's current body is exactly
-- the M1 (20281129024522) `SELECT false` body, so it can never silently
-- overwrite a kill switch or any other later change.
-- Static SQL only. Conflicts would raise PT409, never 40001 (none raised here).

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.issue_4522_plan_v2_enabled()','c461f1f09b0984ad9135e918dbe65da8')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #4522 M5 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

CREATE OR REPLACE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$ SELECT true $fn$;

REVOKE ALL ON FUNCTION public.issue_4522_plan_v2_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_plan_v2_enabled() TO service_role;
COMMENT ON FUNCTION public.issue_4522_plan_v2_enabled() IS
  'Issue #4522: the single server switch for saving v2 trip plans, quoting them and taking flexible payments. On since the M5 switch-on migration; the kill switch is a later migration returning false.';

COMMIT;
