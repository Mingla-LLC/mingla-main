-- Issue #3697 — single-account paid-social audiences and immutable stage facts.
--
-- Current product scope: the one consumer-lane @usemingla connection for each
-- provider. Provider audience ownership is therefore resolved by platform at
-- runtime; this table does not add a speculative multi-account layer.
-- Do not auto-apply. Release through the governed migration lane only.

BEGIN;

CREATE TABLE public.ad_audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('meta','snapchat','tiktok')),
  code text NOT NULL CHECK (code ~ '^[MST][1-9]$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  scope text NOT NULL CHECK (scope IN ('market','brand','event')),
  market text NOT NULL CHECK (market ~ '^[A-Z]{2}$'),
  brand_id uuid NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  event_id uuid NULL REFERENCES public.events(id) ON DELETE CASCADE,
  platform_audience_id text NULL,
  rule jsonb NOT NULL CHECK (jsonb_typeof(rule) = 'object'),
  window_days integer NOT NULL CHECK (window_days BETWEEN 1 AND 730),
  approx_size bigint NULL CHECK (approx_size IS NULL OR approx_size >= 0),
  status text NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating','ready','too_small','error')),
  last_synced_at timestamptz NULL,
  error text NULL CHECK (error IS NULL OR char_length(error) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_audiences_scope_identity CHECK (
    (scope = 'market' AND brand_id IS NULL AND event_id IS NULL)
    OR (scope = 'brand' AND brand_id IS NOT NULL AND event_id IS NULL)
    OR (scope = 'event' AND brand_id IS NOT NULL AND event_id IS NOT NULL)
  ),
  CONSTRAINT ad_audiences_identity_key
    UNIQUE NULLS NOT DISTINCT (platform, code, scope, market, brand_id, event_id)
);

CREATE INDEX ad_audiences_filters_idx
  ON public.ad_audiences(platform, market, brand_id, event_id, status);
CREATE INDEX ad_audiences_provider_id_idx
  ON public.ad_audiences(platform, platform_audience_id)
  WHERE platform_audience_id IS NOT NULL;

ALTER TABLE public.ad_audiences ENABLE ROW LEVEL SECURITY;
CREATE POLICY ad_audiences_admin_read
  ON public.ad_audiences FOR SELECT TO authenticated
  USING (public.is_admin_user());

-- #1856 / anon-exec gate: authenticated admins read through RLS. Only the
-- service role can call the SECURITY DEFINER writers below.
REVOKE ALL ON public.ad_audiences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ad_audiences TO authenticated;
GRANT ALL ON public.ad_audiences TO service_role;

CREATE OR REPLACE FUNCTION public.ad_audience_upsert(
  p_platform text,
  p_code text,
  p_name text,
  p_scope text,
  p_market text,
  p_brand_id uuid,
  p_event_id uuid,
  p_rule jsonb,
  p_window_days integer
)
RETURNS public.ad_audiences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_row public.ad_audiences;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.ad_audiences(
    platform, code, name, scope, market, brand_id, event_id, rule,
    window_days, status
  ) VALUES (
    lower(btrim(p_platform)), upper(btrim(p_code)), btrim(p_name),
    lower(btrim(p_scope)), upper(btrim(p_market)), p_brand_id, p_event_id,
    p_rule, p_window_days, 'creating'
  )
  ON CONFLICT ON CONSTRAINT ad_audiences_identity_key DO UPDATE
  SET name = EXCLUDED.name,
      rule = EXCLUDED.rule,
      window_days = EXCLUDED.window_days,
      status = CASE
        WHEN ad_audiences.platform_audience_id IS NULL THEN 'creating'
        ELSE ad_audiences.status
      END,
      error = CASE
        WHEN ad_audiences.error = 'event_ended' THEN NULL
        ELSE ad_audiences.error
      END,
      updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_audience_record_sync(
  p_id uuid,
  p_platform_audience_id text,
  p_approx_size bigint,
  p_status text,
  p_error text DEFAULT NULL,
  p_synced_at timestamptz DEFAULT now()
)
RETURNS public.ad_audiences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_row public.ad_audiences;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('creating','ready','too_small','error') THEN
    RAISE EXCEPTION 'ad_audience_status_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ad_audiences
  SET platform_audience_id = coalesce(
        nullif(btrim(p_platform_audience_id), ''), platform_audience_id
      ),
      approx_size = p_approx_size,
      status = p_status,
      error = nullif(left(coalesce(p_error, ''), 1000), ''),
      last_synced_at = p_synced_at,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_audience_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_audience_end_expired(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ad_audiences a
  SET status = 'error', error = 'event_ended', updated_at = p_now
  WHERE a.scope = 'event'
    AND a.event_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = a.event_id
        AND (
          e.status IN ('ended','cancelled')
          OR coalesce((
            SELECT max(d.end_at) FROM public.event_dates d
            WHERE d.event_id = e.id
          ), '-infinity'::timestamptz) <= p_now
        )
    )
    AND (a.status <> 'error' OR a.error IS DISTINCT FROM 'event_ended');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_audience_upsert(text,text,text,text,text,uuid,uuid,jsonb,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_audience_record_sync(uuid,text,bigint,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_audience_end_expired(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_audience_upsert(text,text,text,text,text,uuid,uuid,jsonb,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_audience_record_sync(uuid,text,bigint,text,text,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_audience_end_expired(timestamptz)
  TO service_role;

CREATE TABLE public.ad_plan_stage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_version_id uuid NOT NULL REFERENCES public.ad_plan_versions(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta','snapchat','tiktok')),
  stage text NOT NULL CHECK (stage IN ('prospecting','retarget','abandoners')),
  enabled boolean NOT NULL,
  executable boolean NOT NULL,
  budget_percent integer NOT NULL CHECK (budget_percent BETWEEN 0 AND 100),
  budget_cents bigint NOT NULL CHECK (budget_cents >= 0),
  audience_codes text[] NOT NULL DEFAULT '{}'::text[],
  audience_sizes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audience_sizes) = 'object'),
  widened jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(widened) = 'array'),
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_version_id, platform, stage)
);

ALTER TABLE public.ad_plan_stage_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY ad_plan_stage_snapshots_admin_read
  ON public.ad_plan_stage_snapshots FOR SELECT TO authenticated
  USING (public.is_admin_user());
REVOKE ALL ON public.ad_plan_stage_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ad_plan_stage_snapshots TO authenticated;
GRANT ALL ON public.ad_plan_stage_snapshots TO service_role;

-- Backfill only when history proves one brand. Ambiguous/unattached Mingla
-- house assets intentionally remain NULL and cannot be selected for a brand
-- campaign until an admin explicitly assigns or copies them.
WITH creative_brand_refs AS (
  SELECT a.creative_id, coalesce(c.brand_id, e.brand_id) AS brand_id
  FROM public.ads a
  JOIN public.ad_sets s ON s.id = a.ad_set_id
  JOIN public.ad_campaigns c ON c.id = s.campaign_id
  LEFT JOIN public.events e ON e.id = c.dest_event_id
  WHERE a.creative_id IS NOT NULL AND coalesce(c.brand_id, e.brand_id) IS NOT NULL
  UNION ALL
  SELECT (v.canonical_plan->>'creative_library_id')::uuid,
         (v.destination_snapshot->>'brand_id')::uuid
  FROM public.ad_plan_versions v
  WHERE coalesce(v.canonical_plan->>'creative_library_id','') ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND coalesce(v.destination_snapshot->>'brand_id','') ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  UNION ALL
  SELECT stage_id.value::uuid, (v.destination_snapshot->>'brand_id')::uuid
  FROM public.ad_plan_versions v
  CROSS JOIN LATERAL jsonb_each(
    coalesce(v.canonical_plan->'stage_creative_ids', '{}'::jsonb)
  ) stage_rows
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(stage_rows.value) = 'array'
      THEN stage_rows.value ELSE '[]'::jsonb END
  ) stage_id(value)
  WHERE stage_id.value ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND coalesce(v.destination_snapshot->>'brand_id','') ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), deterministic AS (
  SELECT creative_id, min(brand_id::text)::uuid AS brand_id
  FROM creative_brand_refs
  WHERE brand_id IS NOT NULL
  GROUP BY creative_id
  HAVING count(DISTINCT brand_id) = 1
)
UPDATE public.ad_creatives c
SET brand_id = d.brand_id, updated_at = now()
FROM deterministic d
WHERE c.id = d.creative_id AND c.brand_id IS NULL;

DO $cron$
DECLARE v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Issue #3697: pg_cron/pg_net unavailable; audience sync not scheduled.';
    RETURN;
  END IF;
  SELECT jobid INTO v_job_id FROM cron.job
  WHERE jobname = 'issue_3697_ad_audience_sync_daily' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule(
    'issue_3697_ad_audience_sync_daily',
    '47 3 * * *',
    $command$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name='supabase_url' LIMIT 1) || '/functions/v1/admin-ad-audiences',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || (SELECT decrypted_secret
            FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)
        ),
        body := '{"action":"sync"}'::jsonb,
        timeout_milliseconds := 55000
      );
    $command$
  );
END
$cron$;

-- Invariant I-3697-AUDIENCE-AUTHORITY: provider ids/rules enter only through
-- service-role definer writes; browsers can read no audience row directly.
COMMENT ON TABLE public.ad_audiences IS
  'Issue #3697 server-owned @usemingla provider audiences. Admin read only; SECURITY DEFINER service-role writes.';
COMMENT ON TABLE public.ad_plan_stage_snapshots IS
  'Issue #3697 immutable-at-create stage/audience/budget evidence for one reviewed plan version.';

COMMIT;
