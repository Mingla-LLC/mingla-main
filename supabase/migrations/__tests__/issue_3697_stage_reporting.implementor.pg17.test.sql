-- MINGLA-INVARIANT: I-3697-STAGE-METRICS | issue #3697 | Provider facts are stored per day and ad set while campaign totals remain in the campaign spend ledger.
BEGIN;

DO $test$
DECLARE
  v_acl text;
  v_function_acl text;
BEGIN
  IF COALESCE((
    SELECT is_enabled
    FROM public.feature_flags
    WHERE flag_key = 'ad_buyer_list_sync_enabled'
  ), true) THEN
    RAISE EXCEPTION '#3697 buyer-list sync flag must ship off';
  END IF;
  IF to_regclass('public.ad_stage_metrics_daily') IS NULL THEN
    RAISE EXCEPTION '#3697 ad_stage_metrics_daily missing';
  END IF;
  IF to_regclass('public.ad_event_stage_summary_daily') IS NULL THEN
    RAISE EXCEPTION '#3697 ad_event_stage_summary_daily missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.ad_sets'::regclass
      AND attname = 'stage' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '#3697 ad_sets.stage missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.ad_creatives'::regclass
      AND attname IN ('stage_tags','concept_tag','hook_tag','event_id','licence_reference','date_locked_until')
      AND NOT attisdropped
    GROUP BY attrelid HAVING count(*) = 6
  ) THEN
    RAISE EXCEPTION '#3697 creative tags/date lock incomplete';
  END IF;

  SELECT array_to_string(relacl, ',') INTO v_acl
  FROM pg_class WHERE oid = 'public.ad_stage_metrics_daily'::regclass;
  IF v_acl LIKE '%anon=%' OR v_acl LIKE '%authenticated=arwd%' THEN
    RAISE EXCEPTION '#1856 broad metric table grant: %', v_acl;
  END IF;

  SELECT array_to_string(proacl, ',') INTO v_function_acl
  FROM pg_proc
  WHERE oid = 'public.ad_archive_expired_creatives(timestamptz)'::regprocedure;
  IF v_function_acl LIKE '%=X/%' OR v_function_acl LIKE '%anon=X%' OR v_function_acl LIKE '%authenticated=X%' THEN
    RAISE EXCEPTION '#1856 archive function executable outside service role: %', v_function_acl;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'issue_3697_archive_expired_ad_creatives'
      AND schedule = '17 3 * * *'
      AND command = 'SELECT public.ad_archive_expired_creatives(now());'
  ) THEN
    RAISE EXCEPTION '#3697 expired creative daily archive cron missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public'
      AND viewname = 'ad_event_stage_summary_daily'
      AND definition ILIKE '%dest_event_id%'
      AND definition ILIKE '%stage%'
  ) THEN
    RAISE EXCEPTION '#3697 event/stage reporting view incomplete';
  END IF;
END
$test$;

ROLLBACK;
