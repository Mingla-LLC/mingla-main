-- Issue #3697 — per-stage paid-social reporting and Creative Library tags.
--
-- Do not auto-apply. Release through the governed migration lane only.

BEGIN;

INSERT INTO public.feature_flags(flag_key, is_enabled, description)
VALUES (
  'ad_buyer_list_sync_enabled',
  false,
  'Privacy gate for Meta M8, Snapchat S5 and TikTok T5 hashed buyer-list audience sync'
)
ON CONFLICT(flag_key) DO NOTHING;

ALTER TABLE public.ad_sets
  ADD COLUMN IF NOT EXISTS stage text NULL,
  ADD COLUMN IF NOT EXISTS audience_codes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS audience_sizes jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ad_sets
  DROP CONSTRAINT IF EXISTS ad_sets_stage_check;
ALTER TABLE public.ad_sets
  ADD CONSTRAINT ad_sets_stage_check
  CHECK (stage IS NULL OR stage IN ('prospecting', 'retarget', 'abandoners'))
  NOT VALID;
ALTER TABLE public.ad_sets VALIDATE CONSTRAINT ad_sets_stage_check;

ALTER TABLE public.ad_sets
  DROP CONSTRAINT IF EXISTS ad_sets_audience_sizes_object;
ALTER TABLE public.ad_sets
  ADD CONSTRAINT ad_sets_audience_sizes_object
  CHECK (jsonb_typeof(audience_sizes) = 'object') NOT VALID;
ALTER TABLE public.ad_sets VALIDATE CONSTRAINT ad_sets_audience_sizes_object;

CREATE TABLE public.ad_stage_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  ad_set_id uuid NOT NULL REFERENCES public.ad_sets(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta','tiktok','snapchat','google','reddit')),
  stage text NOT NULL CHECK (stage IN ('prospecting','retarget','abandoners')),
  metric_date date NOT NULL,
  spend_cents bigint NOT NULL DEFAULT 0 CHECK (spend_cents >= 0),
  results numeric NOT NULL DEFAULT 0 CHECK (results >= 0),
  result_type text NOT NULL CHECK (char_length(btrim(result_type)) BETWEEN 1 AND 80),
  cost_per_result_cents bigint NULL CHECK (cost_per_result_cents IS NULL OR cost_per_result_cents >= 0),
  reach bigint NOT NULL DEFAULT 0 CHECK (reach >= 0),
  frequency numeric NOT NULL DEFAULT 0 CHECK (frequency >= 0),
  impressions bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  currency char(3) NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_set_id, metric_date)
);

CREATE INDEX ad_stage_metrics_campaign_date_idx
  ON public.ad_stage_metrics_daily(campaign_id, metric_date DESC);
CREATE INDEX ad_stage_metrics_event_date_idx
  ON public.ad_stage_metrics_daily(metric_date DESC, platform, stage);

ALTER TABLE public.ad_stage_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ad_stage_metrics_admin_read
  ON public.ad_stage_metrics_daily FOR SELECT TO authenticated
  USING (public.is_admin_user());
CREATE POLICY ad_stage_metrics_brand_read
  ON public.ad_stage_metrics_daily FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.ad_campaigns c
      WHERE c.id = ad_stage_metrics_daily.campaign_id
        AND c.brand_id IS NOT NULL
        AND public.biz_is_brand_member_for_read_for_caller(c.brand_id)
    )
  );

-- #1856: CREATE TABLE can inherit broad grants. Revoke before restoring the
-- exact read/write surface: admins and brand members read through RLS; only the
-- service-role sync worker writes.
REVOKE ALL ON public.ad_stage_metrics_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ad_stage_metrics_daily TO authenticated;
GRANT ALL ON public.ad_stage_metrics_daily TO service_role;

ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS stage_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS concept_tag text NULL,
  ADD COLUMN IF NOT EXISTS hook_tag text NULL,
  ADD COLUMN IF NOT EXISTS event_id uuid NULL REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS licence_reference text NULL,
  ADD COLUMN IF NOT EXISTS date_locked_until timestamptz NULL;

ALTER TABLE public.ad_creatives
  DROP CONSTRAINT IF EXISTS ad_creatives_stage_tags_check;
ALTER TABLE public.ad_creatives
  ADD CONSTRAINT ad_creatives_stage_tags_check
  CHECK (stage_tags <@ ARRAY['prospecting','retarget','abandoners']::text[])
  NOT VALID;
ALTER TABLE public.ad_creatives VALIDATE CONSTRAINT ad_creatives_stage_tags_check;

UPDATE public.ad_creatives c
SET event_id = source_event.id,
    date_locked_until = source_event.ends_at
FROM (
  SELECT
    a.creative_id,
    min(e.id::text)::uuid AS id,
    max(ed.end_at) AS ends_at
  FROM public.ads a
  JOIN public.ad_sets s ON s.id = a.ad_set_id
  JOIN public.ad_campaigns campaign ON campaign.id = s.campaign_id
  JOIN public.events e ON e.id = campaign.dest_event_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id
  WHERE a.creative_id IS NOT NULL
  GROUP BY a.creative_id
  HAVING count(DISTINCT e.id) = 1
) source_event
WHERE c.id = source_event.creative_id
  AND c.event_id IS NULL;

CREATE INDEX ad_creatives_brand_stage_idx
  ON public.ad_creatives(brand_id, status)
  WHERE purged_at IS NULL;
CREATE INDEX ad_creatives_event_date_lock_idx
  ON public.ad_creatives(event_id, date_locked_until)
  WHERE status = 'active' AND purged_at IS NULL;

CREATE OR REPLACE FUNCTION public.ad_archive_expired_creatives(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ad_creatives
  SET status = 'archived',
      archived_at = p_now,
      archived_by = NULL
  WHERE status = 'active'
    AND purged_at IS NULL
    AND date_locked_until IS NOT NULL
    AND date_locked_until <= p_now;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_archive_expired_creatives(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_archive_expired_creatives(timestamptz)
  TO service_role;

DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'issue_3697_archive_expired_ad_creatives';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule(
    'issue_3697_archive_expired_ad_creatives',
    '17 3 * * *',
    $command$SELECT public.ad_archive_expired_creatives(now());$command$
  );
END
$cron$;

-- Historical Snap stats could include dates before the campaign object existed.
-- Those rows cannot describe this Mingla campaign and must not survive.
DELETE FROM public.ad_spend_daily d
USING public.ad_campaigns c
WHERE d.campaign_id = c.id
  AND d.platform = 'snapchat'
  AND d.spend_date < (c.created_at AT TIME ZONE 'UTC')::date;

CREATE OR REPLACE VIEW public.ad_event_stage_summary_daily
WITH (security_invoker = true)
AS
SELECT
  c.dest_event_id AS event_id,
  m.metric_date,
  m.platform,
  m.stage,
  m.currency,
  sum(m.spend_cents)::bigint AS spend_cents,
  sum(CASE WHEN m.result_type IN ('landing_page_view','page_view') THEN m.results ELSE 0 END) AS landings,
  sum(CASE WHEN m.result_type IN ('purchase','complete_payment','sale') THEN m.results ELSE 0 END) AS sales,
  CASE
    WHEN sum(CASE WHEN m.result_type IN ('purchase','complete_payment','sale') THEN m.results ELSE 0 END) > 0
    THEN round(
      sum(m.spend_cents)::numeric /
      sum(CASE WHEN m.result_type IN ('purchase','complete_payment','sale') THEN m.results ELSE 0 END)
    )::bigint
    ELSE NULL
  END AS cost_per_sale_cents,
  sum(m.reach)::bigint AS reach,
  CASE WHEN sum(m.reach) > 0
    THEN round(sum(m.impressions)::numeric / sum(m.reach), 4)
    ELSE 0::numeric
  END AS frequency,
  max(m.synced_at) AS synced_at
FROM public.ad_stage_metrics_daily m
JOIN public.ad_campaigns c ON c.id = m.campaign_id
WHERE c.dest_event_id IS NOT NULL
GROUP BY c.dest_event_id, m.metric_date, m.platform, m.stage, m.currency;

REVOKE ALL ON public.ad_event_stage_summary_daily FROM PUBLIC, anon;
GRANT SELECT ON public.ad_event_stage_summary_daily TO authenticated, service_role;

COMMENT ON TABLE public.ad_stage_metrics_daily IS
  'I-3697-STAGE-METRICS: provider facts stored per day and provider ad set; campaign totals remain in ad_spend_daily.';
COMMENT ON VIEW public.ad_event_stage_summary_daily IS
  'Issue #3697 daily event summary for Ads reporting, split by platform and prospecting/retarget/abandoners stage.';

COMMIT;
