-- Issue #1397 executable database compatibility and cron matrix.
\set ON_ERROR_STOP on
BEGIN;

DO $schema$
DECLARE
  v_nullable text;
BEGIN
  SELECT is_nullable INTO v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'fx_rate_snapshots'
    AND column_name = 'provider_eol_at';

  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION
      'issue_1397: provider_eol_at must be nullable, found %',
      v_nullable;
  END IF;
END;
$schema$;

DO $activation$
DECLARE
  v_rates jsonb;
  v_without_eol uuid;
  v_with_eol uuid;
  v_active_before_failure uuid;
  v_stored_eol timestamptz;
  v_expected_eol timestamptz := now() + interval '2 days';
BEGIN
  SELECT jsonb_object_agg(
    code::text,
    CASE WHEN code::text = 'USD' THEN 1::numeric ELSE 2::numeric END
  )
  INTO v_rates
  FROM public.supported_brand_currencies
  WHERE active;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  v_without_eol := public.issue_1384_activate_fx_snapshot(
    now() - interval '2 hours',
    now() + interval '22 hours',
    NULL,
    'issue-1397-no-announced-eol',
    v_rates,
    '{"fixture":"no-announced-eol"}'::jsonb
  );
  SELECT provider_eol_at INTO v_stored_eol
  FROM public.fx_rate_snapshots
  WHERE id = v_without_eol;
  IF v_stored_eol IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1397: no-EOL sentinel was fabricated as %',
      v_stored_eol;
  END IF;

  v_with_eol := public.issue_1384_activate_fx_snapshot(
    now() - interval '1 hour',
    now() + interval '23 hours',
    v_expected_eol,
    'issue-1397-positive-future-eol',
    v_rates,
    '{"fixture":"positive-future-eol"}'::jsonb
  );
  SELECT provider_eol_at INTO v_stored_eol
  FROM public.fx_rate_snapshots
  WHERE id = v_with_eol;
  IF v_stored_eol IS DISTINCT FROM v_expected_eol THEN
    RAISE EXCEPTION
      'issue_1397: positive future EOL was not preserved';
  END IF;

  SELECT id INTO v_active_before_failure
  FROM public.fx_rate_snapshots
  WHERE status = 'active';
  BEGIN
    PERFORM public.issue_1384_activate_fx_snapshot(
      now() - interval '1 hour',
      now() + interval '23 hours',
      now() - interval '1 minute',
      'issue-1397-expired-eol',
      v_rates,
      '{"fixture":"expired-eol"}'::jsonb
    );
    RAISE EXCEPTION
      'issue_1397: expired nonzero EOL activated';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%invalid_provider_timestamps%' THEN
      RAISE;
    END IF;
  END;
  IF (
    SELECT id FROM public.fx_rate_snapshots WHERE status = 'active'
  ) IS DISTINCT FROM v_active_before_failure THEN
    RAISE EXCEPTION
      'issue_1397: failed expired EOL displaced the active snapshot';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fx_rate_snapshots
    WHERE payload_sha256 = 'issue-1397-expired-eol'
  ) THEN
    RAISE EXCEPTION
      'issue_1397: expired EOL left a partial snapshot';
  END IF;
END;
$activation$;

DO $cron$
DECLARE
  v_count integer;
  v_schedule text;
  v_command text;
BEGIN
  SELECT count(*), min(schedule), min(command)
  INTO v_count, v_schedule, v_command
  FROM cron.job
  WHERE jobname = 'issue_1397_fx_refresh_daily';

  IF v_count <> 1 OR v_schedule IS DISTINCT FROM '15 1 * * *' THEN
    RAISE EXCEPTION
      'issue_1397: expected one daily cron at 15 1 * * *, found count %, schedule %',
      v_count, v_schedule;
  END IF;
  IF v_command NOT LIKE '%/functions/v1/refresh-fx-rates%'
     OR v_command NOT LIKE '%supabase_url%'
     OR v_command NOT LIKE '%service_role_key%'
     OR v_command NOT LIKE '%Authorization%'
     OR v_command NOT LIKE '%Bearer %'
     OR v_command NOT LIKE '%timeout_milliseconds := 30000%' THEN
    RAISE EXCEPTION
      'issue_1397: cron command lost its authenticated Vault/pg_net contract';
  END IF;
END;
$cron$;

ROLLBACK;
