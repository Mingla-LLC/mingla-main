-- toward #3697: region consent, opt-out match state and scheduled retry proof.
-- MINGLA-INVARIANT: I-3697-PIXEL-CONSENT-RETRY | issue #3697 | Region pixel mode defaults to on-arrival, browser opt-out state reaches every conversion source, and retry remains service-only and bounded by the edge worker.
-- MINGLA-INVARIANT: I-PROPOSED-3697-OPT-OUT-LATCH | issue #3697 | A buyer opt-out suppresses every server ad-platform send even when an attribution touch exists.
-- MINGLA-INVARIANT: I-PROPOSED-3697-PUBLIC-PIXEL-MODE | issue #3697 | The public config returns only one non-sensitive pixel mode and defaults missing regions to on-arrival.
-- MINGLA-INVARIANT: I-PROPOSED-3697-REGION-PIXEL-MODE | issue #3697 | Country pixel-mode overrides are admin-readable, server-written, and default to on-arrival.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_missing text[];
BEGIN
  IF to_regclass('public.ad_region_config') IS NULL THEN
    RAISE EXCEPTION '#3697 ad_region_config missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ad_region_config'::regclass) THEN
    RAISE EXCEPTION '#3697 ad_region_config RLS disabled';
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
  INTO v_missing
  FROM (VALUES
    ('ticket_checkout_sessions', 'ttp'),
    ('ticket_checkout_sessions', 'ad_tracking_opt_out'),
    ('reservation_checkout_sessions', 'ttp'),
    ('reservation_checkout_sessions', 'ad_tracking_opt_out'),
    ('stay_reservation_groups', 'ttp'),
    ('stay_reservation_groups', 'ad_tracking_opt_out')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required.table_name
      AND c.column_name = required.column_name
      AND (
        required.column_name <> 'ad_tracking_opt_out'
        OR (c.is_nullable = 'NO' AND c.column_default = 'false')
      )
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '#3697 opt-out/match columns missing or weak: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'public.ad_pixel_public_config(text)'::regprocedure
      AND prosecdef
      AND provolatile = 's'
      AND proconfig @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION '#3697 public pixel config definer is missing or unpinned';
  END IF;
  IF NOT has_function_privilege('anon', 'public.ad_pixel_public_config(text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.ad_region_config', 'SELECT') THEN
    RAISE EXCEPTION '#3697 public pixel config ACL is not narrow';
  END IF;
  IF has_function_privilege('anon', 'public.admin_set_ad_pixel_consent_mode(text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3697_set_stay_ad_context(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3697_set_stay_ad_context(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_3697_set_stay_ad_context(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '#3697 definer write ACL is too broad or service role lost access';
  END IF;
END;
$test$;

INSERT INTO public.ad_region_config(country_code, ad_pixel_consent_mode)
VALUES ('GB', 'opt_in')
ON CONFLICT (country_code) DO UPDATE
SET ad_pixel_consent_mode = EXCLUDED.ad_pixel_consent_mode;

SET LOCAL ROLE anon;
DO $test$
BEGIN
  IF public.ad_pixel_public_config('GB')->>'ad_pixel_consent_mode' <> 'opt_in' THEN
    RAISE EXCEPTION '#3697 region override was not returned to anon';
  END IF;
  IF public.ad_pixel_public_config('ZZ')->>'ad_pixel_consent_mode' <> 'on_arrival' THEN
    RAISE EXCEPTION '#3697 missing region did not default to on_arrival';
  END IF;
END;
$test$;
RESET ROLE;

DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND NOT EXISTS (
       SELECT 1 FROM cron.job
       WHERE jobname = 'issue_3697_ad_conversion_retry_hourly'
         AND schedule = '37 * * * *'
         AND active
         AND command LIKE '%/functions/v1/ad-conversion-retry%'
     ) THEN
    RAISE EXCEPTION '#3697 hourly conversion retry cron missing';
  END IF;
END;
$test$;

ROLLBACK;
