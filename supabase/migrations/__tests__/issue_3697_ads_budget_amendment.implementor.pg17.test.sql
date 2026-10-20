-- Issue #3697: a live Mingla plan's budget changes only through an
-- append-only amendment bound to the exact plan version + hash. The cap can
-- never drop below spend-to-date, the provider-account hold follows the new
-- cap, the 98% auto-pause reads the amended cap, and the plan binding guard
-- still refuses any direct edit of the frozen allocation columns.
-- Database half of I-3697-BUDGET-CHANGE-AMENDS-NEVER-REWRITES (declared beside
-- the Deno gate, supabase/functions/_shared/__tests__/issue_3697_ads_budget_change.test.ts).

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '36973200-0000-4000-8000-000000000001';
  v_connection constant uuid := '36973200-0000-4000-8000-000000000021';
  v_campaign constant uuid := '36973200-0000-4000-8000-000000000041';
  v_plan public.ad_plans%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_row public.ad_campaigns%ROWTYPE;
  v_result jsonb;
  v_failed text;
  v_amendment_id uuid;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'issue-3697-budget@example.test');
  INSERT INTO public.creator_accounts (id, email)
  VALUES (v_user, 'issue-3697-budget@example.test');
  INSERT INTO public.ad_connections (
    id, platform, lane, display_name, external_account_id, auth_kind,
    token_env_var, status, currency, connected
  ) VALUES (
    v_connection, 'meta', 'consumer', 'Issue 3697 budget Meta',
    'act_issue3697_budget', 'system_user_token',
    'ISSUE_3697_BUDGET_TOKEN', 'connected', 'USD', true
  );
  v_plan := public.ad_plan_open(
    'admin', 'mingla', NULL, 'marketing_page', 'explorer', '[]'::jsonb, v_user
  );
  v_version := public.ad_plan_create_version(
    v_plan.id,
    jsonb_build_object(
      'name', 'Deserted Island 6.0',
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
      'host_budget_cents', 12000, 'host_delivery_budget_cents', 3000,
      'provider_budget_cents', 12000, 'provider_delivery_budget_cents', 3000
    )), v_user
  );
  INSERT INTO public.ad_plan_targeting_snapshots (
    plan_version_id, platform, audience_intent, compiled_targeting, verdict,
    evidence_observed_at, compiler_version
  ) VALUES (
    v_version.id, 'meta', '{"countries":["NG"]}'::jsonb,
    '{"geo_locations":{"countries":["NG"]}}'::jsonb, 'exact', now(),
    'v1.4-issue-3697-budget'
  );
  PERFORM public.ad_plan_mark_ready(v_version.id, v_version.plan_hash);
  PERFORM public.ad_plan_mark_admin_funded(v_version.id, v_version.plan_hash);
  PERFORM public.ad_plan_confirm_launch(
    v_version.id, v_version.plan_hash, 'CREATE PAUSED', v_user
  );
  INSERT INTO public.ad_campaigns (
    id, connection_id, platform, external_campaign_id, name, objective, status,
    daily_budget_cents, dest_page_type, dest_brand_slug, dest_url,
    dest_smart_link, brand_id, owner_kind, currency, plan_version_id,
    plan_hash, host_currency, provider_currency, host_budget_cents,
    provider_budget_cents, provider_delivery_budget_cents, fx_snapshot_id,
    cap_cents
  ) VALUES (
    v_campaign, v_connection, 'meta', '52609700000001', 'Deserted Island 6.0',
    'OUTCOME_TRAFFIC', 'ACTIVE', 3000, 'marketing', 'mingla',
    'https://host.usemingla.com/explorer', 'https://host.usemingla.com/explorer',
    NULL, 'mingla', 'USD', v_version.id, v_version.plan_hash,
    NULL, 'USD', 12000, 12000, 3000, NULL, 12000
  );
  INSERT INTO public.ad_spend_daily (campaign_id, platform, spend_date, spend_cents, currency)
  VALUES (v_campaign, 'meta', current_date, 5000, 'USD');

  -- (1) A cap below spend-to-date is refused; nothing changes.
  v_failed := NULL;
  BEGIN
    PERFORM public.ad_plan_amend_budget(
      v_version.id, v_version.plan_hash,
      jsonb_build_array(jsonb_build_object(
        'campaign_id', v_campaign, 'new_provider_budget_cents', 4000,
        'new_provider_delivery_budget_cents', 1000
      )), 'Lower it', v_user
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'ad_budget_cap_below_spend:4000:5000' THEN
    RAISE EXCEPTION 'a cap below spend must refuse: %', v_failed;
  END IF;

  -- (2) A reason is required.
  v_failed := NULL;
  BEGIN
    PERFORM public.ad_plan_amend_budget(
      v_version.id, v_version.plan_hash,
      jsonb_build_array(jsonb_build_object(
        'campaign_id', v_campaign, 'new_provider_budget_cents', 16000,
        'new_provider_delivery_budget_cents', 4500
      )), '   ', v_user
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'ad_budget_reason_required' THEN
    RAISE EXCEPTION 'an empty reason must refuse: %', v_failed;
  END IF;

  -- (3) $30/day + $120 cap → $45/day + $160 cap.
  v_result := public.ad_plan_amend_budget(
    v_version.id, v_version.plan_hash,
    jsonb_build_array(jsonb_build_object(
      'campaign_id', v_campaign, 'new_provider_budget_cents', 16000,
      'new_provider_delivery_budget_cents', 4500
    )), 'Clicks are cheap on day 1', v_user,
    jsonb_build_object(v_campaign::text, jsonb_build_object('daily_budget', 4500))
  );
  SELECT * INTO v_row FROM public.ad_campaigns WHERE id = v_campaign;
  IF v_row.amended_provider_budget_cents <> 16000
     OR v_row.amended_provider_delivery_budget_cents <> 4500
     OR v_row.cap_cents <> 16000 OR v_row.daily_budget_cents <> 4500
     OR v_row.provider_budget_cents <> 12000
     OR v_row.provider_delivery_budget_cents <> 3000 THEN
    RAISE EXCEPTION 'campaign row not amended as expected: %', row_to_json(v_row);
  END IF;
  IF (SELECT amount_cents FROM public.ad_plan_funding_holds
      WHERE plan_version_id = v_version.id) <> 16000 THEN
    RAISE EXCEPTION 'the hold did not follow the new cap';
  END IF;
  IF (SELECT state FROM public.ad_plan_funding_holds
      WHERE plan_version_id = v_version.id) <> 'held' THEN
    RAISE EXCEPTION 'the hold must stay held';
  END IF;
  SELECT (v_result->'amendments'->0->>'id')::uuid INTO v_amendment_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_plan_budget_amendments a
    WHERE a.id = v_amendment_id AND a.sequence = 1
      AND a.previous_provider_budget_cents = 12000 AND a.new_provider_budget_cents = 16000
      AND a.previous_provider_delivery_budget_cents = 3000
      AND a.new_provider_delivery_budget_cents = 4500
      AND a.spend_to_date_cents = 5000 AND a.previous_hold_cents = 12000
      AND a.new_hold_cents = 16000 AND a.created_by = v_user
      AND a.plan_hash = v_version.plan_hash
  ) THEN
    RAISE EXCEPTION 'amendment row wrong: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_status_events e
    WHERE e.campaign_id = v_campaign AND e.action = 'budget_change'
      AND e.actor = v_user AND (e.provider_response->>'new_cap_cents')::bigint = 16000
      AND e.provider_response->>'reason' = 'Clicks are cheap on day 1'
  ) THEN
    RAISE EXCEPTION 'budget_change audit row missing';
  END IF;

  -- (4) Amendments are immutable.
  v_failed := NULL;
  BEGIN
    UPDATE public.ad_plan_budget_amendments SET reason = 'edited'
    WHERE id = v_amendment_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'ad_immutable_record' THEN
    RAISE EXCEPTION 'an amendment must be immutable: %', v_failed;
  END IF;

  -- (5) The amended columns cannot be edited around the RPC.
  v_failed := NULL;
  BEGIN
    UPDATE public.ad_campaigns SET amended_provider_budget_cents = 99999
    WHERE id = v_campaign;
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'ad_campaign_budget_amendment_mismatch' THEN
    RAISE EXCEPTION 'a direct amended-cap edit must refuse: %', v_failed;
  END IF;

  -- (6) The plan binding guard is not weakened: the frozen columns still refuse.
  v_failed := NULL;
  BEGIN
    UPDATE public.ad_campaigns SET provider_budget_cents = 16000
    WHERE id = v_campaign;
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM;
  END;
  IF v_failed IS NULL THEN
    RAISE EXCEPTION 'the frozen allocation column was rewritten';
  END IF;

  -- (7) A second change is sequence 2 and starts from the amended values.
  v_result := public.ad_plan_amend_budget(
    v_version.id, v_version.plan_hash,
    jsonb_build_array(jsonb_build_object(
      'campaign_id', v_campaign, 'new_provider_budget_cents', 15000,
      'new_provider_delivery_budget_cents', 2000
    )), 'Lowering for the weekday', v_user
  );
  IF (v_result->'amendments'->0->>'sequence')::int <> 2
     OR (v_result->'amendments'->0->>'previous_provider_budget_cents')::bigint <> 16000
     OR (v_result->'funding_hold'->>'amount_cents')::bigint <> 15000 THEN
    RAISE EXCEPTION 'second amendment wrong: %', v_result;
  END IF;

  -- (8) Every campaign of the plan must be listed.
  v_failed := NULL;
  BEGIN
    PERFORM public.ad_plan_amend_budget(
      v_version.id, v_version.plan_hash, '[]'::jsonb, 'x', v_user
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'ad_budget_changes_invalid' THEN
    RAISE EXCEPTION 'empty changes must refuse: %', v_failed;
  END IF;

  IF has_function_privilege('authenticated',
       'public.ad_plan_amend_budget(uuid,text,jsonb,text,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute ad_plan_amend_budget';
  END IF;
END;
$test$;

ROLLBACK;
