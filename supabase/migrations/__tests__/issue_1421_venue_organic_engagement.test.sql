\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_command text;
BEGIN
  IF to_regclass('public.venue_organic_journeys') IS NULL
     OR to_regclass('public.venue_organic_engagement_events') IS NULL
     OR to_regclass('public.venue_organic_reservation_attributions') IS NULL THEN
    RAISE EXCEPTION 'issue1421 tables missing';
  END IF;
  IF has_table_privilege('anon', 'public.venue_organic_journeys', 'SELECT')
     OR has_table_privilege('authenticated', 'public.venue_organic_engagement_events', 'SELECT') THEN
    RAISE EXCEPTION 'issue1421 raw table grant leaked';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.venue_organic_engagement_rollup(uuid,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.venue_organic_engagement_rollup(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue1421 aggregate RPC grant invalid';
  END IF;
  SELECT command INTO v_command
  FROM cron.job
  WHERE jobname = 'issue_1421_venue_organic_retention'
    AND active
    AND schedule = '17 3 * * *';
  IF v_command IS DISTINCT FROM
    'SELECT public.cleanup_venue_organic_engagement(5000);' THEN
    RAISE EXCEPTION 'issue1421 retention job invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.reservation_checkout_sessions'::regclass
      AND tgname = 'reservation_checkout_sessions_attribute_organic'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'issue1421 attribution trigger missing';
  END IF;
  RAISE NOTICE 'issue1421 schema/grants/retention/trigger PASS';
END
$test$;
