-- toward #3697 Wave 2 — spend feed, hard cap, brand_id (#3701 / #3705 / #3709)
-- Do NOT auto-apply — Management API post-merge.

BEGIN;

-- ── ad_campaigns money / identity columns ───────────────────────────────────
ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_kind text NOT NULL DEFAULT 'mingla',
  ADD COLUMN IF NOT EXISTS cap_cents bigint NULL,
  ADD COLUMN IF NOT EXISTS lifetime_budget_cents bigint NULL,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ad_campaigns_owner_kind_check'
      AND conrelid = 'public.ad_campaigns'::regclass
  ) THEN
    ALTER TABLE public.ad_campaigns
      ADD CONSTRAINT ad_campaigns_owner_kind_check
      CHECK (owner_kind IN ('mingla', 'host'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ad_campaigns_cap_cents_check'
      AND conrelid = 'public.ad_campaigns'::regclass
  ) THEN
    ALTER TABLE public.ad_campaigns
      ADD CONSTRAINT ad_campaigns_cap_cents_check
      CHECK (cap_cents IS NULL OR cap_cents > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ad_campaigns_lifetime_budget_cents_check'
      AND conrelid = 'public.ad_campaigns'::regclass
  ) THEN
    ALTER TABLE public.ad_campaigns
      ADD CONSTRAINT ad_campaigns_lifetime_budget_cents_check
      CHECK (lifetime_budget_cents IS NULL OR lifetime_budget_cents > 0);
  END IF;
END$$;

COMMENT ON COLUMN public.ad_campaigns.brand_id IS
  'toward #3697 Wave 2 (#3705): stable brand FK; dest_brand_slug remains for display/legacy.';
COMMENT ON COLUMN public.ad_campaigns.owner_kind IS
  'toward #3697 Wave 2: mingla (Admin, no fee) | host (Ari, 15% fee).';
COMMENT ON COLUMN public.ad_campaigns.cap_cents IS
  'toward #3697 Wave 2 (#3701): hard ad-budget cap in minor units. Mingla pauses at 98%.';
COMMENT ON COLUMN public.ad_campaigns.lifetime_budget_cents IS
  'toward #3697 Wave 2: platform lifetime budget in minor units when budget_mode=lifetime.';
COMMENT ON COLUMN public.ad_campaigns.starts_at IS
  'toward #3697 Wave 2: scheduled start (UTC).';
COMMENT ON COLUMN public.ad_campaigns.ends_at IS
  'toward #3697 Wave 2: scheduled end (UTC); hourly sync pauses after this.';
COMMENT ON COLUMN public.ad_campaigns.currency IS
  'toward #3697 Wave 2: ISO-4217 account currency for money columns (default USD).';

-- Backfill brand_id from slug (case-insensitive; newest non-deleted brand wins).
UPDATE public.ad_campaigns c
SET brand_id = b.id
FROM public.brands b
WHERE c.brand_id IS NULL
  AND b.deleted_at IS NULL
  AND lower(b.slug) = lower(c.dest_brand_slug);

CREATE INDEX IF NOT EXISTS ad_campaigns_brand_id_idx
  ON public.ad_campaigns (brand_id)
  WHERE brand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ad_campaigns_ends_at_idx
  ON public.ad_campaigns (ends_at)
  WHERE ends_at IS NOT NULL AND status = 'ACTIVE';

-- ── Daily spend feed ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_spend_daily (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  platform     text NOT NULL,
  spend_date   date NOT NULL,
  spend_cents  bigint NOT NULL CHECK (spend_cents >= 0),
  impressions  bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks       bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  currency     text NOT NULL DEFAULT 'USD',
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, platform, spend_date)
);

COMMENT ON TABLE public.ad_spend_daily IS
  'toward #3697 Wave 2 (#3701/#3705): hourly platform spend feed. ROI panels join this; never fabricate spend from budget.';

CREATE INDEX IF NOT EXISTS ad_spend_daily_campaign_date_idx
  ON public.ad_spend_daily (campaign_id, spend_date DESC);
CREATE INDEX IF NOT EXISTS ad_spend_daily_date_idx
  ON public.ad_spend_daily (spend_date);

ALTER TABLE public.ad_spend_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_spend_daily_admin_select ON public.ad_spend_daily;
CREATE POLICY ad_spend_daily_admin_select ON public.ad_spend_daily
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

DROP POLICY IF EXISTS ad_spend_daily_brand_select ON public.ad_spend_daily;
CREATE POLICY ad_spend_daily_brand_select ON public.ad_spend_daily
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.ad_campaigns c
      WHERE c.id = ad_spend_daily.campaign_id
        AND c.brand_id IS NOT NULL
        AND public.biz_is_brand_member_for_read_for_caller(c.brand_id)
    )
  );

-- #1856 D-01: CREATE TABLE inherits authenticated ALL; revoke before SELECT-only.
REVOKE ALL ON public.ad_spend_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ad_spend_daily TO authenticated;
GRANT ALL ON public.ad_spend_daily TO service_role;

-- ── Rollup: real spend from ad_spend_daily (NULL until first sync row) ───────
CREATE OR REPLACE FUNCTION public.ad_campaign_conversion_rollup(p_campaign_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin   boolean;
  v_brand_id   uuid;
  v_authorized boolean;
  v_result     jsonb;
  v_spend      bigint;
BEGIN
  v_is_admin := public.is_admin_user();

  IF p_campaign_id IS NOT NULL THEN
    SELECT COALESCE(c.brand_id, b.id) INTO v_brand_id
    FROM public.ad_campaigns c
    LEFT JOIN public.brands b
      ON lower(b.slug) = lower(c.dest_brand_slug) AND b.deleted_at IS NULL
    WHERE c.id = p_campaign_id;

    v_authorized := v_is_admin
      OR (v_brand_id IS NOT NULL AND public.biz_is_brand_member_for_read_for_caller(v_brand_id));
  ELSE
    v_authorized := v_is_admin;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'campaign_id', p_campaign_id,
      'authorized', false,
      'conversions', 0,
      'value_cents', '{}'::jsonb,
      'spend_cents', NULL,
      'by_platform', '[]'::jsonb,
      'send_health', jsonb_build_object('sent',0,'failed',0,'skipped',0,'pending',0)
    );
  END IF;

  -- NULL until the hourly feed has written at least one row (never fabricate $0).
  SELECT SUM(s.spend_cents)::bigint INTO v_spend
  FROM public.ad_spend_daily s
  WHERE (p_campaign_id IS NULL OR s.campaign_id = p_campaign_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.ad_spend_daily s
    WHERE (p_campaign_id IS NULL OR s.campaign_id = p_campaign_id)
  ) THEN
    v_spend := NULL;
  END IF;

  WITH scoped AS (
    SELECT c.*
    FROM public.ad_conversions c
    WHERE (p_campaign_id IS NULL OR c.campaign_id = p_campaign_id)
      AND c.campaign_id IS NOT NULL
  ),
  by_platform AS (
    SELECT COALESCE(platform, 'unknown') AS platform,
           COUNT(*)::bigint             AS conversions,
           SUM(COALESCE(value_cents, 0))::bigint AS value_cents,
           COUNT(*) FILTER (WHERE meta_capi_status='sent' OR tiktok_events_status='sent' OR snap_capi_status='sent' OR reddit_capi_status='sent')::bigint AS sent,
           COUNT(*) FILTER (WHERE meta_capi_status='failed' OR tiktok_events_status='failed' OR snap_capi_status='failed' OR reddit_capi_status='failed')::bigint AS failed
    FROM scoped
    GROUP BY COALESCE(platform, 'unknown')
  ),
  value_by_ccy AS (
    SELECT COALESCE(currency, 'GBP') AS currency,
           SUM(COALESCE(value_cents, 0))::bigint AS cents
    FROM scoped
    GROUP BY COALESCE(currency, 'GBP')
    HAVING SUM(COALESCE(value_cents, 0)) > 0
  )
  SELECT jsonb_build_object(
    'campaign_id', p_campaign_id,
    'authorized', true,
    'conversions', (SELECT COUNT(*)::bigint FROM scoped),
    'value_cents', COALESCE((SELECT jsonb_object_agg(currency, cents) FROM value_by_ccy), '{}'::jsonb),
    'spend_cents', v_spend,
    'by_platform', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'platform', platform,
        'conversions', conversions,
        'value_cents', value_cents,
        'sent', sent,
        'failed', failed
      ) ORDER BY conversions DESC, platform)
      FROM by_platform
    ), '[]'::jsonb),
    'send_health', jsonb_build_object(
      'sent',    (SELECT COUNT(*)::bigint FROM scoped WHERE meta_capi_status='sent' OR tiktok_events_status='sent' OR snap_capi_status='sent' OR reddit_capi_status='sent'),
      'failed',  (SELECT COUNT(*)::bigint FROM scoped WHERE meta_capi_status='failed' OR tiktok_events_status='failed' OR snap_capi_status='failed' OR reddit_capi_status='failed'),
      'skipped', (SELECT COUNT(*)::bigint FROM scoped WHERE meta_capi_status='skipped' AND tiktok_events_status='skipped' AND snap_capi_status='skipped' AND reddit_capi_status='skipped'),
      'pending', (SELECT COUNT(*)::bigint FROM scoped WHERE meta_capi_status='pending' OR tiktok_events_status='pending' OR snap_capi_status='pending' OR reddit_capi_status='pending')
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.ad_campaign_conversion_rollup(uuid) IS
  'ISSUE-865 + #3697 Wave 2: per-campaign conversion rollup. spend_cents from ad_spend_daily (NULL until first feed row — never fabricate from budget).';

REVOKE EXECUTE ON FUNCTION public.ad_campaign_conversion_rollup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_campaign_conversion_rollup(uuid) TO authenticated;

-- ── Hourly spend sync cron (pg_cron + pg_net → edge function) ───────────────
-- Fail-open when pg_cron is absent (CI baseline / fresh local) — same pattern
-- as Wave 0 attribution purge. Production has pg_cron; re-apply to schedule.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Issue #3697 Wave 2: pg_cron not enabled; spend-sync cron NOT scheduled.';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Issue #3697 Wave 2: pg_net is not enabled. The spend-sync cron body will no-op until it is.';
  END IF;

  SELECT j.jobid INTO v_job_id
  FROM cron.job j
  WHERE j.jobname = 'issue_3697_ad_spend_sync_hourly'
  LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'issue_3697_ad_spend_sync_hourly',
    '15 * * * *',
    $cron$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
            FROM vault.decrypted_secrets
           WHERE name = 'supabase_url'
           LIMIT 1
        ) || '/functions/v1/admin-ad-spend-sync',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret
              FROM vault.decrypted_secrets
             WHERE name = 'service_role_key'
             LIMIT 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $cron$
  );
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Issue #3697 Wave 2: cron.job not visible; spend-sync cron NOT scheduled.';
END$$;

COMMIT;
