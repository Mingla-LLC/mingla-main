-- Issue #1397 — accept Open V6's documented time_eol_unix=0 sentinel and
-- refresh the canonical FX snapshot once daily after the provider update window.

-- A NULL is the truthful database representation of "no announced EOL".
-- DROP NOT NULL is additive and replay-safe; existing positive values survive.
ALTER TABLE public.fx_rate_snapshots
  ALTER COLUMN provider_eol_at DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_1384_activate_fx_snapshot(
  p_provider_updated_at timestamptz,
  p_provider_next_update_at timestamptz,
  p_provider_eol_at timestamptz,
  p_payload_sha256 text,
  p_rates jsonb,
  p_response_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_snapshot_id uuid;
  v_missing_count bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF (p_provider_eol_at IS NOT NULL AND p_provider_eol_at <= now())
     OR p_provider_updated_at >= p_provider_next_update_at THEN
    RAISE EXCEPTION 'invalid_provider_timestamps' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_missing_count
  FROM public.supported_brand_currencies c
  WHERE c.active
    AND (
      NOT (p_rates ? c.code::text)
      OR jsonb_typeof(p_rates->c.code::text) <> 'number'
      OR (p_rates->>c.code::text)::numeric <= 0
    );
  IF v_missing_count <> 0 THEN
    RAISE EXCEPTION 'incomplete_fx_snapshot' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_snapshot_id
  FROM public.fx_rate_snapshots
  WHERE payload_sha256 = p_payload_sha256;
  IF FOUND THEN
    RETURN v_snapshot_id;
  END IF;

  INSERT INTO public.fx_rate_snapshots (
    provider, base_currency_code, provider_updated_at,
    provider_next_update_at, provider_eol_at,
    stale_after, expires_at, payload_sha256, status, response_metadata
  ) VALUES (
    'exchange_rate_api_open_v6', 'USD', p_provider_updated_at,
    p_provider_next_update_at, p_provider_eol_at,
    p_provider_next_update_at + interval '24 hours',
    p_provider_updated_at + interval '7 days',
    p_payload_sha256, 'rejected', COALESCE(p_response_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_snapshot_id;

  INSERT INTO public.fx_rates (snapshot_id, currency_code, rate_per_base)
  SELECT v_snapshot_id, c.code, (p_rates->>c.code::text)::numeric
  FROM public.supported_brand_currencies c
  WHERE c.active;

  UPDATE public.fx_rate_snapshots
    SET status = 'superseded'
    WHERE status = 'active';
  UPDATE public.fx_rate_snapshots
    SET status = 'active'
    WHERE id = v_snapshot_id;

  RETURN v_snapshot_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_activate_fx_snapshot(
  timestamptz, timestamptz, timestamptz, text, jsonb, jsonb
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1384_activate_fx_snapshot(
  timestamptz, timestamptz, timestamptz, text, jsonb, jsonb
) TO service_role;

-- Vault is an operator dependency. Keep migration replay CI-safe while making a
-- missing runtime secret visible instead of silently suppressing the schedule.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'issue-1397 advisory: vault schema missing; FX cron is registered but cannot authenticate until Vault is configured';
  ELSIF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url'
  ) THEN
    RAISE NOTICE 'issue-1397 advisory: Vault secret "supabase_url" missing';
  ELSIF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key'
  ) THEN
    RAISE NOTICE 'issue-1397 advisory: Vault secret "service_role_key" missing';
  END IF;
END;
$$;

-- Idempotent once-daily registration. 01:15 UTC is after the currently
-- observed Open V6 daily update window and avoids client-side FX ownership.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'issue_1397_fx_refresh_daily'
  ) THEN
    PERFORM cron.unschedule('issue_1397_fx_refresh_daily');
  END IF;
END;
$$;

SELECT cron.schedule(
  'issue_1397_fx_refresh_daily',
  '15 1 * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'supabase_url'
        LIMIT 1
      ) || '/functions/v1/refresh-fx-rates',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'service_role_key'
          LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

DO $$
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
      'issue-1397 probe failed: expected one daily FX cron at 15 1 * * *, found count %, schedule %',
      v_count, v_schedule;
  END IF;
  IF v_command NOT LIKE '%/functions/v1/refresh-fx-rates%'
     OR v_command NOT LIKE '%service_role_key%'
     OR v_command NOT LIKE '%Authorization%' THEN
    RAISE EXCEPTION
      'issue-1397 probe failed: FX cron is not service-role-authorized';
  END IF;
END;
$$;
