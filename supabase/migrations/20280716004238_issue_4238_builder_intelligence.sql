-- Issue #4238 W3 (amendment A) — builder intelligence.
--
--   1. ad_plan_automation_events.kind gains retarget_added, retarget_removed,
--      creative_fatigue and apps_trimmed (T-2, T-4, T-6). The fatigue prompt
--      fires at most once per creative per plan in 7 days; that window is
--      enforced by the sweep (detail.creative_id), not by the once-index.
--   2. ad_creative_metrics_daily: per-ad impressions, link clicks and spend,
--      filled by admin-ad-spend-sync (T-4). Service role only.
--   3. ad_ops_switch_events.switch gains past_guest_seed, plus the admin RPC
--      admin_set_ad_past_guest_seed (T-3). It refuses to turn the seed on
--      without a privacy-review reference and ships OFF on all five apps
--      (no connection carries past_guest_seed_enabled = true).
--
-- Read-only probe (local full chain, W3 report): every existing kind and
-- switch value is inside the widened lists, so VALIDATE cannot fail.

-- ── 1. New automation kinds ──────────────────────────────────────────────────
ALTER TABLE public.ad_plan_automation_events
  DROP CONSTRAINT IF EXISTS ad_plan_automation_events_kind_check;
ALTER TABLE public.ad_plan_automation_events
  ADD CONSTRAINT ad_plan_automation_events_kind_check CHECK (kind IN (
    'goal_promoted','low_stock_copy','slow_sales_nudge','auto_paused','auto_ended',
    'retarget_added','retarget_removed','creative_fatigue','apps_trimmed'
  )) NOT VALID;
ALTER TABLE public.ad_plan_automation_events
  VALIDATE CONSTRAINT ad_plan_automation_events_kind_check;

-- ── 2. Per-ad daily metrics ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_creative_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta','tiktok','snapchat','google','reddit')),
  provider_ad_id text NOT NULL CHECK (char_length(btrim(provider_ad_id)) BETWEEN 1 AND 200),
  creative_id uuid NULL REFERENCES public.ad_creatives(id) ON DELETE SET NULL,
  metric_date date NOT NULL,
  impressions bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  link_clicks bigint NOT NULL DEFAULT 0 CHECK (link_clicks >= 0),
  spend_cents bigint NOT NULL DEFAULT 0 CHECK (spend_cents >= 0),
  currency char(3) NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, provider_ad_id, metric_date)
);

CREATE INDEX IF NOT EXISTS ad_creative_metrics_daily_campaign_date
  ON public.ad_creative_metrics_daily (campaign_id, metric_date DESC);

ALTER TABLE public.ad_creative_metrics_daily ENABLE ROW LEVEL SECURITY;
-- #1856: no policies; nothing for anon, authenticated or PUBLIC.
REVOKE ALL ON public.ad_creative_metrics_daily FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.ad_creative_metrics_daily TO service_role;

COMMENT ON TABLE public.ad_creative_metrics_daily IS
  'Issue #4238 T-4: per-ad daily impressions, link clicks and spend (Meta level ad, TikTok AUCTION_AD, Snap per-ad stats) for the tired-creative prompt. Written by admin-ad-spend-sync only.';

-- ── 3. Past-guest seed switch ────────────────────────────────────────────────
ALTER TABLE public.ad_ops_switch_events
  DROP CONSTRAINT IF EXISTS ad_ops_switch_events_switch_check;
ALTER TABLE public.ad_ops_switch_events
  ADD CONSTRAINT ad_ops_switch_events_switch_check
  CHECK (switch IN ('reach_estimates','past_guest_seed')) NOT VALID;
ALTER TABLE public.ad_ops_switch_events
  VALIDATE CONSTRAINT ad_ops_switch_events_switch_check;

CREATE OR REPLACE FUNCTION public.admin_set_ad_past_guest_seed(
  p_platform text,
  p_enabled boolean,
  p_privacy_review_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
  v_ref text := nullif(btrim(coalesce(p_privacy_review_ref, '')), '');
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit') THEN
    RAISE EXCEPTION 'platform_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = '22023';
  END IF;
  -- R-3: customer lists stay behind the D2 privacy review.
  IF p_enabled AND v_ref IS NULL THEN
    RAISE EXCEPTION 'privacy_review_ref_required' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NOT NULL AND char_length(v_ref) > 200 THEN
    RAISE EXCEPTION 'privacy_review_ref_invalid' USING ERRCODE = '22023';
  END IF;
  -- Host ads run on the consumer lane (#4238 D1, HOST_AD_LANE).
  UPDATE public.ad_connections
  SET extra = coalesce(extra, '{}'::jsonb)
        || jsonb_build_object('past_guest_seed_enabled', p_enabled)
  WHERE platform = p_platform AND lane = 'consumer';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.ad_ops_switch_events (switch, platform, value, actor_id)
  VALUES ('past_guest_seed', p_platform,
    jsonb_build_object('enabled', p_enabled, 'rows', v_count,
      'privacy_review_ref', v_ref), auth.uid());
  RETURN jsonb_build_object('platform', p_platform, 'enabled', p_enabled,
    'rows', v_count, 'privacy_review_ref', v_ref);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_ad_past_guest_seed(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ad_past_guest_seed(text, boolean, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_ad_past_guest_seed(text, boolean, text) IS
  'Issue #4238 T-3: staff switch the past-guests starting audience for "Let Mingla choose" per ad app. Admins only (42501 otherwise). Turning it on needs a privacy-review reference (D2). Audited in ad_ops_switch_events. Ships OFF.';
