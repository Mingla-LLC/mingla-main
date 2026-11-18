\set ON_ERROR_STOP on

-- Issue #4238 W4b — Host ad notices, brand admins launch and pause, and the
-- 7-day Mingla count. Runs after the full migration chain on PostgreSQL 17 as
-- supabase_admin. Everything runs in one rolled-back transaction.
--
--   N1  every type the #4430 constraint accepted is still accepted (62 types).
--   N2  the nine Host ad notice types are accepted.
--   N3  business.ad_unknown is refused.
--   R1  brand admin: read, plan, fund, launch, pause yes; end no.
--       (fund for admins came with 20281118014238, the ads roles change.)
--   R2  marketing without ads_spend still cannot launch or pause; finance
--       cannot launch; a removed admin and an unaccepted admin get nothing.
--   R3  the owner can still do everything; end stays owner-only.
--   R4  no answer is NULL (a missing permission key is false).
--   A1  the chart counts a sale 6 days after the tap, not one 8 days after,
--       not one before its tap and not one with no tap.
--
-- MINGLA-INVARIANT: I-4238-ADMIN-LAUNCH-PAUSE | issue #4238 | A brand admin can launch and pause Host ads; ending stays owner-only (ad_can_host_action 'end' is false for every team role).
-- MINGLA-INVARIANT: I-4238-MINGLA-COUNT-7D | issue #4238 | Mingla's own result count (results chart and Host results) only counts a sale made within 7 days after the ad tap it is credited to; no view-through.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.s_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 W4b FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

DO $t$
DECLARE
  v_owner uuid := '42380000-7200-4000-8000-000000000001';
  v_admin uuid := '42380000-7200-4000-8000-000000000002';
  v_marketing uuid := '42380000-7200-4000-8000-000000000003';
  v_finance uuid := '42380000-7200-4000-8000-000000000004';
  v_removed uuid := '42380000-7200-4000-8000-000000000005';
  v_invited uuid := '42380000-7200-4000-8000-000000000006';
  v_brand uuid := '42380000-7200-4000-8000-0000000000b1';
  v_type text;
  v_refused boolean;
  v_earlier text[] := ARRAY[
    'business.order_paid',
    'business.event_sold_out',
    'business.low_inventory',
    'business.refund_processed',
    'business.dispute_opened',
    'business.dispute_action_needed',
    'business.payout_paid',
    'business.payout_failed',
    'business.payout_waiting_for_bank',
    'business.payouts_paused',
    'business.payouts_resumed',
    'business.account_status_changed',
    'business.new_review',
    'business.claim_decision',
    'business.team_member_joined',
    'business.discount_limit_80',
    'business.discount_ended',
    'business.discount_needs_attention',
    'business.referral.sale',
    'business.referral.budget_80',
    'business.referral.budget_reached',
    'business.referral.member_joined',
    'business.referral.flagged',
    'creator.referral.invite',
    'creator.referral.sale',
    'creator.referral.tier_up',
    'creator.referral.paid',
    'creator.referral.payout_failed',
    'creator.referral.reversed',
    'business.gig.interest',
    'business.gig.accepted',
    'business.gig.declined_refunded',
    'business.gig.script_ready',
    'business.gig.video_ready',
    'business.gig.posts_live',
    'business.gig.auto_approved',
    'business.gig.dispute',
    'business.gig.rate',
    'business.gig.counter',
    'creator.gig.match',
    'creator.gig.offer',
    'creator.gig.offer_expiring',
    'creator.gig.script_locked',
    'creator.gig.fix_requested',
    'creator.gig.post_reminder',
    'creator.gig.posts_failed',
    'creator.gig.released',
    'creator.gig.dispute',
    'creator.gig.rate',
    'creator.gig.counter_answered',
    'creator.verify.state',
    'business.local.review_posted',
    'business.gig.shoot_confirmed',
    'business.gig.posts_submitted',
    'business.gig.post_due_soon',
    'business.gig.post_missed',
    'creator.gig.shoot_confirmed',
    'creator.gig.video_approved',
    'creator.gig.offer_cancelled',
    'creator.gig.post_missed',
    'business.gig.cancelled',
    'creator.gig.cancelled'
  ];
  v_new text[] := ARRAY[
    'business.ad_live','business.ad_rejected','business.ad_part_rejected',
    'business.ad_paused','business.ad_credit_low','business.ad_ended',
    'business.ad_slow_sales','business.ad_creative_tired','business.ad_last_tickets'
  ];
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'w4b-owner@example.test'), (v_admin, 'w4b-admin@example.test'),
    (v_marketing, 'w4b-marketing@example.test'), (v_finance, 'w4b-finance@example.test'),
    (v_removed, 'w4b-removed@example.test'), (v_invited, 'w4b-invited@example.test');
  INSERT INTO public.creator_accounts (id, email) VALUES
    (v_owner, 'w4b-owner@example.test'), (v_admin, 'w4b-admin@example.test'),
    (v_marketing, 'w4b-marketing@example.test'), (v_finance, 'w4b-finance@example.test'),
    (v_removed, 'w4b-removed@example.test'), (v_invited, 'w4b-invited@example.test');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_owner, 'W4b brand', 'w4b-brand', 'USD');
  INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at, removed_at, permissions_override)
  VALUES
    (v_brand, v_admin, 'brand_admin', now(), NULL, '{}'::jsonb),
    (v_brand, v_marketing, 'marketing_manager', now(), NULL, '{}'::jsonb),
    (v_brand, v_finance, 'finance_manager', now(), NULL, '{}'::jsonb),
    (v_brand, v_removed, 'brand_admin', now(), now(), '{}'::jsonb),
    (v_brand, v_invited, 'brand_admin', NULL, NULL, '{}'::jsonb);

  -- N1 / N2
  FOREACH v_type IN ARRAY v_earlier || v_new LOOP
    INSERT INTO public.business_notification_type_preferences (user_id, channel, type, opt_in)
    VALUES (v_owner, 'push', v_type, false);
  END LOOP;
  PERFORM pg_temp.s_assert(true, 'N1 every #4430 type still accepted');
  PERFORM pg_temp.s_assert(
    (SELECT count(*) FROM public.business_notification_type_preferences
     WHERE user_id = v_owner AND type = ANY(v_new)) = 9,
    'N2 the nine Host ad notice types are accepted');
  -- N3
  v_refused := false;
  BEGIN
    INSERT INTO public.business_notification_type_preferences (user_id, channel, type, opt_in)
    VALUES (v_owner, 'in_app', 'business.ad_unknown', false);
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  PERFORM pg_temp.s_assert(v_refused, 'N3 business.ad_unknown is refused');

  -- R1
  PERFORM pg_temp.s_assert(
    public.ad_can_host_action(v_brand, v_admin, 'read')
    AND public.ad_can_host_action(v_brand, v_admin, 'plan')
    AND public.ad_can_host_action(v_brand, v_admin, 'launch')
    AND public.ad_can_host_action(v_brand, v_admin, 'pause')
    AND public.ad_can_host_action(v_brand, v_admin, 'fund')
    AND NOT public.ad_can_host_action(v_brand, v_admin, 'end'),
    'R1 brand admin funds, launches and pauses, cannot end');
  -- R2
  PERFORM pg_temp.s_assert(
    NOT public.ad_can_host_action(v_brand, v_marketing, 'launch')
    AND NOT public.ad_can_host_action(v_brand, v_marketing, 'pause')
    AND NOT public.ad_can_host_action(v_brand, v_finance, 'launch')
    AND NOT public.ad_can_host_action(v_brand, v_finance, 'pause'),
    'R2 marketing without ads_spend and finance still cannot launch or pause');
  PERFORM pg_temp.s_assert(
    NOT public.ad_can_host_action(v_brand, v_removed, 'launch')
    AND NOT public.ad_can_host_action(v_brand, v_removed, 'read')
    AND NOT public.ad_can_host_action(v_brand, v_invited, 'launch')
    AND NOT public.ad_can_host_action(v_brand, v_invited, 'pause'),
    'R2 removed and unaccepted admins get nothing');
  -- R3
  PERFORM pg_temp.s_assert(
    public.ad_can_host_action(v_brand, v_owner, 'end')
    AND public.ad_can_host_action(v_brand, v_owner, 'launch')
    AND NOT public.ad_can_host_action(v_brand, v_admin, 'end')
    AND NOT public.ad_can_host_action(v_brand, v_finance, 'end')
    AND NOT public.ad_can_host_action(v_brand, v_marketing, 'end'),
    'R3 owner does everything; end stays owner-only');
  -- R3b (#4238 P3-1): a NULL or empty action is refused even for the owner.
  PERFORM pg_temp.s_assert(
    public.ad_can_host_action(v_brand, v_owner, NULL) IS FALSE
    AND public.ad_can_host_action(v_brand, v_owner, '') IS FALSE
    AND public.ad_can_host_action(v_brand, v_admin, NULL) IS FALSE,
    'R3b a NULL or empty action is false, the owner included');
  -- R4: every answer is true or false, never NULL (fail closed explicitly).
  PERFORM pg_temp.s_assert(
    (SELECT bool_and(public.ad_can_host_action(v_brand, u, a) IS NOT NULL)
     FROM unnest(ARRAY[v_admin, v_marketing, v_finance, v_removed, v_invited]) u,
          unnest(ARRAY['read','plan','fund','launch','pause','end','bogus']) a),
    'R4 no NULL answers');
END
$t$;

-- A1: the results chart counts the 7-day window only.
DO $a$
DECLARE
  v_owner uuid := '42380000-7200-4000-8000-000000000001';
  v_brand uuid := '42380000-7200-4000-8000-0000000000b1';
  v_conn uuid := '42380000-7200-4000-8000-0000000000c1';
  v_campaign uuid := '42380000-7200-4000-8000-0000000000d1';
  v_t6 uuid := gen_random_uuid();
  v_t8 uuid := gen_random_uuid();
  v_tf uuid := gen_random_uuid();
  v_total bigint;
BEGIN
  INSERT INTO public.ad_connections (
    id, platform, lane, display_name, external_account_id, auth_kind,
    token_env_var, status, currency, connected
  ) VALUES (
    v_conn, 'meta', 'business', 'W4b Meta', 'act_w4b', 'system_user_token',
    'ISSUE_4238_W4B_TOKEN', 'connected', 'USD', true
  );
  -- The window is the same for every lane; an Admin-lane row keeps the
  -- fixture free of a funded plan.
  INSERT INTO public.ad_campaigns (
    id, connection_id, platform, external_campaign_id, name, objective,
    status, dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
    currency
  ) VALUES (
    v_campaign, v_conn, 'meta', 'w4b-ext', 'W4b ad', 'OUTCOME_TRAFFIC',
    'PAUSED', 'event', 'w4b-brand', 'https://usemingla.com/e/w4b-brand/x',
    'https://usemingla.com/e/w4b-brand/x', 'USD'
  );
  INSERT INTO public.ad_attribution_touches (id, click_id, network, campaign_id, surface, created_at) VALUES
    (v_t6, 'w4b-click-6', 'meta', v_campaign, 'web', now() - interval '6 days'),
    (v_t8, 'w4b-click-8', 'meta', v_campaign, 'web', now() - interval '8 days'),
    (v_tf, 'w4b-click-f', 'meta', v_campaign, 'web', now() + interval '1 day');
  INSERT INTO public.ad_conversions (touch_id, event_type, event_name, campaign_id, platform, surface, event_id, created_at) VALUES
    (v_t6, 'purchase', 'Purchase', v_campaign, 'meta', 'web', 'w4b-ev-6', now()),
    (v_t8, 'purchase', 'Purchase', v_campaign, 'meta', 'web', 'w4b-ev-8', now()),
    (v_tf, 'purchase', 'Purchase', v_campaign, 'meta', 'web', 'w4b-ev-f', now()),
    (NULL, 'purchase', 'Purchase', v_campaign, 'meta', 'web', 'w4b-ev-none', now());
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- The CI image's auth.role() reads the older per-claim setting.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT coalesce(sum(results), 0) INTO v_total
  FROM public.ad_campaign_daily_series(ARRAY[v_campaign], 'UTC');
  PERFORM pg_temp.s_assert(v_total = 1,
    'A1 only the sale 6 days after its tap is counted (got ' || v_total || ')');
END
$a$;

ROLLBACK;
