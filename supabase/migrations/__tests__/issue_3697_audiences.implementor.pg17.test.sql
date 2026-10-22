BEGIN;

DO $test$
DECLARE
  v_acl text;
  v_upsert_acl text;
BEGIN
  IF to_regclass('public.ad_audiences') IS NULL THEN
    RAISE EXCEPTION '#3697 ad_audiences missing';
  END IF;
  IF to_regclass('public.ad_plan_stage_snapshots') IS NULL THEN
    RAISE EXCEPTION '#3697 plan stage snapshots missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.ad_audiences'::regclass) THEN
    RAISE EXCEPTION '#3697 ad_audiences RLS disabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ad_audiences'
      AND policyname='ad_audiences_admin_read' AND cmd='SELECT'
  ) THEN
    RAISE EXCEPTION '#3697 admin-only audience read policy missing';
  END IF;

  SELECT array_to_string(relacl, ',') INTO v_acl
  FROM pg_class WHERE oid='public.ad_audiences'::regclass;
  IF v_acl LIKE '%anon=%' OR v_acl LIKE '%authenticated=arwd%' THEN
    RAISE EXCEPTION '#1856 broad ad_audiences grant: %', v_acl;
  END IF;

  SELECT array_to_string(proacl, ',') INTO v_upsert_acl
  FROM pg_proc
  WHERE oid='public.ad_audience_upsert(text,text,text,text,text,uuid,uuid,jsonb,integer)'::regprocedure;
  IF coalesce(v_upsert_acl, '') ~ '(^|,)=X/'
     OR has_function_privilege(
       'anon',
       'public.ad_audience_upsert(text,text,text,text,text,uuid,uuid,jsonb,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.ad_audience_upsert(text,text,text,text,text,uuid,uuid,jsonb,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.ad_audience_upsert(text,text,text,text,text,uuid,uuid,jsonb,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION '#1856 audience writer executable outside service role: %', v_upsert_acl;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.ad_audiences'::regclass
      AND conname='ad_audiences_identity_key'
  ) THEN
    RAISE EXCEPTION '#3697 null-safe platform/market audience identity missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname='issue_3697_ad_audience_sync_daily'
      AND schedule='47 3 * * *'
      AND command LIKE '%/functions/v1/admin-ad-audiences%'
      AND command LIKE '%service_role_key%'
  ) THEN
    RAISE EXCEPTION '#3697 daily audience sync cron missing';
  END IF;
END
$test$;

ROLLBACK;
