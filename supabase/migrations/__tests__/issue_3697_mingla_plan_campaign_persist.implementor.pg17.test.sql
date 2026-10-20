-- Issue #3697: a Mingla-owned plan's campaign row persists exactly as
-- admin-ad-create-campaign builds it after the provider create.
-- Production 2026-10-20 (plan 534424c7, Meta): the provider create succeeded,
-- then the insert carried brand_id = the promoted page's brand while the
-- Mingla plan's brand_id is NULL, so ad_campaign_plan_binding_guard raised
-- ad_campaign_plan_binding_mismatch and the paid objects were rolled back.
-- Database half of I-3697-BOUND-PLAN-OWNERSHIP (declared beside the Deno gate,
-- supabase/functions/_shared/__tests__/issue_3697_plan_campaign_binding.test.ts).

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '36973000-0000-4000-8000-000000000001';
  v_brand constant uuid := '36973000-0000-4000-8000-000000000011';
  v_connection constant uuid := '36973000-0000-4000-8000-000000000021';
  v_campaign constant uuid := '36973000-0000-4000-8000-000000000041';
  v_plan public.ad_plans%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_row public.ad_campaigns%ROWTYPE;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'issue-3697-mingla-persist@example.test');
  INSERT INTO public.creator_accounts (id, email)
  VALUES (v_user, 'issue-3697-mingla-persist@example.test');
  -- The Host whose public page the Mingla-owned plan promotes.
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, paystack_subaccount_code
  ) VALUES (
    v_brand, v_user, 'Issue 3697 promoted host', 'issue-3697-mingla-persist',
    'NGN', 'paystack', 'NG', 'ACCT_issue3697_mingla_persist'
  );
  INSERT INTO public.ad_connections (
    id, platform, lane, display_name, external_account_id, auth_kind,
    token_env_var, status, currency, connected
  ) VALUES (
    v_connection, 'meta', 'consumer', 'Issue 3697 Mingla USD Meta',
    'act_issue3697_mingla_persist', 'system_user_token',
    'ISSUE_3697_MINGLA_PERSIST_TOKEN', 'connected', 'USD', true
  );

  v_plan := public.ad_plan_open(
    'admin', 'mingla', NULL, 'public_mingla_page',
    'brand:issue-3697-mingla-persist', '[]'::jsonb, v_user
  );
  IF v_plan.brand_id IS NOT NULL OR v_plan.owner_kind <> 'mingla' THEN
    RAISE EXCEPTION 'fixture: Mingla plan must have no brand_id';
  END IF;
  v_version := public.ad_plan_create_version(
    v_plan.id,
    jsonb_build_object(
      'platforms', jsonb_build_array('meta'),
      'confirmation_phrase', 'CREATE PAUSED',
      'media_rights', jsonb_build_object(
        'rights_confirmed', true, 'rights_basis', 'owned',
        'ai_generated', false, 'house_reuse_allowed', false,
        'attested_by', v_user::text, 'attested_at', now()
      )
    ),
    12000, 'USD', jsonb_build_array(jsonb_build_object(
      'platform', 'meta', 'connection_id', v_connection,
      'host_budget_cents', 12000, 'host_delivery_budget_cents', 4000,
      'provider_budget_cents', 12000, 'provider_delivery_budget_cents', 4000
    )), v_user
  );
  INSERT INTO public.ad_plan_targeting_snapshots (
    plan_version_id, platform, audience_intent, compiled_targeting, verdict,
    evidence_observed_at, compiler_version
  ) VALUES (
    v_version.id, 'meta', '{"countries":["NG"]}'::jsonb,
    '{"geo_locations":{"countries":["NG"]}}'::jsonb, 'exact', now(),
    'v1.4-issue-3697-persist'
  );
  PERFORM public.ad_plan_mark_ready(v_version.id, v_version.plan_hash);
  PERFORM public.ad_plan_mark_admin_funded(v_version.id, v_version.plan_hash);
  PERFORM public.ad_plan_confirm_launch(
    v_version.id, v_version.plan_hash, 'CREATE PAUSED', v_user
  );
  IF (SELECT host_currency FROM public.ad_plan_provider_allocations
      WHERE plan_version_id = v_version.id) <> 'USD' THEN
    RAISE EXCEPTION 'fixture: allocation must carry USD like production';
  END IF;

  -- (1) The pre-fix row: brand_id resolved from the promoted page's slug.
  v_failed := false;
  BEGIN
    INSERT INTO public.ad_campaigns (
      connection_id, platform, external_campaign_id, name, objective, status,
      dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
      brand_id, owner_kind, currency, plan_version_id, plan_hash,
      host_currency, provider_currency, host_budget_cents,
      provider_budget_cents, provider_delivery_budget_cents, fx_snapshot_id,
      cap_cents
    ) VALUES (
      v_connection, 'meta', 'meta-3697-prefix', 'Issue 3697 pre-fix row',
      'OUTCOME_TRAFFIC', 'PAUSED', 'brand', 'issue-3697-mingla-persist',
      'https://host.usemingla.com/b/issue-3697-mingla-persist',
      'https://host.usemingla.com/b/issue-3697-mingla-persist',
      v_brand, 'mingla', 'USD', v_version.id, v_version.plan_hash,
      'USD', 'USD', 12000, 12000, 4000, NULL, 12000
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := SQLERRM = 'ad_campaign_plan_binding_mismatch';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'a Mingla row carrying the page brand passed the plan guard';
  END IF;

  -- (2) The row exactly as the fixed function builds it (boundPlanMoney +
  -- campaignPersistBrandId): brand_id = plan brand (NULL), host_currency NULL.
  INSERT INTO public.ad_campaigns (
    id, connection_id, platform, external_campaign_id, name, objective, status,
    dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
    brand_id, owner_kind, currency, plan_version_id, plan_hash,
    host_currency, provider_currency, host_budget_cents,
    provider_budget_cents, provider_delivery_budget_cents, fx_snapshot_id,
    cap_cents
  ) VALUES (
    v_campaign, v_connection, 'meta', 'meta-3697-fixed', 'Issue 3697 fixed row',
    'OUTCOME_TRAFFIC', 'PAUSED', 'brand', 'issue-3697-mingla-persist',
    'https://host.usemingla.com/b/issue-3697-mingla-persist',
    'https://host.usemingla.com/b/issue-3697-mingla-persist',
    NULL, 'mingla', 'USD', v_version.id, v_version.plan_hash,
    NULL, 'USD', 12000, 12000, 4000, NULL, 12000
  ) RETURNING * INTO v_row;
  IF v_row.brand_id IS NOT NULL OR v_row.host_currency IS NOT NULL
     OR v_row.currency <> 'USD' OR v_row.owner_kind <> 'mingla' THEN
    RAISE EXCEPTION 'fixed Mingla row was rewritten: %', row_to_json(v_row);
  END IF;
  IF (SELECT state FROM public.ad_plans WHERE id = v_plan.id)
     <> 'platform_review' THEN
    RAISE EXCEPTION 'single-provider Mingla plan did not reach platform_review';
  END IF;
  IF (SELECT state FROM public.ad_provider_attempts
      WHERE plan_version_id = v_version.id AND platform = 'meta'
        AND idempotency_key = v_version.plan_hash || ':meta:create')
     <> 'succeeded' THEN
    RAISE EXCEPTION 'create success was not recorded on the plan-hash key';
  END IF;

  -- (3) Idempotency (20271122003697): a second Meta row for the same plan
  -- version is refused, so a repeated create rolls its provider objects back.
  v_failed := false;
  BEGIN
    INSERT INTO public.ad_campaigns (
      connection_id, platform, external_campaign_id, name, objective, status,
      dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
      brand_id, owner_kind, currency, plan_version_id, plan_hash,
      host_currency, provider_currency, host_budget_cents,
      provider_budget_cents, provider_delivery_budget_cents, fx_snapshot_id,
      cap_cents
    ) VALUES (
      v_connection, 'meta', 'meta-3697-duplicate', 'Issue 3697 duplicate',
      'OUTCOME_TRAFFIC', 'PAUSED', 'brand', 'issue-3697-mingla-persist',
      'https://host.usemingla.com/b/issue-3697-mingla-persist',
      'https://host.usemingla.com/b/issue-3697-mingla-persist',
      NULL, 'mingla', 'USD', v_version.id, v_version.plan_hash,
      NULL, 'USD', 12000, 12000, 4000, NULL, 12000
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := SQLERRM LIKE '%ad_campaigns_one_per_plan_version_platform%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'a second Meta campaign persisted for one plan hash';
  END IF;
END;
$test$;

ROLLBACK;
