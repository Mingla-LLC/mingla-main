\set ON_ERROR_STOP on

-- Issue #4238 media-buyer, rework after tester round 8 (implementor). Runs
-- after the full migration chain on PostgreSQL 17. Guards
-- I-4238-LIVE-EDIT-CAPS-WITHIN-TOTAL and I-4238-LIVE-EDIT-CLAIM-BEFORE-PUSH
-- (declared in supabase/functions/_shared/adHostLiveEdit.ts).
--
--   R1  #1856 grants: the four new tables hold nothing for anon/PUBLIC and
--       only SELECT for authenticated; claim/release are server-only.
--   R2  The claim: one per plan; a second key is "in progress" (PT409) and
--       host_ad_amend_live refuses it too; recording clears the claim.
--   R3  Same key after the edit is recorded: the claim and the amend both
--       return the saved edit, and no money moves twice.
--   R4  Once a day still holds through the claim; a released or lapsed claim
--       can be taken again.
--   R5  Caps whose host-money total (frozen rate) is above the new total are
--       refused (PT409), with nothing moved.
--   R6  The reach-estimate limiter counts per bucket on the database clock,
--       refuses over the limit, resets after the window, and is server-only.

CREATE OR REPLACE FUNCTION pg_temp.r9_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 r9 implementor FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

BEGIN;

DO $grants$
DECLARE
  v_tbl text;
  v_priv text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['ad_platform_country_availability', 'ad_ops_switch_events',
    'host_ad_live_edits', 'host_ad_live_edit_claims', 'ad_host_estimate_rate'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
      'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
      PERFORM pg_temp.r9_assert(NOT has_table_privilege('anon', 'public.' || v_tbl, v_priv),
        'R1 anon holds no ' || v_priv || ' on ' || v_tbl);
      IF v_priv <> 'SELECT' THEN
        PERFORM pg_temp.r9_assert(NOT has_table_privilege('authenticated', 'public.' || v_tbl, v_priv),
          'R1 authenticated holds no ' || v_priv || ' on ' || v_tbl);
      END IF;
    END LOOP;
    IF v_tbl = 'ad_host_estimate_rate' THEN
      PERFORM pg_temp.r9_assert(NOT has_table_privilege('authenticated', 'public.' || v_tbl, 'SELECT'),
        'R1 authenticated cannot read the estimate limiter');
    ELSE
      PERFORM pg_temp.r9_assert(has_table_privilege('authenticated', 'public.' || v_tbl, 'SELECT'),
        'R1 authenticated keeps SELECT (admins, by RLS) on ' || v_tbl);
    END IF;
    PERFORM pg_temp.r9_assert(NOT EXISTS (
      SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = ('public.' || v_tbl)::regclass AND a.grantee = 0),
      'R1 no PUBLIC grant on ' || v_tbl);
  END LOOP;
  PERFORM pg_temp.r9_assert(
    NOT has_function_privilege('authenticated', 'public.host_ad_live_edit_claim(uuid,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.host_ad_live_edit_claim(uuid,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.host_ad_live_edit_release(uuid,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.host_ad_live_edit_claim(uuid,uuid,text)', 'EXECUTE'),
    'R1 only the server can claim or release a live edit');
  PERFORM pg_temp.r9_assert(
    NOT has_function_privilege('authenticated', 'public.ad_host_estimate_rate_hit(text,integer,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.ad_host_estimate_rate_hit(text,integer,integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.ad_host_estimate_rate_hit(text,integer,integer)', 'EXECUTE'),
    'R1 only the server can count a reach estimate');
END
$grants$;

DO $rate$
DECLARE
  i integer;
  v_limited boolean;
BEGIN
  FOR i IN 1..3 LOOP
    v_limited := public.ad_host_estimate_rate_hit('host_estimate:brand:r9', 60, 3);
    PERFORM pg_temp.r9_assert(NOT v_limited, 'R6 estimate ' || i || ' of 3 is allowed');
  END LOOP;
  PERFORM pg_temp.r9_assert(public.ad_host_estimate_rate_hit('host_estimate:brand:r9', 60, 3),
    'R6 the 4th estimate in the window is refused');
  PERFORM pg_temp.r9_assert(NOT public.ad_host_estimate_rate_hit('host_estimate:user:r9', 60, 3),
    'R6 another bucket (the user) counts on its own');
  UPDATE public.ad_host_estimate_rate SET window_started_at = now() - interval '61 seconds'
  WHERE bucket_key = 'host_estimate:brand:r9';
  v_limited := public.ad_host_estimate_rate_hit('host_estimate:brand:r9', 60, 3);
  PERFORM pg_temp.r9_assert(NOT v_limited
      AND (SELECT hit_count FROM public.ad_host_estimate_rate WHERE bucket_key = 'host_estimate:brand:r9') = 1,
    'R6 a new window starts over');
  PERFORM pg_temp.r9_assert(public.ad_host_estimate_rate_hit('   ', 60, 3),
    'R6 an empty bucket is treated as limited');
END
$rate$;

INSERT INTO auth.users(id, email) VALUES
  ('42380000-0000-4000-e000-000000000001', 'r9-host@mingla-fixture.org'),
  ('42380000-0000-4000-e000-000000000002', 'r9-admin@mingla-fixture.org');
INSERT INTO public.admin_users(email, role, status)
VALUES ('r9-admin@mingla-fixture.org', 'admin', 'active');

-- One funded live Host plan on Meta: NGN p_budget, USD cap p_cap (NGN 1,500 = USD 1).
CREATE OR REPLACE FUNCTION pg_temp.r9_live_plan(p_n integer, p_budget bigint, p_cap bigint)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_user constant uuid := '42380000-0000-4000-e000-000000000001';
  v_admin constant uuid := '42380000-0000-4000-e000-000000000002';
  v_brand constant uuid := '42380000-0000-4000-e000-000000000101';
  v_conn constant uuid := '42380000-0000-4000-e000-000000000201';
  v_snap constant uuid := '42380000-0000-4000-e000-000000000301';
  v_plan public.ad_plans%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_campaign uuid := gen_random_uuid();
BEGIN
  v_plan := public.ad_plan_open('host', 'host', v_brand, 'public_mingla_page',
    'brand:r9-brand', '[]'::jsonb, v_user);
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
    'r9-hold-' || p_n || '-key', v_user);
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
    v_campaign, v_conn, 'meta', 'r9-meta-' || p_n, 'R9 ' || p_n,
    'OUTCOME_TRAFFIC', 'ACTIVE', 'brand', 'r9-brand',
    'https://usemingla.com/b/r9-brand', 'https://usemingla.com/b/r9-brand',
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


DO $t$
DECLARE
  v_user constant uuid := '42380000-0000-4000-e000-000000000001';
  v_brand constant uuid := '42380000-0000-4000-e000-000000000101';
  v_conn constant uuid := '42380000-0000-4000-e000-000000000201';
  v_snap constant uuid := '42380000-0000-4000-e000-000000000301';
  a jsonb; b jsonb; e jsonb;
  v_claim jsonb;
  v_edit public.host_ad_live_edits%ROWTYPE;
  v_again public.host_ad_live_edits%ROWTYPE;
  v_balance bigint; v_held bigint;
  v_ok boolean;
BEGIN
  INSERT INTO public.creator_accounts (id, email) VALUES (v_user, 'r9-host@mingla-fixture.org');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency,
    payment_provider, payment_country, paystack_subaccount_code)
  VALUES (v_brand, v_user, 'R9 Brand', 'r9-brand', 'NGN', 'paystack', 'NG', 'ACCT_tmt');
  INSERT INTO public.ad_connections (id, platform, lane, display_name,
    external_account_id, auth_kind, token_env_var, status, currency, connected)
  VALUES (v_conn, 'meta', 'business', 'R9 Meta', 'act_tmt', 'system_user_token',
    'R9_META_TOKEN', 'connected', 'USD', true)
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
    now() + interval '7 days', repeat('e', 64), 'active');
  INSERT INTO public.fx_rates (snapshot_id, currency_code, rate_per_base)
  VALUES (v_snap, 'USD', 1), (v_snap, 'NGN', 1500);
  -- Two lots: NGN 160,000 credit with a NGN 8,000 card fee, then NGN 20,000 with none.
  PERFORM public.ad_credit_apply(v_brand, 'top_up', 16000000, 'NGN',
    'r9-topup-0001', 800000, 16800000, NULL, NULL, 'mingla_adc_tmt_1', v_user, '{}'::jsonb);
  PERFORM public.ad_credit_apply(v_brand, 'top_up', 2000000, 'NGN',
    'r9-topup-0002', 0, 2000000, NULL, NULL, 'mingla_adc_tmt_2', v_user, '{}'::jsonb);

  a := pg_temp.r9_live_plan(1, 3000000, 2000);
  b := pg_temp.r9_live_plan(2, 3000000, 2000);
  e := pg_temp.r9_live_plan(3, 3000000, 2000);

  -- R2: one claim per plan.
  v_claim := public.host_ad_live_edit_claim((a->>'plan')::uuid, v_user, 'r9-claim-a-0001');
  PERFORM pg_temp.r9_assert(v_claim = '{"replay": false, "claimed": true}'::jsonb,
    'R2 the first tap claims the edit');
  v_ok := false;
  BEGIN PERFORM public.host_ad_live_edit_claim((a->>'plan')::uuid, v_user, 'r9-claim-a-0002');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_ok := SQLERRM = 'host_ad_live_edit_in_progress'; END;
  PERFORM pg_temp.r9_assert(v_ok, 'R2 a second tap (another key) is "in progress" and never pushes');
  v_ok := false;
  BEGIN PERFORM public.host_ad_amend_live((a->>'version')::uuid, a->>'hash', 4500000, NULL,
      jsonb_build_array(jsonb_build_object('campaign_id', a->>'campaign',
        'new_provider_budget_cents', 3000, 'new_provider_delivery_budget_cents', 300)),
      v_user, 'r9-claim-a-0002', '{}'::jsonb);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_ok := SQLERRM = 'host_ad_live_edit_in_progress'; END;
  PERFORM pg_temp.r9_assert(v_ok, 'R2 the amend refuses a key that does not hold the claim');
  v_edit := public.host_ad_amend_live((a->>'version')::uuid, a->>'hash', 4500000, NULL,
    jsonb_build_array(jsonb_build_object('campaign_id', a->>'campaign',
      'new_provider_budget_cents', 3000, 'new_provider_delivery_budget_cents', 300)),
    v_user, 'r9-claim-a-0001', '{}'::jsonb);
  PERFORM pg_temp.r9_assert(v_edit.hold_delta_cents = 1500000
      AND NOT EXISTS (SELECT 1 FROM public.host_ad_live_edit_claims WHERE plan_id = (a->>'plan')::uuid),
    'R2 recording the edit clears the claim');

  -- R3: same key again, after it is recorded.
  SELECT balance_cents, held_cents INTO v_balance, v_held FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  v_claim := public.host_ad_live_edit_claim((a->>'plan')::uuid, v_user, 'r9-claim-a-0001');
  PERFORM pg_temp.r9_assert((v_claim->>'replay')::boolean AND (v_claim->'edit'->>'id')::uuid = v_edit.id,
    'R3 a same-key retry gets the saved edit from the claim');
  v_again := public.host_ad_amend_live((a->>'version')::uuid, a->>'hash', 4500000, NULL,
    jsonb_build_array(jsonb_build_object('campaign_id', a->>'campaign',
      'new_provider_budget_cents', 3000, 'new_provider_delivery_budget_cents', 300)),
    v_user, 'r9-claim-a-0001', '{}'::jsonb);
  PERFORM pg_temp.r9_assert(v_again.id = v_edit.id
      AND (SELECT balance_cents FROM public.ad_credit_wallets WHERE brand_id = v_brand) = v_balance
      AND (SELECT held_cents FROM public.ad_credit_wallets WHERE brand_id = v_brand) = v_held,
    'R3 a same-key amend returns the saved edit and moves nothing');
  v_ok := false;
  BEGIN PERFORM public.host_ad_live_edit_claim((b->>'plan')::uuid, v_user, 'r9-claim-a-0001');
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := SQLERRM = 'host_ad_live_edit_key_invalid'; END;
  PERFORM pg_temp.r9_assert(v_ok, 'R3 another plan''s recorded key is never replayed');

  -- R4: once a day through the claim; released / lapsed claims are free.
  v_ok := false;
  BEGIN PERFORM public.host_ad_live_edit_claim((a->>'plan')::uuid, v_user, 'r9-claim-a-0003');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_ok := SQLERRM = 'host_ad_live_edit_once_a_day'; END;
  PERFORM pg_temp.r9_assert(v_ok, 'R4 a new edit the same day is refused at the claim');
  PERFORM public.host_ad_live_edit_claim((b->>'plan')::uuid, v_user, 'r9-claim-b-0001');
  PERFORM pg_temp.r9_assert(NOT public.host_ad_live_edit_release((b->>'plan')::uuid, 'r9-claim-b-other'),
    'R4 another key cannot release the claim');
  PERFORM pg_temp.r9_assert(public.host_ad_live_edit_release((b->>'plan')::uuid, 'r9-claim-b-0001'),
    'R4 the failed push releases its own claim');
  v_claim := public.host_ad_live_edit_claim((b->>'plan')::uuid, v_user, 'r9-claim-b-0002');
  PERFORM pg_temp.r9_assert(NOT (v_claim->>'replay')::boolean, 'R4 after a release the Host can try again');
  UPDATE public.host_ad_live_edit_claims
  SET claimed_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute'
  WHERE plan_id = (b->>'plan')::uuid;
  v_claim := public.host_ad_live_edit_claim((b->>'plan')::uuid, v_user, 'r9-claim-b-0003');
  PERFORM pg_temp.r9_assert((SELECT idempotency_key FROM public.host_ad_live_edit_claims
      WHERE plan_id = (b->>'plan')::uuid) = 'r9-claim-b-0003',
    'R4 a lapsed claim (crashed request) can be taken over');
  PERFORM pg_temp.r9_assert(v_claim->'lapsed_claim'->>'idempotency_key' = 'r9-claim-b-0002',
    'R4 taking over a lapsed claim names it, so staff can be told the app may differ');
  PERFORM pg_temp.r9_assert(NOT (v_claim ? 'lapsed_claim')
      OR v_claim->'lapsed_claim'->>'idempotency_key' <> 'r9-claim-b-0003',
    'R4 the new claim is never reported as lapsed');

  -- R5: caps above the new total, at the frozen rate, are refused.
  SELECT balance_cents, held_cents INTO v_balance, v_held FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  v_ok := false;
  BEGIN PERFORM public.host_ad_amend_live((e->>'version')::uuid, e->>'hash', 3100000, NULL,
      jsonb_build_array(jsonb_build_object('campaign_id', e->>'campaign',
        'new_provider_budget_cents', 2067, 'new_provider_delivery_budget_cents', 200)),
      v_user, 'r9-edit-e-0001', '{}'::jsonb);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    v_ok := SQLERRM = 'host_ad_live_edit_caps_exceed_budget:3100500:3100000';
  END;
  PERFORM pg_temp.r9_assert(v_ok, 'R5 a cap one cent over the new total (NGN 31,005 for 31,000) is refused');
  PERFORM pg_temp.r9_assert(
    (SELECT balance_cents FROM public.ad_credit_wallets WHERE brand_id = v_brand) = v_balance
    AND (SELECT held_cents FROM public.ad_credit_wallets WHERE brand_id = v_brand) = v_held
    AND NOT EXISTS (SELECT 1 FROM public.host_ad_live_edits WHERE plan_id = (e->>'plan')::uuid),
    'R5 nothing moved after the refused caps');
  v_edit := public.host_ad_amend_live((e->>'version')::uuid, e->>'hash', 3100000, NULL,
    jsonb_build_array(jsonb_build_object('campaign_id', e->>'campaign',
      'new_provider_budget_cents', 2066, 'new_provider_delivery_budget_cents', 200)),
    v_user, 'r9-edit-e-0002', '{}'::jsonb);
  PERFORM pg_temp.r9_assert(v_edit.new_host_budget_cents = 3100000,
    'R5 caps that fit (NGN 30,990 for 31,000) are recorded');
END
$t$;

ROLLBACK;
