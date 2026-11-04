\set ON_ERROR_STOP on

-- Issue #4238 media-buyer, tester round 8 — adversarial money checks on
-- host_ad_amend_live and the replaced ad_finalize_campaign_settlement. Runs
-- after the full migration chain on PostgreSQL 17 as supabase_admin over
-- 127.0.0.1. A different angle from the implementor suite (M4/M5, one lot,
-- raise-then-settle only):
--
--   A1  Credit lots stay whole: after a raise across two lots (one carries a
--       fee), a lower, and settlement, the lots' remaining credit always
--       equals the wallet balance and no lot goes negative.
--   A2  Settlement after a LOWER gives back exactly the new total minus the
--       spend, and the wallet's held money returns to zero for that plan.
--   A3  A plan with no live edit (amended cap empty, like every campaign
--       from before this change) settles as before: within its cap it
--       settles; over its first cap it is still "attention required".
--   A4  Hostile calls are refused with nothing moved: no change at all, a
--       zero or negative total, another plan's campaign, a cap under spend.
--   A5  The per-app caps sent with a live edit can never add up to more than
--       the new total (in the brand's money). RED at 0bcf8a9bc: the function
--       trusts the caller's caps, so a NGN 31,000 total with a USD 100 cap
--       is recorded and the app may spend far beyond the credit set aside.

CREATE OR REPLACE FUNCTION pg_temp.tmt_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 media-buyer tester FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('42380000-0000-4000-c000-000000000001', 'tmt-host@mingla-fixture.org'),
  ('42380000-0000-4000-c000-000000000002', 'tmt-admin@mingla-fixture.org');
INSERT INTO public.admin_users(email, role, status)
VALUES ('tmt-admin@mingla-fixture.org', 'admin', 'active');

-- One funded live Host plan on Meta: NGN p_budget, USD cap p_cap (NGN 1,500 = USD 1).
CREATE OR REPLACE FUNCTION pg_temp.tmt_live_plan(p_n integer, p_budget bigint, p_cap bigint)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_user constant uuid := '42380000-0000-4000-c000-000000000001';
  v_admin constant uuid := '42380000-0000-4000-c000-000000000002';
  v_brand constant uuid := '42380000-0000-4000-c000-000000000101';
  v_conn constant uuid := '42380000-0000-4000-c000-000000000201';
  v_snap constant uuid := '42380000-0000-4000-c000-000000000301';
  v_plan public.ad_plans%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_campaign uuid := gen_random_uuid();
BEGIN
  v_plan := public.ad_plan_open('host', 'host', v_brand, 'public_mingla_page',
    'brand:tmt-brand', '[]'::jsonb, v_user);
  v_version := public.ad_plan_create_version(
    v_plan.id,
    '{"platforms":["meta"],"confirmation_phrase":"LAUNCH"}'::jsonb
      || jsonb_build_object('n', p_n, 'media_rights', jsonb_build_object(
        'rights_confirmed', true, 'rights_basis', 'owned', 'ai_generated', false,
        'house_reuse_allowed', false, 'attested_by', v_user::text, 'attested_at', now())),
    p_budget, 'NGN', jsonb_build_array(jsonb_build_object(
      'platform', 'meta', 'connection_id', v_conn,
      'host_budget_cents', p_budget, 'host_delivery_budget_cents', p_budget / 10,
      'provider_budget_cents', p_cap, 'provider_delivery_budget_cents', p_cap / 10,
      'fx_snapshot_id', v_snap)), v_user);
  INSERT INTO public.ad_plan_targeting_snapshots (
    plan_version_id, platform, audience_intent, compiled_targeting, verdict,
    evidence_observed_at, compiler_version
  ) VALUES (v_version.id, 'meta', '{"countries":["NG"]}'::jsonb,
    '{"geo_locations":{"countries":["NG"]}}'::jsonb, 'exact', now(), 'v1.4-test');
  PERFORM public.ad_plan_mark_ready(v_version.id, v_version.plan_hash);
  PERFORM public.ad_plan_hold_host_funds(v_version.id, v_version.plan_hash,
    'tmt-hold-' || p_n || '-key', v_user);
  -- Only a brand's first Host ads wait for a Mingla check.
  IF (SELECT state FROM public.ad_plans WHERE id = v_plan.id) = 'staff_review_required' THEN
    PERFORM public.ad_plan_record_review(v_version.id, v_version.plan_hash,
      'approved', 'Test approval', v_admin);
  END IF;
  PERFORM public.ad_plan_confirm_launch(v_version.id, v_version.plan_hash,
    'LAUNCH', v_user);
  INSERT INTO public.ad_campaigns (
    id, connection_id, platform, external_campaign_id, name, objective,
    status, dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
    brand_id, owner_kind, currency, plan_version_id, plan_hash,
    host_budget_cents, provider_budget_cents, provider_delivery_budget_cents,
    fx_snapshot_id, provider_currency
  ) VALUES (
    v_campaign, v_conn, 'meta', 'tmt-meta-' || p_n, 'TMT ' || p_n,
    'OUTCOME_TRAFFIC', 'ACTIVE', 'brand', 'tmt-brand',
    'https://usemingla.com/b/tmt-brand', 'https://usemingla.com/b/tmt-brand',
    v_brand, 'host', 'NGN', v_version.id, v_version.plan_hash,
    p_budget, p_cap, p_cap / 10, v_snap, 'USD');
  -- USD 5 spent so far (NGN 7,500).
  INSERT INTO public.ad_spend_daily (campaign_id, platform, spend_date,
    spend_cents, impressions, clicks, currency)
  VALUES (v_campaign, 'meta', current_date, 500, 0, 0, 'USD');
  UPDATE public.ad_plans SET state = 'live' WHERE id = v_plan.id;
  RETURN jsonb_build_object('plan', v_plan.id, 'version', v_version.id,
    'hash', v_version.plan_hash, 'campaign', v_campaign);
END $f$;

-- Lots whole: remaining credit across lots = wallet balance; nothing negative.
CREATE OR REPLACE FUNCTION pg_temp.tmt_lots_whole(p_label text) RETURNS void LANGUAGE plpgsql AS $w$
DECLARE
  v_brand constant uuid := '42380000-0000-4000-c000-000000000101';
BEGIN
  PERFORM pg_temp.tmt_assert(
    (SELECT coalesce(sum(credit_remaining_cents), 0) FROM public.ad_credit_lots WHERE brand_id = v_brand)
      = (SELECT balance_cents FROM public.ad_credit_wallets WHERE brand_id = v_brand)
    AND NOT EXISTS (SELECT 1 FROM public.ad_credit_lots WHERE brand_id = v_brand
      AND (credit_remaining_cents < 0 OR fee_remaining_cents < 0
           OR pay_remaining_cents <> credit_remaining_cents + fee_remaining_cents)),
    p_label);
END $w$;

CREATE OR REPLACE FUNCTION pg_temp.tmt_settle(p_campaign uuid, p_spend bigint, p_key text)
RETURNS public.ad_campaign_settlements LANGUAGE plpgsql AS $s$
BEGIN
  UPDATE public.ad_spend_daily SET spend_cents = p_spend WHERE campaign_id = p_campaign;
  PERFORM public.ad_request_campaign_stop(p_campaign, now());
  PERFORM public.ad_confirm_campaign_stop(p_campaign, p_spend, 'USD', now(),
    jsonb_build_object('provider_status', 'PAUSED', 'final_insights_id', p_key), interval '0');
  RETURN public.ad_finalize_campaign_settlement(p_campaign, p_key, now() + interval '1 second');
END $s$;

DO $t$
DECLARE
  v_user constant uuid := '42380000-0000-4000-c000-000000000001';
  v_brand constant uuid := '42380000-0000-4000-c000-000000000101';
  v_conn constant uuid := '42380000-0000-4000-c000-000000000201';
  v_snap constant uuid := '42380000-0000-4000-c000-000000000301';
  a jsonb; b jsonb; c jsonb; d jsonb; e jsonb;
  v_edit public.host_ad_live_edits%ROWTYPE;
  v_set public.ad_campaign_settlements%ROWTYPE;
  v_balance bigint; v_held bigint;
  v_before_balance bigint; v_before_held bigint;
  v_ok boolean;
  v_state text;
BEGIN
  INSERT INTO public.creator_accounts (id, email) VALUES (v_user, 'tmt-host@mingla-fixture.org');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency,
    payment_provider, payment_country, paystack_subaccount_code)
  VALUES (v_brand, v_user, 'TMT Brand', 'tmt-brand', 'NGN', 'paystack', 'NG', 'ACCT_tmt');
  INSERT INTO public.ad_connections (id, platform, lane, display_name,
    external_account_id, auth_kind, token_env_var, status, currency, connected)
  VALUES (v_conn, 'meta', 'business', 'TMT Meta', 'act_tmt', 'system_user_token',
    'TMT_META_TOKEN', 'connected', 'USD', true)
  ON CONFLICT (platform, lane) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.ad_connections WHERE id = v_conn) THEN
    RAISE EXCEPTION 'issue #4238 tester fixture: a business Meta connection already exists; run on a fresh chain';
  END IF;
  UPDATE public.fx_rate_snapshots SET status = 'superseded' WHERE status = 'active';
  INSERT INTO public.fx_rate_snapshots (id, provider, base_currency_code,
    provider_updated_at, provider_next_update_at, provider_eol_at, stale_after,
    expires_at, payload_sha256, status)
  VALUES (v_snap, 'exchange_rate_api_open_v6', 'USD', now() - interval '1 hour',
    now() + interval '1 day', now() + interval '2 days', now() + interval '1 day',
    now() + interval '7 days', repeat('c', 64), 'active');
  INSERT INTO public.fx_rates (snapshot_id, currency_code, rate_per_base)
  VALUES (v_snap, 'USD', 1), (v_snap, 'NGN', 1500);
  -- Two lots: NGN 160,000 credit with a NGN 8,000 card fee, then NGN 20,000 with none.
  PERFORM public.ad_credit_apply(v_brand, 'top_up', 16000000, 'NGN',
    'tmt-topup-0001', 800000, 16800000, NULL, NULL, 'mingla_adc_tmt_1', v_user, '{}'::jsonb);
  PERFORM public.ad_credit_apply(v_brand, 'top_up', 2000000, 'NGN',
    'tmt-topup-0002', 0, 2000000, NULL, NULL, 'mingla_adc_tmt_2', v_user, '{}'::jsonb);
  PERFORM pg_temp.tmt_lots_whole('A1 fixture: two lots, whole');

  -- Plans: A raise, B lower, C/D no edit (like a pre-change campaign), E hostile.
  a := pg_temp.tmt_live_plan(1, 3000000, 2000);
  b := pg_temp.tmt_live_plan(2, 3000000, 2000);
  c := pg_temp.tmt_live_plan(3, 3000000, 2000);
  d := pg_temp.tmt_live_plan(4, 3000000, 2000);
  e := pg_temp.tmt_live_plan(5, 3000000, 2000);
  PERFORM pg_temp.tmt_lots_whole('A1 five holds keep the lots whole');

  -- A1: raise A by NGN 30,000 more than the first lot has left (it spans both lots).
  SELECT balance_cents INTO v_before_balance FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  v_edit := public.host_ad_amend_live((a->>'version')::uuid, a->>'hash',
    3000000 + v_before_balance - 500000, NULL,
    jsonb_build_array(jsonb_build_object('campaign_id', a->>'campaign',
      'new_provider_budget_cents', (3000000 + v_before_balance - 500000) / 1500,
      'new_provider_delivery_budget_cents', 200)),
    v_user, 'tmt-edit-a-0001', '{}'::jsonb);
  PERFORM pg_temp.tmt_assert((SELECT balance_cents FROM public.ad_credit_wallets WHERE brand_id = v_brand) = 500000,
    'A1 a raise across both lots leaves exactly NGN 5,000 of credit');
  PERFORM pg_temp.tmt_lots_whole('A1 after a raise across two lots (one with a fee), the lots are whole');
  PERFORM pg_temp.tmt_assert(
    (SELECT count(*) FROM public.ad_credit_hold_allocations h
      JOIN public.ad_plan_funding_holds f ON f.id = h.hold_id
      WHERE f.plan_version_id = (a->>'version')::uuid) = 2,
    'A1 the raise merges into the existing lot row and adds the second lot');

  -- A2: lower B from NGN 30,000 to NGN 12,000, then settle it at USD 5 spent.
  SELECT balance_cents, held_cents INTO v_before_balance, v_before_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  v_edit := public.host_ad_amend_live((b->>'version')::uuid, b->>'hash', 1200000, NULL,
    jsonb_build_array(jsonb_build_object('campaign_id', b->>'campaign',
      'new_provider_budget_cents', 800, 'new_provider_delivery_budget_cents', 100)),
    v_user, 'tmt-edit-b-0001', '{}'::jsonb);
  PERFORM pg_temp.tmt_assert(v_edit.hold_delta_cents = -1800000, 'A2 the lower records -NGN 18,000');
  PERFORM pg_temp.tmt_lots_whole('A2 after a lower the lots are whole');
  v_set := pg_temp.tmt_settle((b->>'campaign')::uuid, 500, 'tmt-settle-b-0001');
  SELECT balance_cents, held_cents INTO v_balance, v_held FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  PERFORM pg_temp.tmt_assert(v_set.state = 'settled' AND v_set.released_host_cents = 450000,
    'A2 settling after a lower gives back NGN 12,000 - NGN 7,500 = NGN 4,500');
  PERFORM pg_temp.tmt_assert(v_balance = v_before_balance + 1800000 + 450000
      AND v_held = v_before_held - 3000000,
    'A2 the wallet holds nothing more for plan B and got back NGN 22,500 in all');
  PERFORM pg_temp.tmt_lots_whole('A2 after settling a lowered plan the lots are whole');

  -- A3: no live edit (amended cap empty): within cap settles, over the first cap is flagged.
  v_set := pg_temp.tmt_settle((c->>'campaign')::uuid, 1000, 'tmt-settle-c-0001');
  PERFORM pg_temp.tmt_assert(v_set.state = 'settled' AND v_set.released_host_cents = 1500000,
    'A3 an unedited campaign within its cap settles as before (NGN 15,000 back)');
  v_set := pg_temp.tmt_settle((d->>'campaign')::uuid, 2100, 'tmt-settle-d-0001');
  SELECT state INTO v_state FROM public.ad_plans WHERE id = (d->>'plan')::uuid;
  PERFORM pg_temp.tmt_assert(v_set.state = 'attention_required' AND v_state = 'settlement_attention_required',
    'A3 an unedited campaign over its first cap is still "attention required"');
  v_set := public.ad_finalize_campaign_settlement((c->>'campaign')::uuid, 'tmt-settle-c-0002', now() + interval '2 seconds');
  PERFORM pg_temp.tmt_assert(v_set.state = 'settled' AND v_set.released_host_cents = 1500000,
    'A3 an already-settled campaign returns unchanged');
  PERFORM pg_temp.tmt_lots_whole('A3 the lots are whole after settling');

  -- A4: hostile calls change nothing.
  SELECT balance_cents, held_cents INTO v_before_balance, v_before_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  v_ok := false;
  BEGIN PERFORM public.host_ad_amend_live((e->>'version')::uuid, e->>'hash', NULL, NULL,
      '[]'::jsonb, v_user, 'tmt-edit-e-0001', '{}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := SQLERRM = 'host_ad_live_edit_empty'; END;
  PERFORM pg_temp.tmt_assert(v_ok, 'A4 a change with nothing in it is refused');
  FOR v_balance IN SELECT unnest(ARRAY[0, -1000000]::bigint[]) LOOP
    v_ok := false;
    BEGIN PERFORM public.host_ad_amend_live((e->>'version')::uuid, e->>'hash', v_balance, NULL,
        jsonb_build_array(jsonb_build_object('campaign_id', e->>'campaign',
          'new_provider_budget_cents', 600, 'new_provider_delivery_budget_cents', 100)),
        v_user, 'tmt-edit-e-' || abs(v_balance) || '-zero', '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM IN ('host_ad_live_edit_amount_invalid', 'host_ad_live_edit_below_spend'); END;
    PERFORM pg_temp.tmt_assert(v_ok, 'A4 a total of ' || v_balance || ' is refused');
  END LOOP;
  v_ok := false;
  BEGIN PERFORM public.host_ad_amend_live((e->>'version')::uuid, e->>'hash', 3300000, NULL,
      jsonb_build_array(jsonb_build_object('campaign_id', a->>'campaign',
        'new_provider_budget_cents', 2200, 'new_provider_delivery_budget_cents', 200)),
      v_user, 'tmt-edit-e-0003', '{}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := SQLERRM = 'ad_budget_campaign_plan_mismatch'; END;
  PERFORM pg_temp.tmt_assert(v_ok, 'A4 another plan''s campaign is refused');
  v_ok := false;
  BEGIN PERFORM public.host_ad_amend_live((e->>'version')::uuid, e->>'hash', 3300000, NULL,
      jsonb_build_array(jsonb_build_object('campaign_id', e->>'campaign',
        'new_provider_budget_cents', 400, 'new_provider_delivery_budget_cents', 100)),
      v_user, 'tmt-edit-e-0004', '{}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := SQLERRM LIKE 'ad_budget_cap_below_spend:%'; END;
  PERFORM pg_temp.tmt_assert(v_ok, 'A4 a cap under the app''s spend is refused');
  v_ok := false;
  BEGIN PERFORM public.host_ad_amend_live((e->>'version')::uuid, e->>'hash', 3300000, NULL,
      jsonb_build_array(jsonb_build_object('campaign_id', e->>'campaign',
        'new_provider_budget_cents', 2200, 'new_provider_delivery_budget_cents', 2300)),
      v_user, 'tmt-edit-e-0005', '{}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := SQLERRM = 'ad_budget_amount_invalid'; END;
  PERFORM pg_temp.tmt_assert(v_ok, 'A4 a daily above the cap is refused');
  SELECT balance_cents, held_cents INTO v_balance, v_held FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  PERFORM pg_temp.tmt_assert(v_balance = v_before_balance AND v_held = v_before_held
      AND NOT EXISTS (SELECT 1 FROM public.host_ad_live_edits WHERE plan_id = (e->>'plan')::uuid),
    'A4 nothing moved after the hostile calls');

  -- A5 (RED at 0bcf8a9bc): NGN 31,000 is USD 20.67; a USD 100 cap must be refused.
  v_ok := false;
  BEGIN PERFORM public.host_ad_amend_live((e->>'version')::uuid, e->>'hash', 3100000, NULL,
      jsonb_build_array(jsonb_build_object('campaign_id', e->>'campaign',
        'new_provider_budget_cents', 10000, 'new_provider_delivery_budget_cents', 1000)),
      v_user, 'tmt-edit-e-0006', '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_ok := true; END;
  PERFORM pg_temp.tmt_assert(v_ok,
    'A5 caps that add up to more than the new total (USD 100 for NGN 31,000) are refused');
END
$t$;

ROLLBACK;
