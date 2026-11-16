-- Issue #4238 W4b: Host ad notices, brand admins launch and pause, and the
-- 7-day Mingla count on the results chart.
--
-- 1. business_notification_type_preferences accepts the nine Host ad notice
--    types. The list is EXACTLY the one in 20280707424430 (#4430) plus the
--    nine; nothing earlier is dropped (pg17 test proves every earlier type).
-- 2. ad_can_host_action: a brand admin can launch and pause (conductor's
--    decision 2 on amendment B). Ending stays owner-only; fund, plan and read
--    are unchanged.
-- 3. ad_campaign_daily_series counts a result only when the sale came within
--    7 days of the ad tap it was credited to (Mingla's count, amendment B §5,
--    no view-through). A missing or future tap is not counted.
--
-- Do NOT auto-apply. Release only through the reviewed governed migration lane.

BEGIN;

-- ── 1. Notice types ─────────────────────────────────────────────────────────
ALTER TABLE public.business_notification_type_preferences
  DROP CONSTRAINT IF EXISTS business_notification_type_preferences_type_check;
ALTER TABLE public.business_notification_type_preferences
  ADD CONSTRAINT business_notification_type_preferences_type_check CHECK(type IN (
    'business.order_paid','business.event_sold_out','business.low_inventory',
    'business.refund_processed','business.dispute_opened','business.dispute_action_needed',
    'business.payout_paid','business.payout_failed','business.payout_waiting_for_bank',
    'business.payouts_paused','business.payouts_resumed','business.account_status_changed',
    'business.new_review','business.claim_decision','business.team_member_joined',
    'business.discount_limit_80','business.discount_ended','business.discount_needs_attention',
    'business.referral.sale','business.referral.budget_80','business.referral.budget_reached',
    'business.referral.member_joined','business.referral.flagged',
    'creator.referral.invite','creator.referral.sale','creator.referral.tier_up',
    'creator.referral.paid','creator.referral.payout_failed','creator.referral.reversed',
    'business.gig.interest','business.gig.accepted','business.gig.declined_refunded',
    'business.gig.script_ready','business.gig.video_ready','business.gig.posts_live',
    'business.gig.auto_approved','business.gig.dispute','business.gig.rate','business.gig.counter',
    'creator.gig.match','creator.gig.offer','creator.gig.offer_expiring','creator.gig.script_locked',
    'creator.gig.fix_requested','creator.gig.post_reminder','creator.gig.posts_failed',
    'creator.gig.released','creator.gig.dispute','creator.gig.rate','creator.gig.counter_answered',
    'creator.verify.state','business.local.review_posted',
    'business.gig.shoot_confirmed','business.gig.posts_submitted','business.gig.post_due_soon',
    'business.gig.post_missed','creator.gig.shoot_confirmed','creator.gig.video_approved',
    'creator.gig.offer_cancelled','creator.gig.post_missed',
    -- #4430
    'business.gig.cancelled','creator.gig.cancelled',
    -- #4238 W4b: Host ad notices
    'business.ad_live','business.ad_rejected','business.ad_part_rejected',
    'business.ad_paused','business.ad_credit_low','business.ad_ended',
    'business.ad_slow_sales','business.ad_creative_tired','business.ad_last_tickets'
  )) NOT VALID;
ALTER TABLE public.business_notification_type_preferences
  VALIDATE CONSTRAINT business_notification_type_preferences_type_check;

-- ── 2. Host ad authority: brand admins launch and pause ─────────────────────
CREATE OR REPLACE FUNCTION public.ad_can_host_action(
  p_brand_id uuid,
  p_user_id uuid,
  p_action text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_permissions jsonb := '{}'::jsonb;
  v_is_owner boolean := false;
BEGIN
  IF p_brand_id IS NULL OR p_user_id IS NULL
     OR p_action NOT IN ('read','plan','fund','launch','pause','end') THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.account_id = p_user_id
      AND b.deleted_at IS NULL
  ) INTO v_is_owner;
  IF v_is_owner THEN RETURN true; END IF;

  SELECT m.role, coalesce(m.permissions_override, '{}'::jsonb)
    INTO v_role, v_permissions
  FROM public.brand_team_members m
  JOIN public.brands b ON b.id = m.brand_id
  WHERE m.brand_id = p_brand_id
    AND m.user_id = p_user_id
    AND m.removed_at IS NULL
    AND m.accepted_at IS NOT NULL
    AND b.deleted_at IS NULL
  ORDER BY public.biz_role_rank(m.role) DESC, m.id
  LIMIT 1;

  IF NOT FOUND THEN RETURN false; END IF;

  RETURN CASE p_action
    WHEN 'read' THEN
      v_role IN ('brand_admin','marketing_manager','finance_manager')
      OR v_permissions->'ads_view' = 'true'::jsonb
    WHEN 'plan' THEN
      v_role IN ('brand_admin','marketing_manager')
      OR v_permissions->'ads_plan' = 'true'::jsonb
    WHEN 'fund' THEN
      v_role = 'finance_manager'
      OR v_permissions->'ads_fund' = 'true'::jsonb
      OR v_permissions->'ads_spend' = 'true'::jsonb
    WHEN 'launch' THEN
      v_role = 'brand_admin'
      OR (v_role = 'marketing_manager'
        AND v_permissions->'ads_spend' = 'true'::jsonb)
      OR v_permissions->'ads_launch' = 'true'::jsonb
    WHEN 'pause' THEN
      v_role = 'brand_admin'
      OR (v_role = 'marketing_manager'
        AND v_permissions->'ads_spend' = 'true'::jsonb)
      OR v_permissions->'ads_pause' = 'true'::jsonb
    WHEN 'end' THEN false
    ELSE false
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_can_host_action(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_can_host_action(uuid,uuid,text)
  TO service_role;
COMMENT ON FUNCTION public.ad_can_host_action(uuid,uuid,text) IS
  'Issue #3697 v1.4 + #4238 W4b: independent Host Ads read/plan/fund/launch/pause/end authority. Brand owner may do all; brand admins plan, launch and pause; finance can fund; marketing can plan and launch/pause only with ads_spend; direct end remains owner-only.';

-- ── 3. Results chart: Mingla's 7-day count ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.ad_campaign_daily_series(
  p_campaign_ids uuid[],
  p_time_zone text
)
RETURNS TABLE (
  day date,
  campaign_id uuid,
  platform text,
  spend_cents bigint,
  currency text,
  impressions bigint,
  clicks bigint,
  page_visits bigint,
  results bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_tz text := 'UTC';
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.is_admin_user()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_time_zone IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_time_zone) THEN
    v_tz := p_time_zone;
  END IF;
  RETURN QUERY
  WITH ids AS (SELECT DISTINCT unnest(COALESCE(p_campaign_ids, ARRAY[]::uuid[])) AS id),
  spend AS (
    SELECT s.spend_date AS day, s.campaign_id, s.platform,
           sum(s.spend_cents)::bigint AS spend_cents, min(s.currency) AS currency,
           sum(s.impressions)::bigint AS impressions, sum(s.clicks)::bigint AS clicks
    FROM public.ad_spend_daily s JOIN ids ON ids.id = s.campaign_id
    GROUP BY 1, 2, 3
  ),
  visits AS (
    SELECT (t.created_at AT TIME ZONE v_tz)::date AS day, t.campaign_id,
           t.network AS platform, count(*)::bigint AS n
    FROM public.ad_attribution_touches t JOIN ids ON ids.id = t.campaign_id
    GROUP BY 1, 2, 3
  ),
  conv AS (
    -- #4238 W4b: Mingla counts a sale only within 7 days of the ad tap it is
    -- credited to (HOST_AD_CLICK_WINDOW_DAYS in _shared/hostAdAttribution.ts).
    SELECT (c.created_at AT TIME ZONE v_tz)::date AS day, c.campaign_id,
           c.platform, count(*)::bigint AS n
    FROM public.ad_conversions c JOIN ids ON ids.id = c.campaign_id
    JOIN public.ad_attribution_touches t ON t.id = c.touch_id
    WHERE t.created_at <= c.created_at
      AND c.created_at - t.created_at <= interval '7 days'
    GROUP BY 1, 2, 3
  ),
  keys AS (
    SELECT s.day, s.campaign_id FROM spend s
    UNION SELECT v.day, v.campaign_id FROM visits v
    UNION SELECT c.day, c.campaign_id FROM conv c
  )
  SELECT k.day, k.campaign_id,
         COALESCE((SELECT s.platform FROM spend s WHERE s.day = k.day AND s.campaign_id = k.campaign_id LIMIT 1),
                  (SELECT ac.platform FROM public.ad_campaigns ac WHERE ac.id = k.campaign_id)),
         (SELECT sum(s.spend_cents)::bigint FROM spend s WHERE s.day = k.day AND s.campaign_id = k.campaign_id),
         (SELECT min(s.currency) FROM spend s WHERE s.day = k.day AND s.campaign_id = k.campaign_id),
         (SELECT sum(s.impressions)::bigint FROM spend s WHERE s.day = k.day AND s.campaign_id = k.campaign_id),
         (SELECT sum(s.clicks)::bigint FROM spend s WHERE s.day = k.day AND s.campaign_id = k.campaign_id),
         COALESCE((SELECT sum(v.n)::bigint FROM visits v WHERE v.day = k.day AND v.campaign_id = k.campaign_id), 0),
         COALESCE((SELECT sum(c.n)::bigint FROM conv c WHERE c.day = k.day AND c.campaign_id = k.campaign_id), 0)
  FROM keys k
  ORDER BY k.day, k.campaign_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.ad_campaign_daily_series(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_campaign_daily_series(uuid[], text) TO authenticated, service_role;

COMMIT;
