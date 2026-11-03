\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4238-SETTLE-AMENDED-CAP | issue #4238 | Settlement of a Host or Mingla campaign compares final spend with the amended provider cap when a governed budget change exists, else the first cap (ad_finalize_campaign_settlement).

-- Issue #4238 media-buyer — run after the full migration chain on PostgreSQL 17
-- as supabase_admin over 127.0.0.1.
--
--   M1  "Works here": seeded rows (TikTok GB, Reddit NG); a signed-in Host can
--       read nothing (admin-only RLS) and cannot write; anon has no access;
--       admin_set_ad_platform_country refuses a non-admin with 42501, needs a
--       reason for not_available, and not_checked deletes the row (unknown =
--       works).
--   M2  Per-app reach switch: admins only (42501 otherwise); Google has no
--       switch; it flips ad_connections.extra.audience_estimate_certified on
--       the consumer (Host) lane only and is audited append-only.
--   M3  Every new function is revoked from PUBLIC and anon.
--   M4  Host live edit (host_ad_amend_live): a raise takes the extra from
--       Ads credit now (wallet, lots, ledger, hold, amendment rows, campaign
--       cap); a lower gives it back; once a day (PT409); the same key replays
--       the same edit; a budget under spend so far is refused (PT409); an end
--       in the past is refused; only the server may call it.
--   M5  Settlement reads the amended cap: spend above the first cap but
--       within a raised cap settles (never "attention required") and gives
--       back exactly what was not spent.

CREATE OR REPLACE FUNCTION pg_temp.tmb_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 media-buyer FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.tmb_as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $s$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
END $s$;

BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('42380000-0000-4000-b000-000000000001', 'tmb-host@mingla-fixture.org'),
  ('42380000-0000-4000-b000-000000000002', 'tmb-admin@mingla-fixture.org');
INSERT INTO public.admin_users(email, role, status)
VALUES ('tmb-admin@mingla-fixture.org', 'admin', 'active');

-- M1 / M3 -----------------------------------------------------------------------
DO $m1$
DECLARE
  v_host  constant uuid := '42380000-0000-4000-b000-000000000001';
  v_admin constant uuid := '42380000-0000-4000-b000-000000000002';
  v_ok boolean;
  v_n integer;
  v_row public.ad_platform_country_availability%ROWTYPE;
BEGIN
  PERFORM pg_temp.tmb_assert(EXISTS (
    SELECT 1 FROM public.ad_platform_country_availability
    WHERE platform = 'tiktok' AND country_code = 'GB' AND status = 'not_available'
      AND reason LIKE 'TikTok can''t run ads in the United Kingdom%'),
    'M1 TikTok GB is seeded as not available with a plain reason');
  PERFORM pg_temp.tmb_assert(EXISTS (
    SELECT 1 FROM public.ad_platform_country_availability
    WHERE platform = 'reddit' AND country_code = 'NG' AND status = 'not_available'),
    'M1 Reddit NG is seeded as not available');
  PERFORM pg_temp.tmb_assert(
    NOT has_table_privilege('anon', 'public.ad_platform_country_availability', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.ad_platform_country_availability', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.ad_platform_country_availability', 'UPDATE'),
    'M1 anon reads nothing; signed-in users cannot write the table');
  PERFORM pg_temp.tmb_assert(
    NOT has_function_privilege('anon', 'public.admin_set_ad_platform_country(text,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.admin_set_ad_reach_estimates(text,boolean)', 'EXECUTE'),
    'M3 the new functions are not executable by anon');
  PERFORM pg_temp.tmb_assert(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ad_platform_country_availability'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ad_ops_switch_events'::regclass),
    'M3 RLS is on for both new tables');

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.tmb_as_user(v_host);
  SELECT count(*) INTO v_n FROM public.ad_platform_country_availability;
  PERFORM pg_temp.tmb_assert(v_n = 0, 'M1 a Host reads no availability rows directly');
  v_ok := false;
  BEGIN
    PERFORM public.admin_set_ad_platform_country('tiktok', 'GB', 'works', NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M1 a Host cannot mark an app/country (42501)');

  PERFORM pg_temp.tmb_as_user(v_admin);
  SELECT count(*) INTO v_n FROM public.ad_platform_country_availability;
  PERFORM pg_temp.tmb_assert(v_n >= 2, 'M1 an admin reads the table');
  v_ok := false;
  BEGIN
    PERFORM public.admin_set_ad_platform_country('reddit', 'gh', 'not_available', '  ');
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M1 not_available needs a reason');
  v_row := public.admin_set_ad_platform_country('reddit', 'gh', 'not_available', 'Reddit doesn''t run ads in Ghana.');
  PERFORM pg_temp.tmb_assert(v_row.country_code = 'GH' AND v_row.updated_by = v_admin,
    'M1 an admin marks Reddit GH (code upper-cased, author kept)');
  PERFORM public.admin_set_ad_platform_country('reddit', 'GH', 'not_checked', NULL);
  PERFORM pg_temp.tmb_assert(NOT EXISTS (
      SELECT 1 FROM public.ad_platform_country_availability
      WHERE platform = 'reddit' AND country_code = 'GH'),
    'M1 not_checked removes the row (unknown means it works)');
  v_ok := false;
  BEGIN
    PERFORM public.admin_set_ad_platform_country('myspace', 'GH', 'works', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M1 an unknown app is refused');
  RESET ROLE;
END
$m1$;

-- M2 -----------------------------------------------------------------------------
DO $m2$
DECLARE
  v_host  constant uuid := '42380000-0000-4000-b000-000000000001';
  v_admin constant uuid := '42380000-0000-4000-b000-000000000002';
  v_ok boolean;
  v_out jsonb;
  v_consumer uuid := gen_random_uuid();
  v_mingla uuid := gen_random_uuid();
BEGIN
  -- Fixture connections for TikTok on both lanes (constraints permitting).
  INSERT INTO public.ad_connections (id, platform, lane, display_name,
    external_account_id, auth_kind, token_env_var, status, connected, extra)
  VALUES
    (v_consumer, 'tiktok', 'consumer', 'TikTok consumer', 'adv-c',
     'system_user_token', 'TMB_TOKEN', 'connected', true, '{}'::jsonb),
    (v_mingla, 'tiktok', 'business', 'TikTok business', 'adv-b',
     'system_user_token', 'TMB_TOKEN', 'connected', true, '{}'::jsonb)
  ON CONFLICT (platform, lane) DO NOTHING;

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.tmb_as_user(v_host);
  v_ok := false;
  BEGIN PERFORM public.admin_set_ad_reach_estimates('tiktok', true);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M2 a Host cannot switch reach on (42501)');

  PERFORM pg_temp.tmb_as_user(v_admin);
  v_ok := false;
  BEGIN PERFORM public.admin_set_ad_reach_estimates('google', true);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M2 Google has no reach switch');
  v_out := public.admin_set_ad_reach_estimates('tiktok', true);
  PERFORM pg_temp.tmb_assert((v_out->>'enabled')::boolean, 'M2 an admin switches TikTok reach on');
  RESET ROLE;

  PERFORM pg_temp.tmb_assert(
    (SELECT (extra->>'audience_estimate_certified')::boolean FROM public.ad_connections
     WHERE platform = 'tiktok' AND lane = 'consumer' LIMIT 1),
    'M2 the Host lane flag is on');
  PERFORM pg_temp.tmb_assert(
    NOT EXISTS (SELECT 1 FROM public.ad_connections
      WHERE platform = 'tiktok' AND lane <> 'consumer'
        AND (extra->>'audience_estimate_certified')::boolean IS TRUE),
    'M2 other lanes are untouched');
  PERFORM pg_temp.tmb_assert(EXISTS (
      SELECT 1 FROM public.ad_ops_switch_events
      WHERE switch = 'reach_estimates' AND platform = 'tiktok'
        AND actor_id = v_admin AND (value->>'enabled')::boolean),
    'M2 the switch is audited with who flipped it');
  v_ok := false;
  BEGIN DELETE FROM public.ad_ops_switch_events WHERE platform = 'tiktok';
  EXCEPTION WHEN OTHERS THEN v_ok := true; END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M2 the audit is append-only');
END
$m2$;

-- M4 / M5 fixtures: one brand with Ads credit, a Host Meta connection billing
-- in USD, NGN 1,500 = USD 1, and a helper that makes a funded live plan.
CREATE OR REPLACE FUNCTION pg_temp.tmb_live_plan(p_n integer)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_user constant uuid := '42380000-0000-4000-b000-000000000001';
  v_brand constant uuid := '42380000-0000-4000-b000-000000000101';
  v_conn constant uuid := '42380000-0000-4000-b000-000000000201';
  v_snap constant uuid := '42380000-0000-4000-b000-000000000301';
  v_plan public.ad_plans%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_campaign uuid := gen_random_uuid();
BEGIN
  v_plan := public.ad_plan_open('host', 'host', v_brand, 'public_mingla_page',
    'brand:tmb-brand', '[]'::jsonb, v_user);
  v_version := public.ad_plan_create_version(
    v_plan.id,
    '{"platforms":["meta"],"confirmation_phrase":"LAUNCH"}'::jsonb
      || jsonb_build_object('n', p_n, 'media_rights', jsonb_build_object(
        'rights_confirmed', true, 'rights_basis', 'owned', 'ai_generated', false,
        'house_reuse_allowed', false, 'attested_by', v_user::text, 'attested_at', now())),
    3000000, 'NGN', jsonb_build_array(jsonb_build_object(
      'platform', 'meta', 'connection_id', v_conn,
      'host_budget_cents', 3000000, 'host_delivery_budget_cents', 300000,
      'provider_budget_cents', 2000, 'provider_delivery_budget_cents', 200,
      'fx_snapshot_id', v_snap)), v_user);
  INSERT INTO public.ad_plan_targeting_snapshots (
    plan_version_id, platform, audience_intent, compiled_targeting, verdict,
    evidence_observed_at, compiler_version
  ) VALUES (v_version.id, 'meta', '{"countries":["NG"]}'::jsonb,
    '{"geo_locations":{"countries":["NG"]}}'::jsonb, 'exact', now(), 'v1.4-test');
  PERFORM public.ad_plan_mark_ready(v_version.id, v_version.plan_hash);
  PERFORM public.ad_plan_hold_host_funds(v_version.id, v_version.plan_hash,
    'tmb-hold-' || p_n || '-key', v_user);
  -- A Host's first ads are checked by Mingla, then the Host types LAUNCH.
  PERFORM public.ad_plan_record_review(v_version.id, v_version.plan_hash,
    'approved', 'Test approval', '42380000-0000-4000-b000-000000000002');
  PERFORM public.ad_plan_confirm_launch(v_version.id, v_version.plan_hash,
    'LAUNCH', v_user);
  INSERT INTO public.ad_campaigns (
    id, connection_id, platform, external_campaign_id, name, objective,
    status, dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
    brand_id, owner_kind, currency, plan_version_id, plan_hash,
    host_budget_cents, provider_budget_cents, provider_delivery_budget_cents,
    fx_snapshot_id, provider_currency
  ) VALUES (
    v_campaign, v_conn, 'meta', 'tmb-meta-' || p_n, 'TMB ' || p_n,
    'OUTCOME_TRAFFIC', 'ACTIVE', 'brand', 'tmb-brand',
    'https://usemingla.com/b/tmb-brand', 'https://usemingla.com/b/tmb-brand',
    v_brand, 'host', 'NGN', v_version.id, v_version.plan_hash,
    3000000, 2000, 200, v_snap, 'USD');
  -- USD 5 spent so far (NGN 7,500).
  INSERT INTO public.ad_spend_daily (campaign_id, platform, spend_date,
    spend_cents, impressions, clicks, currency)
  VALUES (v_campaign, 'meta', current_date, 500, 0, 0, 'USD');
  UPDATE public.ad_plans SET state = 'live' WHERE id = v_plan.id;
  RETURN jsonb_build_object('plan', v_plan.id, 'version', v_version.id,
    'hash', v_version.plan_hash, 'campaign', v_campaign);
END $f$;

DO $m4$
DECLARE
  v_user constant uuid := '42380000-0000-4000-b000-000000000001';
  v_brand constant uuid := '42380000-0000-4000-b000-000000000101';
  v_conn constant uuid := '42380000-0000-4000-b000-000000000201';
  v_snap constant uuid := '42380000-0000-4000-b000-000000000301';
  a jsonb; b jsonb; c jsonb;
  v_edit public.host_ad_live_edits%ROWTYPE;
  v_again public.host_ad_live_edits%ROWTYPE;
  v_balance bigint; v_held bigint;
  v_ok boolean;
  v_settlement public.ad_campaign_settlements%ROWTYPE;
BEGIN
  INSERT INTO public.creator_accounts (id, email) VALUES (v_user, 'tmb-host@mingla-fixture.org');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency,
    payment_provider, payment_country, paystack_subaccount_code)
  VALUES (v_brand, v_user, 'TMB Brand', 'tmb-brand', 'NGN', 'paystack', 'NG', 'ACCT_tmb');
  INSERT INTO public.ad_connections (id, platform, lane, display_name,
    external_account_id, auth_kind, token_env_var, status, currency, connected)
  VALUES (v_conn, 'meta', 'business', 'TMB Meta', 'act_tmb', 'system_user_token',
    'TMB_META_TOKEN', 'connected', 'USD', true);
  UPDATE public.fx_rate_snapshots SET status = 'superseded' WHERE status = 'active';
  INSERT INTO public.fx_rate_snapshots (id, provider, base_currency_code,
    provider_updated_at, provider_next_update_at, provider_eol_at, stale_after,
    expires_at, payload_sha256, status)
  VALUES (v_snap, 'exchange_rate_api_open_v6', 'USD', now() - interval '1 hour',
    now() + interval '1 day', now() + interval '2 days', now() + interval '1 day',
    now() + interval '7 days', repeat('b', 64), 'active');
  INSERT INTO public.fx_rates (snapshot_id, currency_code, rate_per_base)
  VALUES (v_snap, 'USD', 1), (v_snap, 'NGN', 1500);
  PERFORM public.ad_credit_apply(v_brand, 'top_up', 12000000, 'NGN',
    'tmb-topup-0001', 0, 12000000, NULL, NULL, 'mingla_adc_tmb', v_user, '{}'::jsonb);

  a := pg_temp.tmb_live_plan(1);
  b := pg_temp.tmb_live_plan(2);
  c := pg_temp.tmb_live_plan(3);
  SELECT balance_cents, held_cents INTO v_balance, v_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  PERFORM pg_temp.tmb_assert(v_balance = 3000000 AND v_held = 9000000,
    'M4 fixture: three funded live plans');

  PERFORM pg_temp.tmb_assert(
    NOT has_function_privilege('authenticated',
      'public.host_ad_amend_live(uuid,text,bigint,timestamptz,jsonb,uuid,text,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon',
      'public.host_ad_amend_live(uuid,text,bigint,timestamptz,jsonb,uuid,text,jsonb)', 'EXECUTE'),
    'M4 only the server can call the live edit');

  -- Raise plan A from NGN 30,000 to NGN 45,000 (provider cap USD 20 -> 30).
  v_edit := public.host_ad_amend_live((a->>'version')::uuid, a->>'hash', 4500000, NULL,
    jsonb_build_array(jsonb_build_object('campaign_id', a->>'campaign',
      'new_provider_budget_cents', 3000, 'new_provider_delivery_budget_cents', 300)),
    v_user, 'tmb-edit-a-0001', '{}'::jsonb);
  SELECT balance_cents, held_cents INTO v_balance, v_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  PERFORM pg_temp.tmb_assert(v_edit.hold_delta_cents = 1500000
      AND v_balance = 1500000 AND v_held = 10500000,
    'M4 a raise sets the extra NGN 15,000 aside from Ads credit at once');
  PERFORM pg_temp.tmb_assert(
    (SELECT amount_cents FROM public.ad_plan_funding_holds WHERE plan_version_id = (a->>'version')::uuid) = 4500000
    AND (SELECT sum(h.credit_cents - h.restored_credit_cents) FROM public.ad_credit_hold_allocations h
         JOIN public.ad_plan_funding_holds f ON f.id = h.hold_id
         WHERE f.plan_version_id = (a->>'version')::uuid) = 4500000,
    'M4 the hold and its credit lots both grow to NGN 45,000');
  PERFORM pg_temp.tmb_assert(EXISTS (
      SELECT 1 FROM public.ad_credit_ledger
      WHERE idempotency_key = 'host_live_tmb-edit-a-0001'
        AND entry_kind = 'campaign_spend' AND amount_cents = -1500000),
    'M4 the raise has its own ledger row');
  PERFORM pg_temp.tmb_assert(
    (SELECT amended_provider_budget_cents FROM public.ad_campaigns WHERE id = (a->>'campaign')::uuid) = 3000
    AND (SELECT count(*) FROM public.ad_plan_budget_amendments WHERE campaign_id = (a->>'campaign')::uuid) = 1,
    'M4 the campaign carries the new cap as a governed amendment');
  v_again := public.host_ad_amend_live((a->>'version')::uuid, a->>'hash', 4500000, NULL,
    jsonb_build_array(jsonb_build_object('campaign_id', a->>'campaign',
      'new_provider_budget_cents', 3000, 'new_provider_delivery_budget_cents', 300)),
    v_user, 'tmb-edit-a-0001', '{}'::jsonb);
  PERFORM pg_temp.tmb_assert(v_again.id = v_edit.id
      AND (SELECT balance_cents FROM public.ad_credit_wallets WHERE brand_id = v_brand) = 1500000,
    'M4 the same key replays the same edit (no second charge)');
  v_ok := false;
  BEGIN
    PERFORM public.host_ad_amend_live((a->>'version')::uuid, a->>'hash', 5000000, NULL,
      jsonb_build_array(jsonb_build_object('campaign_id', a->>'campaign',
        'new_provider_budget_cents', 3300, 'new_provider_delivery_budget_cents', 300)),
      v_user, 'tmb-edit-a-0002', '{}'::jsonb);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_ok := SQLERRM = 'host_ad_live_edit_once_a_day';
  END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M4 a second edit the same day is refused (PT409)');

  -- Lower plan B from NGN 30,000 to NGN 20,000: NGN 10,000 back to credit.
  v_edit := public.host_ad_amend_live((b->>'version')::uuid, b->>'hash', 2000000,
    now() + interval '3 days',
    jsonb_build_array(jsonb_build_object('campaign_id', b->>'campaign',
      'new_provider_budget_cents', 1333, 'new_provider_delivery_budget_cents', 200)),
    v_user, 'tmb-edit-b-0001', '{}'::jsonb);
  SELECT balance_cents, held_cents INTO v_balance, v_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  PERFORM pg_temp.tmb_assert(v_edit.hold_delta_cents = -1000000
      AND v_balance = 2500000 AND v_held = 9500000,
    'M4 a lower gives NGN 10,000 back to Ads credit at once');
  PERFORM pg_temp.tmb_assert(
    (SELECT ends_at FROM public.ad_campaigns WHERE id = (b->>'campaign')::uuid) > now() + interval '2 days',
    'M4 the new end date reaches every campaign (Mingla stops it there)');

  -- Plan C: NGN 7,500 is already spent.
  v_ok := false;
  BEGIN
    PERFORM public.host_ad_amend_live((c->>'version')::uuid, c->>'hash', 500000, NULL,
      jsonb_build_array(jsonb_build_object('campaign_id', c->>'campaign',
        'new_provider_budget_cents', 600, 'new_provider_delivery_budget_cents', 200)),
      v_user, 'tmb-edit-c-0001', '{}'::jsonb);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_ok := SQLERRM = 'host_ad_live_edit_below_spend';
  END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M4 a budget under the spend so far is refused (PT409)');
  v_ok := false;
  BEGIN
    PERFORM public.host_ad_amend_live((c->>'version')::uuid, c->>'hash', NULL,
      now() - interval '1 hour', '[]'::jsonb, v_user, 'tmb-edit-c-0002', '{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_ok := SQLERRM = 'host_ad_live_edit_end_in_past';
  END;
  PERFORM pg_temp.tmb_assert(v_ok, 'M4 an end in the past is refused');

  -- M5: plan A spent USD 25: over its first cap (20), within the raised one (30).
  UPDATE public.ad_spend_daily SET spend_cents = 2500 WHERE campaign_id = (a->>'campaign')::uuid;
  PERFORM public.ad_request_campaign_stop((a->>'campaign')::uuid, now());
  PERFORM public.ad_confirm_campaign_stop((a->>'campaign')::uuid, 2500, 'USD', now(),
    '{"provider_status":"PAUSED","final_insights_id":"tmb-insight"}'::jsonb, interval '0');
  v_settlement := public.ad_finalize_campaign_settlement((a->>'campaign')::uuid,
    'tmb-settle-a-0001', now() + interval '1 second');
  SELECT balance_cents, held_cents INTO v_balance, v_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  PERFORM pg_temp.tmb_assert(v_settlement.state = 'settled'
      AND v_settlement.final_host_spend_cents = 3750000
      AND v_settlement.released_host_cents = 750000,
    'M5 spend within the raised cap settles and gives back NGN 7,500');
  PERFORM pg_temp.tmb_assert(v_balance = 3250000 AND v_held = 5000000,
    'M5 the wallet is whole after settlement');
END
$m4$;

ROLLBACK;
