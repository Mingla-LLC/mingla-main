-- Issue #3697 v1.4 control-plane executable contract.
-- MINGLA-INVARIANT: I-3697-PLAN-VERSION-BINDING | issue #3697 | Funding, staff review, typed confirmation, provider attempts and campaigns bind to the same immutable plan version and SHA-256.
-- MINGLA-INVARIANT: I-3697-NO-SILENT-TARGETING-WIDENING | issue #3697 | A broader provider target cannot become ready without an explicit acceptance frozen into that version.
-- MINGLA-INVARIANT: I-3697-PROVIDER-CONFIRMED-SETTLEMENT | issue #3697 | Held Host credit cannot be released until provider stop and final spend are recorded and the finality window closes.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '36971000-0000-4000-8000-000000000001';
  v_brand constant uuid := '36971000-0000-4000-8000-000000000011';
  v_connection constant uuid := '36971000-0000-4000-8000-000000000021';
  v_connection_2 constant uuid := '36971000-0000-4000-8000-000000000022';
  v_connection_3 constant uuid := '36971000-0000-4000-8000-000000000023';
  v_snapshot constant uuid := '36971000-0000-4000-8000-000000000031';
  v_campaign constant uuid := '36971000-0000-4000-8000-000000000041';
  v_campaign_2 constant uuid := '36971000-0000-4000-8000-000000000042';
  v_bad_plan public.ad_plans%ROWTYPE;
  v_bad_version public.ad_plan_versions%ROWTYPE;
  v_app_plan public.ad_plans%ROWTYPE;
  v_app_version public.ad_plan_versions%ROWTYPE;
  v_admin_plan public.ad_plans%ROWTYPE;
  v_revise_plan public.ad_plans%ROWTYPE;
  v_revise_version public.ad_plan_versions%ROWTYPE;
  v_revised_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
  v_review public.ad_plan_reviews%ROWTYPE;
  v_confirmation public.ad_plan_confirmations%ROWTYPE;
  v_settlement public.ad_campaign_settlements%ROWTYPE;
  v_settlement_2 public.ad_campaign_settlements%ROWTYPE;
  v_provider_budget bigint;
  v_wallet_balance bigint;
  v_wallet_held bigint;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'issue-3697-control-plane@example.test');
  INSERT INTO public.creator_accounts (id, email)
  VALUES (v_user, 'issue-3697-control-plane@example.test');
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, paystack_subaccount_code
  ) VALUES (
    v_brand, v_user, 'Issue 3697 control plane', 'issue-3697-control-plane',
    'NGN', 'paystack', 'NG', 'ACCT_issue3697_control'
  );
  INSERT INTO public.ad_connections (
    id, platform, lane, display_name, external_account_id, auth_kind,
    token_env_var, status, currency, connected
  ) VALUES (
    v_connection, 'meta', 'business', 'Issue 3697 USD Meta',
    'act_issue3697_control', 'system_user_token', 'ISSUE_3697_CONTROL_TOKEN',
    'connected', 'USD', true
  );
  INSERT INTO public.ad_connections (
    id, platform, lane, display_name, external_account_id, auth_kind,
    token_env_var, status, currency, connected
  ) VALUES (
    v_connection_3, 'reddit', 'consumer', 'Issue 3697 GBP Reddit',
    'rd_issue3697_control', 'refresh_token', 'ISSUE_3697_CONTROL_REDDIT_TOKEN',
    'connected', 'GBP', true
  );
  INSERT INTO public.ad_connections (
    id, platform, lane, display_name, external_account_id, auth_kind,
    token_env_var, status, currency, connected
  ) VALUES (
    v_connection_2, 'tiktok', 'business', 'Issue 3697 USD TikTok',
    'tt_issue3697_control', 'system_user_token', 'ISSUE_3697_CONTROL_TIKTOK_TOKEN',
    'connected', 'USD', true
  );

  UPDATE public.fx_rate_snapshots SET status = 'superseded' WHERE status = 'active';
  INSERT INTO public.fx_rate_snapshots (
    id, provider, base_currency_code, provider_updated_at,
    provider_next_update_at, provider_eol_at, stale_after, expires_at,
    payload_sha256, status
  ) VALUES (
    v_snapshot, 'exchange_rate_api_open_v6', 'USD', now() - interval '1 hour',
    now() + interval '1 day', now() + interval '2 days',
    now() + interval '1 day', now() + interval '7 days',
    repeat('a', 64), 'active'
  );
  INSERT INTO public.fx_rates (snapshot_id, currency_code, rate_per_base)
  VALUES
    (v_snapshot, 'USD', 1),
    (v_snapshot, 'NGN', 1500),
    (v_snapshot, 'GBP', 0.8);
  v_provider_budget := public.fx_convert_minor(3000000, 'NGN', 'USD', v_snapshot);
  IF v_provider_budget <> 2000 THEN
    RAISE EXCEPTION 'fx_fixture_wrong:%', v_provider_budget;
  END IF;

  PERFORM public.ad_credit_apply(
    v_brand, 'top_up', 3000000, 'NGN', 'v14-control-topup-unique',
    0, 3000000, NULL, NULL, 'mingla_adc_v14_control', v_user, '{}'::jsonb
  );

  -- Admin portfolios with unlike ad-account currencies must split into
  -- currency-homogeneous plans; a cross-currency total is never spend authority.
  v_admin_plan := public.ad_plan_open(
    'admin', 'mingla', NULL, 'marketing_page',
    'explorer', '[]'::jsonb, v_user
  );
  v_failed := false;
  BEGIN
    PERFORM public.ad_plan_create_version(
      v_admin_plan.id,
      '{"platforms":["meta","reddit"],"confirmation_phrase":"LAUNCH"}'::jsonb,
      2000, 'USD', jsonb_build_array(
        jsonb_build_object(
          'platform', 'meta', 'connection_id', v_connection,
          'host_budget_cents', 1000, 'provider_budget_cents', 1000,
          'fx_snapshot_id', NULL
        ),
        jsonb_build_object(
          'platform', 'reddit', 'connection_id', v_connection_3,
          'host_budget_cents', 1000, 'provider_budget_cents', 800,
          'fx_snapshot_id', v_snapshot
        )
      ), v_user
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := SQLERRM = 'ad_plan_admin_currency_split_required';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'admin_mixed_currency_plan_was_not_split'; END IF;

  -- Explorer is a first-class destination, but provider creation remains
  -- blocked until the existing exact app-readiness authority turns green.
  v_app_plan := public.ad_plan_open(
    'admin', 'mingla', NULL, 'explorer_app', 'ios', '[]'::jsonb, v_user
  );
  v_app_version := public.ad_plan_create_version(
    v_app_plan.id,
    '{"platforms":["meta"],"confirmation_phrase":"LAUNCH"}'::jsonb,
    1000, 'USD', jsonb_build_array(jsonb_build_object(
      'platform', 'meta', 'connection_id', v_connection,
      'host_budget_cents', 1000, 'provider_budget_cents', 1000,
      'fx_snapshot_id', NULL
    )), v_user
  );
  INSERT INTO public.ad_plan_targeting_snapshots (
    plan_version_id, platform, audience_intent, compiled_targeting, verdict,
    evidence_observed_at, compiler_version
  ) VALUES (
    v_app_version.id, 'meta', '{"countries":["NG"]}'::jsonb,
    '{"geo_locations":{"countries":["NG"]}}'::jsonb,
    'exact', now(), 'v1.4-test'
  );
  v_failed := false;
  BEGIN
    PERFORM public.ad_plan_mark_ready(
      v_app_version.id, v_app_version.plan_hash
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := SQLERRM =
      'ad_plan_destination_not_ready:app_acquisition_not_ready';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'native_app_plan_bypassed_readiness_authority';
  END IF;

  -- A broader snapshot that was not explicitly accepted cannot become ready.
  v_bad_plan := public.ad_plan_open(
    'host', 'host', v_brand, 'public_mingla_page',
    'brand:issue-3697-control-plane', '[]'::jsonb, v_user
  );
  v_bad_version := public.ad_plan_create_version(
    v_bad_plan.id,
    '{"platforms":["meta"],"confirmation_phrase":"LAUNCH"}'::jsonb,
    3000000, 'NGN', jsonb_build_array(jsonb_build_object(
      'platform', 'meta', 'connection_id', v_connection,
      'host_budget_cents', 3000000,
      'provider_budget_cents', v_provider_budget,
      'fx_snapshot_id', v_snapshot
    )), v_user
  );
  INSERT INTO public.ad_plan_targeting_snapshots (
    plan_version_id, platform, audience_intent, compiled_targeting, verdict,
    widening_summary, evidence_observed_at, compiler_version
  ) VALUES (
    v_bad_version.id, 'meta', '{"city":"Lagos","radius_km":10}'::jsonb,
    '{"country":"NG"}'::jsonb, 'broader',
    '["city_radius_not_represented"]'::jsonb, now(), 'v1.4-test'
  );
  v_failed := false;
  BEGIN
    PERFORM public.ad_plan_mark_ready(v_bad_version.id, v_bad_version.plan_hash);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := SQLERRM = 'ad_plan_targeting_not_accepted';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'silent_targeting_widening_succeeded'; END IF;

  -- A non-approval is recoverable: staff feedback atomically releases the
  -- pre-create hold so the Host can freeze a new version without trapped funds.
  v_revise_plan := public.ad_plan_open(
    'host', 'host', v_brand, 'public_mingla_page',
    'brand:issue-3697-control-plane', '[]'::jsonb, v_user
  );
  v_revise_version := public.ad_plan_create_version(
    v_revise_plan.id,
    '{"platforms":["meta"],"confirmation_phrase":"LAUNCH"}'::jsonb,
    1500000, 'NGN', jsonb_build_array(jsonb_build_object(
      'platform', 'meta', 'connection_id', v_connection,
      'host_budget_cents', 1500000,
      'provider_budget_cents', 1000,
      'fx_snapshot_id', v_snapshot
    )), v_user
  );
  INSERT INTO public.ad_plan_targeting_snapshots (
    plan_version_id, platform, audience_intent, compiled_targeting, verdict,
    evidence_observed_at, compiler_version
  ) VALUES (
    v_revise_version.id, 'meta', '{"countries":["NG"]}'::jsonb,
    '{"geo_locations":{"countries":["NG"]}}'::jsonb,
    'exact', now(), 'v1.4-test'
  );
  PERFORM public.ad_plan_mark_ready(
    v_revise_version.id, v_revise_version.plan_hash
  );
  PERFORM public.ad_plan_hold_host_funds(
    v_revise_version.id, v_revise_version.plan_hash,
    'v14-review-release-hold', v_user
  );
  PERFORM public.ad_plan_record_review(
    v_revise_version.id, v_revise_version.plan_hash, 'changes_requested',
    'Correct the headline', v_user
  );
  SELECT balance_cents, held_cents INTO v_wallet_balance, v_wallet_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  SELECT * INTO v_hold FROM public.ad_plan_funding_holds
  WHERE plan_version_id = v_revise_version.id;
  IF v_wallet_balance <> 3000000 OR v_wallet_held <> 0
     OR v_hold.state <> 'released' THEN
    RAISE EXCEPTION 'staff_feedback_trapped_host_funds:balance %, held %, hold %',
      v_wallet_balance, v_wallet_held, row_to_json(v_hold);
  END IF;
  v_revised_version := public.ad_plan_create_version(
    v_revise_plan.id,
    '{"platforms":["meta"],"confirmation_phrase":"LAUNCH","headline":"Corrected"}'::jsonb,
    1500000, 'NGN', jsonb_build_array(jsonb_build_object(
      'platform', 'meta', 'connection_id', v_connection,
      'host_budget_cents', 1500000,
      'provider_budget_cents', 1000,
      'fx_snapshot_id', v_snapshot
    )), v_user
  );
  IF v_revised_version.previous_version_id <> v_revise_version.id THEN
    RAISE EXCEPTION 'review_revision_did_not_preserve_version_history';
  END IF;

  v_plan := public.ad_plan_open(
    'ari', 'host', v_brand, 'public_mingla_page',
    'brand:issue-3697-control-plane', '[]'::jsonb, v_user
  );
  IF v_plan.review_required IS DISTINCT FROM true
     OR NOT (v_plan.review_reasons ? 'first_three_host_campaigns') THEN
    RAISE EXCEPTION 'first_three_review_gate_missing:%', row_to_json(v_plan);
  END IF;
  v_version := public.ad_plan_create_version(
    v_plan.id,
    '{"platforms":["meta","tiktok"],"confirmation_phrase":"LAUNCH","destination":"event:issue-3697-control"}'::jsonb,
    3000000, 'NGN', jsonb_build_array(jsonb_build_object(
      'platform', 'meta', 'connection_id', v_connection,
      'host_budget_cents', 1500000,
      'provider_budget_cents', 1000,
      'fx_snapshot_id', v_snapshot
    ), jsonb_build_object(
      'platform', 'tiktok', 'connection_id', v_connection_2,
      'host_budget_cents', 1500000,
      'provider_budget_cents', 1000,
      'fx_snapshot_id', v_snapshot
    )), v_user
  );
  INSERT INTO public.ad_plan_targeting_snapshots (
    plan_version_id, platform, audience_intent, compiled_targeting, verdict,
    provider_estimate, estimate_observed_at, evidence_observed_at, compiler_version
  ) VALUES
  (
    v_version.id, 'meta', '{"countries":["NG"],"age_min":21}'::jsonb,
    '{"geo_locations":{"countries":["NG"]},"age_min":21}'::jsonb,
    'exact', '{"lower_bound":12000,"upper_bound":18000}'::jsonb,
    now(), now(), 'v1.4-test'
  ),
  (
    v_version.id, 'tiktok', '{"countries":["NG"],"age_min":21}'::jsonb,
    '{"location_ids":["NG"],"age_groups":["AGE_21_24","AGE_25_34"]}'::jsonb,
    'exact', '{"lower_bound":9000,"upper_bound":14000}'::jsonb,
    now(), now(), 'v1.4-test'
  );
  PERFORM public.ad_plan_mark_ready(v_version.id, v_version.plan_hash);
  v_hold := public.ad_plan_hold_host_funds(
    v_version.id, v_version.plan_hash, 'v14-control-hold-unique', v_user
  );
  SELECT balance_cents, held_cents INTO v_wallet_balance, v_wallet_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  IF v_wallet_balance <> 0 OR v_wallet_held <> 3000000 OR v_hold.state <> 'held' THEN
    RAISE EXCEPTION 'host_hold_not_atomic:balance %, held %, hold %',
      v_wallet_balance, v_wallet_held, row_to_json(v_hold);
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.ad_plan_assert_launchable(v_version.id, v_version.plan_hash);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := SQLERRM = 'ad_plan_staff_approval_required';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'first_three_plan_launchable_without_review'; END IF;

  v_review := public.ad_plan_record_review(
    v_version.id, v_version.plan_hash, 'approved', 'Controlled test approval', v_user
  );
  IF v_review.plan_hash <> v_version.plan_hash THEN
    RAISE EXCEPTION 'review_hash_not_bound';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.ad_plan_confirm_launch(v_version.id, v_version.plan_hash, 'launch', v_user);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := SQLERRM = 'ad_plan_confirmation_phrase_mismatch';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'typed_confirmation_case_widened'; END IF;
  v_confirmation := public.ad_plan_confirm_launch(
    v_version.id, v_version.plan_hash, 'LAUNCH', v_user
  );
  IF v_confirmation.plan_hash <> v_version.plan_hash THEN
    RAISE EXCEPTION 'confirmation_hash_not_bound';
  END IF;
  PERFORM public.ad_record_provider_attempt(
    v_version.id, v_version.plan_hash, 'meta', 'create_paused_objects',
    'v14-control-meta-create', 'succeeded',
    '{"campaign_id":"meta-campaign-v14"}'::jsonb,
    '{"status":"PAUSED"}'::jsonb, NULL
  );

  INSERT INTO public.ad_campaigns (
    id, connection_id, platform, external_campaign_id, name, objective,
    status, dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
    brand_id, owner_kind, currency, plan_version_id, plan_hash,
    host_budget_cents, provider_budget_cents, fx_snapshot_id
  ) VALUES (
    v_campaign, v_connection, 'meta', 'meta-campaign-v14',
    'Issue 3697 v1.4', 'OUTCOME_TRAFFIC', 'PAUSED', 'event',
    'issue-3697-control-plane',
    'https://usemingla.com/e/issue-3697-control-plane/control',
    'https://usemingla.com/e/issue-3697-control-plane/control',
    v_brand, 'host', 'NGN', v_version.id, v_version.plan_hash,
    1500000, 1000, v_snapshot
  );
  INSERT INTO public.ad_campaigns (
    id, connection_id, platform, external_campaign_id, name, objective,
    status, dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
    brand_id, owner_kind, currency, plan_version_id, plan_hash,
    host_budget_cents, provider_budget_cents, fx_snapshot_id
  ) VALUES (
    v_campaign_2, v_connection_2, 'tiktok', 'tiktok-campaign-v14',
    'Issue 3697 v1.4 TikTok', 'TRAFFIC', 'PAUSED', 'event',
    'issue-3697-control-plane',
    'https://usemingla.com/e/issue-3697-control-plane/control',
    'https://usemingla.com/e/issue-3697-control-plane/control',
    v_brand, 'host', 'NGN', v_version.id, v_version.plan_hash,
    1500000, 1000, v_snapshot
  );

  v_failed := false;
  BEGIN
    UPDATE public.ad_plan_versions SET host_budget_cents = 1 WHERE id = v_version.id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := SQLERRM = 'ad_immutable_record';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'plan_version_mutation_succeeded'; END IF;

  UPDATE public.ad_plans SET state = 'platform_review' WHERE id = v_plan.id;
  UPDATE public.ad_plans SET state = 'live' WHERE id = v_plan.id;
  UPDATE public.ad_campaigns SET status = 'ACTIVE'
  WHERE id IN (v_campaign, v_campaign_2);
  v_settlement := public.ad_request_campaign_stop(v_campaign, now());
  v_settlement_2 := public.ad_request_campaign_stop(v_campaign_2, now());
  SELECT balance_cents, held_cents INTO v_wallet_balance, v_wallet_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  IF v_wallet_balance <> 0 OR v_wallet_held <> 3000000
     OR v_settlement.state <> 'stop_requested' THEN
    RAISE EXCEPTION 'stop_released_money_early';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.ad_finalize_campaign_settlement(
      v_campaign, 'v14-control-settle-too-early', now()
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := SQLERRM = 'ad_settlement_not_final';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'settled_without_provider_confirmation'; END IF;

  v_settlement := public.ad_confirm_campaign_stop(
    v_campaign, 500, 'USD', now(),
    '{"provider_status":"PAUSED","final_insights_id":"insight-v14"}'::jsonb,
    interval '0'
  );
  v_settlement := public.ad_finalize_campaign_settlement(
    v_campaign, 'v14-control-settle-meta', now() + interval '1 second'
  );
  SELECT balance_cents, held_cents INTO v_wallet_balance, v_wallet_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  IF v_settlement.state <> 'ready_to_settle'
     OR v_settlement.final_host_spend_cents <> 750000
     OR v_wallet_balance <> 0 OR v_wallet_held <> 3000000 THEN
    RAISE EXCEPTION 'partial_platform_settlement_released_money:settlement %, balance %, held %',
      row_to_json(v_settlement), v_wallet_balance, v_wallet_held;
  END IF;
  v_settlement_2 := public.ad_confirm_campaign_stop(
    v_campaign_2, 500, 'USD', now(),
    '{"provider_status":"PAUSED","final_insights_id":"insight-v14-tiktok"}'::jsonb,
    interval '0'
  );
  v_settlement_2 := public.ad_finalize_campaign_settlement(
    v_campaign_2, 'v14-control-settle-final', now() + interval '1 second'
  );
  SELECT balance_cents, held_cents INTO v_wallet_balance, v_wallet_held
  FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  IF v_settlement_2.state <> 'settled'
     OR v_settlement_2.final_host_spend_cents <> 750000
     OR v_settlement_2.released_host_cents <> 1500000
     OR v_wallet_balance <> 1500000 OR v_wallet_held <> 0 THEN
    RAISE EXCEPTION 'final_settlement_wrong:settlement %, balance %, held %',
      row_to_json(v_settlement_2), v_wallet_balance, v_wallet_held;
  END IF;
END;
$test$;

ROLLBACK;
