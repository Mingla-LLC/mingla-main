-- #4238 — LOCAL-ONLY Host ads fixture: one test brand with funded Ads credit
-- and one ad per state, so every Promote screen state can be walked.
--
-- TEST DATA ONLY. Loaded by scripts/sites/local/seed-host-ads.mjs into this
-- worktree's own Host ads stack only (start-host-ads-stack.sh; see the guard). No real payment: the credit is ledger
-- rows (a synthetic top-up), never a payment provider call. No ad platform is
-- called: the connections are "connected" rows with a fake token env name and
-- fake external ids. Never run against a shared or production database.
--
-- psql variables: :owner_email — an existing local auth user (the stack's
-- host-ads-owner@local.invalid); it owns the brand. :stack_project and
-- :stack_token — the stack identity. Runs once per database (fixed ids; a second
-- run says so and changes nothing).
--
-- States (one ad plan + campaign each; brand currency USD, 15% fee on top-up):
--   1 in review       platform_review, nothing ACTIVE
--   2 learning        live 3 days on Meta (inside the 7-day window)
--   3 running Meta    live 12 days on Meta, results and spend
--   4 running TikTok  live 12 days on TikTok (daily_budget_cents NULL on the
--                     campaign, as the ad-group budget stores it — tester P1-2)
--   5 paused sold out paused, latest stop reason sold_out
--   6 ended (passed)  ended, latest stop reason event_ended
--   7 rejected        platform_rejected, its one ad rejected
--   8 part-rejected   live, one of its two ads rejected

\set ON_ERROR_STOP on

-- #4238 rework 2 (tester P2-1): only THIS worktree's Host ads stack. The
-- psql variables :stack_project and :stack_token come from seed-host-ads.mjs
-- (.state/host-ads-stack.json); start-host-ads-stack.sh wrote the same token
-- inside the stack's container. Missing variables are a syntax error; another
-- database has no matching row. Either way nothing below runs.
SELECT EXISTS (
  SELECT 1 FROM sites_local.stack_identity
  WHERE project_id = :'stack_project' AND token = :'stack_token'
) AS host_ads_stack_ok \gset
\if :host_ads_stack_ok
\else
DO $refuse$ BEGIN RAISE EXCEPTION 'host-ads seed: this database is not this worktree''s Host ads stack; nothing written'; END $refuse$;
\endif

-- Run once per local database: plan versions, holds and ledger rows are
-- immutable by design, so a second run stops here (wipe the local stack to
-- start over: scripts/sites/local/start-host-ads-stack.sh --stop --wipe).
SELECT EXISTS (SELECT 1 FROM public.brands WHERE id = '4238f1a0-0000-4000-8000-000000000001') AS host_ads_seeded \gset
\if :host_ads_seeded
\echo 'host-ads seed: already loaded in this database (brand 4238f1a0-0000-4000-8000-000000000001); nothing to do.'
\quit
\endif

BEGIN;

CREATE TEMP TABLE seed_ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM auth.users WHERE lower(email) = lower(:'owner_email') LIMIT 1) AS owner_id,
  -- Checked again inside the transaction (the guard below), under a share lock.
  EXISTS (
    SELECT 1 FROM sites_local.stack_identity
    WHERE project_id = :'stack_project' AND token = :'stack_token'
    FOR SHARE
  ) AS stack_ok,
  '4238f1a0-0000-4000-8000-000000000001'::uuid AS brand_id,
  '4238f1a0-0000-4000-8000-000000000002'::uuid AS event_id,
  '4238f1a0-0000-4000-8000-000000000003'::uuid AS tier_id,
  '4238f1a0-0000-4000-8000-0000000000c1'::uuid AS meta_conn,
  '4238f1a0-0000-4000-8000-0000000000c2'::uuid AS tiktok_conn;

DO $guard$
BEGIN
  IF NOT (SELECT stack_ok FROM seed_ids) THEN
    RAISE EXCEPTION 'host-ads seed: this database is not this worktree''s Host ads stack; nothing written';
  END IF;
  IF (SELECT owner_id FROM seed_ids) IS NULL THEN
    RAISE EXCEPTION 'host-ads seed: no local auth user with that email (run seed-local.mjs first)';
  END IF;
END
$guard$;

-- LOCAL ONLY: the plan-binding and create-success triggers (they demand a
-- typed launch confirmation and move plan states) are switched off for this
-- one transaction and switched back on before COMMIT.
ALTER TABLE public.ad_campaigns DISABLE TRIGGER ad_campaign_plan_binding;
ALTER TABLE public.ad_campaigns DISABLE TRIGGER ad_campaign_record_plan_create_success;

-- ── Brand, event, ticket stock ──────────────────────────────────────────────
INSERT INTO public.creator_accounts (id) SELECT owner_id FROM seed_ids
ON CONFLICT (id) DO NOTHING;
-- #4238 rework 3 (tester P2-1): a brand country, so Step 2 starts with
-- "People in United States" instead of an empty country.
INSERT INTO public.brands (id, account_id, name, slug, pricing_currency, default_currency, country_code)
SELECT brand_id, owner_id, 'Host Ads Test Brand', 'host-ads-test-brand', 'USD', 'USD', 'US' FROM seed_ids;
-- A FAKE payout rail row (never called) so the brand's Ads currency resolves.
INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id, charges_enabled, payouts_enabled, country, default_currency)
SELECT brand_id, 'acct_local_seed_4238', true, true, 'US', 'usd' FROM seed_ids;

INSERT INTO public.events (id, brand_id, title, slug, status, visibility, timezone, currency, published_at)
SELECT event_id, brand_id, 'Rooftop Test Night', 'rooftop-test-night', 'scheduled', 'public', 'UTC', 'USD', now() - interval '20 days'
FROM seed_ids;
INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
SELECT event_id, date_trunc('day', now()) + interval '30 days 20 hours', date_trunc('day', now()) + interval '31 days 2 hours', 'UTC', true
FROM seed_ids;
INSERT INTO public.ticket_types (id, event_id, name, price_cents, quantity_total, currency, sold_count)
SELECT tier_id, event_id, 'General', 25_00, 300, 'USD', 40 FROM seed_ids;

-- ── Ads credit: a synthetic top-up (ledger only, no payment) ────────────────
-- Pay $10,000.00 → $8,500.00 credit (15% fee $1,500.00); the eight holds
-- take $6,570.00 of it, leaving $1,930.00 free.
INSERT INTO public.ad_credit_wallets (brand_id, currency, balance_cents, held_cents, currency_status)
SELECT brand_id, 'USD', 0, 0, 'aligned' FROM seed_ids;
INSERT INTO public.ad_credit_ledger (brand_id, entry_kind, amount_cents, fee_cents, pay_cents, balance_after_cents, currency, idempotency_key, metadata)
SELECT brand_id, 'top_up', 8_500_00, 1_500_00, 10_000_00, 8_500_00, 'USD', 'local-seed-4238-top-up-1', '{"local_seed":"4238"}'::jsonb FROM seed_ids;

-- ── Ad connections (fake; never called) ─────────────────────────────────────
-- #4238 rework 3 (tester P2-1): Host ads read the accounts on HOST_AD_LANE
-- ('consumer', supabase/functions/_shared/adChannelCore.ts). A 'business'
-- row left the builder on "Ads aren't available yet" on the seeded stack.
-- Keep this literal in step with HOST_AD_LANE (pinned by
-- issue_4238_rework3_seed_lane.implementor.test.ts).
INSERT INTO public.ad_connections (id, platform, lane, display_name, external_account_id, auth_kind, token_env_var, status, currency, connected)
SELECT meta_conn, 'meta', 'consumer', 'Local test Meta', 'act_local_4238', 'system_user_token', 'LOCAL_SEED_4238_FAKE_TOKEN', 'connected', 'USD', true FROM seed_ids
UNION ALL
SELECT tiktok_conn, 'tiktok', 'consumer', 'Local test TikTok', 'tt_local_4238', 'system_user_token', 'LOCAL_SEED_4238_FAKE_TOKEN', 'connected', 'USD', true FROM seed_ids;

-- ── One plan + campaign per state ───────────────────────────────────────────
-- n, label, platform, plan state, campaign status, days live (NULL = never),
-- daily credit, run days, spent credit, stop reason, ad review statuses
CREATE TEMP TABLE seed_states ON COMMIT DROP AS
SELECT * FROM (VALUES
  (1, 'In review',      'meta',   'platform_review',   'PAUSED', NULL::int, 50_00, 14,      0, NULL::text,     ARRAY['pending']),
  (2, 'Learning',       'meta',   'live',              'ACTIVE', 3,         60_00, 21,  180_00, NULL,          ARRAY['approved']),
  (3, 'Running Meta',   'meta',   'live',              'ACTIVE', 12,        40_00, 28,  480_00, NULL,          ARRAY['approved']),
  (4, 'Running TikTok', 'tiktok', 'live',              'ACTIVE', 12,        30_00, 28,  360_00, NULL,          ARRAY['approved']),
  (5, 'Sold out',       'meta',   'paused',            'PAUSED', 9,         45_00, 20,  405_00, 'sold_out',    ARRAY['approved']),
  (6, 'Event passed',   'meta',   'ended',             'PAUSED', 10,        35_00, 10,  350_00, 'event_ended', ARRAY['approved']),
  (7, 'Rejected',       'meta',   'platform_rejected', 'PAUSED', NULL,      50_00, 14,      0, NULL,          ARRAY['rejected']),
  (8, 'Part rejected',  'meta',   'live',              'ACTIVE', 5,         50_00, 14,  250_00, NULL,          ARRAY['approved', 'rejected'])
) AS t(n, label, platform, plan_state, status, days_live, daily_credit, run_days, spent_credit, stop_reason, reviews);

DO $states$
DECLARE
  s record;
  v_ids record;
  v_plan uuid;
  v_version uuid;
  v_campaign uuid;
  v_set uuid;
  v_ledger uuid;
  v_hash text;
  v_cap bigint;
  v_live timestamptz;
  v_conn uuid;
  v_balance bigint := 8_500_00;
  v_held bigint := 0;
  v_snapshot jsonb;
  i int;
BEGIN
  SELECT * INTO v_ids FROM seed_ids;
  v_snapshot := jsonb_build_object(
    'page_type', 'event', 'brand_slug', 'host-ads-test-brand', 'entity_slug', 'rooftop-test-night',
    'event_id', v_ids.event_id, 'canonical_url', 'https://usemingla.com/e/host-ads-test-brand/rooftop-test-night',
    'result_kind', 'clicks');
  FOR s IN SELECT * FROM seed_states ORDER BY n LOOP
    v_plan := ('4238f1a0-0000-4000-8000-1000000000' || lpad(s.n::text, 2, '0'))::uuid;
    v_version := ('4238f1a0-0000-4000-8000-2000000000' || lpad(s.n::text, 2, '0'))::uuid;
    v_campaign := ('4238f1a0-0000-4000-8000-3000000000' || lpad(s.n::text, 2, '0'))::uuid;
    v_set := ('4238f1a0-0000-4000-8000-4000000000' || lpad(s.n::text, 2, '0'))::uuid;
    v_hash := encode(sha256(convert_to('local-seed-4238-plan-' || s.n, 'UTF8')), 'hex');
    v_cap := s.daily_credit * s.run_days;
    v_conn := CASE WHEN s.platform = 'tiktok' THEN v_ids.tiktok_conn ELSE v_ids.meta_conn END;
    v_live := CASE WHEN s.days_live IS NULL THEN NULL ELSE now() - make_interval(days => s.days_live) END;

    INSERT INTO public.ad_plans (id, client_kind, owner_kind, brand_id, destination_family, destination_key, state)
    VALUES (v_plan, 'host', 'host', v_ids.brand_id, 'public_mingla_page', 'event:host-ads-test-brand:rooftop-test-night', s.plan_state);
    INSERT INTO public.ad_plan_versions (id, plan_id, version_number, canonical_plan, destination_snapshot, plan_hash, host_currency, host_budget_cents)
    VALUES (v_version, v_plan, 1,
      jsonb_build_object('measurement', jsonb_build_object('result_hierarchy', jsonb_build_array('ticket_sales')),
        'optimization_by_platform', jsonb_build_object(s.platform, 'sales'), 'local_seed', '4238'),
      v_snapshot, v_hash, 'USD', v_cap);
    INSERT INTO public.ad_plan_provider_allocations (id, plan_version_id, platform, connection_id, host_currency, host_budget_cents,
      host_delivery_budget_cents, provider_currency, provider_budget_cents, provider_delivery_budget_cents)
    VALUES (('4238f1a0-0000-4000-8000-5000000000' || lpad(s.n::text, 2, '0'))::uuid, v_version, s.platform, v_conn, 'USD', v_cap,
      s.daily_credit, 'USD', v_cap, s.daily_credit);

    -- The hold: credit set aside for this plan (ledger + funding hold).
    v_balance := v_balance - v_cap;
    v_held := v_held + v_cap;
    INSERT INTO public.ad_credit_ledger (brand_id, entry_kind, amount_cents, fee_cents, balance_after_cents, currency, idempotency_key, metadata)
    VALUES (v_ids.brand_id, 'campaign_spend', -v_cap, 0, greatest(v_balance, 0), 'USD', 'local-seed-4238-hold-' || s.n,
      -- #4238 rework 3 (tester P3-10): plan_id, as the real hold writes it, so
      -- the statement's "Per ad" rows carry each ad's name.
      jsonb_build_object('local_seed', '4238', 'plan_id', v_plan))
    RETURNING id INTO v_ledger;
    INSERT INTO public.ad_plan_funding_holds (id, plan_id, plan_version_id, plan_hash, funding_source, brand_id, ledger_id, currency, amount_cents, state)
    VALUES (('4238f1a0-0000-4000-8000-6000000000' || lpad(s.n::text, 2, '0'))::uuid, v_plan, v_version, v_hash, 'host_credit',
      v_ids.brand_id, v_ledger, 'USD', v_cap, CASE WHEN s.plan_state = 'ended' THEN 'settled' ELSE 'held' END);
    UPDATE public.ad_plans SET current_version_id = v_version WHERE id = v_plan;

    INSERT INTO public.ad_campaigns (id, connection_id, platform, external_campaign_id, name, objective, status,
      dest_page_type, dest_brand_slug, dest_url, dest_smart_link, currency, owner_kind, brand_id,
      daily_budget_cents, cap_cents, starts_at, ends_at, plan_version_id, plan_hash,
      host_budget_cents, provider_budget_cents, provider_delivery_budget_cents, provider_currency, currency_status)
    VALUES (v_campaign, v_conn, s.platform, 'local-seed-4238-' || s.n, 'Rooftop Test Night · ' || s.label, 'OUTCOME_SALES', s.status,
      'event', 'host-ads-test-brand', 'https://usemingla.com/e/host-ads-test-brand/rooftop-test-night',
      'https://usemingla.com/e/host-ads-test-brand/rooftop-test-night', 'USD', 'host', v_ids.brand_id,
      -- TikTok keeps its budget on the ad group: NULL here, as in production.
      CASE WHEN s.platform = 'tiktok' THEN NULL ELSE s.daily_credit END, v_cap,
      coalesce(v_live, now()), coalesce(v_live, now()) + make_interval(days => s.run_days), v_version, v_hash,
      v_cap, v_cap, s.daily_credit, 'USD', 'aligned');
    INSERT INTO public.ad_sets (id, campaign_id, external_adset_id, name, optimization_goal, status, stage)
    VALUES (v_set, v_campaign, 'local-seed-4238-set-' || s.n, 'Prospecting', 'OFFSITE_CONVERSIONS', s.status, 'prospecting');
    FOR i IN 1 .. cardinality(s.reviews) LOOP
      -- #4238 rework 3: brand_id too, so the builder's photo library lists them.
      INSERT INTO public.ad_creatives (id, kind, name, content_hash, source, source_url, source_brand_id, brand_id, width, height)
      VALUES (('4238f1a0-0000-4000-8000-7000000' || lpad(s.n::text, 2, '0') || lpad(i::text, 3, '0'))::uuid, 'image',
        'Seed creative ' || s.n || '.' || i, encode(sha256(convert_to('seed-creative-' || s.n || '-' || i, 'UTF8')), 'hex'),
        'host_upload', 'https://usemingla.com/og/default.jpg', v_ids.brand_id, v_ids.brand_id, 1080, 1080)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.ads (id, ad_set_id, external_ad_id, name, status, review_status, creative_id)
      VALUES (('4238f1a0-0000-4000-8000-8000000' || lpad(s.n::text, 2, '0') || lpad(i::text, 3, '0'))::uuid, v_set,
        'local-seed-4238-ad-' || s.n || '-' || i, 'Seed ad ' || s.n || '.' || i,
        CASE WHEN s.reviews[i] = 'rejected' THEN 'PAUSED' ELSE s.status END, s.reviews[i],
        ('4238f1a0-0000-4000-8000-7000000' || lpad(s.n::text, 2, '0') || lpad(i::text, 3, '0'))::uuid);
    END LOOP;

    IF v_live IS NOT NULL THEN
      INSERT INTO public.ad_status_events (campaign_id, platform, entity, action, from_status, to_status, created_at)
      VALUES (v_campaign, s.platform, 'campaign', 'launch', 'PAUSED', 'ACTIVE', v_live);
      -- Spend spread over the days live (credit = provider money here: both USD).
      INSERT INTO public.ad_spend_daily (campaign_id, platform, spend_date, spend_cents, impressions, clicks, currency)
      SELECT v_campaign, s.platform, (v_live + make_interval(days => d))::date, s.spent_credit / s.days_live, 4000, 60, 'USD'
      FROM generate_series(0, s.days_live - 1) AS d
      WHERE s.spent_credit > 0;
    END IF;
    IF s.stop_reason IS NOT NULL THEN
      INSERT INTO public.ad_status_events (campaign_id, platform, entity, action, from_status, to_status, provider_response, created_at)
      VALUES (v_campaign, s.platform, 'campaign', CASE WHEN s.plan_state = 'ended' THEN 'stop_confirmed' ELSE 'pause' END,
        'ACTIVE', 'PAUSED', jsonb_build_object('reason', s.stop_reason), now() - interval '1 hour');
    END IF;
  END LOOP;
  UPDATE public.ad_credit_wallets SET balance_cents = greatest(v_balance, 0), held_cents = v_held
  WHERE brand_id = v_ids.brand_id;
END
$states$;

ALTER TABLE public.ad_campaigns ENABLE TRIGGER ad_campaign_plan_binding;
ALTER TABLE public.ad_campaigns ENABLE TRIGGER ad_campaign_record_plan_create_success;

SELECT 'host-ads seed: brand ' || brand_id || ' (8 ads)' AS done FROM seed_ids;

COMMIT;
